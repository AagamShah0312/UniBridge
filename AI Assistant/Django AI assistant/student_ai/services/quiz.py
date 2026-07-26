from __future__ import annotations

import re
from collections import OrderedDict

from .ai_service import AIServiceError
from .gemini_service import GeminiDocumentService
from student_ai.models import AIDocumentChunk, Note, Subject


def _note_label(note: Note) -> str:
    """One selectable entry per faculty note, shown as "<folder> / <title>" so the
    T-1…T-4 folders faculty upload into stay visible in the picker."""
    title = (note.title or "").strip()
    folder = note.folder.name.strip() if note.folder_id and note.folder else ""
    return f"{folder} / {title}" if folder else title


def _subject_notes(subject_id: str) -> list[Note]:
    return list(
        Note.objects.filter(subject_id=subject_id, deleted_at__isnull=True)
        .select_related("folder")
        .order_by("folder__name", "title")
    )


def available_chapters(subject_id: str) -> list[str]:
    # Listed from the faculty notes themselves rather than from processed chunks:
    # a note that has not been through AI ingestion yet is still selectable and
    # gets extracted on demand in _chunks_for_notes().
    labels: OrderedDict[str, None] = OrderedDict()
    for note in _subject_notes(subject_id):
        label = _note_label(note)
        if label:
            labels.setdefault(label, None)
    return list(labels.keys())


def _selected_notes(subject_id: str, chapters: list[str], note_ids: list[str] | None) -> list[Note]:
    notes = _subject_notes(subject_id)
    if note_ids:
        # The API layer resolved these against the student's publication and batch
        # visibility, which this service does not mirror; trust that list only.
        wanted_ids = {str(note_id) for note_id in note_ids}
        return [note for note in notes if str(note.id) in wanted_ids]
    wanted = {chapter.strip().casefold() for chapter in chapters if isinstance(chapter, str) and chapter.strip()}
    if not wanted:
        return notes
    return [note for note in notes if _note_label(note).casefold() in wanted]


def _chunks_for_notes(notes: list[Note]) -> tuple[list[AIDocumentChunk], list[str]]:
    """Extracted chunks for the picked notes, ingesting any that were never
    processed. Returns the chunks plus one message per note that could not be
    extracted, so the caller can explain the failure instead of guessing."""
    # Imported here: ingestion_service pulls in PyMuPDF/embeddings, which the
    # chapter listing has no reason to load.
    from .ingestion_service import process_note_document

    def stored(note: Note) -> list[AIDocumentChunk]:
        return list(
            AIDocumentChunk.objects.filter(
                document__note_id=note.id,
                document__processing_status="completed",
            ).order_by("chunk_index")
        )

    chunks: list[AIDocumentChunk] = []
    failures: list[str] = []
    for note in notes:
        found = stored(note)
        if not found:
            try:
                process_note_document(note)
            except Exception as exc:  # noqa: BLE001 - reported back to the student
                failures.append(f"{_note_label(note)}: {exc}")
                continue
            found = stored(note)
        if found:
            chunks.extend(found)
        else:
            failures.append(f"{_note_label(note)}: no extractable text")
    return chunks, failures


def _chunk_heading(chunk: AIDocumentChunk) -> str:
    return (chunk.chapter_name or chunk.unit_name or "").strip() or "section"


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


def generate_quiz(subject_id: str, chapters: list[str], question_count: int, seed: str, note_ids: list[str] | None = None) -> dict:
    subject = Subject.objects.get(pk=subject_id)
    selected = [chapter.strip() for chapter in chapters if isinstance(chapter, str) and chapter.strip()]
    notes = _selected_notes(subject_id, selected, note_ids)
    if not notes:
        raise ValueError("Select at least one faculty note to generate questions from.")
    chunks, failures = _chunks_for_notes(notes)
    if not chunks:
        detail = f" ({'; '.join(failures)})" if failures else ""
        raise ValueError(f"The selected faculty notes have no extractable text{detail}.")

    # Send the extracted, semantically chunked faculty-note text to Gemini. This
    # is the material the questions are written from — nothing is templated.
    context = "\n\n".join(
        f"[{_chunk_heading(chunk)}]\n{chunk.content}"
        for chunk in chunks
    )[:24000]
    requested = max(4, min(int(question_count or 10), 20))
    system = "You are a university assessment author. Create content-grounded MCQs from the supplied faculty notes. Return JSON only."

    def build_prompt(count: int, stricter: bool) -> str:
        extra = (
            "\nThe previous attempt returned unusable questions. Quote concrete terms, definitions, "
            "formulas, or examples that appear verbatim in the context in every stem.\n"
            if stricter else ""
        )
        return f"""Create exactly {count} substantially different MCQs for {subject.code} - {subject.name}.
Use only the supplied extracted faculty-note context. Test the actual concepts, definitions, formulas, algorithms, examples, and relationships in that context.
Vary the question types across definition, concept application, comparison, sequence/process, scenario, and calculation when supported by the material.
Every question must name a concrete concept from the context. Never use a generic stem such as "Which statement is supported by the selected faculty note?" or ask about the existence of the notes.
Each question needs exactly four plausible, distinct options and one correct answer. Do not copy the same stem or answer pattern repeatedly.
Do not mention source text, AI, or 'according to the note'. Use the seed to vary question coverage: {seed}.
Return this exact JSON shape: {{"questions":[{{"text":"...","options":["...","...","...","..."],"correct_index":0,"explanation":"...","chapter":"..."}}]}}.
{extra}
FACULTY NOTE CONTEXT:
{context}
"""

    questions: list[dict] = []
    seen: set[str] = set()
    try:
        service = GeminiDocumentService()
        service.ai.timeout = max(service.ai.timeout, 30)
        service.ai.max_retries = max(service.ai.max_retries, 2)
        # Two passes: the validator below drops off-context or duplicated stems,
        # so one short reply would otherwise fail the whole generation.
        for attempt in range(2):
            missing = requested - len(questions)
            if missing <= 0:
                break
            payload = service.json_chat(system, build_prompt(missing, attempt > 0), fallback={"questions": []}, allow_fallback=False)
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
    # Report the notes actually used, so "Generated from: …" stays accurate when
    # the student selected nothing and every note was used.
    return {"subject_id": str(subject.id), "chapters": [_note_label(note) for note in notes], "questions": questions}
