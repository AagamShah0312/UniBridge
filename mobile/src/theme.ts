// Design tokens lifted from "UniPortal Mobile.dc.html" so the app matches the mockup
// and the web portal's palette.
export const theme = {
  color: {
    primary: '#2563eb',
    primaryDark: '#1e3a8a',
    primaryDeep: '#0b2a63',
    heroFrom: '#dbeafe',
    heroTo: '#eff6ff',
    surface: '#ffffff',
    bg: '#f6f6f4',
    border: '#e5edf4',
    borderSoft: '#eceae5',
    ink: '#151515',
    muted: '#8a877f',
    mutedLight: '#a8a49c',
    danger: '#c2410c',
    dangerBg: '#fef2f2',
  },
  radius: { sm: 10, md: 14, lg: 18, pill: 999 },
  space: (n: number) => n * 4,
} as const
