import { Platform } from 'react-native'

/**
 * Tokens taken directly from "UniPortal Mobile.dc.html" (iOS / Human Interface frames).
 * Colour values are copied verbatim from the design's inline styles.
 */
export const theme = {
  color: {
    // surfaces
    bg: '#f6f6f4',
    surface: '#ffffff',
    drawer: '#faf9f7',
    track: '#f2f1ee',
    chip: '#eceae5',
    grid: '#f0efec',

    // text
    ink: '#151515',
    inkStrong: '#111111',
    inkRow: '#1f1f1f',
    body: '#6b6862',
    label: '#5f5c56',
    hint: '#9a968e',
    faint: '#a8a49c',
    axis: '#b3afa7',
    tabOff: '#8a877f',
    navLabel: '#3a382f',

    // accents (one per stat card, per the design)
    primary: '#2563eb',
    purple: '#7c3aed',
    teal: '#0d9488',
    amber: '#d97706',
    indigo: '#4f46e5',

    // severity
    danger: '#c0392b',
    dangerBg: '#fde8e8',
    warn: '#b45309',
    warnBg: '#fff2df',
    dot: '#ef4444',

    border: 'rgba(0,0,0,.06)',
    borderStrong: 'rgba(0,0,0,.10)',
    scrim: 'rgba(15,15,18,.42)',

    // aliases kept so the non-designed inner screens (Students, Faculty, …) and the
    // login screen keep compiling against the same palette.
    heroFrom: '#dbeafe',
    heroTo: '#eff6ff',
    borderSoft: '#eceae5',
    muted: '#6b6862',
    mutedLight: '#a8a49c',
    primaryDeep: '#0b2a63',
    primaryDark: '#1e3a8a',
  },
  radius: { chip: 20, card: 18, btn: 14, nav: 13, sm: 10, md: 14, lg: 18, pill: 999 },
  /**
   * The design sets headings in Source Serif 4. Shipping a webfont would add expo-font +
   * a Google-Fonts package and a load-blocking splash; the platform serif is visually the
   * same family of shape, so we use it and keep the app dependency-free.
   */
  serif: Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia' })!,
} as const

export const c = theme.color
