"""Regression coverage for chunk-backed AI quiz generation."""

import uuid

from django.test import TestCase

from student_ai.models import AIDocument, AIDocumentChunk, Note, NoteFolder, Subject
from student_ai.services.quiz import _fallback_questions, _matching_chunks, available_chapters


class QuizSelectionTests(TestCase):
    def setUp(self):
        self.subject = Subject.objects.create(
            university_id=uuid.uuid4(), semester_number=4, code="IMM", name="Interactive Multimedia", type="THEORY"
        )
        folder = NoteFolder.objects.create(university_id=uuid.uuid4(), subject=self.subject, name="T-4")
        note = Note.objects.create(
            subject=self.subject, faculty_id=uuid.uuid4(), folder=folder, title="React Basics",
            file_url="/tmp/react.pdf", file_key="react.pdf", mime_type="application/pdf",
        )
        document = AIDocument.objects.create(
            subject=self.subject, note=note, source_type="note", title=note.title,
            original_file_url=note.file_url, original_file_key=note.file_key,
            content_hash="react-basics", processing_status="completed",
        )
        AIDocumentChunk.objects.create(
            document=document, subject=self.subject, chunk_index=0, chapter_name="React Basics",
            content="React components render user interfaces. React uses JSX to describe user interface elements. "
                    "The virtual DOM improves efficient interface updates. Components receive data through props.",
        )

    def test_processed_note_is_listed_by_folder_and_title(self):
        self.assertEqual(available_chapters(str(self.subject.id)), ["T-4 / React Basics"])

    def test_fallback_creates_content_specific_questions(self):
        chunks = _matching_chunks(str(self.subject.id), ["T-4 / React Basics"])
        questions = _fallback_questions(chunks, 4, "quiz-test")

        self.assertEqual(len(questions), 4)
        self.assertTrue(all("Which statement is supported" not in item["text"] for item in questions))
        self.assertTrue(all(len(item["options"]) == 4 for item in questions))
