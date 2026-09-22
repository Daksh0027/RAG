# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
- Run full stack: `.\run.bat`
- Backend (FastAPI): `cd omnidocs/backend && uvicorn app.main:app --reload --port 8000`
- Frontend (Next.js): `cd omnidocs/frontend && npm run dev`
- Install Backend deps: `pip install -r omnidocs/backend/requirements.txt`
- Install Frontend deps: `cd omnidocs/frontend && npm install`

### Testing
- Run all backend tests: `pytest omnidocs/backend`
- Run specific backend test: `pytest omnidocs/backend/path/to/test_file.py`

## Architecture

OmniDocs is a RAG (Retrieval-Augmented Generation) application for document indexing and search.

### Backend (FastAPI)
- **Core**: FastAPI application with a lifespan handler for database initialization.
- **Database**: PostgreSQL with `pgvector` for storing and querying document embeddings.
- **Indexing**: 
    - Hybrid search implementation using both Vector embeddings (HNSW index for cosine distance) and Full-Text Search (GIN index on `tsvector`).
    - Document parsing handled via `pypdf`, `pymupdf`, and `python-docx`.
- **LLM Integration**: Uses Google Gemini (`google-generativeai`) for embedding generation and chat responses.
- **Structure**:
    - `app/main.py`: Entry point and middleware setup.
    - `app/routers/`: API endpoints for `documents`, `chat`, and `workspaces`.
    - `app/services/`: Business logic, specifically `rag.py` for retrieval and generation.
    - `app/models.py`: SQLAlchemy ORM models.

### Frontend (Next.js)
- **Framework**: Next.js App Router.
- **UI**: Tailwind CSS for styling.
- **API Client**: Shared API utility in `lib/api.ts` for communicating with the FastAPI backend.
- **Features**:
    - Dashboard for workspace management.
    - Chat interface for RAG-based querying.
    - Document upload and management.
