import { Outlet } from 'react-router-dom'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { Loader2, FileBarChart } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { portalOf, useUser } from '@/stores/authStore'
import { useUiStore } from '@/stores/uiStore'
import { hodApi } from '@/api/hod'
import { facultyApi } from '@/api/faculty'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { MobileTabBar } from './MobileTabBar'
import { hodNavItems } from './navItems/hodNavItems'
import { facultyNavItems } from './navItems/facultyNavItems'
import { studentNavItems } from './navItems/studentNavItems'
import { universityNavItems } from './navItems/universityNavItems'
import { HodOnboardingModal } from '@/pages/hod/HodOnboardingModal'

export default function AppShell() {
  const user = useUser()
  const role = portalOf(user)
  const mobileOpen = useUiStore((s) => s.mobileSidebarOpen)
  const setMobileSidebar = useUiStore((s) => s.setMobileSidebar)

  // Only attendance coordinators see the report page; keep it out of every other
  // faculty's sidebar (the endpoints 403 non-coordinators regardless).
  const coordStatus = useQuery({
    queryKey: ['faculty', 'attendance-coordinator', 'status'],
    queryFn: () => facultyApi.attendanceCoordinatorStatus(),
    enabled: role === 'FACULTY',
  })
  const facultySections = useMemo(() => {
    if (!coordStatus.data?.isCoordinator) return facultyNavItems
    return facultyNavItems.map((s) => s.section === 'Teaching'
      ? { ...s, items: [...s.items, { id: 'attendance-report', label: 'Attendance Report', path: '/faculty/attendance-report', icon: FileBarChart }] }
      : s)
  }, [coordStatus.data?.isCoordinator])

  const sections =
    role === 'UNIVERSITY' ? universityNavItems : role === 'STUDENT' ? studentNavItems : role === 'HOD' ? hodNavItems : facultySections

  const hodScope = useQuery({ queryKey: ['hod', 'scope', 'active'], queryFn: () => hodApi.scope(), enabled: role === 'HOD' })
  // ponytail: LATCH the wizard open. myScope refetches after the Batches step and returns
  // needsOnboarding=false (batches now exist), which would otherwise unmount the wizard mid-flow.
  // Stays open until the wizard's DoneStep calls onFinish.
  const [wizardOpen, setWizardOpen] = useState(false)
  useEffect(() => {
    if (role === 'HOD' && hodScope.data?.needsOnboarding) setWizardOpen(true)
  }, [role, hodScope.data?.needsOnboarding])

  // ── HARD ONBOARDING LOCK ──────────────────────────────────
  // The panel NEVER renders until onboarding is confirmed complete (DB-gated via needsOnboarding).
  // Direct URLs and refresh can't bypass it — AppShell wraps every /hod route, and we render the
  // wizard full-screen (no sidebar/topbar/Outlet) whenever onboarding is required.
  if (role === 'HOD') {
    if (hodScope.isLoading) {
      return (
        <div className="flex h-screen items-center justify-center bg-bg">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
        </div>
      )
    }
    if (wizardOpen && hodScope.data) {
      return (
        <div className="flex h-screen items-center justify-center bg-bg p-4">
          <HodOnboardingModal
            activeSemesterNumber={hodScope.data.activeSemester.number}
            activeSemesterId={hodScope.data.activeSemester.id}
            onFinish={() => setWizardOpen(false)}
          />
        </div>
      )
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <Sidebar sections={sections} role={role} />
      </div>

      {/* Mobile drawer — slide-over from the left, matching the mobile design's "More" menu. */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            onClick={() => setMobileSidebar(false)}
          />
          <div className="absolute left-0 top-0 h-full animate-[slideIn_.18s_ease-out]">
            <Sidebar
              sections={sections}
              role={role}
              onNavigate={() => setMobileSidebar(false)}
            />
          </div>
        </div>
      )}

      <div className={cn('flex min-w-0 flex-1 flex-col')}>
        <Topbar />
        {/* pb-24 on mobile keeps content clear of the fixed bottom tab bar. */}
        <main className="scrollbar-thin flex-1 overflow-y-auto p-4 pb-24 md:p-6 lg:pb-6">
          <Suspense fallback={<div className="flex h-full items-center justify-center py-20 text-text-muted"><Loader2 className="animate-spin" size={22} /></div>}>
            <Outlet />
          </Suspense>
        </main>
      </div>

      <MobileTabBar sections={sections} role={role} onOpenMenu={() => setMobileSidebar(true)} />
    </div>
  )
}
