import os
import re
import json
import logging
import unicodedata
from collections.abc import Iterator
from pypdf import PdfReader
import google.generativeai as genai

try:
    import fitz  # PyMuPDF: rasterizes PDF pages for the OCR fallback.
except ImportError:  # pragma: no cover - OCR is an optional feature
    fitz = None

from sqlalchemy import func
from sqlalchemy.orm import Session
from ..config import settings
from ..models import Document, DocumentChunk
from ..database import SessionLocal
from ..services.llm import llm

logger = logging.getLogger(__name__)

# Cap per-document context fed into the comparison-table prompt so large
# documents don't blow out the prompt size or cost.
COMPARISON_CONTEXT_CHAR_LIMIT = 8000

# How many prior messages (user + assistant combined) are carried into a
# chat turn as conversation history. Bounded to keep prompt size/cost in
# check; 6 messages = the last 3 user/assistant exchanges.
DEFAULT_HISTORY_LIMIT = 6

def build_retrieval_query(history: list[dict] | None, query: str) -> str:
    """
    Pre-processes a user query for optimal retrieval.
    Currently returns the query as-is, but allows for future expansion
    (e.g., query expansion or translation).
    """
    return query

def generate_chat_response(
    system_prompt: str,
    user_message: str,
    history: list[dict] | None = None,
) -> str:
    return llm.generate(system_prompt, user_message, history)

def stream_chat_response(
    system_prompt: str,
    user_message: str,
    history: list[dict] | None = None,
) -> Iterator[str]:
    """Yields the model's answer incrementally as text deltas."""
    return llm.stream_generate(system_prompt, user_message, history)

def generate_comparison_table(
    docs_context: dict[str, dict],
    fields: list[str] | None = None,
) -> dict:
    """Uses Gemini to extract a structured, cited comparison table across
    multiple documents."""
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

    data = llm.generate_structured(prompt, schema_hint)

    # The model only echoes document_id back; attach filenames server-side
    # so the frontend doesn't have to cross-reference separately.
    for row in data.get("rows", []):
        for value in row.get("values", []):
            value["filename"] = filename_lookup.get(value.get("document_id"), "Unknown")

    return data

def extract_text_from_pdf(file_path: str) -> Iterator[str]:
    """Extracts text page-by-page from a local PDF file as a generator."""
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"PDF file not found at path: {file_path}")

    reader = PdfReader(file_path)

    for i, page in enumerate(reader.pages):
        text = _extract_page_text(page, file_path, i)
        if text:
            yield text

_GARBLED_SYMBOLS = set("{}[]|\\~^<>")
_VOWELS = set("aeiouyAEIOUY")

def _has_nonlatin_script_letter(token: str) -> bool:
    for c in token:
        if not c.isalpha() or c.isascii():
            continue
        try:
            if not unicodedata.name(c).startswith("LATIN"):
                return True
        except ValueError:
            continue
    return False

def _token_is_garbled(token: str) -> bool:
    core = token.strip()
    if not core:
        return False
    if _has_nonlatin_script_letter(core):
        return False
    if any(c in _GARBLED_SYMBOLS for c in core):
        return True
    if ";" in core:
        return True
    if "/" in core and any(c.isalpha() for c in core):
        return True
    if re.search(r"[A-Za-z]{3,}\.[A-Za-z]{3,}", core):
        return True
    if re.search(r"[a-z][A-Z]", core):
        return True
    decomposed = unicodedata.normalize("NFD", core)
    letters = [c for c in decomposed if c.isalpha()]
    if len(letters) >= 2 and not core.isupper():
        if not any(c in _VOWELS for c in letters):
            return True
    return False

def _strip_garbled_text(text: str) -> str:
    cleaned_lines = []
    for line in text.split("\n"):
        kept = [tok for tok in line.split() if not _token_is_garbled(tok)]
        if kept:
            cleaned_lines.append(" ".join(kept))
    return "\n".join(cleaned_lines)

def _sanitize_extracted_text(text: str | None) -> str:
    if not text:
        return ""
    text = text.replace("\x00", "")
    return _strip_garbled_text(text)

_MIN_USABLE_CHARS = 40
_GARBLED_RATIO_THRESHOLD = 0.5
_OCR_ZOOM = 2.0

def _garbled_ratio(raw_text: str) -> float:
    tokens = raw_text.split()
    if not tokens:
        return 0.0
    garbled = sum(1 for tok in tokens if _token_is_garbled(tok))
    return garbled / len(tokens)

def _page_needs_ocr(raw_text: str | None, cleaned_text: str) -> bool:
    if len(cleaned_text.strip()) < _MIN_USABLE_CHARS:
        return True
    if _garbled_ratio(raw_text or "") >= _GARBLED_RATIO_THRESHOLD:
        return True
    return False

def _ocr_pdf_page(file_path: str, page_index: int) -> str:
    if fitz is None:
        logger.warning(
            "OCR fallback skipped: PyMuPDF (fitz) is not installed. "
            "Add 'pymupdf' to requirements to enable it."
        )
        return ""

    try:
        with fitz.open(file_path) as pdf:
            page = pdf.load_page(page_index)
            pixmap = page.get_pixmap(matrix=fitz.Matrix(_OCR_ZOOM, _OCR_ZOOM))
            image_bytes = pixmap.tobytes("png")

        # Log the start of transcription for observability
        logger.debug(f"Starting OCR transcription for page {page_index + 1} of {file_path}")
        return llm.transcribe_image(image_bytes, "Transcribe ALL text visible in this document image exactly as written, preserving the original language(s) and scripts. Output only the transcribed text with no commentary, labels, or translation.")
    except Exception as e:
        logger.exception(f"OCR pipeline failure for page {page_index + 1} of {file_path}: {e}")
        return ""

def _extract_page_text(page, file_path: str, page_index: int) -> str:
    raw_text = page.extract_text()
    cleaned = _sanitize_extracted_text(raw_text)

    if _page_needs_ocr(raw_text, cleaned):
        ocr_text = _ocr_pdf_page(file_path, page_index)
        if len(ocr_text.strip()) > len(cleaned.strip()):
            logger.info(
                f"Used OCR fallback for page {page_index + 1} of {file_path}."
            )
            return ocr_text

    return cleaned

def chunk_text(text: str, chunk_size: int = 1000, overlap: int = 200) -> list[str]:
    if not text:
        return []
    sentences = re.split(r'(?<=[.!?])\s+', text)
    chunks = []
    current_chunk = []
    current_length = 0
    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence:
            continue
        sentence_len = len(sentence)
        if sentence_len > chunk_size:
            if current_chunk:
                chunks.append(" ".join(current_chunk))
                current_chunk = []
                current_length = 0
            for i in range(0, sentence_len, chunk_size - overlap):
                chunks.append(sentence[i:i + chunk_size])
            continue
        if current_length + sentence_len + (1 if current_chunk else 0) > chunk_size:
            chunks.append(" ".join(current_chunk))
            overlap_chunk = []
            overlap_len = 0
            for s in reversed(current_chunk):
                if overlap_len + len(s) + (1 if overlap_chunk else 0) <= overlap:
                    overlap_chunk.insert(0, s)
                    overlap_len += len(s) + 1
                else:
                    break
            current_chunk = overlap_chunk
            current_length = overlap_len
        current_chunk.append(sentence)
        current_length += sentence_len + (1 if len(current_chunk) > 1 else 0)
    if current_chunk:
        chunks.append(" ".join(current_chunk))
    return chunks

def generate_embedding(text: str, is_query: bool = False) -> list[float]:
    return llm.embed(text, is_query=is_query)

def generate_embeddings_batch(texts: list[str], batch_size: int = 50) -> list[list[float]]:
    # The provider now handles batching logic internally or via SDK
    return llm.embed_batch(texts)

def extract_file_chunks_with_pages(file_path: str) -> list[tuple[str, int]]:
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found at path: {file_path}")
    ext = os.path.splitext(file_path)[1].lower()
    chunks_with_pages = []
    if ext == ".pdf":
        # Consume the text generator to process pages one by one
        for i, page_text in enumerate(extract_text_from_pdf(file_path)):
            if page_text.strip():
                for chunk_content in chunk_text(page_text):
                    chunks_with_pages.append((chunk_content, i + 1))
    elif ext in (".txt", ".md"):
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            text = f.read()
            if text.strip():
                for chunk_content in chunk_text(text):
                    chunks_with_pages.append((chunk_content, 1))
    elif ext == ".docx":
        import docx
        doc = docx.Document(file_path)
        text = "\n".join([para.text for para in doc.paragraphs])
        if text.strip():
            for chunk_content in chunk_text(text):
                chunks_with_pages.append((chunk_content, 1))
    else:
        raise ValueError(f"Unsupported file extension: {ext}")
    if not chunks_with_pages:
        raise ValueError(f"No extractable text found in {file_path}. It might be empty or scanned.")
    return chunks_with_pages

def index_document_chunks(
    db: Session,
    doc_id: str,
    chunks_with_pages: list[tuple[str, int]],
    embeddings: list[list[float]]
):
    for (chunk_content, page_num), embedding in zip(chunks_with_pages, embeddings):
        db_chunk = DocumentChunk(
            document_id=doc_id,
            content=chunk_content,
            page_number=page_num,
            embedding=embedding,
            tsv=func.to_tsvector('english', chunk_content)
        )
        db.add(db_chunk)
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if doc:
        doc.status = "completed"
    db.commit()

def _mark_document_failed(doc_id: str):
    db: Session = SessionLocal()
    try:
        doc = db.query(Document).filter(Document.id == doc_id).first()
        if doc:
            doc.status = "failed"
            db.commit()
    except Exception as err:
        logger.exception(f"Failed to set document {doc_id} status to failed: {err}")
        db.rollback()
    finally:
        db.close()

def process_document_background(doc_id: str, file_path: str):
    db: Session = SessionLocal()
    try:
        doc = db.query(Document).filter(Document.id == doc_id).first()
        if not doc:
            logger.error(f"Background task failed: Document {doc_id} not found in DB.")
            return
        chunks_with_pages = extract_file_chunks_with_pages(file_path)
        chunk_texts = [item[0] for item in chunks_with_pages]
        embeddings = generate_embeddings_batch(chunk_texts)
        index_document_chunks(db, doc_id, chunks_with_pages, embeddings)
        logger.info(f"Successfully indexed document {doc_id} with {len(chunks_with_pages)} chunks.")
    except Exception as e:
        logger.exception(f"Failed to process document {doc_id}: {str(e)}")
        db.rollback()
        _mark_document_failed(doc_id)
    finally:
        db.close()

def rerank_chunks(query: str, chunks: list, top_k: int = 5) -> list:
    if not chunks or len(chunks) <= top_k:
        return chunks[:top_k]

    context_str = ""
    for i, chunk in enumerate(chunks):
        context_str += f"--- Chunk {i} ---\n{chunk.content}\n\n"

    prompt = (
        f"You are a relevance ranking assistant.\n"
        f"User Query: {query}\n\n"
        f"Evaluate the following chunks of text and select up to {top_k} chunks that are MOST relevant to answering the query.\n"
        f"Return ONLY a JSON list of integers representing the chunk indices (e.g., [0, 2, 4]). Do not explain.\n\n"
        f"{context_str}"
    )

    try:
        indices = llm.generate_structured(prompt, "Output valid JSON array of ints.")
        if isinstance(indices, list):
            selected = [chunks[i] for i in indices if 0 <= i < len(chunks)]
            return selected[:top_k] if selected else chunks[:top_k]
    except Exception as e:
        logger.warning(f"Reranking failed, falling back to top_k: {e}")

    return chunks[:top_k]
