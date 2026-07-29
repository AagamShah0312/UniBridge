"""
Train and persist the best ML regressor for marks prediction.
"""
from __future__ import annotations

import json
import logging
import math
from pathlib import Path
from typing import Any

import joblib
import numpy as np
from sklearn.ensemble import ExtraTreesRegressor, GradientBoostingRegressor, RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

logger = logging.getLogger(__name__)

_HERE = Path(__file__).parent
MODEL_PATH = _HERE / "marks_predictor.pkl"
_model: Pipeline | None = None


def build_features(t1: float, t2: float, t3: float) -> np.ndarray:
    values = [t1, t2, t3]
    return np.array([[t1, t2, t3, np.mean(values), np.std(values)]])


def _generate_synthetic_data(n: int = 2000) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(42)
    t1 = rng.uniform(5, 25, n)
    t2 = rng.uniform(5, 25, n)
    t3 = rng.uniform(5, 25, n)
    weighted_avg = (0.25 * t1) + (0.30 * t2) + (0.45 * t3)
    final = np.clip((2.0 * weighted_avg) + rng.normal(0, 1.5, n), 0, 50)
    x_data = np.column_stack([t1, t2, t3, (t1 + t2 + t3) / 3, np.std(np.column_stack([t1, t2, t3]), axis=1)])
    return x_data, final


def train_model(X: np.ndarray | None = None, y: np.ndarray | None = None) -> Pipeline:
    if X is None or y is None:
        logger.info("Training marks predictor on synthetic data.")
        X, y = _generate_synthetic_data()

    x_train, x_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    candidates = {
        "Linear Regression": LinearRegression(),
        "Random Forest": RandomForestRegressor(n_estimators=100, random_state=42),
        "Gradient Boosting": GradientBoostingRegressor(random_state=42),
        "Extra Trees": ExtraTreesRegressor(n_estimators=100, random_state=42),
    }

    best_name = ""
    best_pipeline: Pipeline | None = None
    best_r2 = -float("inf")
    best_metrics: dict[str, float] = {}

    for name, regressor in candidates.items():
        pipeline = Pipeline([("scaler", StandardScaler()), ("reg", regressor)])
        pipeline.fit(x_train, y_train)
        prediction = pipeline.predict(x_test)
        mae = float(mean_absolute_error(y_test, prediction))
        mse = float(mean_squared_error(y_test, prediction))
        rmse = float(math.sqrt(mse))
        r2 = float(r2_score(y_test, prediction))
        logger.info("%s -> R2: %.4f | MAE: %.4f | RMSE: %.4f", name, r2, mae, rmse)
        if r2 > best_r2:
            best_name = name
            best_pipeline = pipeline
            best_r2 = r2
            best_metrics = {"r2": r2, "mae": mae, "rmse": rmse}

    if best_pipeline is None:
        raise RuntimeError("No model candidate was trained.")

    joblib.dump(best_pipeline, MODEL_PATH)
    MODEL_PATH.with_suffix(".json").write_text(json.dumps({"name": best_name, "metrics": best_metrics}))
    return best_pipeline


def get_model() -> Pipeline:
    global _model
    if _model is not None:
        return _model
    if MODEL_PATH.exists():
        _model = joblib.load(MODEL_PATH)
        logger.info("Marks predictor loaded from %s", MODEL_PATH)
    else:
        _model = train_model()
    return _model


def retrain_from_db() -> dict[str, Any]:
    from collections import defaultdict

    from student_ai.models import Result

    rows = list(Result.objects.select_related("phase").filter(is_published=True))
    if len(rows) < 20:
        return {"status": "skipped", "reason": "Insufficient data (< 20 result rows)"}

    grouped: dict[tuple[str, str], dict[str, tuple[float, float]]] = defaultdict(dict)
    for row in rows:
        grouped[(str(row.enrollment_id), str(row.subject_id))][row.phase.label.upper()] = (
            float(row.marks_obtained),
            float(row.max_marks),
        )

    x_rows: list[list[float]] = []
    y_rows: list[float] = []
    for marks_by_type in grouped.values():
        t1 = marks_by_type.get("T1")
        t2 = marks_by_type.get("T2")
        t3 = marks_by_type.get("T3")
        t4 = marks_by_type.get("T4")
        if all(value is not None for value in (t1, t2, t3, t4)):
            assert t1 is not None and t2 is not None and t3 is not None and t4 is not None
            normalized = lambda value, target: (value[0] / value[1]) * target if value[1] > 0 else 0.0
            t1_value, t2_value, t3_value = normalized(t1, 25.0), normalized(t2, 25.0), normalized(t3, 25.0)
            t4_value = normalized(t4, 50.0)
            x_rows.append([t1_value, t2_value, t3_value, np.mean([t1_value, t2_value, t3_value]), np.std([t1_value, t2_value, t3_value])])
            y_rows.append(t4_value)

    if len(x_rows) < 10:
        return {"status": "skipped", "reason": "Not enough complete T1/T2/T3/T4 records in database"}

    global _model
    _model = train_model(np.array(x_rows), np.array(y_rows))
    meta = json.loads(MODEL_PATH.with_suffix(".json").read_text())
    metrics = meta.get("metrics", {})
    return {
        "status": "retrained",
        "best_model": meta.get("name", "Best Model"),
        "samples": len(x_rows),
        "r2": round(metrics.get("r2", 0.0), 4),
        "mae": round(metrics.get("mae", 0.0), 4),
        "rmse": round(metrics.get("rmse", 0.0), 4),
    }
