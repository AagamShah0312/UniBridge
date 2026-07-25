import { useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { LoginResponse } from './api'
import { c, theme } from './theme'
import { Dashboard } from './screens/Dashboard'
import {
  IconBell, IconClose, IconMenu, NavIcon,
  TabAttendance, TabHome, TabMore, TabResults, TabStudents,
} from './icons'
import {
  AnalyticsScreen, AnnouncementsScreen, ArchiveScreen, AttendanceScreen, ExamPanelScreen,
  FacultyScreen, ResultsScreen, SettingsScreen, StudentsScreen, SubjectsScreen, TimetableScreen,
  type ScreenProps,
} from './screens/hod'

type RouteId =
  | 'dashboard' | 'students' | 'faculty' | 'results' | 'attendance' | 'subjects'
  | 'timetable' | 'exams' | 'announcements' | 'analytics' | 'archive' | 'settings'

const LABEL: Record<RouteId, string> = {
  dashboard: 'Dashboard', students: 'Students', faculty: 'Faculty', results: 'Results',
  attendance: 'Attendance', subjects: 'Subjects', timetable: 'Timetable', exams: 'Exam Panel',
  announcements: 'Announcements', analytics: 'Analytics', archive: 'Archive', settings: 'Settings',
}

const SCREENS: Record<Exclude<RouteId, 'dashboard'>, (p: ScreenProps) => React.ReactElement> = {
  students: StudentsScreen, faculty: FacultyScreen, results: ResultsScreen,
  attendance: AttendanceScreen, subjects: SubjectsScreen, timetable: TimetableScreen,
  exams: ExamPanelScreen, announcements: AnnouncementsScreen, analytics: AnalyticsScreen,
  archive: ArchiveScreen, settings: SettingsScreen,
}

// Drawer groups exactly as the design's "MAIN" / "MANAGEMENT" sections.
const DRAWER: { section: string; ids: RouteId[] }[] = [
  { section: 'MAIN', ids: ['dashboard', 'students', 'faculty', 'results', 'attendance', 'subjects', 'timetable'] },
  { section: 'MANAGEMENT', ids: ['exams', 'announcements', 'analytics', 'archive', 'settings'] },
]

const TABS: { id: RouteId; label: string; Icon: (p: { color?: string; active?: boolean }) => React.ReactElement }[] = [
  { id: 'dashboard', label: 'Home', Icon: ({ color, active }) => <TabHome color={color} active={active} /> },
  { id: 'students', label: 'Students', Icon: ({ color }) => <TabStudents color={color} /> },
  { id: 'attendance', label: 'Attend.', Icon: ({ color }) => <TabAttendance color={color} /> },
  { id: 'results', label: 'Results', Icon: ({ color }) => <TabResults color={color} /> },
]

const initials = (name: string) =>
  name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()

/** App chrome built to match the design's nav bar, tab bar and slide-over drawer. */
export function Shell({ session, onSignOut }: { session: LoginResponse; onSignOut: () => void }) {
  const [route, setRoute] = useState<RouteId>('dashboard')
  const [drawerOpen, setDrawerOpen] = useState(false)

  const go = (id: string) => {
    setRoute(id as RouteId)
    setDrawerOpen(false)
  }

  const Active = route === 'dashboard' ? null : SCREENS[route as Exclude<RouteId, 'dashboard'>]

  return (
    <View style={s.root}>
      {/* nav bar: hamburger · centred brand · bell + avatar */}
      <View style={s.nav}>
        <Pressable onPress={() => setDrawerOpen(true)} hitSlop={10} style={s.navBtn}>
          <IconMenu />
        </Pressable>

        <View style={s.brand}>
          <View style={s.brandMark}><Text style={s.brandMarkText}>LJ</Text></View>
          <Text style={s.brandName}>UniPortal</Text>
        </View>

        <View style={s.navRight}>
          <Pressable hitSlop={8} style={s.navBtn}>
            <IconBell />
            <View style={s.bellDot} />
          </Pressable>
          <View style={s.avatar}><Text style={s.avatarText}>{initials(session.user.name)}</Text></View>
        </View>
      </View>

      <View style={s.body}>
        {route === 'dashboard' ? <Dashboard session={session} onNavigate={go} /> : Active ? <Active session={session} /> : null}
      </View>

      {/* tab bar */}
      <View style={s.tabbar}>
        {TABS.map((t) => {
          const on = route === t.id
          return (
            <Pressable key={t.id} style={s.tab} onPress={() => setRoute(t.id)}>
              <t.Icon color={on ? c.primary : c.tabOff} active={on} />
              <Text style={[s.tabLabel, on && s.tabLabelOn]}>{t.label}</Text>
            </Pressable>
          )
        })}
        <Pressable style={s.tab} onPress={() => setDrawerOpen(true)}>
          <TabMore color={c.tabOff} />
          <Text style={s.tabLabel}>More</Text>
        </Pressable>
      </View>

      {/* slide-over drawer */}
      <Modal visible={drawerOpen} transparent animationType="fade" onRequestClose={() => setDrawerOpen(false)}>
        <Pressable style={s.scrim} onPress={() => setDrawerOpen(false)} />
        <View style={s.drawer}>
          <View style={s.drawerHead}>
            <View style={s.drawerBrand}>
              <View style={s.drawerMark}><Text style={s.drawerMarkText}>LJ</Text></View>
              <View>
                <Text style={s.drawerName}>UniPortal</Text>
                <Text style={s.drawerSub}>HOD PORTAL</Text>
              </View>
            </View>
            <Pressable onPress={() => setDrawerOpen(false)} hitSlop={8} style={s.closeBtn}>
              <IconClose />
            </Pressable>
          </View>

          <ScrollView style={s.flex} contentContainerStyle={{ paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
            {DRAWER.map((g) => (
              <View key={g.section}>
                <Text style={s.groupLabel}>{g.section}</Text>
                {g.ids.map((id) => {
                  const on = route === id
                  return (
                    <Pressable key={id} onPress={() => go(id)} style={[s.navItem, on && s.navItemOn]}>
                      <NavIcon name={id} color={on ? c.primary : '#7a776f'} />
                      <Text style={[s.navItemText, on && s.navItemTextOn]}>{LABEL[id]}</Text>
                    </Pressable>
                  )
                })}
              </View>
            ))}
          </ScrollView>

          <View style={s.drawerFoot}>
            <View style={s.footAvatar}><Text style={s.footAvatarText}>{initials(session.user.name)}</Text></View>
            <View style={s.flex}>
              <Text style={s.footName} numberOfLines={1}>{session.user.name}</Text>
              <Text style={s.footRole}>HOD Portal</Text>
            </View>
            <Pressable onPress={onSignOut} hitSlop={10}>
              <NavIcon name="logout" color={c.hint} size={20} />
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

  nav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingTop: 4, paddingBottom: 10,
    backgroundColor: 'rgba(246,246,244,.98)',
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(0,0,0,.08)',
  },
  navBtn: { padding: 8 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandMark: { width: 30, height: 30, borderRadius: 8, backgroundColor: '#0b0b0c', alignItems: 'center', justifyContent: 'center' },
  brandMarkText: { fontFamily: theme.serif, color: '#fff', fontSize: 12, fontWeight: '700' },
  brandName: { fontFamily: theme.serif, fontSize: 16, fontWeight: '700', color: c.inkStrong },
  navRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bellDot: {
    position: 'absolute', top: 6, right: 6, width: 7, height: 7, borderRadius: 4,
    backgroundColor: c.dot, borderWidth: 1.5, borderColor: c.bg,
  },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 12, fontWeight: '600' },

  body: { flex: 1 },

  tabbar: {
    flexDirection: 'row', justifyContent: 'space-around',
    backgroundColor: 'rgba(246,246,244,.96)',
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(0,0,0,.09)',
    paddingTop: 8, paddingBottom: 22, paddingHorizontal: 8,
  },
  tab: { alignItems: 'center', gap: 4, flex: 1 },
  tabLabel: { fontSize: 10, fontWeight: '500', color: c.tabOff },
  tabLabelOn: { color: c.primary, fontWeight: '600' },

  scrim: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: c.scrim },
  drawer: {
    position: 'absolute', left: 0, top: 0, bottom: 0, width: 314,
    backgroundColor: c.drawer,
    borderTopRightRadius: 26, borderBottomRightRadius: 26,
    paddingTop: 52,
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 40, shadowOffset: { width: 24, height: 0 },
  },
  drawerHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 4, paddingBottom: 16 },
  drawerBrand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  drawerMark: { width: 38, height: 38, borderRadius: 10, backgroundColor: '#0b0b0c', alignItems: 'center', justifyContent: 'center' },
  drawerMarkText: { fontFamily: theme.serif, color: '#fff', fontSize: 14, fontWeight: '700' },
  drawerName: { fontFamily: theme.serif, fontSize: 17, fontWeight: '700', color: c.inkStrong },
  drawerSub: { fontSize: 9, fontWeight: '600', letterSpacing: 1.3, color: c.hint, marginTop: 5 },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: c.chip, alignItems: 'center', justifyContent: 'center' },

  groupLabel: { fontSize: 10, fontWeight: '600', letterSpacing: 1.4, color: c.faint, paddingHorizontal: 24, paddingTop: 8, paddingBottom: 6 },
  navItem: { flexDirection: 'row', alignItems: 'center', gap: 13, padding: 12, marginHorizontal: 12, borderRadius: theme.radius.nav },
  navItemOn: { backgroundColor: 'rgba(37,99,235,.1)' },
  navItemText: { fontSize: 14, fontWeight: '500', color: c.navLabel },
  navItemTextOn: { color: c.primary, fontWeight: '600' },

  drawerFoot: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    borderTopWidth: 1, borderTopColor: c.chip,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 26,
  },
  footAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  footAvatarText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  footName: { fontSize: 13, fontWeight: '600', color: c.inkRow },
  footRole: { fontSize: 11, fontWeight: '500', color: c.hint, marginTop: 5 },
})
