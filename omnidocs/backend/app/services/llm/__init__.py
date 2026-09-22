from ...config import settings
from .providers.gemini import GeminiProvider

def get_llm_provider():
    # In the future, this can be switched via settings.LLM_PROVIDER
    return GeminiProvider(api_key=settings.GEMINI_API_KEY)

llm = get_llm_provider()
