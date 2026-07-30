from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Document, DocumentChunk, Message, Workspace
from ..auth import get_current_user_id
from ..services.rag import generate_chat_response, generate_embedding, generate_comparison_table

router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])

class WorkspaceCreate(BaseModel):
    name: str
    document_ids: list[str]

class ChatRequest(BaseModel):
    message: str

class CompareRequest(BaseModel):
    fields: list[str] | None = None

@router.post("", status_code=status.HTTP_201_CREATED)
async def create_workspace(
    payload: WorkspaceCreate,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db)
):
    name = payload.name.strip()
    if not name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Workspace name cannot be empty."
        )
        
    if not payload.document_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A workspace must contain at least one document."
        )

    # Verify user owns all target documents
    user_docs = db.query(Document).filter(
        Document.id.in_(payload.document_ids),
        Document.user_id == user_id
    ).all()
    
    if len(user_docs) != len(payload.document_ids):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Some requested documents were not found or access was denied."
        )

    # Create workspace
    db_ws = Workspace(
        user_id=user_id,
        name=name,
        document_ids=payload.document_ids
    )
    db.add(db_ws)
    db.commit()
    db.refresh(db_ws)
    
    return {
        "id": db_ws.id,
        "name": db_ws.name,
        "document_ids": db_ws.document_ids,
        "created_at": db_ws.created_at.isoformat()
    }

@router.get("")
async def list_workspaces(
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db)
):
    workspaces = db.query(Workspace).filter(Workspace.user_id == user_id).order_by(Workspace.created_at.desc()).all()
    
    # We will enrich workspace objects with lists of document metadata (filenames, sizes, etc.)
    enriched = []
    for ws in workspaces:
        docs = db.query(Document).filter(Document.id.in_(ws.document_ids)).all()
        enriched.append({
            "id": ws.id,
            "name": ws.name,
            "created_at": ws.created_at.isoformat(),
            "documents": [
                {
                    "id": doc.id,
                    "filename": doc.filename,
                    "file_size": doc.file_size
                }
                for doc in docs
            ]
        })
    return enriched

@router.get("/{workspace_id}")
async def get_workspace(
    workspace_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db)
):
    ws = db.query(Workspace).filter(Workspace.id == workspace_id, Workspace.user_id == user_id).first()
    if not ws:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workspace not found or access denied."
        )

    # Retrieve docs metadata
    docs = db.query(Document).filter(Document.id.in_(ws.document_ids)).all()
    return {
        "id": ws.id,
        "name": ws.name,
        "created_at": ws.created_at.isoformat(),
        "documents": [
            {
                "id": doc.id,
                "filename": doc.filename,
                "file_size": doc.file_size,
                "status": doc.status
            }
            for doc in docs
        ]
    }

@router.delete("/{workspace_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workspace(
    workspace_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db)
):
    ws = db.query(Workspace).filter(Workspace.id == workspace_id, Workspace.user_id == user_id).first()
    if not ws:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workspace not found or access denied."
        )
    db.delete(ws)
    db.commit()


class WorkspaceUpdate(BaseModel):
    document_ids: list[str]


@router.patch("/{workspace_id}")
async def update_workspace_documents(
    workspace_id: str,
    payload: WorkspaceUpdate,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db)
):
    ws = db.query(Workspace).filter(Workspace.id == workspace_id, Workspace.user_id == user_id).first()
    if not ws:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workspace not found or access denied."
        )

    if not payload.document_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A workspace must contain at least one document."
        )

    # Verify user owns all target documents
    user_docs = db.query(Document).filter(
        Document.id.in_(payload.document_ids),
        Document.user_id == user_id
    ).all()

    if len(user_docs) != len(payload.document_ids):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Some requested documents were not found or access was denied."
        )

    ws.document_ids = payload.document_ids
    db.commit()
    db.refresh(ws)

    docs = db.query(Document).filter(Document.id.in_(ws.document_ids)).all()
    return {
        "id": ws.id,
        "name": ws.name,
        "created_at": ws.created_at.isoformat(),
        "documents": [
            {"id": doc.id, "filename": doc.filename, "file_size": doc.file_size, "status": doc.status}
            for doc in docs
        ]
    }


@router.get("/{workspace_id}/chat")
async def get_workspace_chat_history(
    workspace_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db)
):
    # Verify ownership
    ws = db.query(Workspace).filter(Workspace.id == workspace_id, Workspace.user_id == user_id).first()
    if not ws:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workspace not found or access denied."
        )
        
    messages = db.query(Message).filter(Message.workspace_id == workspace_id).order_by(Message.created_at.asc()).all()
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

@router.post("/{workspace_id}/chat")
async def chat_with_workspace(
    workspace_id: str,
    payload: ChatRequest,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db)
):
    # Verify ownership
    ws = db.query(Workspace).filter(Workspace.id == workspace_id, Workspace.user_id == user_id).first()
    if not ws:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workspace not found or access denied."
        )

    user_message = payload.message.strip()
    if not user_message:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Message content cannot be empty."
        )

    # Retrieve all documents to map IDs to filenames
    docs = db.query(Document).filter(Document.id.in_(ws.document_ids)).all()
    filenames = {doc.id: doc.filename for doc in docs}
    
    # Check if any document is still processing
    for doc in docs:
        if doc.status == "processing":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Document '{doc.filename}' is still indexing. Please wait a few moments."
            )
        elif doc.status == "failed":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Document '{doc.filename}' failed indexing. Please remove it from the workspace."
            )

    try:
        # 1. Embed query
        query_embedding = generate_embedding(user_message, is_query=True)
        
        # 2. Retrieve top matching segments across all workspace documents
        chunks = db.query(DocumentChunk).filter(
            DocumentChunk.document_id.in_(ws.document_ids)
        ).order_by(
            DocumentChunk.embedding.cosine_distance(query_embedding)
        ).limit(6).all()
        
        # 3. Format RAG prompt injection context with clear source identifiers
        context_parts = []
        for chunk in chunks:
            fname = filenames.get(chunk.document_id, "Unknown PDF")
            context_parts.append(f"--- Source File: {fname}, Page {chunk.page_number} ---\n{chunk.content}")
        context_text = "\n\n".join(context_parts)
        
        system_prompt = (
            "You are an expert AI comparative document analysis assistant.\n"
            "Answer the user's question as accurately and objectively as possible using ONLY the context provided below from their workspace documents.\n"
            "Always state which source files and pages you are referencing in your analysis.\n"
            "If the retrieved context does not contain the answer, state that you cannot find the answer in the document workspace.\n"
            "Do not make up facts, URLs, or external references.\n\n"
            f"[RETRIEVED CONTEXT]:\n{context_text}"
        )
        
        # 4. Generate a completion using the active provider.
        ai_response = generate_chat_response(system_prompt, user_message)
        
        # 5. Compile sources mapping
        sources = [
            {
                "content": chunk.content,
                "page_number": chunk.page_number,
                "filename": filenames.get(chunk.document_id, "Unknown PDF")
            }
            for chunk in chunks
        ]
        
        # 6. Save messages to DB
        db_user_msg = Message(
            workspace_id=workspace_id,
            role="user",
            content=user_message
        )
        db_ai_msg = Message(
            workspace_id=workspace_id,
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
            detail=f"An error occurred during comparative RAG synthesis: {str(e)}"
        )


@router.post("/{workspace_id}/compare")
async def compare_workspace_documents(
    workspace_id: str,
    payload: CompareRequest,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db)
):
    """Generates a structured, cited comparison table across all documents
    in a workspace (the 'Extract & Compare Table' view)."""
    # Verify ownership
    ws = db.query(Workspace).filter(Workspace.id == workspace_id, Workspace.user_id == user_id).first()
    if not ws:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workspace not found or access denied."
        )

    docs = db.query(Document).filter(Document.id.in_(ws.document_ids)).all()
    if len(docs) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Add at least two documents to this workspace to generate a comparison."
        )

    for doc in docs:
        if doc.status == "processing":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Document '{doc.filename}' is still indexing. Please wait a few moments."
            )
        elif doc.status == "failed":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Document '{doc.filename}' failed indexing. Please remove it from the workspace."
            )

    # Build per-document context from all of its indexed chunks, ordered by page.
    docs_context: dict[str, dict] = {}
    for doc in docs:
        chunks = db.query(DocumentChunk).filter(
            DocumentChunk.document_id == doc.id
        ).order_by(DocumentChunk.page_number.asc()).all()
        docs_context[doc.id] = {
            "filename": doc.filename,
            "text": "\n".join(chunk.content for chunk in chunks),
        }

    try:
        table = generate_comparison_table(docs_context, payload.fields)
        return table
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An error occurred while generating the comparison table: {str(e)}"
        )
