from __future__ import annotations

from student_ai.models import Note
from student_ai.services.ingestion_service import process_note_document


def generate_note_insight(note: Note, *, source_url: str | None = None) -> dict:
    return process_note_document(note, source_url=source_url)
