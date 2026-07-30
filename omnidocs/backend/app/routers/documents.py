import os
import uuid
import shutil
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status, BackgroundTasks
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Document
from ..auth import get_current_user_id
from ..config import settings
from ..services.rag import process_document_background

router = APIRouter(prefix="/api/documents", tags=["documents"])

@router.post("", status_code=status.HTTP_201_CREATED)
async def upload_document(
    file: UploadFile = File(...),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db)
):
    # Enforce PDF files for this phase
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PDF files are supported in this phase."
        )

    # Generate unique storage filename to avoid collisions and path injections
    unique_id = str(uuid.uuid4())
    storage_filename = f"{unique_id}.pdf"
    storage_path = os.path.join(settings.STORAGE_DIR, storage_filename)

    try:
        # Save file to disk
        with open(storage_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        # Get file size
        file_size = os.path.getsize(storage_path)
        
        # Create database record
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
        
        # Trigger background processing
        background_tasks.add_task(process_document_background, db_doc.id, storage_path)
        
        return db_doc.to_dict()
        
    except Exception as e:
        # Clean up file if DB insert fails
        if os.path.exists(storage_path):
            os.remove(storage_path)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process and store document: {str(e)}"
        )

@router.get("")
async def list_documents(
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db)
):
    docs = db.query(Document).filter(Document.user_id == user_id).order_by(Document.uploaded_at.desc()).all()
    return [doc.to_dict() for doc in docs]

@router.delete("/{document_id}")
async def delete_document(
    document_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db)
):
    doc = db.query(Document).filter(Document.id == document_id, Document.user_id == user_id).first()
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found or access denied."
        )

    try:
        # Delete file from disk
        if os.path.exists(doc.file_path):
            os.remove(doc.file_path)
            
        # Delete record from database
        db.delete(doc)
        db.commit()
        
        return {"message": "Document deleted successfully"}
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete document: {str(e)}"
        )
