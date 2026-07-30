import os
import json
import logging
from pypdf import PdfReader
import google.generativeai as genai
from sqlalchemy.orm import Session
from ..config import settings
from ..models import Document, DocumentChunk
from ..database import SessionLocal

logger = logging.getLogger(__name__)

# Cap per-document context fed into the comparison-table prompt so large
# documents don't blow out the prompt size or cost.
COMPARISON_CONTEXT_CHAR_LIMIT = 8000


def generate_chat_response(system_prompt: str, user_message: str) -> str:
    genai.configure(api_key=settings.GEMINI_API_KEY)
    model = genai.GenerativeModel(
        model_name="gemini-2.5-flash",
        system_instruction=system_prompt
    )

    response = model.generate_content(
        contents=user_message,
        generation_config={"temperature": 0.0}
    )
    return response.text


def generate_comparison_table(
    docs_context: dict[str, dict],
    fields: list[str] | None = None,
) -> dict:
    """Uses Gemini to extract a structured, cited comparison table across
    multiple documents.

    `docs_context` maps document_id -> {"filename": str, "text": str}.
    Returns a dict shaped like:
    {
      "fields": ["Price", "Warranty"],
      "rows": [
        {
          "field": "Price",
          "values": [
            {"document_id": "...", "filename": "...", "value": "...",
             "page_number": 3, "status": "match"}
          ]
        }
      ]
    }
    `status` is one of "match", "conflict", "unique", or "missing".
    """
    genai.configure(api_key=settings.GEMINI_API_KEY)

    doc_sections = []
    filename_lookup = {}
    for doc_id, info in docs_context.items():
        filename_lookup[doc_id] = info["filename"]
        text = info["text"][:COMPARISON_CONTEXT_CHAR_LIMIT]
        doc_sections.append(f"### Document (id: {doc_id}, filename: {info['filename']})\n{text}")

    fields_instruction = (
        f"Use exactly these comparison fields, in this order: {', '.join(fields)}."
        if fields else
        "First, identify 3 to 6 of the most useful fields to compare across these "
        "documents (e.g. pricing, dates, terms, obligations) based on their actual "
        "content. Prefer fields that most documents actually address."
    )

    prompt = (
        "You are a meticulous document analyst comparing multiple related documents.\n"
        f"{fields_instruction}\n\n"
        "For every field, extract each document's value for that field, staying as close "
        "to the source wording as possible while keeping it concise (under ~20 words).\n"
        "For each value, set \"status\" to exactly one of:\n"
        "- \"match\": this value agrees (even loosely) with at least one other document's value for the same field.\n"
        "- \"conflict\": this value meaningfully disagrees with another document's value for the same field.\n"
        "- \"unique\": only one document in the set addresses this field at all.\n"
        "- \"missing\": this document does not mention the field; set \"value\" to null in that case.\n"
        "Include a best-guess \"page_number\" (integer) if you can tell which page the value came from, else null.\n\n"
        "Documents:\n\n" + "\n\n".join(doc_sections)
    )

    schema_hint = (
        "You produce strictly valid JSON comparison tables from document excerpts, and "
        "nothing else. Respond ONLY with JSON matching this exact shape:\n"
        "{\n"
        '  "fields": ["Field A", "Field B"],\n'
        '  "rows": [\n'
        "    {\n"
        '      "field": "Field A",\n'
        '      "values": [\n'
        '        {"document_id": "...", "value": "...", "page_number": 3, "status": "match"}\n'
        "      ]\n"
        "    }\n"
        "  ]\n"
        "}"
    )

    model = genai.GenerativeModel(
        model_name="gemini-2.5-flash",
        system_instruction=schema_hint,
    )

    response = model.generate_content(
        contents=prompt,
        generation_config={
            "temperature": 0.0,
            "response_mime_type": "application/json",
        },
    )

    data = json.loads(response.text)

    # The model only echoes document_id back; attach filenames server-side
    # so the frontend doesn't have to cross-reference separately.
    for row in data.get("rows", []):
        for value in row.get("values", []):
            value["filename"] = filename_lookup.get(value.get("document_id"), "Unknown")

    return data

def extract_text_from_pdf(file_path: str) -> str:
    """Extracts text page-by-page from a local PDF file."""
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"PDF file not found at path: {file_path}")
        
    reader = PdfReader(file_path)
    full_text = []
    
    for i, page in enumerate(reader.pages):
        text = _sanitize_extracted_text(page.extract_text())
        if text:
            full_text.append(text)
            
    return "\n\n".join(full_text)

def _sanitize_extracted_text(text: str | None) -> str:
    """Strips NUL bytes and other control characters that some PDFs (especially
    scanned or malformed ones) can leak into extracted text. Postgres/psycopg2
    reject NUL (0x00) bytes in text columns outright, so this must run before
    any extracted text is chunked, embedded, or stored.
    """
    if not text:
        return ""
    return text.replace("\x00", "")


def chunk_text(text: str, chunk_size: int = 1000, overlap: int = 200) -> list[str]:
    """Splits a string into overlapping chunks of a specified size."""
    if not text:
        return []
        
    chunks = []
    start = 0
    text_len = len(text)
    
    while start < text_len:
        end = start + chunk_size
        chunks.append(text[start:end])
        # Move start window forward by (chunk_size - overlap)
        start += (chunk_size - overlap)
        
    return chunks

def generate_embedding(text: str, is_query: bool = False) -> list[float]:
    """Generates a vector embedding using Gemini."""
    genai.configure(api_key=settings.GEMINI_API_KEY)
    task_type = "retrieval_query" if is_query else "retrieval_document"
    result = genai.embed_content(
        model="models/gemini-embedding-001",
        content=text,
        task_type=task_type
    )
    return result["embedding"]

def generate_embeddings_batch(texts: list[str], batch_size: int = 50) -> list[list[float]]:
    """Generates vector embeddings in batches to stay within size and rate limits."""
    if not texts:
        return []

    genai.configure(api_key=settings.GEMINI_API_KEY)
    all_embeddings = []
    
    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        result = genai.embed_content(
            model="models/gemini-embedding-001",
            content=batch,
            task_type="retrieval_document"
        )
        all_embeddings.extend(result["embedding"])
        
    return all_embeddings

def process_document_background(doc_id: str, file_path: str):
    """
    Background worker task to extract, chunk page-by-page, generate embeddings for,
    and index a PDF document's content with page metadata.
    """
    # Create a dedicated database session for the background thread
    db: Session = SessionLocal()
    try:
        # Retrieve the document
        doc = db.query(Document).filter(Document.id == doc_id).first()
        if not doc:
            logger.error(f"Background task failed: Document {doc_id} not found in DB.")
            return

        if not os.path.exists(file_path):
            raise FileNotFoundError(f"PDF file not found at path: {file_path}")
            
        reader = PdfReader(file_path)
        chunks_with_pages = []
        
        # 1. Extract and chunk text page-by-page to preserve page number citations
        for i, page in enumerate(reader.pages):
            page_text = _sanitize_extracted_text(page.extract_text())
            if page_text and page_text.strip():
                page_chunks = chunk_text(page_text)
                for chunk_content in page_chunks:
                    chunks_with_pages.append((chunk_content, i + 1))  # 1-indexed page number
                    
        if not chunks_with_pages:
            raise ValueError("No extractable text found in PDF. It might be scanned or empty.")
            
        # 2. Generate embeddings in batches (avoids 15 RPM free tier rate limits)
        chunk_texts = [item[0] for item in chunks_with_pages]
        embeddings = generate_embeddings_batch(chunk_texts)
        
        # 3. Save chunks with page numbers
        for (chunk_content, page_num), embedding in zip(chunks_with_pages, embeddings):
            db_chunk = DocumentChunk(
                document_id=doc_id,
                content=chunk_content,
                page_number=page_num,
                embedding=embedding
            )
            db.add(db_chunk)
            
        # Update document status to completed
        doc.status = "completed"
        db.commit()
        logger.info(f"Successfully indexed document {doc_id} with {len(chunks_with_pages)} chunks.")
        
    except Exception as e:
        logger.exception(f"Failed to process document {doc_id}: {str(e)}")
        # Reset session and mark document as failed
        db.rollback()
        doc = db.query(Document).filter(Document.id == doc_id).first()
        if doc:
            doc.status = "failed"
            db.commit()
    finally:
        db.close()
