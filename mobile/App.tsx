import { useState } from 'react'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaView, StyleSheet } from 'react-native'
import { LoginScreen } from './src/screens/LoginScreen'
import { HomeScreen } from './src/screens/HomeScreen'
import type { LoginResponse } from './src/api'

/**
 * UniPortal mobile — HOD module.
 *
 * ponytail: the session lives in memory for this milestone, so the app needs no extra native
 * modules (SecureStore/AsyncStorage) to run in Expo Go. Swap in expo-secure-store when we add
 * "stay signed in" — the only thing that changes is where `session` is read from and written to.
 */
export default function App() {
  const [session, setSession] = useState<LoginResponse | null>(null)

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />
      {session ? (
        <HomeScreen session={session} onSignOut={() => setSession(null)} />
      ) : (
        <LoginScreen onSignedIn={setSession} />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
})
