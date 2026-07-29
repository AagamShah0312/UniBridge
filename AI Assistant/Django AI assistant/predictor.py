"""
ML inference helpers for UniBridge student marks prediction.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from statistics import mean
from typing import Optional

import numpy as np

from model import MODEL_PATH, build_features, get_model
from student_ai.models import Result, Student

logger = logging.getLogger(__name__)


def model_metadata() -> dict:
    meta_path = Path(MODEL_PATH).with_suffix(".json")
    if not meta_path.exists():
        return {"name": "Best Model", "metrics": {}}
    try:
        return json.loads(meta_path.read_text())
    except Exception:
        return {"name": "Best Model", "metrics": {}}


def predict_final_score(t1: float, t2: float, t3: float, subject_name: Optional[str] = None) -> dict:
    model = get_model()
    score = float(model.predict(build_features(t1, t2, t3))[0])
    score = round(max(0.0, min(50.0, score)), 2)
    std = float(np.std([t1, t2, t3]))
    if std < 2.0:
        confidence = "High - consistent performance across tests."
    elif std < 4.5:
        confidence = "Medium - moderate variation across tests."
    else:
        confidence = "Low - high variation; prediction may be less accurate."
    return {
        "predicted_final_score": score,
        "confidence_note": confidence,
        "input_avg": round((t1 + t2 + t3) / 3.0, 2),
        "subject_name": subject_name,
        "max_marks": 50,
    }


def _performance_label(percentage: float) -> str:
    if percentage >= 85:
        return "Excellent"
    if percentage >= 70:
        return "Good"
    if percentage >= 50:
        return "Average"
    return "Needs Improvement"


def _to_30_scale(percentage: float) -> float:
    return round((percentage / 100.0) * 30.0, 2)


def _phase_key(result: Result) -> str:
    label = (result.phase.label or "").upper().replace("-", "").replace(" ", "")
    if label in {"T1", "TEST1", "PHASE1"} or result.phase.number == 1:
        return "T1"
    if label in {"T2", "TEST2", "PHASE2"} or result.phase.number == 2:
        return "T2"
    if label in {"T3", "TEST3", "PHASE3"} or result.phase.number == 3:
        return "T3"
    if label in {"T4", "TEST4", "PHASE4"} or result.phase.number == 4:
        return "T4"
    return label


def _normalise_mark(marks_obtained: float, max_marks: float, target_max: float) -> float:
    """Convert stored result marks to the scale expected by the predictor."""
    if max_marks <= 0:
        return 0.0
    return max(0.0, min(target_max, (marks_obtained / max_marks) * target_max))


def predict_student_next_semester_marks(student_id: str) -> Optional[dict]:
    student = Student.objects.filter(pk=student_id).first()
    if not student:
        return None

    marks = list(
        Result.objects.select_related("phase", "subject", "enrollment__semester")
        .filter(enrollment__student=student, is_published=True)
        .order_by("enrollment__semester__number", "subject__name", "phase__number")
    )
    if not marks:
        return None

    grouped: dict[tuple[str, str], list[Result]] = {}
    for mark in marks:
        grouped.setdefault((str(mark.enrollment_id), str(mark.subject_id)), []).append(mark)

    predictions: list[dict] = []
    for group in grouped.values():
        first = group[0]
        tests = {
            _phase_key(item): _normalise_mark(float(item.marks_obtained), float(item.max_marks), 25.0)
            for item in group
        }
        if "T4" in tests or not all(name in tests for name in ("T1", "T2", "T3")):
            continue

        predicted = predict_final_score(tests["T1"], tests["T2"], tests["T3"], first.subject.name)
        predicted_score = min(50.0, predicted["predicted_final_score"])
        actual_obtained = sum(float(item.marks_obtained) for item in group)
        actual_max = sum(float(item.max_marks) for item in group)
        projected_percentage = round(((actual_obtained + predicted_score) / (actual_max + 50.0)) * 100.0, 2)
        baseline_t4 = (mean([tests["T1"], tests["T2"], tests["T3"]]) / 25.0) * 50.0
        if predicted_score > baseline_t4 + 2:
            trend = "Improving"
        elif predicted_score < baseline_t4 - 2:
            trend = "Declining"
        else:
            trend = "Stable"

        predictions.append(
            {
                "semester": first.enrollment.semester.number,
                "academic_year": str(first.enrollment.semester.academic_year_id),
                "subject_id": str(first.subject_id),
                "subject_code": first.subject.code,
                "subject_name": first.subject.name,
                "test_id": None,
                "test_type": "T4",
                "predicted_final_score": round(predicted_score, 2),
                "predicted_marks": round(predicted_score, 2),
                "max_marks": 50,
                "predicted_percentage": projected_percentage,
                "trend": trend,
                "confidence_note": predicted["confidence_note"],
            }
        )

    if not predictions:
        return None

    latest_semester = max(item["semester"] for item in predictions)
    predictions = [item for item in predictions if item["semester"] == latest_semester]
    predicted_percentage = round(mean(item["predicted_percentage"] for item in predictions), 2)
    meta = model_metadata()
    metrics = meta.get("metrics", {})
    return {
        "student_id": str(student.id),
        "enrollment_no": student.enrollment_no,
        "name": student.name,
        "semester": latest_semester,
        "predicted_average": _to_30_scale(predicted_percentage),
        "predicted_percentage": predicted_percentage,
        "predicted_rank": None,
        "predicted_badge": _performance_label(predicted_percentage),
        "prediction_confidence": "High" if len(predictions) >= 3 else "Medium",
        "model_name": meta.get("name", "Best Model"),
        "model_r2": metrics.get("r2"),
        "model_mae": metrics.get("mae"),
        "model_rmse": metrics.get("rmse"),
        "predictions": predictions,
        "subject_predictions": predictions,
    }
