"""Server-Sent Events helpers for streaming chat completions.

Event protocol (each frame is `event: <name>` + `data: <json>`):
  - `sources`  — the retrieved citations, sent once before any text so the UI
                 can render the source panel immediately.
  - `delta`    — `{"text": "..."}`, an incremental chunk of the answer.
  - `done`     — `{"content": "<full answer>"}`, terminal success frame.
  - `error`    — `{"detail": "..."}`, terminal failure frame.

Errors are delivered as an `error` event rather than an HTTP status because the
response has already begun streaming (headers are long since flushed) by the
time generation can fail.
"""

import json
import logging
from collections.abc import Iterator

from sqlalchemy.orm import Session

from ..models import Message
from ..database import SessionLocal
from .rag import stream_chat_response

logger = logging.getLogger(__name__)

SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    # Tells nginx and similar proxies not to buffer, which would defeat streaming.
    "X-Accel-Buffering": "no",
}


def sse_event(event: str, payload: dict) -> str:
    """Formats a single SSE frame."""
    return f"event: {event}\ndata: {json.dumps(payload)}\n\n"


def stream_and_persist(
    system_prompt: str,
    user_message: str,
    sources: list[dict],
    *,
    document_id: str | None = None,
    workspace_id: str | None = None,
    history: list[dict] | None = None,
) -> Iterator[str]:
    """Streams an answer as SSE frames, then persists the exchange.

    `history` is the recent conversation (already fetched by the caller) so
    the model can follow up-references ("what about section 2?") rather than
    treating every message as the start of a new conversation.

    Both messages are written only after generation finishes, so a failed or
    disconnected stream doesn't leave a user message with no reply in history.
    A fresh session is used because the request-scoped session from
    `get_db` is already closed by the time this generator runs.
    """
    yield sse_event("sources", {"sources": sources})

    collected: list[str] = []
    try:
        for delta in stream_chat_response(system_prompt, user_message, history):
            collected.append(delta)
            yield sse_event("delta", {"text": delta})
    except Exception as e:
        logger.exception("Chat streaming failed: %s", e)
        yield sse_event(
            "error",
            {"detail": "The response was interrupted before it finished. Please try again."},
        )
        return

    full_answer = "".join(collected)

    if not full_answer.strip():
        yield sse_event(
            "error",
            {"detail": "The model returned an empty response. Please try rephrasing."},
        )
        return

    db: Session = SessionLocal()
    try:
        db.add(Message(
            document_id=document_id,
            workspace_id=workspace_id,
            role="user",
            content=user_message,
        ))
        db.add(Message(
            document_id=document_id,
            workspace_id=workspace_id,
            role="assistant",
            content=full_answer,
            sources=sources,
        ))
        db.commit()
    except Exception as e:
        db.rollback()
        # The answer already reached the client; failing to persist it is worth
        # logging but shouldn't turn a successful response into an error.
        logger.exception("Failed to persist chat messages: %s", e)
    finally:
        db.close()

    yield sse_event("done", {"content": full_answer})
