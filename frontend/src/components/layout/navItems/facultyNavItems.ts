import {
  Activity,
  Calendar,
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  FileText,
  Heart,
  PenLine,
  HelpCircle,
  LayoutDashboard,
  Megaphone,
  Settings,
  Users,
} from 'lucide-react'
import type { NavSection } from './types'

export const facultyNavItems: NavSection[] = [
  {
    section: 'Teaching',
    items: [
      { id: 'dashboard', label: 'Dashboard', path: '/faculty', icon: LayoutDashboard, end: true },
      { id: 'schedule', label: 'My Schedule', path: '/faculty/schedule', icon: CalendarDays },
      { id: 'students', label: 'Students', path: '/faculty/students', icon: Users },
      { id: 'attendance', label: 'Attendance', path: '/faculty/attendance', icon: CalendarCheck },
      { id: 'notes', label: 'Notes', path: '/faculty/notes', icon: FileText },
      { id: 'quizzes', label: 'Quizzes', path: '/faculty/quizzes', icon: HelpCircle },
    ],
  },
  {
    section: 'Communication',
    items: [
      { id: 'announcements', label: 'Announcements', path: '/faculty/announcements', icon: Megaphone },
      { id: 'mentees', label: 'Mentees', path: '/faculty/mentees', icon: Heart },
    ],
  },
  {
    section: 'Data',
    items: [
      { id: 'exams', label: 'Exams', path: '/faculty/exams', icon: PenLine },
      { id: 'exam-duties', label: 'Exam Duties', path: '/faculty/exam-duties', icon: CalendarCheck },
      { id: 'results', label: 'Results', path: '/faculty/results', icon: ClipboardList },
      { id: 'analytics', label: 'Analytics', path: '/faculty/analytics', icon: Activity },
      { id: 'calendar', label: 'Calendar', path: '/faculty/calendar', icon: Calendar },
      { id: 'settings', label: 'Settings', path: '/faculty/settings', icon: Settings },
    ],
  },
]
