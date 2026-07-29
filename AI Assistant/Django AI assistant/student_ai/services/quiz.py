from __future__ import annotations

import random
import re
from collections import OrderedDict

from .ai_service import AIServiceError
from .gemini_service import GeminiDocumentService
from student_ai.models import AIDocumentChunk, Subject


def _chapter_label(chunk: AIDocumentChunk) -> str:
    title = (chunk.document.note.title if chunk.document.note_id else chunk.document.title).strip()
    folder = chunk.document.note.folder.name.strip() if chunk.document.note_id and chunk.document.note.folder_id else ""
    return f"{folder} / {title}" if folder else title


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


def _fallback_questions(chunks: list[AIDocumentChunk], count: int, seed: str) -> list[dict]:
    sentences: list[tuple[str, str]] = []
    for chunk in chunks:
        for sentence in re.split(r"(?<=[.!?])\s+", chunk.content):
            cleaned = " ".join(sentence.split())
            if 12 <= len(cleaned) <= 260 and cleaned not in [item[0] for item in sentences]:
                sentences.append((cleaned, _chapter_label(chunk)))
    if not sentences:
        return []
    rng = random.Random(seed)
    rng.shuffle(sentences)
    stop_words = {"about","after","also","and","are","between","called","each","from","have","into","more","note","only","that","the","their","there","these","this","through","with","which"}
    vocabulary = list({word for sentence, _chapter in sentences for word in re.findall(r"[a-zA-Z][A-Za-z0-9_-]{3,}", sentence) if word.lower() not in stop_words})
    if len(vocabulary) < 4:
        return []
    questions: list[dict] = []
    for sentence, chapter in sentences:
        candidates = [word for word in re.findall(r"[a-zA-Z][A-Za-z0-9_-]{3,}", sentence) if word.lower() not in stop_words]
        if not candidates:
            continue
        rng.shuffle(candidates)
        for correct in dict.fromkeys(candidates):
            distractors = [word for word in vocabulary if word.casefold() != correct.casefold()]
            rng.shuffle(distractors)
            options = [correct, *distractors[:3]]
            if len(options) != 4:
                continue
            rng.shuffle(options)
            cloze = re.sub(re.escape(correct), "_____", sentence, flags=re.IGNORECASE)
            questions.append({
                "text": f"Complete this statement from {chapter}: {cloze}",
                "options": options,
                "correct_index": options.index(correct),
                "explanation": f"The missing term in the faculty material is '{correct}'.",
                "chapter": chapter,
            })
            if len(questions) >= count:
                break
        if len(questions) >= count:
            break
    return questions


def generate_quiz(subject_id: str, chapters: list[str], question_count: int, seed: str) -> dict:
    subject = Subject.objects.get(pk=subject_id)
    selected = [chapter.strip() for chapter in chapters if isinstance(chapter, str) and chapter.strip()]
    chunks = _matching_chunks(subject_id, selected)
    if not chunks:
        raise ValueError("No processed faculty-note chunks are available for the selected chapters.")

    # Keep synchronous quiz generation below the web client's timeout. If the
    # provider cannot answer quickly, the note-grounded local fallback is used.
    context = "\n\n".join(
        f"[Chapter: {_chapter_label(chunk)}]\n{chunk.content}"
        for chunk in chunks
    )[:6000]
    requested = max(4, min(int(question_count or 10), 20))
    local_questions = _fallback_questions(chunks, requested, seed)
    if len(context) < 600 and len(local_questions) >= 4:
        return {"subject_id": str(subject.id), "chapters": selected, "questions": local_questions}
    system = "You create accurate university practice MCQs from faculty notes. Return JSON only."
    prompt = f"""Create exactly {requested} different MCQs for {subject.code} - {subject.name}.
Use only the supplied faculty-note context. Each question needs exactly four plausible, distinct options and one correct answer.
Do not mention source text, AI, or 'according to the note'. Use the seed to vary question coverage: {seed}.
Return this exact JSON shape: {{"questions":[{{"text":"...","options":["...","...","...","..."],"correct_index":0,"explanation":"...","chapter":"..."}}]}}.

FACULTY NOTE CONTEXT:
{context}
"""
    questions: list[dict] = []
    try:
        service = GeminiDocumentService()
        service.ai.timeout = 55
        service.ai.max_retries = 1
        service.fallback_ai.model = service.ai.model
        payload = service.json_chat(system, prompt, fallback={"questions": []})
        for item in payload.get("questions", []) if isinstance(payload, dict) else []:
            options = item.get("options") if isinstance(item, dict) else None
            correct = item.get("correct_index") if isinstance(item, dict) else None
            if isinstance(options, list) and len(options) == 4 and len({str(option).strip() for option in options}) == 4 and isinstance(correct, int) and 0 <= correct < 4:
                questions.append({
                    "text": str(item.get("text", "")).strip(),
                    "options": [str(option).strip() for option in options],
                    "correct_index": correct,
                    "explanation": str(item.get("explanation", "")).strip(),
                    "chapter": str(item.get("chapter", "")).strip(),
                })
            if len(questions) >= requested:
                break
    except Exception:
        questions = []
    questions = [question for question in questions if question["text"]]
    if len(questions) < 4:
        questions = local_questions
    if len(questions) < 4:
        raise ValueError("The selected notes do not contain enough readable content to create a quiz.")
    return {"subject_id": str(subject.id), "chapters": selected, "questions": questions}
