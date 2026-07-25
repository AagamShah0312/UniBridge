import { useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { loginHod, type LoginResponse } from '../api'
import { theme } from '../theme'

const c = theme.color

/** HOD sign-in — mirrors the "iOS/Android — Login" frames in UniPortal Mobile.dc.html. */
export function LoginScreen({ onSignedIn }: { onSignedIn: (session: LoginResponse) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy

  async function submit() {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      onSignedIn(await loginHod(email, password))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign in failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        {/* Hero — the mockup's soft blue wash with the LJ mark. */}
        <View style={s.hero}>
          <View style={s.logo}>
            <Text style={s.logoText}>LJ</Text>
          </View>
          <Text style={s.brand}>LJ University</Text>
          <Text style={s.brandSub}>HOD PORTAL</Text>
        </View>

        <View style={s.body}>
          <Text style={s.title}>Welcome Back!</Text>
          <Text style={s.subtitle}>Sign in to continue to your dashboard</Text>

          {error ? (
            <View style={s.error}>
              <Text style={s.errorText}>{error}</Text>
            </View>
          ) : null}

          <Text style={s.label}>Email</Text>
          <TextInput
            style={s.input}
            value={email}
            onChangeText={setEmail}
            placeholder="Enter your email"
            placeholderTextColor={c.mutedLight}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            editable={!busy}
          />

          <Text style={s.label}>Password</Text>
          <View style={s.passwordRow}>
            <TextInput
              style={[s.input, s.passwordInput]}
              value={password}
              onChangeText={setPassword}
              placeholder="Enter your password"
              placeholderTextColor={c.mutedLight}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              editable={!busy}
              onSubmitEditing={submit}
              returnKeyType="go"
            />
            <Pressable onPress={() => setShowPassword((v) => !v)} style={s.reveal} hitSlop={8}>
              <Text style={s.revealText}>{showPassword ? 'Hide' : 'Show'}</Text>
            </Pressable>
          </View>

          <View style={s.metaRow}>
            <Pressable style={s.checkRow} onPress={() => setRemember((v) => !v)} hitSlop={6}>
              <View style={[s.checkbox, remember && s.checkboxOn]}>
                {remember ? <Text style={s.checkMark}>✓</Text> : null}
              </View>
              <Text style={s.metaText}>Remember me</Text>
            </Pressable>
            <Text style={s.link}>Forgot Password?</Text>
          </View>

          <Pressable
            onPress={submit}
            disabled={!canSubmit}
            style={({ pressed }) => [s.button, !canSubmit && s.buttonDisabled, pressed && s.buttonPressed]}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={s.buttonText}>Sign In　→</Text>
            )}
          </Pressable>

          <Text style={s.footer}>
            Don't have an account? <Text style={s.link}>Contact Administrator</Text>
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: c.surface },
  scroll: { flexGrow: 1, backgroundColor: c.surface },
  hero: {
    backgroundColor: c.heroFrom,
    paddingTop: 72,
    paddingBottom: 34,
    alignItems: 'center',
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  logo: {
    width: 62,
    height: 62,
    borderRadius: 18,
    backgroundColor: c.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: c.primary,
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  logoText: { color: '#fff', fontSize: 22, fontWeight: '700', letterSpacing: 0.5 },
  brand: { marginTop: 14, fontSize: 21, fontWeight: '700', color: c.primaryDeep },
  brandSub: { marginTop: 5, fontSize: 11, fontWeight: '600', letterSpacing: 1.6, color: c.primary },

  body: { paddingHorizontal: 24, paddingTop: 28, paddingBottom: 40 },
  title: { fontSize: 27, fontWeight: '700', color: c.ink },
  subtitle: { marginTop: 6, fontSize: 14, color: c.muted },

  error: {
    marginTop: 16,
    backgroundColor: c.dangerBg,
    borderRadius: theme.radius.sm,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  errorText: { color: c.danger, fontSize: 13, fontWeight: '500' },

  label: { marginTop: 20, marginBottom: 7, fontSize: 13, fontWeight: '600', color: c.ink },
  input: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 15,
    color: c.ink,
    backgroundColor: c.surface,
  },
  passwordRow: { justifyContent: 'center' },
  passwordInput: { paddingRight: 62 },
  reveal: { position: 'absolute', right: 14 },
  revealText: { color: c.primary, fontSize: 13, fontWeight: '600' },

  metaRow: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkbox: {
    width: 19,
    height: 19,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: c.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: c.primary, borderColor: c.primary },
  checkMark: { color: '#fff', fontSize: 12, fontWeight: '700' },
  metaText: { fontSize: 13, color: c.muted },
  link: { color: c.primary, fontSize: 13, fontWeight: '600' },

  button: {
    marginTop: 26,
    backgroundColor: c.primary,
    borderRadius: theme.radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: c.primary,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  buttonDisabled: { opacity: 0.45 },
  buttonPressed: { opacity: 0.9 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  footer: { marginTop: 22, textAlign: 'center', fontSize: 13, color: c.muted },
})
