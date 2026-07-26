# Graph Report - UniBridge_  (2026-07-26)

## Corpus Check
- 351 files · ~419,729 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1603 nodes · 2125 edges · 189 communities (122 shown, 67 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 116 edges (avg confidence: 0.59)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `66ded4ff`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- UniBridge Free-Tier Deployment Plan
- Confirmed Bugs
- UniBridge Frontend & Backend Changes for Faster Response
- Observability: verify every performance change
- Backend changes
- Frontend changes
- Secure deployment plan
- devDependencies
- compilerOptions
- dependencies
- storage.ts
- AppShell.tsx
- compilerOptions
- seed.ts
- compilerOptions
- TimetablePage.tsx
- faculty.ts
- student.ts
- Button.tsx
- PromotionPage.tsx
- SettingsPage.tsx
- common.ts
- StatCard.tsx
- ExamsPage.tsx
- HodOnboardingModal.tsx
- seed-sy3-timetable-attendance.ts
- getStudentEnrollment
- index.tsx
- FacultyPage.tsx
- ResultsPage.tsx
- SubjectsPage.tsx
- authStore.ts
- NotesPage.tsx
- StudentsPage.tsx
- auth.ts
- download.ts
- schedule.tsx
- SettingsPage.tsx
- CalendarPage.tsx
- ExamPanelPage.tsx
- SettingsPage.tsx
- facultyActiveSemester
- MenteesPage.tsx
- FacultyPage.tsx
- PromotionDashboardPage.tsx
- SubjectsPage.tsx
- YearsPage.tsx
- index.tsx
- getFacultyScopeData
- CsvUploadModal.tsx
- StudentProfileModal.tsx
- Badge.tsx
- Table.tsx
- QuizzesPage.tsx
- AnnouncementsPage.tsx
- App.tsx
- CalendarGrid.tsx
- ProgressBar.tsx
- Select.tsx
- AttendancePage.tsx
- CalendarPage.tsx
- DashboardPage.tsx
- SubjectFormModal.tsx
- CalendarPage.tsx
- DashboardPage.tsx
- SelfNotesPage.tsx
- StudyPlannerPage.tsx
- TimetablePage.tsx
- BranchesPage.tsx
- hodAllBatchIds
- AttendancePctCell.tsx
- ExportMenu.tsx
- NotificationBell.tsx
- PageShell.tsx
- Avatar.tsx
- EmptyState.tsx
- IconButton.tsx
- Input.tsx
- Tabs.tsx
- Textarea.tsx
- SchedulePage.tsx
- StudentsPage.tsx
- AttendancePage.tsx
- DashboardPage.tsx
- NotificationsPage.tsx
- LeaderboardPage.tsx
- NotesPage.tsx
- historyStore.ts
- uiStore.ts
- vite-env.d.ts
- tsconfig.json
- getAttendanceRules
- buildPagination
- env.ts
- AIAssistantPage.tsx
- QuizzesPage.tsx
- vercel.json
- hod.ts
- useTableSort.ts
- http.ts
- http.ts
- studyPlanner.service.ts
- app.ts
- package.json
- studentAiBridge.service.ts
- StudentAiConfig
- seed-sy3-timetable-attendance.ts
- @prisma/adapter-pg
- @prisma/client
- @types/pdfkit
- zod
- react-router-dom
- seed-sy3-marks.ts
- @tanstack/react-query
- getFacultyScopeData
- AppShell.tsx
- StudentsPage.tsx
- hodAllBatchIds
- student.ts
- FacultyPage.tsx
- auth.ts
- InternalServicePermission
- documents.py
- SimpleCorsMiddleware
- __init__.py
- Student
- Path
- Path
- Student
- Subject
- formatStudyPlan
- getAttendanceRules
- NON_WORKING_TYPES
- overallAttendancePctBulk
- Dashboard.tsx
- devDependencies
- App.tsx
- LoginScreen.tsx
- @prisma/adapter-pg
- @types/pdfkit

## God Nodes (most connected - your core abstractions)
1. `Store` - 24 edges
2. `PrismaMirrorModel` - 23 edges
3. `StudentContextMixin` - 22 edges
4. `StudyPlan` - 21 edges
5. `compilerOptions` - 21 edges
6. `StudentAIChatSession` - 19 edges
7. `NoteInsight` - 19 edges
8. `StudyPlanTask` - 19 edges
9. `PYQInsight` - 18 edges
10. `compilerOptions` - 16 edges

## Surprising Connections (you probably didn't know these)
- `StudentAiApiTests` --uses--> `Semester`  [INFERRED]
  AI Assistant/Django AI assistant/student_ai/tests.py → AI Assistant/Django AI assistant/student_ai/models.py
- `StudentAiApiTests` --uses--> `Note`  [INFERRED]
  AI Assistant/Django AI assistant/student_ai/tests.py → AI Assistant/Django AI assistant/student_ai/models.py
- `GeminiDocumentService` --uses--> `SharedAIService`  [INFERRED]
  AI Assistant/Django AI assistant/student_ai/services/gemini_service.py → AI Assistant/Django AI assistant/student_ai/services/ai_service.py
- `process_note_document()` --calls--> `EmbeddingService`  [INFERRED]
  AI Assistant/Django AI assistant/student_ai/services/ingestion_service.py → AI Assistant/Django AI assistant/student_ai/services/embedding_service.py
- `_store_pyq_chunks()` --calls--> `EmbeddingService`  [INFERRED]
  AI Assistant/Django AI assistant/student_ai/services/pyq_service.py → AI Assistant/Django AI assistant/student_ai/services/embedding_service.py

## Import Cycles
- None detected.

## Communities (189 total, 67 thin omitted)

### Community 0 - "UniBridge Free-Tier Deployment Plan"
Cohesion: 0.08
Nodes (40): Note, PYQFile, Semester, build_semantic_chunks(), SemanticChunk, GeminiDocumentService, _image_url(), _mime_from_suffix() (+32 more)

### Community 1 - "Confirmed Bugs"
Cohesion: 0.05
Nodes (57): WIPE_TABLES, chunkedCreate(), gradeFor(), main(), rand(), chunked(), clamp(), GRID (+49 more)

### Community 2 - "UniBridge Frontend & Backend Changes for Faster Response"
Cohesion: 0.13
Nodes (13): Paged, PromotionDashboard, PromotionHodRow, UniBatch, UniFacultyRow, UniHod, UniHodsResponse, UniOverview (+5 more)

### Community 3 - "Observability: verify every performance change"
Cohesion: 0.04
Nodes (6): CalendarAudience, DAY_LABELS, DAY_NAMES, DayStatus, Scope, VISIBLE_TO

### Community 4 - "Backend changes"
Cohesion: 0.06
Nodes (33): dependencies, compression, cors, dotenv, express, helmet, morgan, multer (+25 more)

### Community 5 - "Frontend changes"
Cohesion: 0.07
Nodes (26): autoprefixer, devDependencies, autoprefixer, postcss, tailwindcss, @types/node, @types/react-dom, typescript (+18 more)

### Community 6 - "Secure deployment plan"
Cohesion: 0.07
Nodes (27): AcademicYearWithSemesters, ActivityItem, AnalyticsKpi, AssignmentRow, AtRiskRow, AttendanceStatSummary, AttendanceTableRow, AttendanceTrend (+19 more)

### Community 7 - "devDependencies"
Cohesion: 0.05
Nodes (42): devDependencies, @types/compression, @types/cors, @types/express, @types/morgan, @types/node, @types/pg, typescript (+34 more)

### Community 8 - "compilerOptions"
Cohesion: 0.07
Nodes (27): compilerOptions, allowImportingTsExtensions, baseUrl, composite, isolatedModules, jsx, lib, module (+19 more)

### Community 9 - "dependencies"
Cohesion: 0.05
Nodes (42): axios, clsx, date-fns, expo, expo-font, expo-status-bar, dependencies, axios (+34 more)

### Community 10 - "storage.ts"
Cohesion: 0.07
Nodes (23): createApp(), env, envSchema, universityId(), requireAuth(), requireFacultyPortal(), requireSuperAdmin(), errorHandler() (+15 more)

### Community 11 - "AppShell.tsx"
Cohesion: 0.31
Nodes (4): facultyNavItems, studentNavItems, NavItem, NavSection

### Community 12 - "compilerOptions"
Cohesion: 0.10
Nodes (20): compilerOptions, allowImportingTsExtensions, composite, isolatedModules, lib, module, moduleDetection, moduleResolution (+12 more)

### Community 13 - "seed.ts"
Cohesion: 0.16
Nodes (19): Cohort, COHORTS, ensureAcademicYear(), ensureAllSemesters(), ensureBatch(), ensureBranch(), ensureFacultyPool(), ensureHod() (+11 more)

### Community 14 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution, outDir, resolveJsonModule, rootDir (+10 more)

### Community 15 - "TimetablePage.tsx"
Cohesion: 0.13
Nodes (10): BASE, DAYS, HodTimetablePage(), isLab(), isOther(), LAB, OTHER, Palette (+2 more)

### Community 16 - "faculty.ts"
Cohesion: 0.11
Nodes (18): AttendanceSessionRow, ChatMsg, DayStatus, FacultyAnnouncement, FacultyDashboardStats, FacultyNote, FacultyNoteDrive, FacultyNoteDriveFile (+10 more)

### Community 17 - "student.ts"
Cohesion: 0.11
Nodes (17): AIConversation, AIMessage, AttendancePerSubject, LeaderboardEntry, PaginatedAnnouncements, PaginatedNotes, PaginatedQuizzes, SelfNote (+9 more)

### Community 18 - "Button.tsx"
Cohesion: 0.16
Nodes (10): Button, ButtonProps, Size, sizes, Variant, variants, ConfirmDialogProps, Modal() (+2 more)

### Community 19 - "PromotionPage.tsx"
Cohesion: 0.14
Nodes (5): LeaderRow, PromoContext, STEPS, YEAR_LABEL, YearPreview

### Community 21 - "common.ts"
Cohesion: 0.10
Nodes (18): AuthUser, LoginResponse, LoginRole, RefreshResponse, University, UserRole, AcademicYear, Announcement (+10 more)

### Community 22 - "StatCard.tsx"
Cohesion: 0.22
Nodes (5): Card(), StatCardProps, Trend, TrendIcon, trendPill

### Community 23 - "ExamsPage.tsx"
Cohesion: 0.20
Nodes (6): AssignmentStudents, examApi, ExamAssignment, ExamContext, STATUS_TONE, YEAR_LABEL

### Community 26 - "getStudentEnrollment"
Cohesion: 0.22
Nodes (9): batchById(), currentEnrollmentForStudent(), ensureStudentSubject(), getMentorAssignment(), getStudentEnrollment(), getStudentMentorAssignment(), getStudentSubjectIds(), getStudentUser() (+1 more)

### Community 27 - "index.tsx"
Cohesion: 0.20
Nodes (3): axis, COLORS, tooltipStyle

### Community 29 - "ResultsPage.tsx"
Cohesion: 0.25
Nodes (5): EditMarksModal(), gradeFor(), Preview, PreviewRow, UploadContext

### Community 30 - "SubjectsPage.tsx"
Cohesion: 0.25
Nodes (5): Comp, FacultyGroup, groupByFaculty(), SubjectsPage(), THEORY_RULES

### Community 31 - "authStore.ts"
Cohesion: 0.36
Nodes (8): AuthStore, homePathOf(), portalOf(), useAuthStore, useIsFaculty(), useIsHod(), useIsStudent(), useUser()

### Community 32 - "NotesPage.tsx"
Cohesion: 0.22
Nodes (4): Assignment, EditNoteModal(), toIso(), UploadNoteModal()

### Community 34 - "auth.ts"
Cohesion: 0.29
Nodes (10): cell(), computeWidths(), csvCell(), ExportFormat, ExportTable, isMeasure(), sendExport(), toCsv() (+2 more)

### Community 35 - "download.ts"
Cohesion: 0.48
Nodes (6): blobError(), downloadExport(), downloadFile(), ExportFormat, Params, saveBlob()

### Community 36 - "schedule.tsx"
Cohesion: 0.29
Nodes (3): FALLBACK, KNOWN, Visual

### Community 38 - "CalendarPage.tsx"
Cohesion: 0.25
Nodes (5): LEGEND, MONTHS, NON_WORKING_TYPES, TYPE_LABEL, TYPES

### Community 39 - "ExamPanelPage.tsx"
Cohesion: 0.29
Nodes (4): Coordinator, examApi, ExamAssignment, STATUS_TONE

### Community 41 - "facultyActiveSemester"
Cohesion: 0.47
Nodes (6): facultyActiveSemester(), getActiveSemester(), getSemester(), hodActiveSemester(), requireExamCoordinator(), scopeSemester()

### Community 46 - "PromotionDashboardPage.tsx"
Cohesion: 0.33
Nodes (4): statusLabel, statusTone, YEAR_LABEL, YEARS

### Community 48 - "YearsPage.tsx"
Cohesion: 0.33
Nodes (3): LEVEL_TO_SEM, SEM_TONE, YEAR_TONE

### Community 49 - "index.tsx"
Cohesion: 0.04
Nodes (54): FacAnalytics, FacAnnouncements, FacAttendance, FacCalendar, FacDashboard, FacExams, FacMentees, FacNotes (+46 more)

### Community 50 - "getFacultyScopeData"
Cohesion: 0.10
Nodes (46): AIConversation, AIDocument, AIDocumentChunk, AIDocumentMetadata, BackgroundJob, CalendarEvent, Flashcard, Meta (+38 more)

### Community 53 - "Badge.tsx"
Cohesion: 0.40
Nodes (3): BadgeProps, Tone, tones

### Community 55 - "QuizzesPage.tsx"
Cohesion: 0.25
Nodes (5): Assignment, blankQuestion(), Draft, LETTERS, QuestionsModal()

### Community 60 - "Select.tsx"
Cohesion: 0.50
Nodes (3): Select, SelectOption, SelectProps

### Community 68 - "StudyPlannerPage.tsx"
Cohesion: 0.33
Nodes (4): PlannerData, PlannerTask, SubjectOption, TODAY

### Community 71 - "hodAllBatchIds"
Cohesion: 0.09
Nodes (35): available_chapters(), _chapter_label(), _content_tokens(), generate_quiz(), _matching_chunks(), _note_label(), _valid_question(), ChatDetailView (+27 more)

### Community 96 - "getAttendanceRules"
Cohesion: 0.12
Nodes (25): build_features(), _generate_synthetic_data(), get_model(), Any, Train and persist the best ML regressor for marks prediction., retrain_from_db(), train_model(), model_metadata() (+17 more)

### Community 97 - "buildPagination"
Cohesion: 0.18
Nodes (6): api, queue, facultyApi, Params, Notification, notificationsApi

### Community 114 - "AIAssistantPage.tsx"
Cohesion: 0.29
Nodes (3): renderInlineMarkdown(), StructuredAssistantContent(), SubjectOption

### Community 118 - "QuizzesPage.tsx"
Cohesion: 0.40
Nodes (3): Question, QuizAttempt, QuizResult

### Community 129 - "hod.ts"
Cohesion: 0.25
Nodes (7): ArchiveBatch, ArchiveResult, ArchiveSemester, ArchiveSnapshot, ArchiveStudent, ArchiveTree, ArchiveYear

### Community 132 - "useTableSort.ts"
Cohesion: 0.67
Nodes (3): getVal(), SortDir, useTableSort()

### Community 133 - "http.ts"
Cohesion: 0.33
Nodes (5): hodApi, Params, SubjectComponentCfg, SubjectConfig, SubjectConfigInput

### Community 134 - "http.ts"
Cohesion: 0.09
Nodes (21): backgroundColor, backgroundImage, foregroundImage, monochromeImage, adaptiveIcon, package, predictiveBackGestureEnabled, expo (+13 more)

### Community 135 - "studyPlanner.service.ts"
Cohesion: 0.28
Nodes (13): academicInputsForStudent(), AcademicSubject, activePhaseForToday(), addDays(), buildTasks(), generateStudyPlanForStudent(), jsonStrings(), nearestExamDate() (+5 more)

### Community 136 - "app.ts"
Cohesion: 0.47
Nodes (5): d(), Ev, EVENTS, main(), PHASES

### Community 137 - "package.json"
Cohesion: 0.38
Nodes (11): amzDate(), basePath, enc(), encPath(), hmac(), presignGetUrl(), sha256hex(), signingKey() (+3 more)

### Community 139 - "studentAiBridge.service.ts"
Cohesion: 0.36
Nodes (9): chunked(), clamp(), gradeFor(), GRID, main(), rand(), SLOTS, studentBase() (+1 more)

### Community 146 - "@prisma/adapter-pg"
Cohesion: 0.11
Nodes (29): AnalyticsScreen(), AnnouncementsScreen(), ArchiveScreen(), AttendanceScreen(), DashboardScreen(), DAYS, ExamPanelScreen(), FacultyScreen() (+21 more)

### Community 148 - "@types/pdfkit"
Cohesion: 0.67
Nodes (3): FacultyRow, main(), parseCsv()

### Community 149 - "zod"
Cohesion: 0.15
Nodes (17): IconBell(), IconCalendarCheck(), IconClose(), IconMenu(), NavIcon(), P, TabAttendance(), TabHome() (+9 more)

### Community 152 - "react-router-dom"
Cohesion: 0.40
Nodes (3): MobileTabBar(), PRIMARY_TABS, SHORT_LABEL

### Community 153 - "seed-sy3-marks.ts"
Cohesion: 0.11
Nodes (16): AnalyticsKpi, AnnouncementRow, AtRiskRow, AttendanceSummary, AttendanceTrend, AuthUser, DashboardSummary, ExamCoordinators (+8 more)

### Community 154 - "@tanstack/react-query"
Cohesion: 0.40
Nodes (4): compilerOptions, strict, extends, expo/tsconfig.base

### Community 161 - "getFacultyScopeData"
Cohesion: 0.40
Nodes (5): ensureFacultyAssignedBatch(), ensureFacultyAssignedSubject(), getFacultyAssignments(), getFacultyScopeData(), getFacultyVisibleEnrollments()

### Community 164 - "hodAllBatchIds"
Cohesion: 0.67
Nodes (3): hodAllBatchIds(), hodEnrollmentWhere(), scopedCurrentEnrollments()

### Community 166 - "student.ts"
Cohesion: 0.46
Nodes (7): djangoAiApi, djangoAiDelete(), djangoAiErrorMessage(), djangoAiGet(), djangoAiPost(), DjangoResponse, unwrapDjangoResponse()

### Community 176 - "InternalServicePermission"
Cohesion: 0.40
Nodes (3): InternalServicePermission, IsStudentScope, BasePermission

### Community 177 - "documents.py"
Cohesion: 0.73
Nodes (5): _extract_from_path(), extract_text(), file_hash(), _is_remote(), Path

### Community 194 - "Dashboard.tsx"
Cohesion: 0.15
Nodes (10): hodApi, IconClipboard(), IconFaculty(), IconShield(), IconStudents(), IconTrend(), Dashboard(), MONTHS (+2 more)

### Community 195 - "devDependencies"
Cohesion: 0.18
Nodes (8): AIServiceError, Any, SharedAIService, generate_study_plan(), _planner_context(), Student, date, Exception

### Community 196 - "App.tsx"
Cohesion: 0.33
Nodes (4): styles, LoginResponse, initials(), Shell()

### Community 197 - "LoginScreen.tsx"
Cohesion: 0.40
Nodes (3): loginHod(), s, theme

### Community 199 - "@prisma/adapter-pg"
Cohesion: 0.39
Nodes (6): baseUrl(), DjangoResponse, requestInternal(), requestStudent(), serviceHeaders(), studentAiBridge

### Community 200 - "@types/pdfkit"
Cohesion: 0.25
Nodes (4): DjangoChat, DjangoPyqPrediction, Params, studentApi

## Knowledge Gaps
- **556 isolated node(s):** `upload`, `Scope`, `CalendarAudience`, `VISIBLE_TO`, `DAY_NAMES` (+551 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **67 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `dependencies` to `devDependencies`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **Are the 15 inferred relationships involving `StudyPlan` (e.g. with `ChatCreateSerializer` and `ChatMessageSerializer`) actually correct?**
  _`StudyPlan` has 15 INFERRED edges - model-reasoned connections that need verification._
- **What connects `upload`, `Scope`, `CalendarAudience` to the rest of the system?**
  _556 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `UniBridge Free-Tier Deployment Plan` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `Confirmed Bugs` be split into smaller, more focused modules?**
  _Cohesion score 0.05189189189189189 - nodes in this community are weakly interconnected._
- **Should `UniBridge Frontend & Backend Changes for Faster Response` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._
- **Should `Observability: verify every performance change` be split into smaller, more focused modules?**
  _Cohesion score 0.043478260869565216 - nodes in this community are weakly interconnected._