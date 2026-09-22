import uuid
from datetime import datetime, timezone
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy import Column, Integer, String, Text, ForeignKey, DateTime, JSON, Index
from pgvector.sqlalchemy import Vector
from .config import settings
from .database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True)  # Clerk user ID
    email = Column(String, unique=True, nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc)
    )


class Document(Base):
    __tablename__ = "documents"

    id = Column(
        String,
        primary_key=True,
        default=lambda: str(uuid.uuid4())
    )

    user_id = Column(
        String,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    filename = Column(String, nullable=False)

    file_path = Column(Text, nullable=False)

    file_size = Column(Integer, nullable=False)

    status = Column(String, nullable=False, default="processing")  # 'processing', 'completed', 'failed'

    uploaded_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc)
    )

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "filename": self.filename,
            "file_path": self.file_path,
            "file_size": self.file_size,
            "status": self.status,
            "uploaded_at": self.uploaded_at.isoformat() if self.uploaded_at else None
        }


class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    document_id = Column(
        String,
        ForeignKey("documents.id", ondelete="CASCADE"),
        nullable=False,
        index=True  # Every retrieval query filters on document_id.
    )
    content = Column(Text, nullable=False)
    page_number = Column(Integer, nullable=True)
    embedding = Column(Vector(settings.EMBEDDING_DIMENSION), nullable=False)  # Gemini gemini-embedding-001 output dimension.
    tsv = Column(TSVECTOR, nullable=True)

    __table_args__ = (
        Index("ix_document_chunks_tsv", "tsv", postgresql_using="gin"),
    )


class Message(Base):
    __tablename__ = "messages"

    id = Column(
        String,
        primary_key=True,
        default=lambda: str(uuid.uuid4())
    )

    document_id = Column(
        String,
        ForeignKey("documents.id", ondelete="CASCADE"),
        nullable=True,
        index=True  # Chat history is always fetched by conversation.
    )

    workspace_id = Column(
        String,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=True,
        index=True
    )

    role = Column(String, nullable=False)

    content = Column(Text, nullable=False)
    sources = Column(JSON, nullable=True)

    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc)
    )


class Workspace(Base):
    __tablename__ = "workspaces"

    id = Column(
        String,
        primary_key=True,
        default=lambda: str(uuid.uuid4())
    )

    user_id = Column(
        String,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    name = Column(String, nullable=False)
    document_ids = Column(JSON, nullable=False)  # JSON array of document ID strings

    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc)
    )