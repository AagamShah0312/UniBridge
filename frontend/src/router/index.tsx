import { lazy } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import AppShell from '@/components/layout/AppShell'
import LoginPage from '@/pages/auth/LoginPage'
import PlaceholderPage from '@/pages/PlaceholderPage'
import RouteError from '@/components/RouteError'
import ProtectedRoute from './ProtectedRoute'
import RoleRouter from './RoleRouter'

// HOD portal pages
const HodDashboard = lazy(() => import('@/pages/hod/DashboardPage'))
const HodStudents = lazy(() => import('@/pages/hod/StudentsPage'))
const HodFaculty = lazy(() => import('@/pages/hod/FacultyPage'))
const HodResults = lazy(() => import('@/pages/hod/ResultsPage'))
const HodAttendance = lazy(() => import('@/pages/hod/AttendancePage'))
const HodSubjects = lazy(() => import('@/pages/hod/SubjectsPage'))
const HodMentorship = lazy(() => import('@/pages/hod/MentorshipPage'))
const HodAnalytics = lazy(() => import('@/pages/hod/AnalyticsPage'))
const HodPromotion = lazy(() => import('@/pages/hod/PromotionPage'))
const HodCalendar = lazy(() => import('@/pages/hod/CalendarPage'))
const HodSettings = lazy(() => import('@/pages/hod/SettingsPage'))
const HodArchive = lazy(() => import('@/pages/hod/ArchivePage'))
const HodTimetable = lazy(() => import('@/pages/hod/TimetablePage'))
const HodAnnouncements = lazy(() => import('@/pages/hod/AnnouncementsPage'))
const HodExamPanel = lazy(() => import('@/pages/hod/ExamPanelPage'))
const NotificationsPage = lazy(() => import('@/pages/NotificationsPage'))

// Faculty portal pages
const FacDashboard = lazy(() => import('@/pages/faculty/DashboardPage'))
const FacSchedule = lazy(() => import('@/pages/faculty/SchedulePage'))
const FacStudents = lazy(() => import('@/pages/faculty/StudentsPage'))
const FacAttendance = lazy(() => import('@/pages/faculty/AttendancePage'))
const FacNotes = lazy(() => import('@/pages/faculty/NotesPage'))
const FacQuizzes = lazy(() => import('@/pages/faculty/QuizzesPage'))
const FacAnnouncements = lazy(() => import('@/pages/faculty/AnnouncementsPage'))
const FacMentees = lazy(() => import('@/pages/faculty/MenteesPage'))
const FacResults = lazy(() => import('@/pages/faculty/ResultsPage'))
const FacExams = lazy(() => import('@/pages/faculty/ExamsPage'))
const FacCalendar = lazy(() => import('@/pages/faculty/CalendarPage'))
const FacAnalytics = lazy(() => import('@/pages/faculty/AnalyticsPage'))
const FacSettings = lazy(() => import('@/pages/faculty/SettingsPage'))

// University (Dean) portal pages
const UniDashboard = lazy(() => import('@/pages/university/DashboardPage'))
const UniYears = lazy(() => import('@/pages/university/YearsPage'))
const UniBranches = lazy(() => import('@/pages/university/BranchesPage'))
const UniHods = lazy(() => import('@/pages/university/HodsPage'))
const UniPromotion = lazy(() => import('@/pages/university/PromotionDashboardPage'))
const UniFaculty = lazy(() => import('@/pages/university/FacultyPage'))
const UniStudents = lazy(() => import('@/pages/university/StudentsPage'))
const UniSubjects = lazy(() => import('@/pages/university/SubjectsPage'))
const UniSettings = lazy(() => import('@/pages/university/SettingsPage'))
const UniArchive = lazy(() => import('@/pages/university/ArchivePage'))

// Student portal pages
const StuDashboard = lazy(() => import('@/pages/student/DashboardPage'))
const StuTimetable = lazy(() => import('@/pages/student/TimetablePage'))
const StuResults = lazy(() => import('@/pages/student/ResultsPage'))
const StuAttendance = lazy(() => import('@/pages/student/AttendancePage'))
const StuNotes = lazy(() => import('@/pages/student/NotesPage'))
const StuSelfNotes = lazy(() => import('@/pages/student/SelfNotesPage'))
const StuQuizzes = lazy(() => import('@/pages/student/QuizzesPage'))
const StuAnnouncements = lazy(() => import('@/pages/student/AnnouncementsPage'))
const StuCalendar = lazy(() => import('@/pages/student/CalendarPage'))
const StuMentorChat = lazy(() => import('@/pages/student/MentorChatPage'))
const StuAI = lazy(() => import('@/pages/student/AIAssistantPage'))
const StuPlanner = lazy(() => import('@/pages/student/StudyPlannerPage'))
const StuLeaderboard = lazy(() => import('@/pages/student/LeaderboardPage'))
const StuSettings = lazy(() => import('@/pages/student/SettingsPage'))

// ponytail: no stubs left — every route is a real page now.
void PlaceholderPage

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppShell />,
        errorElement: <RouteError />,
        children: [
          // ── HOD ─────────────────────────────
          { path: '/hod', element: <HodDashboard /> },
          { path: '/hod/students', element: <HodStudents /> },
          { path: '/hod/faculty', element: <HodFaculty /> },
          { path: '/hod/results', element: <HodResults /> },
          { path: '/hod/attendance', element: <HodAttendance /> },
          { path: '/hod/subjects', element: <HodSubjects /> },
          { path: '/hod/timetable', element: <HodTimetable /> },
          { path: '/hod/announcements', element: <HodAnnouncements /> },
          { path: '/hod/exams', element: <HodExamPanel /> },
          { path: '/hod/notifications', element: <NotificationsPage /> },
          { path: '/faculty/notifications', element: <NotificationsPage /> },
          { path: '/student/notifications', element: <NotificationsPage /> },
          { path: '/hod/mentorship', element: <HodMentorship /> },
          { path: '/hod/analytics', element: <HodAnalytics /> },
          { path: '/hod/promotion', element: <HodPromotion /> },
          { path: '/hod/calendar', element: <HodCalendar /> },
          { path: '/hod/archive', element: <HodArchive /> },
          { path: '/hod/settings/:section?', element: <HodSettings /> },

          // ── Faculty ─────────────────────────
          { path: '/faculty', element: <FacDashboard /> },
          { path: '/faculty/schedule', element: <FacSchedule /> },
          { path: '/faculty/students', element: <FacStudents /> },
          { path: '/faculty/attendance', element: <FacAttendance /> },
          { path: '/faculty/notes', element: <FacNotes /> },
          { path: '/faculty/quizzes', element: <FacQuizzes /> },
          { path: '/faculty/announcements', element: <FacAnnouncements /> },
          { path: '/faculty/mentees', element: <FacMentees /> },
          { path: '/faculty/results', element: <FacResults /> },
          { path: '/faculty/exams', element: <FacExams /> },
          { path: '/faculty/calendar', element: <FacCalendar /> },
          { path: '/faculty/analytics', element: <FacAnalytics /> },
          { path: '/faculty/settings/:section?', element: <FacSettings /> },

          // ── University (Dean) ───────────────
          { path: '/university', element: <UniDashboard /> },
          { path: '/university/years', element: <UniYears /> },
          { path: '/university/branches', element: <UniBranches /> },
          { path: '/university/hods', element: <UniHods /> },
          { path: '/university/promotion', element: <UniPromotion /> },
          { path: '/university/faculty', element: <UniFaculty /> },
          { path: '/university/students', element: <UniStudents /> },
          { path: '/university/subjects', element: <UniSubjects /> },
          { path: '/university/archive', element: <UniArchive /> },
          { path: '/university/settings', element: <UniSettings /> },

          // ── Student ─────────────────────────
          { path: '/student', element: <StuDashboard /> },
          { path: '/student/timetable', element: <StuTimetable /> },
          { path: '/student/results', element: <StuResults /> },
          { path: '/student/attendance', element: <StuAttendance /> },
          { path: '/student/notes', element: <StuNotes /> },
          { path: '/student/self-notes', element: <StuSelfNotes /> },
          { path: '/student/quizzes', element: <StuQuizzes /> },
          { path: '/student/announcements', element: <StuAnnouncements /> },
          { path: '/student/calendar', element: <StuCalendar /> },
          { path: '/student/mentor', element: <StuMentorChat /> },
          { path: '/student/ai', element: <StuAI /> },
          { path: '/student/study-planner', element: <StuPlanner /> },
          { path: '/student/leaderboard', element: <StuLeaderboard /> },
          { path: '/student/settings/:section?', element: <StuSettings /> },

          // Root redirect + catch-all
          { path: '/', element: <RoleRouter /> },
          { path: '*', element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
])
