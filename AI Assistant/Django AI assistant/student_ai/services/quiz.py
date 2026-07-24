from __future__ import annotations

import random
import re
from collections import OrderedDict

from .ai_service import AIServiceError
from .gemini_service import GeminiDocumentService
from student_ai.models import AIDocumentChunk, Subject


def available_chapters(subject_id: str) -> list[str]:
    chunks = AIDocumentChunk.objects.filter(
        subject_id=subject_id,
        document__processing_status="completed",
    ).select_related("document").order_by("document__title", "chunk_index")
    labels: OrderedDict[str, None] = OrderedDict()
    for chunk in chunks:
        label = (chunk.chapter_name or chunk.unit_name or chunk.document.title or "").strip()
        if label:
            labels.setdefault(label, None)
    return list(labels.keys())


def _matching_chunks(subject_id: str, chapters: list[str]) -> list[AIDocumentChunk]:
    normalized = {chapter.strip().casefold() for chapter in chapters if chapter.strip()}
    chunks = list(AIDocumentChunk.objects.filter(
        subject_id=subject_id,
        document__processing_status="completed",
    ).select_related("document").order_by("document__title", "chunk_index"))
    if not normalized:
        return chunks
    return [
        chunk for chunk in chunks
        if (chunk.chapter_name or chunk.unit_name or chunk.document.title or "").strip().casefold() in normalized
    ]


def _fallback_questions(chunks: list[AIDocumentChunk], count: int, seed: str) -> list[dict]:
    sentences: list[str] = []
    for chunk in chunks:
        for sentence in re.split(r"(?<=[.!?])\s+", chunk.content):
            cleaned = " ".join(sentence.split())
            if 45 <= len(cleaned) <= 260 and cleaned not in sentences:
                sentences.append(cleaned)
    if len(sentences) < 4:
        return []
    rng = random.Random(seed)
    rng.shuffle(sentences)
    questions: list[dict] = []
    for index, correct in enumerate(sentences[:count]):
        distractors = [item for item in sentences if item != correct][:]
        rng.shuffle(distractors)
        options = [correct, *distractors[:3]]
        rng.shuffle(options)
        questions.append({
            "text": "Which statement is supported by the selected faculty note?",
            "options": options,
            "correct_index": options.index(correct),
            "explanation": "This statement is taken directly from the selected faculty-note material.",
            "chapter": "Selected notes",
        })
    return questions


def generate_quiz(subject_id: str, chapters: list[str], question_count: int, seed: str) -> dict:
    subject = Subject.objects.get(pk=subject_id)
    selected = [chapter.strip() for chapter in chapters if isinstance(chapter, str) and chapter.strip()]
    chunks = _matching_chunks(subject_id, selected)
    if not chunks:
        raise ValueError("No processed faculty-note chunks are available for the selected chapters.")

    context = "\n\n".join(
        f"[Chapter: {chunk.chapter_name or chunk.unit_name or chunk.document.title}]\n{chunk.content}"
        for chunk in chunks
    )[:50000]
    requested = max(4, min(int(question_count or 10), 20))
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
        payload = GeminiDocumentService().json_chat(system, prompt, {"questions": []})
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
    except AIServiceError:
        questions = []
    questions = [question for question in questions if question["text"]]
    if len(questions) < 4:
        questions = _fallback_questions(chunks, requested, seed)
    if len(questions) < 4:
        raise ValueError("The selected notes do not contain enough readable content to create a quiz.")
    return {"subject_id": str(subject.id), "chapters": selected, "questions": questions}
