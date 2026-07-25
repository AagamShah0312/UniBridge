import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg'
import { c } from './theme'

type P = { size?: number; color?: string }

/** Icons transcribed 1:1 from the SVG paths in UniPortal Mobile.dc.html. */

export const IconMenu = ({ size = 22, color = c.inkStrong }: P) => (
  <Svg width={size} height={size} viewBox="0 0 22 22" fill="none">
    <Path d="M3 6h16M3 11h16M3 16h16" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
  </Svg>
)

export const IconBell = ({ size = 21, color = c.inkStrong }: P) => (
  <Svg width={size} height={size} viewBox="0 0 22 22" fill="none">
    <Path
      d="M11 3a5 5 0 0 0-5 5c0 5-2 6-2 6h14s-2-1-2-6a5 5 0 0 0-5-5zM9.5 18a1.7 1.7 0 0 0 3 0"
      stroke={color}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
)

export const IconClose = ({ size = 15, color = '#3a382f' }: P) => (
  <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
    <Path d="M4 4l8 8M12 4l-8 8" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
  </Svg>
)

export const IconShield = ({ size = 17, color = '#fff' }: P) => (
  <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <Path d="M10 2l6 2.5v5c0 4-2.7 6.5-6 8-3.3-1.5-6-4-6-8v-5L10 2z" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M7.5 10l1.8 1.8L13 8" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
)

export const IconClipboard = ({ size = 17, color = '#1a1a1a' }: P) => (
  <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <Rect x={4} y={3} width={12} height={15} rx={2} stroke={color} strokeWidth={1.7} />
    <Path d="M7 2.5h6v3H7zM7 9h6M7 12.5h4" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
)

// ── Stat-card badges ─────────────────────────────────────────
export const IconStudents = ({ size = 16, color = c.primary }: P) => (
  <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <Circle cx={7} cy={7} r={3} stroke={color} strokeWidth={1.6} />
    <Path d="M2 17c0-3 2.5-5 5-5s5 2 5 5M13 8a3 3 0 0 0 0-6M18 17c0-2.5-1.5-4-4-4.5" stroke={color} strokeWidth={1.6} />
  </Svg>
)

export const IconFaculty = ({ size = 16, color = c.purple }: P) => (
  <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <Circle cx={8} cy={7} r={3} stroke={color} strokeWidth={1.6} />
    <Path d="M2 17c0-3 2.5-5 6-5M15 6v5M12.5 8.5h5" stroke={color} strokeWidth={1.6} />
  </Svg>
)

export const IconCalendarCheck = ({ size = 16, color = c.teal }: P) => (
  <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <Rect x={3} y={4} width={14} height={13} rx={2} stroke={color} strokeWidth={1.6} strokeLinecap="round" />
    <Path d="M3 8h14M7 2v3M13 2v3M6.5 12l2 2 3.5-3.5" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
  </Svg>
)

export const IconTrend = ({ size = 16, color = c.amber }: P) => (
  <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <Path d="M2 11l3-4 3 3 4-6 3 4 3-3" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
)

// ── Tab bar ──────────────────────────────────────────────────
export const TabHome = ({ size = 24, color = c.tabOff, active = false }: P & { active?: boolean }) =>
  active ? (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Rect x={3} y={3} width={7} height={7} rx={2} />
      <Rect x={14} y={3} width={7} height={7} rx={2} />
      <Rect x={3} y={14} width={7} height={7} rx={2} />
      <Rect x={14} y={14} width={7} height={7} rx={2} />
    </Svg>
  ) : (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={3} y={3} width={7} height={7} rx={2} stroke={color} strokeWidth={1.7} />
      <Rect x={14} y={3} width={7} height={7} rx={2} stroke={color} strokeWidth={1.7} />
      <Rect x={3} y={14} width={7} height={7} rx={2} stroke={color} strokeWidth={1.7} />
      <Rect x={14} y={14} width={7} height={7} rx={2} stroke={color} strokeWidth={1.7} />
    </Svg>
  )

export const TabStudents = ({ size = 24, color = c.tabOff }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx={9} cy={8} r={3.2} stroke={color} strokeWidth={1.7} />
    <Path d="M3.5 20c0-3.3 2.8-5.5 5.5-5.5s5.5 2.2 5.5 5.5M16 7.5a3 3 0 0 1 0 6M18.5 20c0-2.6-1.5-4.4-3.5-5" stroke={color} strokeWidth={1.7} />
  </Svg>
)

export const TabAttendance = ({ size = 24, color = c.tabOff }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Rect x={3.5} y={5} width={17} height={15} rx={2.5} stroke={color} strokeWidth={1.7} strokeLinecap="round" />
    <Path d="M3.5 9.5h17M8 3v4M16 3v4M8 14l2.5 2.5L16 11" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
  </Svg>
)

export const TabResults = ({ size = 24, color = c.tabOff }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Rect x={5} y={3.5} width={14} height={17} rx={2.5} stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M9 2.5h6v3H9zM8.5 11h7M8.5 15h4.5" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
)

export const TabMore = ({ size = 24, color = c.tabOff }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx={5} cy={12} r={1.4} stroke={color} strokeWidth={1.9} />
    <Circle cx={12} cy={12} r={1.4} stroke={color} strokeWidth={1.9} />
    <Circle cx={19} cy={12} r={1.4} stroke={color} strokeWidth={1.9} />
  </Svg>
)

// ── Drawer nav (one line-art glyph per destination) ──────────
export const NavIcon = ({ name, color = '#7a776f', size = 19 }: { name: string; color?: string; size?: number }) => {
  const p = { stroke: color, strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  const paths: Record<string, React.ReactNode> = {
    dashboard: (
      <>
        <Rect x={3} y={3} width={7} height={7} rx={2} {...p} />
        <Rect x={14} y={3} width={7} height={7} rx={2} {...p} />
        <Rect x={3} y={14} width={7} height={7} rx={2} {...p} />
        <Rect x={14} y={14} width={7} height={7} rx={2} {...p} />
      </>
    ),
    students: (
      <>
        <Circle cx={9} cy={8} r={3.2} {...p} />
        <Path d="M3.5 20c0-3.3 2.8-5.5 5.5-5.5s5.5 2.2 5.5 5.5M16 7.5a3 3 0 0 1 0 6M18.5 20c0-2.6-1.5-4.4-3.5-5" {...p} />
      </>
    ),
    faculty: (
      <>
        <Circle cx={10} cy={8} r={3.2} {...p} />
        <Path d="M4 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M18 6v5M15.5 8.5h5" {...p} />
      </>
    ),
    results: (
      <>
        <Rect x={5} y={3.5} width={14} height={17} rx={2.5} {...p} />
        <Path d="M9 2.5h6v3H9zM8.5 11h7M8.5 15h4.5" {...p} />
      </>
    ),
    attendance: (
      <>
        <Rect x={3.5} y={5} width={17} height={15} rx={2.5} {...p} />
        <Path d="M3.5 9.5h17M8 3v4M16 3v4M8 14l2.5 2.5L16 11" {...p} />
      </>
    ),
    subjects: <Path d="M4 5.5A2 2 0 0 1 6 3.5h5v17H6a2 2 0 0 0-2 2zM20 5.5a2 2 0 0 0-2-2h-5v17h5a2 2 0 0 1 2 2z" {...p} />,
    timetable: (
      <>
        <Rect x={3.5} y={5} width={17} height={15} rx={2.5} {...p} />
        <Path d="M3.5 9.5h17M8 3v4M16 3v4M8 13h3M8 16.5h7" {...p} />
      </>
    ),
    exams: (
      <>
        <Path d="M12 3l7 3v5.5c0 4.6-3.1 7.5-7 9-3.9-1.5-7-4.4-7-9V6l7-3z" {...p} />
        <Path d="M9 12l2 2 4-4" {...p} />
      </>
    ),
    announcements: <Path d="M4 9v5h3l7 4V5l-7 4H4zM17.5 8.5a5 5 0 0 1 0 7" {...p} />,
    analytics: (
      <>
        <Path d="M4 20V10M10 20V4M16 20v-7M22 20H2" {...p} />
      </>
    ),
    archive: (
      <>
        <Rect x={3} y={4} width={18} height={4.5} rx={1.5} {...p} />
        <Path d="M5 8.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V8.5M10 12.5h4" {...p} />
      </>
    ),
    settings: (
      <>
        <Circle cx={12} cy={12} r={3} {...p} />
        <Path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.4 5.6l-2 2M7.6 16.4l-2 2M18.4 18.4l-2-2M7.6 7.6l-2-2" {...p} />
      </>
    ),
    logout: <Path d="M14 7V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-2M18 12H9M15.5 8.5L19 12l-3.5 3.5" {...p} />,
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {paths[name] ?? paths.dashboard}
    </Svg>
  )
}

/** Gradient avatar used in the nav bar and drawer footer. */
export const AvatarGradient = ({ size = 32, initials }: { size?: number; initials: string }) => (
  <Svg width={size} height={size} viewBox="0 0 32 32">
    <Defs>
      <LinearGradient id="av" x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0" stopColor={c.primary} />
        <Stop offset="1" stopColor={c.indigo} />
      </LinearGradient>
    </Defs>
    <Circle cx={16} cy={16} r={16} fill="url(#av)" />
  </Svg>
)
