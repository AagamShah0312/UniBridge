import {
  Archive,
  BookOpen,
  Building2,
  CalendarRange,
  GitBranch,
  GraduationCap,
  LayoutDashboard,
  TrendingUp,
  UserCheck,
  Users,
} from 'lucide-react'
import type { NavSection } from './types'

export const universityNavItems: NavSection[] = [
  {
    section: 'University',
    items: [
      { id: 'dashboard', label: 'Dashboard', path: '/university', icon: LayoutDashboard, end: true },
      { id: 'years', label: 'Academic Years', path: '/university/years', icon: CalendarRange },
      { id: 'branches', label: 'Branches', path: '/university/branches', icon: GitBranch },
      { id: 'hods', label: 'HODs', path: '/university/hods', icon: UserCheck },
      { id: 'promotion', label: 'Promotion', path: '/university/promotion', icon: TrendingUp },
      { id: 'faculty', label: 'Faculty', path: '/university/faculty', icon: Users },
      { id: 'students', label: 'Students', path: '/university/students', icon: GraduationCap },
      { id: 'subjects', label: 'Subjects', path: '/university/subjects', icon: BookOpen },
      { id: 'archive', label: 'Archive', path: '/university/archive', icon: Archive },
      { id: 'settings', label: 'Settings', path: '/university/settings', icon: Building2 },
    ],
  },
]
