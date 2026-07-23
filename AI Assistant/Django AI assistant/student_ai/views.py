from __future__ import annotations

from django.http import Http404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import AllowAny

from .models import AIConversation, BackgroundJob, Note, NoteInsight, PYQFile, PYQInsight, StudyPlan, StudyPlanTask, Student, StudentAIChatSession, StudentEnrollment, Subject
from .permissions import InternalServicePermission, IsStudentScope
from .serializers import (
    ChatCreateSerializer,
    ChatMessageSerializer,
    ChatRenameSerializer,
    MarksPredictSerializer,
    NoteInsightSerializer,
    PYQInsightSerializer,
    StudyPlanCreateSerializer,
    StudyPlanRegenerateSerializer,
    StudyPlanSerializer,
    StudyPlanTaskCreateSerializer,
    StudyPlanTaskSerializer,
    StudyPlanTaskUpdateSerializer,
    StudentAIChatSessionSerializer,
)
from .services.ai_service import AIServiceError, SharedAIService
from .services.context import build_chat_sources, get_student_context
from .services.jobs import create_job, submit_job
from .services.marks import get_marks_model_metadata, predict_marks, predict_student_marks, retrain_marks_model
from .services.notes import generate_note_insight
from .services.planner import generate_study_plan
from .services.pyq import analyze_pyq, predict_topic_trends


class StudentContextMixin:
    permission_classes = [IsStudentScope]

    def get_student(self, request) -> Student:
        student_id = request.headers.get("X-Student-Id") or getattr(request.user, "student_id", None)
        if not student_id:
            raise Http404("Student context missing.")
        return Student.objects.get(pk=student_id)

    def success(self, message: str, data: dict | list, status_code: int = status.HTTP_200_OK) -> Response:
        return Response({"success": True, "message": message, "data": data}, status=status_code)

    def error(self, message: str, code: str, details: str, status_code: int) -> Response:
        return Response({"success": False, "message": message, "error": {"code": code, "details": details}}, status=status_code)


class HealthView(StudentContextMixin, APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        try:
            provider = SharedAIService()
            metadata = get_marks_model_metadata()
            return self.success(
                "Service healthy.",
                {
                    "service": "django-student-ai",
                    "database": "ok",
                    "freellmapi": "configured" if provider.api_key else "missing_api_key",
                    "model_file": "ok" if metadata is not None else "missing",
                },
            )
        except Exception as exc:
            return self.error("Health check failed.", "HEALTH_CHECK_FAILED", str(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)


class ChatListCreateView(StudentContextMixin, APIView):
    def get(self, request):
        student = self.get_student(request)
        sessions = StudentAIChatSession.objects.filter(student=student, is_deleted=False).select_related("conversation", "subject")
        return self.success("Chats fetched.", StudentAIChatSessionSerializer(sessions, many=True).data)

    def post(self, request):
        student = self.get_student(request)
        serializer = ChatCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        subject = Subject.objects.filter(pk=serializer.validated_data.get("subject_id")).first() if serializer.validated_data.get("subject_id") else None
        conversation = AIConversation.objects.create(student=student, subject=subject, messages=[])
        session = StudentAIChatSession.objects.create(
            student=student,
            subject=subject,
            conversation=conversation,
            title=serializer.validated_data.get("title") or "New Chat",
        )
        return self.success(
            "Chat created.",
            {
                "chat_id": str(session.id),
                "student_id": str(student.id),
                "subject_id": str(subject.id) if subject else None,
                "title": session.title,
                "messages": [],
                "created_at": session.created_at,
            },
            status.HTTP_201_CREATED,
        )


class ChatDetailView(StudentContextMixin, APIView):
    def get_object(self, request, chat_id: str) -> StudentAIChatSession:
        student = self.get_student(request)
        return StudentAIChatSession.objects.select_related("conversation", "subject").get(id=chat_id, student=student, is_deleted=False)

    def get(self, request, chat_id: str):
        session = self.get_object(request, chat_id)
        return self.success("Chat history fetched.", {"chat_id": str(session.id), "title": session.title, "subject_id": str(session.subject_id) if session.subject_id else None, "messages": session.conversation.messages})

    def patch(self, request, chat_id: str):
        session = self.get_object(request, chat_id)
        serializer = ChatRenameSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        session.title = serializer.validated_data["title"]
        session.save(update_fields=["title", "updated_at"])
        return self.success("Chat renamed.", {"chat_id": str(session.id), "title": session.title})

    def delete(self, request, chat_id: str):
        session = self.get_object(request, chat_id)
        session.is_deleted = True
        session.save(update_fields=["is_deleted", "updated_at"])
        return self.success("Chat deleted.", {"chat_id": str(session.id)})


class ChatMessageView(StudentContextMixin, APIView):
    def post(self, request, chat_id: str):
        student = self.get_student(request)
        session = StudentAIChatSession.objects.select_related("conversation", "student", "subject").get(id=chat_id, student=student, is_deleted=False)
        serializer = ChatMessageSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user_message = serializer.validated_data["message"]
        student_context = get_student_context(session.student)
        retrieval_text, sources = build_chat_sources(session.student, session.subject, user_message)
        messages = list(session.conversation.messages or [])
        messages.append({"role": "user", "content": user_message})
        if session.subject:
            assistant_rules = (
                "You are UniBridge student AI assistant for a subject chat. "
                "Answer only using the supplied university context and retrieved document chunks. "
                "If the context is insufficient, say exactly what is missing and do not invent syllabus, PYQ, marks, or faculty note details. "
                "When possible, mention the source title and chapter/unit/page from the context. "
                "Keep explanations simple, educational, and organized in Markdown."
            )
        else:
            assistant_rules = (
                "You are UniBridge student AI assistant in general chat mode. "
                "Answer the student's question directly and clearly. Use student context when relevant, "
                "but do not pretend that a subject, syllabus, PYQ, or faculty note exists unless it is present in context. "
                "Use clean Markdown and keep the answer concise."
            )
        prompt = [
            {
                "role": "system",
                "content": assistant_rules,
            },
            {
                "role": "system",
                "content": f"Student context: {student_context}\nUniversity material:\n{retrieval_text}",
            },
            *messages[-12:],
        ]
        try:
            ai_result = SharedAIService().chat(prompt)
        except AIServiceError as exc:
            status_code = getattr(exc, "status_code", status.HTTP_502_BAD_GATEWAY)
            return self.error("Unable to process request.", "AI_SERVICE_ERROR", str(exc), status_code)
        messages.append({"role": "assistant", "content": ai_result["reply"]})
        session.conversation.messages = messages
        session.conversation.save(update_fields=["messages", "updated_at"])
        return self.success("Assistant response generated.", {"chat_id": str(session.id), "reply": ai_result["reply"], "sources": sources, "history_saved": True})


class SubjectNotesView(StudentContextMixin, APIView):
    def get(self, request, subject_id: str):
        self.get_student(request)
        insights = NoteInsight.objects.filter(note__subject_id=subject_id).select_related("note").prefetch_related("note__flashcards")
        return self.success("Note insights fetched.", NoteInsightSerializer(insights, many=True).data)


class NoteInsightView(StudentContextMixin, APIView):
    def get(self, request, note_id: str):
        student = self.get_student(request)
        note = Note.objects.get(pk=note_id)
        insight = NoteInsight.objects.filter(note=note).select_related("note").prefetch_related("note__flashcards").first()
        if insight and insight.status == "completed":
            return self.success("Note insight fetched.", NoteInsightSerializer(insight).data)
        job = create_job("note_generation", {"note_id": note_id}, university_id=str(student.university_id), student_id=str(student.id))
        submit_job(job, generate_note_insight, note)
        return self.success("Note processing queued.", {"note_id": note_id, "job_id": str(job.id), "status": "queued", "previous_status": insight.status if insight else None}, status.HTTP_202_ACCEPTED)


class StudyPlanListCreateView(StudentContextMixin, APIView):
    def get(self, request):
        student = self.get_student(request)
        plan = StudyPlan.objects.filter(student=student).prefetch_related("tasks__subject").order_by("-created_at").first()
        if not plan:
            return self.success("No study plan found.", None)
        return self.success("Study plan fetched.", StudyPlanSerializer(plan).data)

    def post(self, request):
        student = self.get_student(request)
        serializer = StudyPlanCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        enrollment = StudentEnrollment.objects.select_related("semester").get(student=student, is_current=True)
        plan = StudyPlan.objects.create(
            student=student,
            enrollment=enrollment,
            semester=enrollment.semester,
            weak_subject_ids=[str(item) for item in serializer.validated_data.get("weak_subject_ids", [])],
            weak_topics=serializer.validated_data.get("weak_topics", []),
            start_date=serializer.validated_data["start_date"],
            end_date=serializer.validated_data["end_date"],
            status="queued",
        )
        job = create_job("study_plan_generation", {"study_plan_id": str(plan.id)}, university_id=str(student.university_id), student_id=str(student.id))
        submit_job(job, generate_study_plan, plan, weak_subject_ids=plan.weak_subject_ids, weak_topics=plan.weak_topics)
        return self.success("Study plan generation queued.", {"study_plan_id": str(plan.id), "status": "queued", "job_id": str(job.id)}, status.HTTP_202_ACCEPTED)


class StudyPlanDetailView(StudentContextMixin, APIView):
    def get(self, request, study_plan_id: str):
        student = self.get_student(request)
        plan = StudyPlan.objects.filter(id=study_plan_id, student=student).prefetch_related("tasks__subject").get()
        return self.success("Study plan fetched.", StudyPlanSerializer(plan).data)


class StudyPlanRegenerateView(StudentContextMixin, APIView):
    def post(self, request, study_plan_id: str):
        student = self.get_student(request)
        serializer = StudyPlanRegenerateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        plan = StudyPlan.objects.get(id=study_plan_id, student=student)
        job = create_job("study_plan_regenerate", {"study_plan_id": study_plan_id}, university_id=str(student.university_id), student_id=str(student.id))
        submit_job(job, generate_study_plan, plan, weak_subject_ids=plan.weak_subject_ids, weak_topics=plan.weak_topics, from_date=serializer.validated_data["from_date"])
        return self.success("Study plan regeneration queued.", {"study_plan_id": study_plan_id, "job_id": str(job.id), "status": "queued"}, status.HTTP_202_ACCEPTED)


class StudyPlanTaskView(StudentContextMixin, APIView):
    def patch(self, request, task_id: str):
        student = self.get_student(request)
        serializer = StudyPlanTaskUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        task = StudyPlanTask.objects.get(id=task_id, study_plan__student=student)
        task.is_completed = serializer.validated_data["is_completed"]
        task.save(update_fields=["is_completed", "updated_at"])
        return self.success("Task updated.", {"task_id": str(task.id), "is_completed": task.is_completed})

    def delete(self, request, task_id: str):
        student = self.get_student(request)
        task = StudyPlanTask.objects.get(id=task_id, study_plan__student=student, is_custom=True)
        task.delete()
        return self.success("Custom task deleted.", {"task_id": task_id})


class StudyPlanTaskCreateView(StudentContextMixin, APIView):
    def post(self, request, study_plan_id: str):
        student = self.get_student(request)
        serializer = StudyPlanTaskCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        task = StudyPlanTask.objects.create(
            study_plan=StudyPlan.objects.get(id=study_plan_id, student=student),
            subject_id=serializer.validated_data.get("subject_id"),
            task_date=serializer.validated_data["date"],
            description=serializer.validated_data["description"],
            estimated_duration_minutes=serializer.validated_data["estimated_duration_minutes"],
            priority=serializer.validated_data["priority"],
            is_custom=True,
        )
        return self.success("Custom task added.", StudyPlanTaskSerializer(task).data, status.HTTP_201_CREATED)


class PYQAnalysisView(StudentContextMixin, APIView):
    def get(self, request, pyq_id: str):
        student = self.get_student(request)
        pyq = PYQFile.objects.select_related("subject").get(pk=pyq_id)
        insight = PYQInsight.objects.filter(pyq_file=pyq).first()
        if insight:
            return self.success("PYQ analysis fetched.", PYQInsightSerializer(insight).data)
        job = create_job("pyq_analysis", {"pyq_id": pyq_id}, university_id=str(student.university_id), student_id=str(student.id))
        submit_job(job, analyze_pyq, pyq)
        return self.success("PYQ analysis queued.", {"pyq_id": pyq_id, "job_id": str(job.id), "status": "queued"}, status.HTTP_202_ACCEPTED)


class PYQPredictionView(StudentContextMixin, APIView):
    def get(self, request, subject_id: str):
        self.get_student(request)
        return self.success("PYQ predictions fetched.", predict_topic_trends(subject_id))


class MarksPredictView(StudentContextMixin, APIView):
    def post(self, request):
        self.get_student(request)
        serializer = MarksPredictSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return self.success("Marks predicted successfully.", predict_marks(**serializer.validated_data))


class StudentMarksPredictionView(StudentContextMixin, APIView):
    def get(self, request):
        student = self.get_student(request)
        result = predict_student_marks(student)
        if result is None:
            return self.error("Prediction unavailable.","INSUFFICIENT_MARKS_DATA","Not enough marks data to generate a prediction.",status.HTTP_200_OK)
        return self.success("Student prediction generated.", result)


class MarksModelView(StudentContextMixin, APIView):
    def get(self, request):
        self.get_student(request)
        return self.success("Model metadata fetched.", get_marks_model_metadata())


class MarksRetrainView(StudentContextMixin, APIView):
    def post(self, request):
        student = self.get_student(request)
        job = create_job("marks_retrain", {}, university_id=str(student.university_id), student_id=str(student.id))
        submit_job(job, retrain_marks_model)
        return self.success("Marks retraining queued.", {"job_id": str(job.id), "status": "queued"}, status.HTTP_202_ACCEPTED)


class JobStatusView(StudentContextMixin, APIView):
    def get(self, request, job_id: str):
        self.get_student(request)
        job = BackgroundJob.objects.get(pk=job_id)
        return self.success("Job status fetched.", {"job_id": str(job.id), "status": job.status, "progress": job.progress, "result": job.result, "error": job.error or None})


class InternalNoteProcessView(APIView):
    permission_classes = [InternalServicePermission]

    def post(self, request, note_id: str):
        note = Note.objects.get(pk=note_id)
        job = create_job("note_generation", {"note_id": note_id}, university_id=str(note.subject.university_id))
        submit_job(job, generate_note_insight, note)
        return Response({"success": True, "message": "Note processing queued.", "data": {"note_id": note_id, "job_id": str(job.id), "status": "queued"}}, status=status.HTTP_202_ACCEPTED)


class InternalPYQProcessView(APIView):
    permission_classes = [InternalServicePermission]

    def post(self, request, pyq_id: str):
        pyq = PYQFile.objects.select_related("subject").get(pk=pyq_id)
        job = create_job("pyq_analysis", {"pyq_id": pyq_id}, university_id=str(pyq.subject.university_id))
        submit_job(job, analyze_pyq, pyq)
        return Response({"success": True, "message": "PYQ processing queued.", "data": {"pyq_id": pyq_id, "job_id": str(job.id), "status": "queued"}}, status=status.HTTP_202_ACCEPTED)
