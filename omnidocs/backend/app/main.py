from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from .database import engine
from .models import Base
from .routers import documents, chat, workspaces

app = FastAPI(
    title="OmniDocs API",
    description="Backend API for document indexing, uploads, and search.",
    version="1.0.0"
)


@app.on_event("startup")
def initialize_database() -> None:
    # Keep app importable even if PostgreSQL is temporarily unavailable.
    try:
        with engine.connect() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            conn.commit()

        Base.metadata.create_all(bind=engine)
    except Exception as e:
        print(f"Warning: Database initialization skipped: {e}")

# CORS configuration to allow local Next.js development server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(documents.router)
app.include_router(chat.router)
app.include_router(workspaces.router)

@app.get("/")
def read_root():
    return {"status": "healthy", "service": "OmniDocs API"}
