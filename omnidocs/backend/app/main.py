import logging
import os
import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from .config import settings
from .database import engine
from .models import Base

logger = logging.getLogger(__name__)

# Rate limiter setup
def get_remote_address(request: Request):
    return request.client.host

limiter = Limiter(key_func=get_remote_address)

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(
    title="OmniDocs API",
    description="Backend API for document indexing, uploads, and search.",
    version="1.0.0",
    lifespan=lifespan,
)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception("GLOBAL UNHANDLED EXCEPTION: %s", exc)
    return Response(
        content=json.dumps({
            "detail": f"Global Error: {str(exc)}",
            "type": "InternalServerError"
        }),
        status_code=500,
        media_type="application/json"
    )

# CORS: temporarily allow all origins to debug connectivity issues.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def log_requests(request: Request, call_next):
    print(f"\n>>> REQUEST RECEIVED: {request.method} {request.url.path}")
    response = await call_next(request)
    print(f"<<< RESPONSE SENT: {response.status_code}\n")
    return response

# Rate Limiting Setup
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# Routers are imported after `app` exists to keep the import graph obvious.
from .routers import documents, chat, workspaces  # noqa: E402

# Include routers
app.include_router(documents.router)
app.include_router(chat.router)
app.include_router(workspaces.router)

@app.get("/health")
def health_check():
    """Detailed health check for production monitoring."""
    checks = {}

    # 1. Database Check
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        checks["database"] = "healthy"
    except Exception as e:
        checks["database"] = f"unhealthy: {str(e)}"

    # 2. Storage Check
    try:
        test_file = os.path.join(settings.STORAGE_DIR, ".healthcheck")
        with open(test_file, "w") as f:
            f.write("ok")
        os.remove(test_file)
        checks["storage"] = "healthy"
    except Exception as e:
        checks["storage"] = f"unhealthy: {str(e)}"

    # 3. LLM Provider Check
    if not settings.GEMINI_API_KEY:
        checks["llm"] = "unhealthy: missing API key"
    else:
        checks["llm"] = "healthy"

    # Determine overall status
    if any("unhealthy" in v for v in checks.values()):
        return Response(
            content={"status": "unhealthy", "details": checks},
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE
        )

    return {"status": "healthy", "details": checks}

@app.get("/")
def read_root():
    return {"status": "healthy", "service": "OmniDocs API"}
