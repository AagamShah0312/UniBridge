from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable
from uuid import UUID

from django.conf import settings
from django.db import close_old_connections

from student_ai.models import BackgroundJob

logger = logging.getLogger(__name__)
executor = ThreadPoolExecutor(max_workers=4)


def _json_safe(value: Any) -> Any:
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    return value


def create_job(job_type: str, payload: dict[str, Any], *, university_id: str, student_id: str | None = None) -> BackgroundJob:
    return BackgroundJob.objects.create(
        university_id=university_id,
        student_id=student_id,
        job_type=job_type,
        payload=_json_safe(payload),
    )


def submit_job(job: BackgroundJob, func: Callable[..., dict[str, Any]], *args: Any, **kwargs: Any) -> None:
    def runner() -> None:
        close_old_connections()
        try:
            job.status = "PROCESSING"
            job.progress = 10
            job.save(update_fields=["status", "progress", "updated_at"])
            result = func(*args, **kwargs)
            job.status = "COMPLETE"
            job.progress = 100
            job.result = result
            job.save(update_fields=["status", "progress", "result", "updated_at"])
        except Exception as exc:
            logger.exception("Background job %s failed", job.id)
            job.status = "FAILED"
            job.error = str(exc)
            job.save(update_fields=["status", "error", "updated_at"])
        finally:
            close_old_connections()

    if settings.DB_MANAGED_MIRROR:
        runner()
        return
    executor.submit(runner)
