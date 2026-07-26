from __future__ import annotations

import re
from collections import OrderedDict

from .ai_service import AIServiceError
from .gemini_service import GeminiDocumentService
from student_ai.models import AIDocumentChunk, Subject


def _note_label(chunk: AIDocumentChunk) -> str:
    title = (chunk.document.note.title if chunk.document.note_id else chunk.document.title).strip()
    folder = chunk.document.note.folder.name.strip() if chunk.document.note_id and chunk.document.note.folder_id else ""
    return f"{folder} / {title}" if folder else title


def _chapter_label(chunk: AIDocumentChunk) -> str:
    # Prefer the AI-extracted chapter/unit so students get real, selectable
    # chapters; fall back to the note's folder/title when a chunk lacks them.
    return (chunk.chapter_name or chunk.unit_name or "").strip() or _note_label(chunk)


def available_chapters(subject_id: str) -> list[str]:
    chunks = AIDocumentChunk.objects.filter(
        subject_id=subject_id,
        document__processing_status="completed",
    ).select_related("document__note__folder").order_by("document__title", "chunk_index")
    labels: OrderedDict[str, None] = OrderedDict()
    for chunk in chunks:
        label = _chapter_label(chunk)
        if label:
            labels.setdefault(label, None)
    return list(labels.keys())


def _matching_chunks(subject_id: str, chapters: list[str]) -> list[AIDocumentChunk]:
    normalized = {chapter.strip().casefold() for chapter in chapters if chapter.strip()}
    chunks = list(AIDocumentChunk.objects.filter(
        subject_id=subject_id,
        document__processing_status="completed",
    ).select_related("document__note__folder").order_by("document__title", "chunk_index"))
    if not normalized:
        return chunks
    return [
        chunk for chunk in chunks
        if _chapter_label(chunk).casefold() in normalized
    ]


GENERIC_STEM = "which statement is supported by the selected faculty note"


def _content_tokens(text: str) -> set[str]:
    return {token for token in re.findall(r"[a-z][a-z0-9-]{2,}", text.casefold()) if token not in {"which", "should", "could", "would", "about", "these", "those", "using", "based", "what", "does", "how", "why"}}


def _valid_question(item: object, context: str, seen: set[str]) -> dict | None:
    if not isinstance(item, dict):
        return None
    text = " ".join(str(item.get("text", "")).split())
    options = item.get("options")
    correct = item.get("correct_index")
    if not text or GENERIC_STEM in text.casefold() or text.casefold() in seen:
        return None
    if not isinstance(options, list) or len(options) != 4:
        return None
    normalized_options = [" ".join(str(option).split()) for option in options]
    if len(set(option.casefold() for option in normalized_options)) != 4:
        return None
    if not isinstance(correct, int) or not 0 <= correct < 4:
        return None
    # Require the question to mention at least one concrete term from the
    # extracted chunks; this blocks generic templates even when the provider
    # returns otherwise valid JSON.
    if not (_content_tokens(text) & _content_tokens(context)):
        return None
    seen.add(text.casefold())
    return {
        "text": text,
        "options": normalized_options,
        "correct_index": correct,
        "explanation": " ".join(str(item.get("explanation", "")).split()),
        "chapter": " ".join(str(item.get("chapter", "")).split()),
    }


def generate_quiz(subject_id: str, chapters: list[str], question_count: int, seed: str) -> dict:
    subject = Subject.objects.get(pk=subject_id)
    selected = [chapter.strip() for chapter in chapters if isinstance(chapter, str) and chapter.strip()]
    chunks = _matching_chunks(subject_id, selected)
    if not chunks:
        raise ValueError("No processed faculty-note chunks are available for the selected chapters.")

    # Send extracted, semantically chunked faculty-note content to Gemini.
    context = "\n\n".join(
        f"[Chapter: {_chapter_label(chunk)}]\n{chunk.content}"
        for chunk in chunks
    )[:24000]
    requested = max(4, min(int(question_count or 10), 20))
    system = "You are a university assessment author. Create content-grounded MCQs from the supplied faculty notes. Return JSON only."
    prompt = f"""Create exactly {requested} substantially different MCQs for {subject.code} - {subject.name}.
Use only the supplied extracted faculty-note context. Test the actual concepts, definitions, formulas, algorithms, examples, and relationships in that context.
Vary the question types across definition, concept application, comparison, sequence/process, scenario, and calculation when supported by the material.
Every question must name a concrete concept from the context. Never use a generic stem such as "Which statement is supported by the selected faculty note?" or ask about the existence of the notes.
Each question needs exactly four plausible, distinct options and one correct answer. Do not copy the same stem or answer pattern repeatedly.
Do not mention source text, AI, or 'according to the note'. Use the seed to vary question coverage: {seed}.
Return this exact JSON shape: {{"questions":[{{"text":"...","options":["...","...","...","..."],"correct_index":0,"explanation":"...","chapter":"..."}}]}}.

FACULTY NOTE CONTEXT:
{context}
"""
    questions: list[dict] = []
    try:
        service = GeminiDocumentService()
        service.ai.timeout = max(service.ai.timeout, 30)
        service.ai.max_retries = max(service.ai.max_retries, 2)
        payload = service.json_chat(system, prompt, fallback={"questions": []}, allow_fallback=False)
        seen: set[str] = set()
        for item in payload.get("questions", []) if isinstance(payload, dict) else []:
            question = _valid_question(item, context, seen)
            if question:
                questions.append(question)
            if len(questions) >= requested:
                break
    except AIServiceError as exc:
        raise ValueError(f"Gemini quiz generation is unavailable: {exc}") from exc
    if len(questions) < 4:
        raise ValueError("Gemini returned too few content-grounded questions. Try again or select more processed notes.")
    return {"subject_id": str(subject.id), "chapters": selected, "questions": questions}
