import os
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[1] / ".env.local"
    )

    # Environment mode ("development" or "production").
    # In development, localhost origins are allowed by default.
    ENV: str = "development"
    DATABASE_URL: str = "postgresql://postgres:postgres@localhost:5433/omnidocs"
    CLERK_JWKS_URL: str = "https://verified-panther-1.clerk.accounts.dev/.well-known/jwks.json"
    STORAGE_DIR: str = "storage"
    GEMINI_API_KEY: str = Field(
        default="",
        validation_alias=AliasChoices("GEMINI_API_KEY", "GOOGLE_API_KEY"),
    )

    # Comma-separated list of browser origins allowed to call this API.
    CORS_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"

    # LLM provider to use ("gemini" is current default)
    LLM_PROVIDER: str = "gemini"

    # Embedding dimension for the vector database.
    # Default 3072 for gemini-embedding-004.
    EMBEDDING_DIMENSION: int = 3072

    # Maximum allowed upload size in MB.
    MAX_UPLOAD_MB: int = 50


    # When True, unexpected server errors return their exception text to the
    # client. Useful locally; leave False in any shared environment so
    # internal details (paths, driver messages, SQL) aren't exposed.
    DEBUG_ERRORS: bool = False

    @property
    def cors_origins(self) -> list[str]:
        if self.ENV == "development":
            # Allow local frontend by default in dev mode.
            origins = self.CORS_ORIGINS.split(",") + ["http://localhost:3000"]
        else:
            origins = self.CORS_ORIGINS.split(",")
        return [origin.strip() for origin in origins if origin.strip()]

    @property
    def max_upload_bytes(self) -> int:
        return self.MAX_UPLOAD_MB * 1024 * 1024

settings = Settings()

# Ensure the storage directory exists
os.makedirs(settings.STORAGE_DIR, exist_ok=True)

# Set the standard Google environment variable for the SDK
if settings.GEMINI_API_KEY:
    os.environ.setdefault("GOOGLE_API_KEY", settings.GEMINI_API_KEY)
