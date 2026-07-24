from django.urls import path

from .views import ChatDetailView, ChatListCreateView, ChatMessageView, HealthView, InternalNoteProcessView, InternalPYQProcessView, InternalQuizChaptersView, InternalQuizGenerateView, JobStatusView, MarksModelView, MarksPredictView, MarksRetrainView, NoteInsightView, PYQAnalysisView, PYQPredictionView, StudentMarksPredictionView, StudyPlanDetailView, StudyPlanListCreateView, StudyPlanRegenerateView, StudyPlanTaskCreateView, StudyPlanTaskView, SubjectNotesView

urlpatterns = [
    path("health", HealthView.as_view(), name="health"),
    path("chats", ChatListCreateView.as_view(), name="chat-list-create"),
    path("chats/<uuid:chat_id>", ChatDetailView.as_view(), name="chat-detail"),
    path("chats/<uuid:chat_id>/messages", ChatMessageView.as_view(), name="chat-message"),
    path("notes/<uuid:note_id>", NoteInsightView.as_view(), name="note-insight"),
    path("subjects/<uuid:subject_id>/notes", SubjectNotesView.as_view(), name="subject-notes"),
    path("study-plans", StudyPlanListCreateView.as_view(), name="study-plan-list-create"),
    path("study-plans/<uuid:study_plan_id>", StudyPlanDetailView.as_view(), name="study-plan-detail"),
    path("study-plans/<uuid:study_plan_id>/regenerate", StudyPlanRegenerateView.as_view(), name="study-plan-regenerate"),
    path("study-plans/<uuid:study_plan_id>/tasks", StudyPlanTaskCreateView.as_view(), name="study-plan-task-create"),
    path("study-plans/tasks/<uuid:task_id>", StudyPlanTaskView.as_view(), name="study-plan-task"),
    path("pyqs/<uuid:pyq_id>/analysis", PYQAnalysisView.as_view(), name="pyq-analysis"),
    path("pyqs/subjects/<uuid:subject_id>/predictions", PYQPredictionView.as_view(), name="pyq-predictions"),
    path("marks/predict", MarksPredictView.as_view(), name="marks-predict"),
    path("students/me/marks/prediction", StudentMarksPredictionView.as_view(), name="student-marks-prediction"),
    path("marks/model", MarksModelView.as_view(), name="marks-model"),
    path("marks/retrain", MarksRetrainView.as_view(), name="marks-retrain"),
    path("jobs/<uuid:job_id>", JobStatusView.as_view(), name="job-status"),
    path("internal/notes/<uuid:note_id>/process", InternalNoteProcessView.as_view(), name="internal-note-process"),
    path("internal/pyqs/<uuid:pyq_id>/process", InternalPYQProcessView.as_view(), name="internal-pyq-process"),
    path("internal/quizzes/subjects/<uuid:subject_id>/chapters", InternalQuizChaptersView.as_view(), name="internal-quiz-chapters"),
    path("internal/quizzes/generate", InternalQuizGenerateView.as_view(), name="internal-quiz-generate"),
]
