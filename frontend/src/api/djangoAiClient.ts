import axios, { AxiosError } from 'axios'
import { env } from '@/config/env'
import { useAuthStore } from '@/stores/authStore'
import type { ApiError } from '@/types/common'

type DjangoResponse<T> = {
  success: boolean
  message?: string
  data: T
  error?: { code?: string; details?: string }
}

export const djangoAiApi = axios.create({
  baseURL: env.DJANGO_AI_URL.replace(/\/$/, ''),
  headers: { 'Content-Type': 'application/json' },
  timeout: 60_000,
})

djangoAiApi.interceptors.request.use((config) => {
  const user = useAuthStore.getState().user
  if (user?.role === 'STUDENT' && user.id) {
    config.headers['X-Student-Id'] = user.id
  }
  return config
})

export async function djangoAiGet<T>(path: string): Promise<T> {
  try {
    const response = await djangoAiApi.get<DjangoResponse<T>>(path)
    return unwrapDjangoResponse(response.data)
  } catch (err) {
    throw new Error(djangoAiErrorMessage(err))
  }
}

export async function djangoAiPost<T>(path: string, body?: unknown): Promise<T> {
  try {
    const response = await djangoAiApi.post<DjangoResponse<T>>(path, body)
    return unwrapDjangoResponse(response.data)
  } catch (err) {
    throw new Error(djangoAiErrorMessage(err))
  }
}

export async function djangoAiDelete<T>(path: string): Promise<T> {
  try {
    const response = await djangoAiApi.delete<DjangoResponse<T>>(path)
    return unwrapDjangoResponse(response.data)
  } catch (err) {
    throw new Error(djangoAiErrorMessage(err))
  }
}

function unwrapDjangoResponse<T>(payload: DjangoResponse<T>): T {
  if (!payload.success) {
    throw new Error(payload.error?.details || payload.message || 'Django AI request failed')
  }
  return payload.data
}

export function djangoAiErrorMessage(err: unknown, fallback = 'AI request failed'): string {
  const ax = err as AxiosError<DjangoResponse<unknown> | ApiError | string>
  const data = ax?.response?.data
  if (data && typeof data === 'object' && 'error' in data) {
    const error = data.error as { details?: string; message?: string } | undefined
    return error?.details ?? error?.message ?? fallback
  }
  if (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string') return data.message
  if (typeof data === 'string' && ax?.response?.status && ax.response.status >= 500) {
    return 'The AI service is temporarily unavailable. Please try again.'
  }
  return ax?.message ?? fallback
}
