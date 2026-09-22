"""Shared helpers for turning unexpected exceptions into safe HTTP responses."""

import logging
import uuid

from fastapi import HTTPException, status

from .config import settings

logger = logging.getLogger(__name__)


def internal_error(context: str, exc: Exception) -> HTTPException:
    """Logs an unexpected exception and returns a sanitized HTTPException.

    The full traceback goes to the server log alongside a short reference id
    that is also given to the client, so a user-reported failure can be traced
    back to a specific log entry without exposing internal details (file
    paths, driver errors, SQL, API payloads) in the HTTP response.

    Set DEBUG_ERRORS=true in .env.local to include the exception text in the
    response while developing locally.
    """
    reference = uuid.uuid4().hex[:8]
    logger.exception("[%s] %s: %s", reference, context, exc)

    if settings.DEBUG_ERRORS:
        detail = f"{context}: {exc}"
    else:
        detail = f"{context}. Reference: {reference}"

    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail=detail,
    )
