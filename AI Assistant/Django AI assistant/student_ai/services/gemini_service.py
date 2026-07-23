from __future__ import annotations

import json
import os
import re
import base64
import logging
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from student_ai.services.ai_service import AIServiceError, SharedAIService

logger = logging.getLogger(__name__)


class GeminiDocumentService:
    """Provider wrapper so native Gemini file APIs can be swapped in later."""

    def __init__(self) -> None:
        self.ai = SharedAIService(model=os.getenv("FREELLMAPI_DOCUMENT_MODEL") or None)
        self.fallback_ai = SharedAIService()

    def json_chat(self, system: str, user: str, *, fallback: dict[str, Any]) -> dict[str, Any]:
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]
        try:
            reply = self.ai.chat(messages, temperature=0.1, response_format={"type": "json_object"})["reply"]
        except AIServiceError:
            if self.ai.model == self.fallback_ai.model:
                raise
            logger.warning("Configured document model failed; using the available text model for structured extraction.")
            reply = self.fallback_ai.chat(messages, temperature=0.1, response_format={"type": "json_object"})["reply"]
        return _parse_json(reply, fallback)

    def extract_image_text(self, source: str | Path, *, mime_type: str | None = None) -> str:
        image_url = _image_url(source, mime_type)
        reply = self.ai.chat(
            [
                {
                    "role": "system",
                    "content": (
                        "You are Gemini document understanding for academic material. "
                        "Extract all readable text from the image, preserving headings, tables, formulas, "
                        "question numbers, marks, units, and layout hints. Return plain text only."
                    ),
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Extract this academic document image for downstream chunking and analysis."},
                        {"type": "image_url", "image_url": {"url": image_url}},
                    ],
                },
            ],
            temperature=0.0,
        )["reply"]
        return reply.strip()


def _parse_json(reply: str, fallback: dict[str, Any]) -> dict[str, Any]:
    text = reply.strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, flags=re.DOTALL | re.IGNORECASE)
    if fenced:
        text = fenced.group(1).strip()
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else fallback
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            try:
                parsed = json.loads(text[start : end + 1])
                return parsed if isinstance(parsed, dict) else fallback
            except json.JSONDecodeError:
                return fallback
    return fallback


def normalize_list(value: Any, *, limit: int = 25) -> list[str]:
    if isinstance(value, list):
        items = value
    elif isinstance(value, str):
        items = [part.strip() for part in re.split(r"[,;\n]", value)]
    else:
        items = []
    result: list[str] = []
    for item in items:
        if isinstance(item, dict):
            item = item.get("title") or item.get("name") or item.get("topic") or item.get("text")
        if item is None:
            continue
        text = str(item).strip()
        if text and text not in result:
            result.append(text[:255])
    return result[:limit]


def _image_url(source: str | Path, mime_type: str | None) -> str:
    if isinstance(source, str) and urlparse(source).scheme in {"http", "https"}:
        return source
    path = Path(source)
    guessed = mime_type or _mime_from_suffix(path.suffix)
    payload = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{guessed};base64,{payload}"


def _mime_from_suffix(suffix: str) -> str:
    return {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".bmp": "image/bmp",
    }.get(suffix.lower(), "image/png")
