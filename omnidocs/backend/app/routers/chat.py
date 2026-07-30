from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Document, DocumentChunk, Message
from ..auth import get_current_user_id
from ..services.rag import generate_chat_response, generate_embedding

router = APIRouter(prefix="/api/documents", tags=["chat"])

class ChatRequest(BaseModel):
    message: str

@router.get("/{document_id}/chat")
async def get_chat_history(
    document_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db)
):
    # Verify document ownership
    doc = db.query(Document).filter(Document.id == document_id, Document.user_id == user_id).first()
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found or access denied."
        )

    # Fetch messages ordered by time
    messages = db.query(Message).filter(Message.document_id == document_id).order_by(Message.created_at.asc()).all()
    
    return [
        {
            "id": msg.id,
            "role": msg.role,
            "content": msg.content,
            "sources": msg.sources,
            "created_at": msg.created_at.isoformat() if msg.created_at else None
        }
        for msg in messages
    ]

@router.post("/{document_id}/chat")
async def chat_with_document(
    document_id: str,
    payload: ChatRequest,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db)
):
    # Verify document ownership and status
    doc = db.query(Document).filter(Document.id == document_id, Document.user_id == user_id).first()
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found or access denied."
        )
        
    if doc.status == "processing":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Document is still being parsed and indexed. Please wait a few moments."
        )
    elif doc.status == "failed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Indexing failed for this document. Try deleting and uploading again."
        )

    user_message = payload.message.strip()
    if not user_message:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Message content cannot be empty."
        )

    try:
        # 1. Embed user query (specifying is_query=True for retrieval_query)
        query_embedding = generate_embedding(user_message, is_query=True)
        
        # 2. Retrieve top-K most similar text chunks using cosine distance
        chunks = db.query(DocumentChunk).filter(
            DocumentChunk.document_id == document_id
        ).order_by(
            DocumentChunk.embedding.cosine_distance(query_embedding)
        ).limit(5).all()
        
        # 3. Formulate RAG prompt with retrieved context
        context_text = "\n\n".join([f"--- Chunk ---\n{chunk.content}" for chunk in chunks])
        
        system_prompt = (
            "You are an expert AI document analysis assistant.\n"
            "Answer the user's question as accurately and objectively as possible using ONLY the context provided below from their document.\n"
            "If the retrieved context does not contain the answer, state that you cannot find the answer in the document.\n"
            "Do not make up facts, URLs, or external references.\n\n"
            f"[RETRIEVED CONTEXT]:\n{context_text}"
        )
        
        # 4. Generate a completion using the active provider.
        ai_response = generate_chat_response(system_prompt, user_message)
        
        # 5. Save user query and assistant response to chat history
        db_user_msg = Message(
            document_id=document_id,
            role="user",
            content=user_message
        )
        
        # Compile citation sources list
        sources = [
            {
                "content": chunk.content,
                "page_number": chunk.page_number
            }
            for chunk in chunks
        ]
        
        db_ai_msg = Message(
            document_id=document_id,
            role="assistant",
            content=ai_response,
            sources=sources
        )
        
        db.add(db_user_msg)
        db.add(db_ai_msg)
        db.commit()
        
        return {
            "role": "assistant",
            "content": ai_response,
            "sources": sources
        }
        
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An error occurred during RAG synthesis: {str(e)}"
        )
