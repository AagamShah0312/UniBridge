from __future__ import annotations

from collections import Counter
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import urlparse

from django.conf import settings
from django.utils import timezone
import requests

from student_ai.models import AIDocument, AIDocumentChunk, AIDocumentMetadata, Flashcard, Note, NoteInsight
from student_ai.services.ai_service import AIServiceError
from student_ai.services.chunk_service import build_semantic_chunks
from student_ai.services.documents import extract_text, file_hash
from student_ai.services.embedding_service import EmbeddingService
from student_ai.services.gemini_service import GeminiDocumentService, normalize_list

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}


def resolve_local_path(file_url: str, file_key: str) -> str | Path:
    parsed = urlparse(file_url or "")
    if parsed.scheme in {"http", "https"}:
        return file_url
    candidate = Path(file_url)
    if candidate.exists():
        return candidate
    return Path(settings.MEDIA_ROOT) / file_key


def process_note_document(note: Note, *, source_url: str | None = None) -> dict:
    path = resolve_local_path(source_url or note.file_url, note.file_key)
    digest = file_hash(path)
    document, _created = AIDocument.objects.update_or_create(
        note=note,
        defaults={
            "subject": note.subject,
            "uploaded_by_id": note.faculty_id,
            "source_type": "note",
            "title": note.title,
            "original_file_url": note.file_url,
            "original_file_key": note.file_key,
            "mime_type": note.mime_type,
            "content_hash": digest,
            "processing_status": "processing",
            "error_message": "",
        },
    )
    try:
        extracted = extract_document_text(path, note.mime_type).strip()
        if not extracted:
            raise ValueError("Document has no extractable text.")
        structured = _extract_note_structure(note, extracted)
        chunks = build_semantic_chunks(extracted)
        AIDocumentChunk.objects.filter(document=document).delete()
        embedder = EmbeddingService()
        for chunk in chunks:
            AIDocumentChunk.objects.create(
                document=document,
                subject=note.subject,
                chunk_index=chunk.index,
                unit_name=chunk.unit_name,
                chapter_name=chunk.chapter_name,
                page_number=chunk.page_number,
                content=chunk.content,
                summary=_short_summary(chunk.content),
                keywords=_keywords(chunk.content, structured.get("keywords", [])),
                embedding=embedder.generate_embedding(chunk.content),
                token_count=chunk.token_count,
            )
        _store_metadata(document, note, structured)
        _store_legacy_note_outputs(note, digest, extracted, structured)
        document.processing_status = "completed"
        document.total_chunks = len(chunks)
        document.processed_at = timezone.now()
        document.error_message = ""
        document.save(update_fields=["processing_status", "total_chunks", "processed_at", "error_message", "updated_at"])
        return {"note_id": str(note.id), "document_id": str(document.id), "status": "completed", "chunks": len(chunks)}
    except Exception as exc:
        document.processing_status = "failed"
        document.error_message = str(exc)
        document.save(update_fields=["processing_status", "error_message", "updated_at"])
        NoteInsight.objects.update_or_create(
            note=note,
            defaults={"content_hash": digest, "status": "failed", "short_summary": "", "detailed_notes": "", "extracted_text": ""},
        )
        raise


def _extract_note_structure(note: Note, extracted: str) -> dict:
    fallback = {
        "short_summary": "",
        "detailed_notes": "",
        "bullet_notes": [],
        "important_definitions": [],
        "key_formulae": [],
        "flashcards": [],
        "important_questions": [],
        "units": [],
        "chapters": [],
        "keywords": [],
        "prerequisites": [],
        "tables": [],
        "formulas": [],
    }
    system = (
        "You are processing a faculty-uploaded study document once for retrieval. "
        "Return valid JSON only with keys: short_summary, detailed_notes, bullet_notes, "
        "important_definitions, key_formulae, flashcards, important_questions, units, "
        "chapters, keywords, prerequisites, tables, formulas. Preserve academic hierarchy."
    )
    user = (
        f"Subject: {note.subject.code} {note.subject.name}\n"
        f"Document title: {note.title}\n"
        "Extract the structure, hierarchy, formulas, keywords, summaries, and student-ready notes.\n\n"
        f"{extracted[:24000]}"
    )
    try:
        parsed = GeminiDocumentService().json_chat(system, user, fallback=fallback)
    except AIServiceError:
        # Keep faculty material accessible when the optional LLM router is offline.
        parsed = _extractive_note_structure(extracted)
    return {**fallback, **parsed}


def _extractive_note_structure(extracted: str) -> dict:
    paragraphs = [part.strip() for part in re.split(r"\n\s*\n+", extracted) if part.strip()]
    sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+", " ".join(paragraphs)) if part.strip()]
    definitions: list[str] = []
    for line in extracted.splitlines():
        if ":" not in line:
            continue
        term, meaning = line.split(":", 1)
        if term.strip() and meaning.strip() and len(term.strip()) <= 100:
            definitions.append(f"{term.strip()}: {meaning.strip()}")
    return {
        "short_summary": " ".join(sentences[:3])[:1200] or extracted[:1200],
        "detailed_notes": "\n\n".join(paragraphs)[:10000],
        "bullet_notes": sentences[:8],
        "important_definitions": definitions[:12],
        "key_formulae": [],
        "flashcards": [],
        "important_questions": [sentence for sentence in sentences if sentence.endswith("?")][:10],
        "units": [],
        "chapters": [],
        "keywords": [],
        "prerequisites": [],
        "tables": [],
        "formulas": [],
    }


def extract_document_text(path: str | Path, mime_type: str | None = None) -> str:
    suffix = Path(str(path)).suffix.lower()
    if (mime_type or "").lower().startswith("image/") or suffix in IMAGE_EXTENSIONS:
        return GeminiDocumentService().extract_image_text(path, mime_type=mime_type)
    extracted = extract_text(path)
    if suffix != ".pdf" or len(extracted.strip()) >= 80:
        return extracted
    return _extract_scanned_pdf_text(path)


def _extract_scanned_pdf_text(path: str | Path) -> str:
    """Use Gemini vision only when a PDF has no usable embedded text layer."""
    try:
        import fitz
    except ImportError as exc:
        raise RuntimeError("PyMuPDF is required to process scanned PDFs. Install requirements.txt and retry.") from exc

    local_path, cleanup_path = _local_pdf_path(path)
    try:
        pdf = fitz.open(str(local_path))
        try:
            if not pdf.page_count:
                return ""
            service = GeminiDocumentService()
            pages: list[str] = []
            # Keep uploads bounded while still processing normal academic handouts end to end.
            for page_index in range(min(pdf.page_count, 30)):
                page = pdf.load_page(page_index)
                image = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
                with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as handle:
                    image_path = Path(handle.name)
                image.save(str(image_path))
                try:
                    text = service.extract_image_text(image_path, mime_type="image/png")
                    if text:
                        pages.append(f"[Page {page_index + 1}]\n{text}")
                finally:
                    image_path.unlink(missing_ok=True)
            return "\n\n".join(pages)
        finally:
            pdf.close()
    finally:
        if cleanup_path:
            os.unlink(cleanup_path)


def _local_pdf_path(path: str | Path) -> tuple[Path, str | None]:
    if not isinstance(path, str) or urlparse(path).scheme not in {"http", "https"}:
        return Path(path), None
    response = requests.get(path, timeout=60)
    response.raise_for_status()
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as handle:
        handle.write(response.content)
        return Path(handle.name), handle.name


def _store_metadata(document: AIDocument, note: Note, structured: dict) -> None:
    units = structured.get("units") if isinstance(structured.get("units"), list) else []
    chapters = structured.get("chapters") if isinstance(structured.get("chapters"), list) else []
    AIDocumentMetadata.objects.update_or_create(
        document=document,
        defaults={
            "subject": note.subject,
            "units": units,
            "chapter_count": len(chapters),
            "keywords": normalize_list(structured.get("keywords"), limit=40),
            "generated_summary": str(structured.get("short_summary") or "")[:5000],
            "prerequisites": normalize_list(structured.get("prerequisites"), limit=25),
            "tables": structured.get("tables") if isinstance(structured.get("tables"), list) else [],
            "formulas": structured.get("formulas") if isinstance(structured.get("formulas"), list) else structured.get("key_formulae", []),
        },
    )


def _store_legacy_note_outputs(note: Note, digest: str, extracted: str, structured: dict) -> None:
    insight, _created = NoteInsight.objects.update_or_create(
        note=note,
        defaults={
            "content_hash": digest,
            "extracted_text": extracted[:50000],
            "short_summary": str(structured.get("short_summary") or "")[:5000],
            "detailed_notes": str(structured.get("detailed_notes") or "")[:50000],
            "bullet_notes": structured.get("bullet_notes") if isinstance(structured.get("bullet_notes"), list) else [],
            "important_definitions": structured.get("important_definitions") if isinstance(structured.get("important_definitions"), list) else [],
            "key_formulae": structured.get("key_formulae") if isinstance(structured.get("key_formulae"), list) else [],
            "important_questions": structured.get("important_questions") if isinstance(structured.get("important_questions"), list) else [],
            "status": "completed",
        },
    )
    note.ai_summary = insight.short_summary
    note.save(update_fields=["ai_summary", "updated_at"])
    Flashcard.objects.filter(note=note).delete()
    for index, item in enumerate(structured.get("flashcards") if isinstance(structured.get("flashcards"), list) else []):
        if not isinstance(item, dict):
            continue
        Flashcard.objects.create(note=note, question=str(item.get("question", ""))[:2000], answer=str(item.get("answer", ""))[:4000], order=index)


def _short_summary(content: str) -> str:
    first = content.replace("\n", " ").strip()
    return first[:500]


def _keywords(content: str, document_keywords: list[str]) -> list[str]:
    words = [word.lower() for word in __import__("re").findall(r"[A-Za-z][A-Za-z0-9_-]{3,}", content)]
    common = [word for word, _count in Counter(words).most_common(10)]
    return normalize_list([*document_keywords[:10], *common], limit=15)
