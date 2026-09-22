from abc import ABC, abstractmethod
from collections.abc import Iterator
from typing import Any, Optional

class LLMProvider(ABC):
    @abstractmethod
    def generate(self, system_prompt: str, user_message: str, history: list[dict] | None = None) -> str:
        """Returns a full text response."""
        pass

    @abstractmethod
    def stream_generate(self, system_prompt: str, user_message: str, history: list[dict] | None = None) -> Iterator[str]:
        """Yields text deltas incrementally."""
        pass

    @abstractmethod
    def generate_structured(self, prompt: str, schema_hint: Optional[str] = None) -> dict[str, Any]:
        """Returns a parsed JSON response."""
        pass

    @abstractmethod
    def embed(self, text: str, is_query: bool = False) -> list[float]:
        """Generates a single vector embedding."""
        pass

    @abstractmethod
    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Generates a batch of vector embeddings."""
        pass

    @abstractmethod
    def transcribe_image(self, image_bytes: bytes, prompt: str) -> str:
        """Performs multimodal OCR/transcription on an image."""
        pass
