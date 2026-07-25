import {
  Activity,
  Archive,
  BookOpen,
  Calendar,
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  Megaphone,
  RefreshCw,
  Settings,
  ShieldCheck,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react'
import type { NavSection } from './types'

export const hodNavItems: NavSection[] = [
  {
    section: 'Main',
    items: [
      { id: 'dashboard', label: 'Dashboard', path: '/hod', icon: LayoutDashboard, end: true },
      { id: 'students', label: 'Students', path: '/hod/students', icon: Users },
      { id: 'faculty', label: 'Faculty', path: '/hod/faculty', icon: UserCheck },
      { id: 'results', label: 'Results', path: '/hod/results', icon: ClipboardList },
      { id: 'attendance', label: 'Attendance', path: '/hod/attendance', icon: CalendarCheck },
      { id: 'subjects', label: 'Subjects', path: '/hod/subjects', icon: BookOpen },
      { id: 'timetable', label: 'Timetable', path: '/hod/timetable', icon: CalendarDays },
    ],
  },
  {
    section: 'Management',
    items: [
      { id: 'exams', label: 'Exam Panel', path: '/hod/exams', icon: ShieldCheck },
      { id: 'announcements', label: 'Announcements', path: '/hod/announcements', icon: Megaphone },
      { id: 'mentorship', label: 'Mentorship', path: '/hod/mentorship', icon: UserPlus },
      { id: 'analytics', label: 'Analytics', path: '/hod/analytics', icon: Activity },
      { id: 'promotion', label: 'Promotion', path: '/hod/promotion', icon: RefreshCw },
      { id: 'calendar', label: 'Calendar', path: '/hod/calendar', icon: Calendar },
      { id: 'archive', label: 'Archive', path: '/hod/archive', icon: Archive },
      { id: 'settings', label: 'Settings', path: '/hod/settings', icon: Settings },
    ],
  },
]
