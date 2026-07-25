import { Platform } from 'react-native'

/**
 * Where the UniBridge backend lives, per platform:
 *  - iOS simulator shares the Mac's network, so localhost works.
 *  - Android emulator reaches the host through the 10.0.2.2 alias.
 *  - A physical device needs the Mac's LAN IP — set EXPO_PUBLIC_API_URL to override.
 */
export const API_BASE =
  process.env.EXPO_PUBLIC_API_URL ??
  Platform.select({
    android: 'http://10.0.2.2:4000/api/v1',
    default: 'http://localhost:4000/api/v1',
  })!

export interface AuthUser {
  id: string
  name: string
  email: string
  role: string
  isHod: boolean
  universityId: string
  employeeId?: string | null
  year?: string | null
}

export interface LoginResponse {
  accessToken: string
  refreshToken: string
  expiresIn: number
  user: AuthUser
}

/** Backend errors come back as { error: { code, message } }. */
async function parse<T>(res: Response): Promise<T> {
  const text = await res.text()
  const body = text ? JSON.parse(text) : {}
  if (!res.ok) {
    throw new Error(body?.error?.message ?? `Request failed (${res.status})`)
  }
  return body as T
}

/** HOD sign-in. The backend maps role -> account lookup, so 'HOD' is required here. */
export async function loginHod(email: string, password: string): Promise<LoginResponse> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), password, role: 'HOD' }),
  })
  const data = await parse<LoginResponse>(res)
  if (!data.user?.isHod) {
    throw new Error('This account is not a HOD account.')
  }
  return data
}

/** HOD scope — proves the token works and gives the dashboard its header numbers. */
export async function fetchHodScope(accessToken: string) {
  const res = await fetch(`${API_BASE}/hod/my-scope`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  return parse<{
    hod: { name: string; year: string | null; employeeId: string | null; sectionTag: string | null }
    activeSemester: { label: string; number: number }
    batches: { id: string; code: string; studentCount: number }[]
    totalStudents: number
    totalFaculty: number
  }>(res)
}
