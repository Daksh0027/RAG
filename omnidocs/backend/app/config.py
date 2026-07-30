import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://postgres:postgres@localhost:5433/omnidocs"
    CLERK_JWKS_URL: str = "https://verified-panther-1.clerk.accounts.dev/.well-known/jwks.json"
    STORAGE_DIR: str = "storage"
    GEMINI_API_KEY: str = ""

    class Config:
        env_file = ".env.local"

settings = Settings()

# Ensure the storage directory exists
os.makedirs(settings.STORAGE_DIR, exist_ok=True)

# Set the standard Google environment variable for the SDK
if settings.GEMINI_API_KEY:
    os.environ["GOOGLE_API_KEY"] = settings.GEMINI_API_KEY
