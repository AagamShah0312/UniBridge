import { useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { LoginResponse } from './api'
import { theme } from './theme'
import { initialsOf } from './ui'
import {
  AnalyticsScreen,
  AnnouncementsScreen,
  ArchiveScreen,
  AttendanceScreen,
  DashboardScreen,
  ExamPanelScreen,
  FacultyScreen,
  ResultsScreen,
  SettingsScreen,
  StudentsScreen,
  SubjectsScreen,
  TimetableScreen,
  type ScreenProps,
} from './screens/hod'

const c = theme.color

type RouteId =
  | 'dashboard' | 'students' | 'faculty' | 'results' | 'attendance' | 'subjects'
  | 'timetable' | 'exams' | 'announcements' | 'analytics' | 'archive' | 'settings'

const ROUTES: { id: RouteId; label: string; screen: (p: ScreenProps) => React.ReactElement }[] = [
  { id: 'dashboard', label: 'Dashboard', screen: DashboardScreen },
  { id: 'students', label: 'Students', screen: StudentsScreen },
  { id: 'faculty', label: 'Faculty', screen: FacultyScreen },
  { id: 'results', label: 'Results', screen: ResultsScreen },
  { id: 'attendance', label: 'Attendance', screen: AttendanceScreen },
  { id: 'subjects', label: 'Subjects', screen: SubjectsScreen },
  { id: 'timetable', label: 'Timetable', screen: TimetableScreen },
  { id: 'exams', label: 'Exam Panel', screen: ExamPanelScreen },
  { id: 'announcements', label: 'Announcements', screen: AnnouncementsScreen },
  { id: 'analytics', label: 'Analytics', screen: AnalyticsScreen },
  { id: 'archive', label: 'Archive', screen: ArchiveScreen },
  { id: 'settings', label: 'Settings', screen: SettingsScreen },
]

// Drawer grouping mirrors the design's "MAIN" / "MANAGEMENT" sections.
const DRAWER: { section: string; ids: RouteId[] }[] = [
  { section: 'MAIN', ids: ['dashboard', 'students', 'faculty', 'results', 'attendance', 'subjects', 'timetable'] },
  { section: 'MANAGEMENT', ids: ['exams', 'announcements', 'analytics', 'archive', 'settings'] },
]

// Bottom tabs from the design: Home · Students · Attend. · Results · More
const TABS: { id: RouteId; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Home', icon: '▦' },
  { id: 'students', label: 'Students', icon: '👥' },
  { id: 'attendance', label: 'Attend.', icon: '✓' },
  { id: 'results', label: 'Results', icon: '📊' },
]

/**
 * App chrome: top bar + slide-over drawer + bottom tab bar, matching
 * "UniPortal Mobile.dc.html". Routing is a simple id switch — the app has no deep
 * linking or back-stack needs yet, so this avoids pulling in react-navigation
 * and its five native dependencies.
 */
export function Shell({ session, onSignOut }: { session: LoginResponse; onSignOut: () => void }) {
  const [route, setRoute] = useState<RouteId>('dashboard')
  const [drawerOpen, setDrawerOpen] = useState(false)

  const active = ROUTES.find((r) => r.id === route) ?? ROUTES[0]
  const ActiveScreen = active.screen
  const go = (id: RouteId) => {
    setRoute(id)
    setDrawerOpen(false)
  }

  return (
    <View style={s.root}>
      {/* Top bar */}
      <View style={s.topbar}>
        <Pressable onPress={() => setDrawerOpen(true)} hitSlop={10} style={s.iconBtn}>
          <Text style={s.hamburger}>☰</Text>
        </Pressable>
        <Text style={s.topTitle}>{active.label}</Text>
        <View style={s.topAvatar}>
          <Text style={s.topAvatarText}>{initialsOf(session.user.name)}</Text>
        </View>
      </View>

      {/* Screen */}
      <View style={s.body}>
        <ActiveScreen session={session} />
      </View>

      {/* Bottom tabs */}
      <View style={s.tabbar}>
        {TABS.map((tab) => {
          const on = route === tab.id
          return (
            <Pressable key={tab.id} style={s.tab} onPress={() => setRoute(tab.id)}>
              <Text style={[s.tabIcon, on && s.tabOn]}>{tab.icon}</Text>
              <Text style={[s.tabLabel, on && s.tabOn]}>{tab.label}</Text>
            </Pressable>
          )
        })}
        <Pressable style={s.tab} onPress={() => setDrawerOpen(true)}>
          <Text style={s.tabIcon}>☰</Text>
          <Text style={s.tabLabel}>More</Text>
        </Pressable>
      </View>

      {/* Slide-over drawer */}
      <Modal visible={drawerOpen} transparent animationType="fade" onRequestClose={() => setDrawerOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setDrawerOpen(false)} />
        <View style={s.drawer}>
          <View style={s.brandRow}>
            <View style={s.brandLogo}>
              <Text style={s.brandLogoText}>LJ</Text>
            </View>
            <View>
              <Text style={s.brandName}>UniPortal</Text>
              <Text style={s.brandSub}>HOD PORTAL</Text>
            </View>
          </View>

          <ScrollView style={s.flex} contentContainerStyle={{ paddingBottom: 20 }}>
            {DRAWER.map((group) => (
              <View key={group.section} style={{ marginTop: 18 }}>
                <Text style={s.groupLabel}>{group.section}</Text>
                {group.ids.map((id) => {
                  const item = ROUTES.find((r) => r.id === id)!
                  const on = route === id
                  return (
                    <Pressable key={id} onPress={() => go(id)} style={[s.navItem, on && s.navItemOn]}>
                      <Text style={[s.navText, on && s.navTextOn]}>{item.label}</Text>
                    </Pressable>
                  )
                })}
              </View>
            ))}
          </ScrollView>

          <View style={s.drawerFooter}>
            <View style={s.footAvatar}>
              <Text style={s.footAvatarText}>{initialsOf(session.user.name)}</Text>
            </View>
            <View style={s.flex}>
              <Text style={s.footName} numberOfLines={1}>{session.user.name}</Text>
              <Text style={s.footRole}>HOD Portal</Text>
            </View>
            <Pressable onPress={onSignOut} hitSlop={8}>
              <Text style={s.signOut}>Sign out</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  flex: { flex: 1 },

  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: c.surface,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  iconBtn: { padding: 2 },
  hamburger: { fontSize: 20, color: c.ink },
  topTitle: { flex: 1, fontSize: 17, fontWeight: '700', color: c.ink },
  topAvatar: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: c.heroFrom, alignItems: 'center', justifyContent: 'center',
  },
  topAvatarText: { color: c.primary, fontWeight: '700', fontSize: 12 },

  body: { flex: 1 },

  tabbar: {
    flexDirection: 'row',
    backgroundColor: c.surface,
    borderTopWidth: 1,
    borderTopColor: c.border,
    paddingTop: 8,
    paddingBottom: 22,
  },
  tab: { flex: 1, alignItems: 'center', gap: 3 },
  tabIcon: { fontSize: 17, color: c.muted },
  tabLabel: { fontSize: 10, fontWeight: '600', color: c.muted },
  tabOn: { color: c.primary },

  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,.4)' },
  drawer: {
    position: 'absolute',
    left: 0, top: 0, bottom: 0,
    width: 284,
    backgroundColor: c.surface,
    paddingTop: 54,
    paddingHorizontal: 14,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: c.borderSoft },
  brandLogo: { width: 38, height: 38, borderRadius: 11, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  brandLogoText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  brandName: { fontSize: 16, fontWeight: '700', color: c.ink },
  brandSub: { fontSize: 9.5, fontWeight: '700', letterSpacing: 1.2, color: c.muted, marginTop: 2 },

  groupLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: c.mutedLight, marginBottom: 6, paddingHorizontal: 10 },
  navItem: { paddingVertical: 11, paddingHorizontal: 10, borderRadius: theme.radius.sm },
  navItemOn: { backgroundColor: c.heroTo },
  navText: { fontSize: 14, color: c.ink, fontWeight: '500' },
  navTextOn: { color: c.primary, fontWeight: '700' },

  drawerFooter: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderTopWidth: 1, borderTopColor: c.borderSoft,
    paddingVertical: 14, paddingBottom: 30,
  },
  footAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: c.heroFrom, alignItems: 'center', justifyContent: 'center' },
  footAvatarText: { color: c.primary, fontWeight: '700', fontSize: 12 },
  footName: { fontSize: 13, fontWeight: '700', color: c.ink },
  footRole: { fontSize: 11, color: c.muted, marginTop: 1 },
  signOut: { color: c.primary, fontSize: 12.5, fontWeight: '700' },
})
