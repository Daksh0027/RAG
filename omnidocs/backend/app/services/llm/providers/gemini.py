import google.generativeai as genai
from ..base import LLMProvider
from app.config import settings
from collections.abc import Iterator
from typing import Any, Optional

class GeminiProvider(LLMProvider):
    def __init__(self, api_key: str):
        genai.configure(api_key=api_key)
        self.text_model_name = "gemini-2.5-flash"
        self.embed_model_name = "models/gemini-embedding-001"
        self._role_map = {"user": "user", "assistant": "model"}

    def _build_contents(self, history: list[dict] | None, user_message: str) -> list[dict]:
        contents = [
            {"role": self._role_map.get(turn["role"], "user"), "parts": [turn["content"]]}
            for turn in (history or [])
        ]
        contents.append({"role": "user", "parts": [user_message]})
        return contents

    def generate(self, system_prompt: str, user_message: str, history: list[dict] | None = None) -> str:
        model = genai.GenerativeModel(
            model_name=self.text_model_name,
            system_instruction=system_prompt
        )
        response = model.generate_content(
            contents=self._build_contents(history, user_message),
            generation_config={"temperature": 0.0}
        )
        return response.text

    def stream_generate(self, system_prompt: str, user_message: str, history: list[dict] | None = None) -> Iterator[str]:
        model = genai.GenerativeModel(
            model_name=self.text_model_name,
            system_instruction=system_prompt
        )
        response = model.generate_content(
            contents=self._build_contents(history, user_message),
            generation_config={"temperature": 0.0},
            stream=True,
        )
        for part in response:
            text = getattr(part, "text", None)
            if text:
                yield text

    def generate_structured(self, prompt: str, schema_hint: Optional[str] = None) -> dict[str, Any]:
        model = genai.GenerativeModel(
            model_name=self.text_model_name,
            system_instruction=schema_hint if schema_hint else "Respond in JSON format."
        )
        response = model.generate_content(
            contents=prompt,
            generation_config={
                "temperature": 0.0,
                "response_mime_type": "application/json",
            },
        )
        import json
        return json.loads(response.text)

    def embed(self, text: str, is_query: bool = False) -> list[float]:
        task_type = "retrieval_query" if is_query else "retrieval_document"
        result = genai.embed_content(
            model=self.embed_model_name,
            content=text,
            task_type=task_type
        )
        return result["embedding"]

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        result = genai.embed_content(
            model=self.embed_model_name,
            content=texts,
            task_type="retrieval_document"
        )
        return result["embedding"]

    def transcribe_image(self, image_bytes: bytes, prompt: str) -> str:
        model = genai.GenerativeModel(model_name=self.text_model_name)
        response = model.generate_content(
            contents=[
                {
                    "role": "user",
                    "parts": [
                        {"text": prompt},
                        {"inline_data": {"mime_type": "image/png", "data": image_bytes}},
                    ],
                }
            ],
            generation_config={"temperature": 0.0},
        )
        return getattr(response, "text", "") or ""
