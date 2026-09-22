import logging
import os
import uuid
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status, BackgroundTasks, Request
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Document, DocumentChunk
from ..auth import get_current_user_id
from ..config import settings
from ..errors import internal_error
from ..services.rag import process_document_background
from .chat import get_user_document
from ..main import limiter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/documents", tags=["documents"])

# Read uploads in fixed-size blocks so a large file is never held in memory
# in full, and the size limit can be enforced mid-stream.
_UPLOAD_CHUNK_BYTES = 1024 * 1024

# PDF magic bytes. Guards against a non-PDF payload with a .pdf extension.
_PDF_MAGIC = b"%PDF-"


async def _save_upload_with_limit(file: UploadFile, destination: str) -> int:
    """Streams an upload to disk, enforcing the configured size limit.

    Returns the number of bytes written. Raises HTTPException(413) as soon as
    the limit is exceeded, so an oversized upload is abandoned partway through
    rather than being buffered in full first.
    """
    max_bytes = settings.max_upload_bytes
    total = 0

    with open(destination, "wb") as buffer:
        while True:
            chunk = await file.read(_UPLOAD_CHUNK_BYTES)
            if not chunk:
                break

            if total == 0:
                if destination.lower().endswith('.pdf') and not chunk.startswith(_PDF_MAGIC):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="File does not appear to be a valid PDF.",
                    )

            total += len(chunk)
            if total > max_bytes:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=f"File exceeds the {settings.MAX_UPLOAD_MB}MB upload limit.",
                )

            buffer.write(chunk)

    if total == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty.",
        )

    return total


@router.post("", status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
async def upload_document(
    request: Request,
    file: UploadFile = File(...),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db)
):
    print(f"\n>>> UPLOAD START: {file.filename}")
    # Enforce supported files for this phase
    allowed_exts = (".pdf", ".txt", ".md", ".docx")
    if not file.filename or not file.filename.lower().endswith(allowed_exts):
        print(f"!!! Upload rejected: unsupported extension {file.filename}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Only {', '.join(allowed_exts)} files are supported in this phase."
        )

    # Generate unique storage filename to avoid collisions and path injections
    unique_id = str(uuid.uuid4())
    ext = os.path.splitext(file.filename)[1].lower() if file.filename else ".pdf"
    storage_filename = f"{unique_id}{ext}"
    storage_path = os.path.join(settings.STORAGE_DIR, storage_filename)
    print(f"--- Saving to: {storage_path}")

    try:
        file_size = await _save_upload_with_limit(file, storage_path)
        print(f"--- Saved successfully, size: {file_size} bytes")

        # Create database record
        print(f"--- Creating DB record for user {user_id}")
        db_doc = Document(
            id=unique_id,
            user_id=user_id,
            filename=file.filename,
            file_path=storage_path,
            file_size=file_size,
            status="processing"
        )

        db.add(db_doc)
        db.commit()
        db.refresh(db_doc)
        print(f"--- DB record committed: {db_doc.id}")

        # Trigger background processing
        background_tasks.add_task(process_document_background, db_doc.id, storage_path)
        print(f"--- Background task queued for {db_doc.id}")

        return db_doc.to_dict()

    except HTTPException:
        print("!!! Validation failure, cleaning up...")
        if os.path.exists(storage_path):
            os.remove(storage_path)
        raise
    except Exception as e:
        print(f"!!! CRITICAL ERROR during upload: {str(e)}")
        if os.path.exists(storage_path):
            os.remove(storage_path)
        raise internal_error("Failed to process and store document", e)

@router.get("")
async def list_documents(
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db)
):
    docs = db.query(Document).filter(Document.user_id == user_id).order_by(Document.uploaded_at.desc()).all()
    return [doc.to_dict() for doc in docs]


@router.get("/{document_id}")
async def get_document(
    document_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db)
):
    """Fetches a single document's metadata, so clients don't have to pull the
    full library and filter client-side."""
    return get_user_document(db, document_id, user_id).to_dict()


@router.get("/{document_id}/file")
async def get_document_file(
    document_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db)
):
    """Serves the original PDF bytes for inline viewing.

    Ownership is verified before the file is served, and the path comes from
    the database record (a server-generated UUID filename) rather than from
    any client-supplied value.
    """
    doc = get_user_document(db, document_id, user_id)

    if not os.path.exists(doc.file_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The stored file for this document is missing.",
        )

    return FileResponse(
        doc.file_path,
        media_type="application/pdf",
        filename=doc.filename,
        content_disposition_type="inline",
    )

@router.post("/{document_id}/reprocess", status_code=status.HTTP_202_ACCEPTED)
async def reprocess_document(
    document_id: str,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db)
):
    """Re-runs extraction and indexing for an already-uploaded document.

    Useful when indexing quality has improved (better garbled-text detection,
    OCR fallback, etc.) since the document was first processed — without
    requiring the user to delete and re-upload the file.
    """
    doc = get_user_document(db, document_id, user_id)

    if not os.path.exists(doc.file_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The stored file for this document is missing and cannot be reprocessed.",
        )

    # Old chunks would otherwise sit alongside the freshly-extracted ones;
    # clear them and flip back to "processing" so the UI reflects the new run.
    db.query(DocumentChunk).filter(DocumentChunk.document_id == document_id).delete()
    doc.status = "processing"
    db.commit()

    background_tasks.add_task(process_document_background, doc.id, doc.file_path)

    return doc.to_dict()


@router.delete("/{document_id}")
async def delete_document(
    document_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db)
):
    doc = get_user_document(db, document_id, user_id)
    file_path = doc.file_path

    try:
        # Remove the database record first: a missing row with an orphaned file
        # on disk is easier to reconcile than a row pointing at a deleted file.
        db.delete(doc)
        db.commit()
    except Exception as e:
        db.rollback()
        raise internal_error("Failed to delete document", e)

    if os.path.exists(file_path):
        try:
            os.remove(file_path)
        except OSError as e:
            # The record is already gone; a leftover file shouldn't fail the request.
            logger.warning(
                "Deleted document %s but could not remove %s: %s",
                document_id, file_path, e,
            )

    return {"message": "Document deleted successfully"}
