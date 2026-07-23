from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models


class PrismaMirrorModel(models.Model):
    class Meta:
        abstract = True
        managed = settings.DB_MANAGED_MIRROR


class Student(PrismaMirrorModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    university_id = models.UUIDField(db_column="universityId")
    enrollment_no = models.CharField(max_length=100, unique=True, db_column="enrollmentNo")
    name = models.CharField(max_length=255)
    email = models.EmailField(unique=True)
    password_hash = models.CharField(max_length=255, db_column="passwordHash")
    branch = models.CharField(max_length=100)
    branch_id = models.UUIDField(null=True, blank=True, db_column="branchId")
    admission_year = models.IntegerField(db_column="admissionYear")
    profile_photo_url = models.CharField(max_length=500, null=True, blank=True, db_column="profilePhotoUrl")
    phone = models.CharField(max_length=50, null=True, blank=True)
    is_active = models.BooleanField(default=True, db_column="isActive")
    created_at = models.DateTimeField(auto_now_add=True, db_column="createdAt")
    updated_at = models.DateTimeField(auto_now=True, db_column="updatedAt")
    deleted_at = models.DateTimeField(null=True, blank=True, db_column="deletedAt")

    class Meta(PrismaMirrorModel.Meta):
        db_table = "students"


class Semester(PrismaMirrorModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    university_id = models.UUIDField(db_column="universityId")
    academic_year_id = models.UUIDField(db_column="academicYearId")
    number = models.IntegerField()
    label = models.CharField(max_length=255)
    year_level = models.CharField(max_length=32, db_column="yearLevel")
    status = models.CharField(max_length=32)
    start_date = models.DateTimeField(db_column="startDate")
    end_date = models.DateTimeField(db_column="endDate")
    phase_count = models.IntegerField(default=4, db_column="phaseCount")
    created_at = models.DateTimeField(auto_now_add=True, db_column="createdAt")
    updated_at = models.DateTimeField(auto_now=True, db_column="updatedAt")

    class Meta(PrismaMirrorModel.Meta):
        db_table = "semesters"


class Subject(PrismaMirrorModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    university_id = models.UUIDField(db_column="universityId")
    semester_number = models.IntegerField(db_column="semesterNumber")
    code = models.CharField(max_length=100)
    name = models.CharField(max_length=255)
    credits = models.IntegerField(default=4)
    type = models.CharField(max_length=32)
    branch = models.CharField(max_length=100, null=True, blank=True)
    total_marks = models.IntegerField(default=100, db_column="totalMarks")
    passing_marks = models.IntegerField(default=40, db_column="passingMarks")
    theory_rule = models.CharField(max_length=32, default="AVG_ALL", db_column="theoryRule")
    is_active = models.BooleanField(default=True, db_column="isActive")
    created_at = models.DateTimeField(auto_now_add=True, db_column="createdAt")
    updated_at = models.DateTimeField(auto_now=True, db_column="updatedAt")
    deleted_at = models.DateTimeField(null=True, blank=True, db_column="deletedAt")

    class Meta(PrismaMirrorModel.Meta):
        db_table = "subjects"


class StudentEnrollment(PrismaMirrorModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    student = models.ForeignKey(Student, on_delete=models.DO_NOTHING, db_column="studentId", related_name="enrollments")
    semester = models.ForeignKey(Semester, on_delete=models.DO_NOTHING, db_column="semesterId", related_name="enrollments")
    batch_id = models.UUIDField(db_column="batchId")
    roll_no = models.CharField(max_length=100, db_column="rollNo")
    year_level = models.CharField(max_length=32, db_column="yearLevel")
    is_current = models.BooleanField(default=True, db_column="isCurrent")
    promoted_from_id = models.UUIDField(null=True, blank=True, db_column="promotedFromId")
    created_at = models.DateTimeField(auto_now_add=True, db_column="createdAt")
    updated_at = models.DateTimeField(auto_now=True, db_column="updatedAt")

    class Meta(PrismaMirrorModel.Meta):
        db_table = "student_enrollments"


class Phase(PrismaMirrorModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    semester = models.ForeignKey(Semester, on_delete=models.DO_NOTHING, db_column="semesterId", related_name="phases")
    label = models.CharField(max_length=50)
    number = models.IntegerField()
    start_date = models.DateTimeField(db_column="startDate")
    end_date = models.DateTimeField(db_column="endDate")
    exam_date = models.DateTimeField(null=True, blank=True, db_column="examDate")
    is_complete = models.BooleanField(default=False, db_column="isComplete")
    created_at = models.DateTimeField(auto_now_add=True, db_column="createdAt")

    class Meta(PrismaMirrorModel.Meta):
        db_table = "phases"


class Result(PrismaMirrorModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    enrollment = models.ForeignKey(StudentEnrollment, on_delete=models.DO_NOTHING, db_column="enrollmentId", related_name="results")
    phase = models.ForeignKey(Phase, on_delete=models.DO_NOTHING, db_column="phaseId", related_name="results")
    subject = models.ForeignKey(Subject, on_delete=models.DO_NOTHING, db_column="subjectId", related_name="results")
    marks_obtained = models.FloatField(db_column="marksObtained")
    max_marks = models.FloatField(default=100, db_column="maxMarks")
    grade = models.CharField(max_length=50, null=True, blank=True)
    is_published = models.BooleanField(default=False, db_column="isPublished")
    published_at = models.DateTimeField(null=True, blank=True, db_column="publishedAt")
    uploaded_by_id = models.UUIDField(db_column="uploadedById")
    created_at = models.DateTimeField(auto_now_add=True, db_column="createdAt")
    updated_at = models.DateTimeField(auto_now=True, db_column="updatedAt")

    class Meta(PrismaMirrorModel.Meta):
        db_table = "results"


class Note(PrismaMirrorModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    subject = models.ForeignKey(Subject, on_delete=models.DO_NOTHING, db_column="subjectId", related_name="notes")
    faculty_id = models.UUIDField(db_column="facultyId")
    title = models.CharField(max_length=255)
    description = models.TextField(null=True, blank=True)
    file_url = models.CharField(max_length=500, db_column="fileUrl")
    file_key = models.CharField(max_length=500, db_column="fileKey")
    mime_type = models.CharField(max_length=255, db_column="mimeType")
    file_size_kb = models.IntegerField(null=True, blank=True, db_column="fileSizeKb")
    ai_summary = models.TextField(null=True, blank=True, db_column="aiSummary")
    ai_job_id = models.CharField(max_length=100, null=True, blank=True, db_column="aiJobId")
    created_at = models.DateTimeField(auto_now_add=True, db_column="createdAt")
    updated_at = models.DateTimeField(auto_now=True, db_column="updatedAt")
    deleted_at = models.DateTimeField(null=True, blank=True, db_column="deletedAt")

    class Meta(PrismaMirrorModel.Meta):
        db_table = "notes"


class Flashcard(PrismaMirrorModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    note = models.ForeignKey(Note, on_delete=models.DO_NOTHING, db_column="noteId", related_name="flashcards")
    question = models.TextField()
    answer = models.TextField()
    order = models.IntegerField(default=0)

    class Meta(PrismaMirrorModel.Meta):
        db_table = "flashcards"


class PYQFile(PrismaMirrorModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    subject = models.ForeignKey(Subject, on_delete=models.DO_NOTHING, db_column="subjectId", related_name="pyq_files")
    uploaded_by_id = models.UUIDField(db_column="uploadedById")
    year = models.CharField(max_length=50)
    file_url = models.CharField(max_length=500, db_column="fileUrl")
    file_key = models.CharField(max_length=500, db_column="fileKey")
    ai_job_id = models.CharField(max_length=100, null=True, blank=True, db_column="aiJobId")
    is_analyzed = models.BooleanField(default=False, db_column="isAnalyzed")
    created_at = models.DateTimeField(auto_now_add=True, db_column="createdAt")

    class Meta(PrismaMirrorModel.Meta):
        db_table = "pyq_files"


class PYQAnalysis(PrismaMirrorModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    subject = models.ForeignKey(Subject, on_delete=models.DO_NOTHING, db_column="subjectId", related_name="pyq_analyses")
    semester = models.ForeignKey(Semester, on_delete=models.DO_NOTHING, db_column="semesterId", related_name="pyq_analyses")
    topic_frequencies = models.JSONField(default=dict, db_column="topicFrequencies")
    analyzed_at = models.DateTimeField(auto_now_add=True, db_column="analyzedAt")

    class Meta(PrismaMirrorModel.Meta):
        db_table = "pyq_analyses"


class AIDocument(PrismaMirrorModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE, db_column="subjectId", related_name="ai_documents")
    note = models.OneToOneField(Note, on_delete=models.CASCADE, null=True, blank=True, db_column="noteId", related_name="ai_document")
    pyq_file = models.OneToOneField(PYQFile, on_delete=models.CASCADE, null=True, blank=True, db_column="pyqFileId", related_name="ai_document")
    uploaded_by_id = models.UUIDField(null=True, blank=True, db_column="uploadedById")
    source_type = models.CharField(max_length=32, db_column="sourceType")
    title = models.CharField(max_length=255)
    original_file_url = models.CharField(max_length=500, db_column="originalFileUrl")
    original_file_key = models.CharField(max_length=500, db_column="originalFileKey")
    mime_type = models.CharField(max_length=255, null=True, blank=True, db_column="mimeType")
    content_hash = models.CharField(max_length=128, db_column="contentHash")
    processing_status = models.CharField(max_length=32, default="pending", db_column="processingStatus")
    total_pages = models.IntegerField(default=0, db_column="totalPages")
    total_chunks = models.IntegerField(default=0, db_column="totalChunks")
    error_message = models.TextField(null=True, blank=True, db_column="errorMessage")
    processed_at = models.DateTimeField(null=True, blank=True, db_column="processedAt")
    created_at = models.DateTimeField(auto_now_add=True, db_column="createdAt")
    updated_at = models.DateTimeField(auto_now=True, db_column="updatedAt")

    class Meta(PrismaMirrorModel.Meta):
        db_table = "ai_documents"


class AIDocumentChunk(PrismaMirrorModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(AIDocument, on_delete=models.CASCADE, db_column="documentId", related_name="chunks")
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE, db_column="subjectId", related_name="ai_document_chunks")
    chunk_index = models.IntegerField(db_column="chunkIndex")
    unit_name = models.CharField(max_length=255, null=True, blank=True, db_column="unitName")
    chapter_name = models.CharField(max_length=255, null=True, blank=True, db_column="chapterName")
    page_number = models.IntegerField(null=True, blank=True, db_column="pageNumber")
    content = models.TextField()
    summary = models.TextField(blank=True)
    keywords = models.JSONField(default=list)
    embedding = models.JSONField(default=list)
    token_count = models.IntegerField(default=0, db_column="tokenCount")
    created_at = models.DateTimeField(auto_now_add=True, db_column="createdAt")

    class Meta(PrismaMirrorModel.Meta):
        db_table = "ai_document_chunks"
        ordering = ["chunk_index"]


class AIDocumentMetadata(PrismaMirrorModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.OneToOneField(AIDocument, on_delete=models.CASCADE, db_column="documentId", related_name="metadata")
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE, db_column="subjectId", related_name="ai_document_metadata")
    units = models.JSONField(default=list)
    chapter_count = models.IntegerField(default=0, db_column="chapterCount")
    keywords = models.JSONField(default=list)
    generated_summary = models.TextField(blank=True, db_column="generatedSummary")
    prerequisites = models.JSONField(default=list)
    tables = models.JSONField(default=list)
    formulas = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True, db_column="createdAt")
    updated_at = models.DateTimeField(auto_now=True, db_column="updatedAt")

    class Meta(PrismaMirrorModel.Meta):
        db_table = "ai_document_metadata"


class PYQQuestion(PrismaMirrorModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE, db_column="subjectId", related_name="pyq_questions")
    pyq_file = models.ForeignKey(PYQFile, on_delete=models.CASCADE, null=True, blank=True, db_column="pyqFileId", related_name="questions")
    document = models.ForeignKey(AIDocument, on_delete=models.SET_NULL, null=True, blank=True, db_column="documentId", related_name="questions")
    year = models.CharField(max_length=50)
    exam = models.CharField(max_length=100, null=True, blank=True)
    unit = models.CharField(max_length=255, null=True, blank=True)
    module = models.CharField(max_length=255, null=True, blank=True)
    question = models.TextField()
    marks = models.FloatField(null=True, blank=True)
    question_type = models.CharField(max_length=100, null=True, blank=True, db_column="questionType")
    difficulty = models.CharField(max_length=32, null=True, blank=True)
    keywords = models.JSONField(default=list)
    bloom_level = models.CharField(max_length=100, null=True, blank=True, db_column="bloomLevel")
    page_number = models.IntegerField(null=True, blank=True, db_column="pageNumber")
    created_at = models.DateTimeField(auto_now_add=True, db_column="createdAt")

    class Meta(PrismaMirrorModel.Meta):
        db_table = "pyq_questions"


class CalendarEvent(PrismaMirrorModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    university_id = models.UUIDField(db_column="universityId")
    semester = models.ForeignKey(Semester, on_delete=models.DO_NOTHING, null=True, blank=True, db_column="semesterId", related_name="calendar_events")
    title = models.CharField(max_length=255)
    description = models.TextField(null=True, blank=True)
    start_date = models.DateField(db_column="startDate")
    end_date = models.DateField(db_column="endDate")
    event_type = models.CharField(max_length=50, db_column="eventType")
    visible_to = models.CharField(max_length=50, db_column="visibleTo")
    created_by_id = models.UUIDField(db_column="createdById")
    created_at = models.DateTimeField(auto_now_add=True, db_column="createdAt")
    updated_at = models.DateTimeField(auto_now=True, db_column="updatedAt")
    deleted_at = models.DateTimeField(null=True, blank=True, db_column="deletedAt")

    class Meta(PrismaMirrorModel.Meta):
        db_table = "calendar_events"


class AIConversation(PrismaMirrorModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    student = models.ForeignKey(Student, on_delete=models.DO_NOTHING, db_column="studentId", related_name="ai_conversations")
    subject = models.ForeignKey(Subject, on_delete=models.DO_NOTHING, null=True, blank=True, db_column="subjectId", related_name="ai_conversations")
    messages = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True, db_column="createdAt")
    updated_at = models.DateTimeField(auto_now=True, db_column="updatedAt")

    class Meta(PrismaMirrorModel.Meta):
        db_table = "ai_conversations"


class StudentAIChatSession(PrismaMirrorModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    student = models.ForeignKey(Student, on_delete=models.CASCADE, db_column="studentId", related_name="chat_sessions")
    subject = models.ForeignKey(Subject, on_delete=models.SET_NULL, null=True, blank=True, db_column="subjectId", related_name="chat_sessions")
    conversation = models.OneToOneField(AIConversation, on_delete=models.CASCADE, db_column="conversationId", related_name="session")
    title = models.CharField(max_length=255)
    is_deleted = models.BooleanField(default=False, db_column="isDeleted")
    created_at = models.DateTimeField(auto_now_add=True, db_column="createdAt")
    updated_at = models.DateTimeField(auto_now=True, db_column="updatedAt")

    class Meta(PrismaMirrorModel.Meta):
        db_table = "student_ai_chat_sessions"
        ordering = ["-updated_at"]


class NoteInsight(PrismaMirrorModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    note = models.OneToOneField(Note, on_delete=models.CASCADE, db_column="noteId", related_name="insight")
    content_hash = models.CharField(max_length=128, db_column="contentHash")
    extracted_text = models.TextField(blank=True, db_column="extractedText")
    short_summary = models.TextField(blank=True, db_column="shortSummary")
    detailed_notes = models.TextField(blank=True, db_column="detailedNotes")
    bullet_notes = models.JSONField(default=list, db_column="bulletNotes")
    important_definitions = models.JSONField(default=list, db_column="importantDefinitions")
    key_formulae = models.JSONField(default=list, db_column="keyFormulae")
    important_questions = models.JSONField(default=list, db_column="importantQuestions")
    status = models.CharField(max_length=32, default="pending")
    last_generated_at = models.DateTimeField(auto_now=True, db_column="lastGeneratedAt")

    class Meta(PrismaMirrorModel.Meta):
        db_table = "note_insights"


class BackgroundJob(PrismaMirrorModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    university_id = models.UUIDField(db_column="universityId")
    student_id = models.UUIDField(null=True, blank=True, db_column="studentId")
    job_type = models.CharField(max_length=64, db_column="jobType")
    status = models.CharField(max_length=32, default="QUEUED")
    progress = models.PositiveSmallIntegerField(default=0)
    payload = models.JSONField(default=dict)
    result = models.JSONField(default=dict)
    error = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_column="createdAt")
    updated_at = models.DateTimeField(auto_now=True, db_column="updatedAt")

    class Meta(PrismaMirrorModel.Meta):
        db_table = "student_ai_jobs"
        ordering = ["-created_at"]


class StudyPlan(PrismaMirrorModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    student = models.ForeignKey(Student, on_delete=models.CASCADE, db_column="studentId", related_name="study_plans")
    enrollment = models.ForeignKey(StudentEnrollment, on_delete=models.CASCADE, db_column="enrollmentId", related_name="study_plans")
    semester = models.ForeignKey(Semester, on_delete=models.CASCADE, db_column="semesterId", related_name="study_plans")
    weak_subject_ids = models.JSONField(default=list, db_column="weakSubjectIds")
    weak_topics = models.JSONField(default=list, db_column="weakTopics")
    start_date = models.DateField(db_column="startDate")
    end_date = models.DateField(db_column="endDate")
    status = models.CharField(max_length=32, default="queued")
    regenerated_from = models.DateField(null=True, blank=True, db_column="regeneratedFrom")
    created_at = models.DateTimeField(auto_now_add=True, db_column="createdAt")
    updated_at = models.DateTimeField(auto_now=True, db_column="updatedAt")

    class Meta(PrismaMirrorModel.Meta):
        db_table = "study_plans"
        ordering = ["-created_at"]


class StudyPlanTask(PrismaMirrorModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    study_plan = models.ForeignKey(StudyPlan, on_delete=models.CASCADE, db_column="studyPlanId", related_name="tasks")
    subject = models.ForeignKey(Subject, on_delete=models.SET_NULL, null=True, blank=True, db_column="subjectId", related_name="study_plan_tasks")
    task_date = models.DateField(db_column="taskDate")
    description = models.TextField()
    estimated_duration_minutes = models.PositiveIntegerField(db_column="estimatedDurationMinutes")
    priority = models.CharField(max_length=16, default="medium")
    is_completed = models.BooleanField(default=False, db_column="isCompleted")
    is_custom = models.BooleanField(default=False, db_column="isCustom")
    created_at = models.DateTimeField(auto_now_add=True, db_column="createdAt")
    updated_at = models.DateTimeField(auto_now=True, db_column="updatedAt")

    class Meta(PrismaMirrorModel.Meta):
        db_table = "study_plan_tasks"
        ordering = ["task_date", "created_at"]


class PYQInsight(PrismaMirrorModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    pyq_file = models.OneToOneField(PYQFile, on_delete=models.CASCADE, db_column="pyqFileId", related_name="insight")
    subject_id = models.UUIDField(db_column="subjectId")
    semester_id = models.UUIDField(db_column="semesterId")
    extracted_text = models.TextField(blank=True, db_column="extractedText")
    topics = models.JSONField(default=list)
    keywords = models.JSONField(default=list)
    difficulty = models.CharField(max_length=32, blank=True)
    marks_weightage = models.JSONField(default=list, db_column="marksWeightage")
    question_types = models.JSONField(default=list, db_column="questionTypes")
    status = models.CharField(max_length=32, default="pending")
    updated_at = models.DateTimeField(auto_now=True, db_column="updatedAt")

    class Meta(PrismaMirrorModel.Meta):
        db_table = "pyq_insights"
