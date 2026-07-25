import { NavLink } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { NavSection } from './navItems/types'

/**
 * Mobile bottom tab bar (iOS Human Interface / Material 3 style from the mobile design).
 * Four primary destinations + "More", which opens the full navigation drawer.
 *
 * ponytail: tabs are RESOLVED from the role's existing nav sections by id, so labels, icons and
 * paths stay single-sourced — adding a nav item can never leave the tab bar out of sync.
 */
const PRIMARY_TABS: Record<string, string[]> = {
  HOD: ['dashboard', 'students', 'attendance', 'results'],
  FACULTY: ['dashboard', 'students', 'attendance', 'notes'],
  STUDENT: ['dashboard', 'timetable', 'attendance', 'results'],
  UNIVERSITY: ['dashboard', 'students', 'faculty', 'hods'],
}

// Long labels don't fit a 5-up tab bar.
const SHORT_LABEL: Record<string, string> = {
  dashboard: 'Home',
  attendance: 'Attend.',
  timetable: 'Timetable',
  'academic years': 'Years',
}

export function MobileTabBar({
  sections,
  role,
  onOpenMenu,
}: {
  sections: NavSection[]
  role: 'HOD' | 'FACULTY' | 'STUDENT' | 'UNIVERSITY'
  onOpenMenu: () => void
}) {
  const all = sections.flatMap((s) => s.items)
  const wanted = PRIMARY_TABS[role] ?? []
  const tabs = wanted.map((id) => all.find((i) => i.id === id)).filter((i): i is NonNullable<typeof i> => !!i)
  // Fall back to the first four destinations if a role's ids ever drift.
  const items = (tabs.length ? tabs : all.slice(0, 4)).slice(0, 4)

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex items-stretch justify-around border-t border-border bg-surface/90 backdrop-blur-xl lg:hidden"
      // Respect the iPhone home indicator / Android gesture bar.
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 8px)' }}
      aria-label="Primary"
    >
      {items.map((item) => {
        const Icon = item.icon
        return (
          <NavLink
            key={item.id}
            to={item.path}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'flex flex-1 flex-col items-center gap-1 pt-2 pb-1 text-[10px] font-semibold transition-colors',
                isActive ? 'text-primary' : 'text-text-muted',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={22} strokeWidth={isActive ? 2.2 : 1.7} />
                <span className={cn(isActive ? 'font-semibold' : 'font-medium')}>
                  {SHORT_LABEL[item.id] ?? item.label}
                </span>
              </>
            )}
          </NavLink>
        )
      })}

      <button
        onClick={onOpenMenu}
        aria-label="Open menu"
        className="flex flex-1 flex-col items-center gap-1 pt-2 pb-1 text-[10px] font-medium text-text-muted transition-colors hover:text-text-primary"
      >
        <Menu size={22} strokeWidth={1.7} />
        <span>More</span>
      </button>
    </nav>
  )
}
