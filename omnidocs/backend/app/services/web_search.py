"""Web search fallback for corrective retrieval (CRAG).

Used only when a document/workspace's indexed content is graded as
insufficient to answer a question — this is the last resort in the
retrieve -> grade -> rewrite -> (retry) -> web-fallback pipeline, not a
general-purpose search tool. Backed by Tavily (https://tavily.com), which
returns clean, LLM-ready snippets rather than raw HTML.
"""

import logging

import httpx

from ..config import settings

logger = logging.getLogger(__name__)

_TAVILY_SEARCH_URL = "https://api.tavily.com/search"


def is_web_search_available() -> bool:
    return bool(settings.TAVILY_API_KEY)


def web_search(query: str, max_results: int = 4) -> list[dict]:
    """Searches the web for supplementary context.

    Returns a list of `{"title": str, "url": str, "content": str}` results.
    Never raises: returns an empty list if the provider isn't configured or
    the request fails, so callers can fall back to "not found" gracefully
    instead of turning a missing API key into a hard error.
    """
    if not is_web_search_available():
        return []

    try:
        response = httpx.post(
            _TAVILY_SEARCH_URL,
            json={
                "api_key": settings.TAVILY_API_KEY,
                "query": query,
                "max_results": max_results,
                "search_depth": "basic",
            },
            timeout=15.0,
        )
        response.raise_for_status()
        data = response.json()
        return [
            {
                "title": result.get("title", ""),
                "url": result.get("url", ""),
                "content": result.get("content", ""),
            }
            for result in data.get("results", [])
            if result.get("content")
        ]
    except Exception as e:  # pragma: no cover - network failures
        logger.warning(f"Web search failed for query {query!r}: {e}")
        return []
