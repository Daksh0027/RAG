import os
import logging
import uuid
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status, BackgroundTasks, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Document, DocumentChunk
from ..auth import get_current_user_id
from ..config import settings
from ..errors import internal_error
from ..services.rag import process_document_background
from .chat import get_user_document
from ..main import limiter
from supabase import create_client, Client

logger = logging.getLogger(__name__)

# Initialize Supabase Client for Storage
supabase: Client = create_client(settings.NEXT_PUBLIC_SUPABASE_URL, settings.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)

router = APIRouter(prefix="/api/documents", tags=["documents"])

_UPLOAD_CHUNK_BYTES = 1024 * 1024
_PDF_MAGIC = b"%PDF-"

async def _upload_to_supabase_storage(file: UploadFile, path: str) -> int:
    """Streams an upload to Supabase Storage, enforcing size limit."""
    max_bytes = settings.max_upload_bytes
    total = 0

    # Buffer for initial magic byte check and size enforcement
    buffer = bytearray()

    while True:
        chunk = await file.read(_UPLOAD_CHUNK_BYTES)
        if not chunk:
            break

        if total == 0:
            if path.lower().endswith('.pdf') and not chunk.startswith(_PDF_MAGIC):
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
        buffer.extend(chunk)

    if total == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty.",
        )

    # Upload the accumulated buffer to Supabase
    try:
        supabase.storage.from_("documents").upload(
            path=path,
            file=bytes(buffer),
            file_options={"content-type": "application/octet-stream"}
        )
    except Exception as e:
        logger.error(f"Supabase storage upload failed: {e}")
        raise internal_error("Failed to upload file to cloud storage", e)

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
    allowed_exts = (".pdf", ".txt", ".md", ".docx")
    if not file.filename or not file.filename.lower().endswith(allowed_exts):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Only {', '.join(allowed_exts)} files are supported."
        )

    unique_id = str(uuid.uuid4())
    ext = os.path.splitext(file.filename)[1].lower() if file.filename else ".pdf"
    storage_path = f"{unique_id}{ext}"

    try:
        file_size = await _upload_to_supabase_storage(file, storage_path)

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

        background_tasks.add_task(process_document_background, db_doc.id, storage_path)
        return db_doc.to_dict()

    except HTTPException:
        raise
    except Exception as e:
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
    return get_user_document(db, document_id, user_id).to_dict()

@router.get("/{document_id}/file")
async def get_document_file(
    document_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db)
):
    doc = get_user_document(db, document_id, user_id)

    try:
        # Generate a signed URL for the file in Supabase Storage
        res = supabase.storage.from_("documents").create_signed_url(doc.file_path, 60)
        if not res.data:
            raise HTTPException(status_code=404, detail="File not found in storage")

        # Redirect to the signed URL
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url=res.data['signedURL'])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching file: {str(e)}")

@router.post("/{document_id}/reprocess", status_code=status.HTTP_202_ACCEPTED)
async def reprocess_document(
    document_id: str,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db)
):
    doc = get_user_document(db, document_id, user_id)
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
        # Remove from Supabase Storage
        supabase.storage.from_("documents").remove([file_path])
        db.delete(doc)
        db.commit()
    except Exception as e:
        db.rollback()
        raise internal_error("Failed to delete document", e)
    return {"message": "Document deleted successfully"}
