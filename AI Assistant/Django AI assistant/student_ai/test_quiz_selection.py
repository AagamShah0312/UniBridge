"""Quiz note-picker selection rules.

Covers the two things that broke the AI quiz: the picker listing nothing when a
note had not been ingested yet, and generic non-content questions being accepted.
"""

import uuid

from django.test import TestCase

from student_ai.models import AIDocument, AIDocumentChunk, Note, NoteFolder, Subject
from student_ai.services.quiz import (
    GENERIC_STEM,
    _selected_notes,
    _valid_question,
    available_chapters,
)


def _subject(code: str) -> Subject:
    return Subject.objects.create(
        university_id=uuid.uuid4(), semester_number=4, code=code, name=f"{code} Subject", type="THEORY"
    )


def _note(subject: Subject, title: str, folder: NoteFolder | None = None) -> Note:
    return Note.objects.create(
        subject=subject, faculty_id=uuid.uuid4(), folder=folder, title=title,
        file_url=f"/tmp/{title}.pdf", file_key=f"{title}.pdf", mime_type="application/pdf",
    )


class QuizNoteSelectionTests(TestCase):
    def setUp(self):
        self.subject = _subject("IMM")
        self.other = _subject("DM")
        self.t1 = NoteFolder.objects.create(university_id=uuid.uuid4(), subject=self.subject, name="T-1")
        self.note_t1 = _note(self.subject, "Chapter 10", self.t1)
        self.note_loose = _note(self.subject, "Dotnet")

    def test_unprocessed_notes_are_still_listed(self):
        """The bug: chapters came from processed chunks, so a freshly uploaded
        note showed 'No processed faculty notes exist' and could not be picked."""
        self.assertEqual(available_chapters(str(self.subject.id)), ["Dotnet", "T-1 / Chapter 10"])

    def test_note_ids_win_over_labels_and_stay_inside_the_subject(self):
        foreign = _note(self.other, "Not Mine")
        picked = _selected_notes(
            str(self.subject.id), ["T-1 / Chapter 10"], [str(self.note_loose.id), str(foreign.id)]
        )
        # note_ids is the API-authorised list, so it overrides the label, and an id
        # belonging to another subject is dropped rather than leaked into the quiz.
        self.assertEqual([note.title for note in picked], ["Dotnet"])

    def test_labels_select_when_no_ids_are_supplied(self):
        picked = _selected_notes(str(self.subject.id), ["T-1 / Chapter 10"], None)
        self.assertEqual([note.title for note in picked], ["Chapter 10"])

    def test_empty_selection_means_every_note(self):
        self.assertEqual(len(_selected_notes(str(self.subject.id), [], None)), 2)


class QuizQuestionValidationTests(TestCase):
    CONTEXT = "Bezier curves interpolate control points to render smooth vector paths."

    def _question(self, text: str) -> dict:
        return {
            "text": text,
            "options": ["Bezier curves", "Raster grids", "Audio buffers", "Shell scripts"],
            "correct_index": 0,
            "explanation": "",
        }

    def test_generic_stem_is_rejected(self):
        self.assertIsNone(_valid_question(self._question(GENERIC_STEM.title() + "?"), self.CONTEXT, set()))

    def test_question_unrelated_to_the_notes_is_rejected(self):
        self.assertIsNone(_valid_question(self._question("Who won the 1998 world cup?"), self.CONTEXT, set()))

    def test_grounded_question_is_accepted_once(self):
        seen: set[str] = set()
        text = "Which primitive interpolates control points for smooth vector paths?"
        self.assertIsNotNone(_valid_question(self._question(text), self.CONTEXT, seen))
        # Duplicate stems must not pad a short generation run.
        self.assertIsNone(_valid_question(self._question(text), self.CONTEXT, seen))


class QuizChunkReuseTests(TestCase):
    def test_completed_chunks_are_reused_without_reprocessing(self):
        subject = _subject("COA")
        note = _note(subject, "Pipelining")
        document = AIDocument.objects.create(
            subject=subject, note=note, source_type="note", title=note.title,
            original_file_url=note.file_url, original_file_key=note.file_key,
            content_hash="abc", processing_status="completed",
        )
        AIDocumentChunk.objects.create(
            document=document, subject=subject, chunk_index=0,
            chapter_name="Pipeline hazards", content="A data hazard stalls the pipeline.",
        )
        from student_ai.services.quiz import _chunks_for_notes

        chunks, failures = _chunks_for_notes([note])
        self.assertEqual(len(chunks), 1)
        self.assertEqual(failures, [])
