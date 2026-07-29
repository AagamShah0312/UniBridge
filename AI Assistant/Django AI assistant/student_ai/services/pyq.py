from __future__ import annotations

from student_ai.models import PYQFile
from student_ai.services.pyq_service import analyze_pyq_statistics, process_pyq_document


def analyze_pyq(pyq_file: PYQFile, *, source_url: str | None = None) -> dict:
    return process_pyq_document(pyq_file, source_url=source_url)


def predict_topic_trends(subject_id: str) -> dict:
    return analyze_pyq_statistics(subject_id)
