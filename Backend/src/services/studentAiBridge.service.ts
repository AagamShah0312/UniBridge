import { env } from "../config/env.js";

type DjangoResponse<T> = {
  success: boolean;
  message: string;
  data: T;
  error?: { code?: string; details?: string };
};

function baseUrl() {
  return (env.DJANGO_AI_BASE_URL ?? (process.env.NODE_ENV === "production" ? undefined : "http://127.0.0.1:8000"))?.replace(/\/$/, "");
}

function serviceHeaders(extra?: Record<string, string>) {
  return {
    "Content-Type": "application/json",
    ...(env.DJANGO_AI_SERVICE_TOKEN ? { "X-Service-Token": env.DJANGO_AI_SERVICE_TOKEN } : {}),
    ...(extra ?? {}),
  };
}

async function parseJson<T>(response: Response): Promise<DjangoResponse<T>> {
  const text = await response.text();
  return text ? JSON.parse(text) as DjangoResponse<T> : { success: response.ok, message: "", data: null as T };
}

async function requestStudent<T>(studentId: string, path: string, init?: RequestInit): Promise<T> {
  const root = baseUrl();
  if (!root) throw new Error("DJANGO_AI_BASE_URL is not configured.");
  const response = await fetch(`${root}/api/v1/student-ai/${path.replace(/^\//, "")}`, {
    ...init,
    headers: serviceHeaders({ "X-Student-Id": studentId, ...(init?.headers as Record<string, string> | undefined) }),
  });
  const payload = await parseJson<T>(response);
  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.details || payload.message || `Django AI request failed with ${response.status}.`);
  }
  return payload.data;
}

async function requestInternal<T>(path: string, init?: RequestInit): Promise<T | null> {
  const root = baseUrl();
  if (!root) return null;
  const response = await fetch(`${root}/api/v1/student-ai/internal/${path.replace(/^\//, "")}`, {
    ...init,
    headers: serviceHeaders(init?.headers as Record<string, string> | undefined),
  });
  const payload = await parseJson<T>(response);
  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.details || payload.message || `Django AI internal request failed with ${response.status}.`);
  }
  return payload.data;
}

export const studentAiBridge = {
  isConfigured() {
    return Boolean(baseUrl());
  },

  listChats(studentId: string) {
    return requestStudent<Array<{ chat_id: string; title: string; subject_id: string | null; updated_at: string; message_count: number }>>(studentId, "chats");
  },

  createChat(studentId: string, body: { title?: string; subject_id?: string | null }) {
    return requestStudent<{ chat_id: string; student_id: string; subject_id: string | null; title: string; messages: unknown[]; created_at: string }>(
      studentId,
      "chats",
      { method: "POST", body: JSON.stringify(body) },
    );
  },

  getChat(studentId: string, chatId: string) {
    return requestStudent<{ chat_id: string; title: string; subject_id: string | null; messages: Array<{ role: string; content: string }> }>(
      studentId,
      `chats/${chatId}`,
    );
  },

  sendChatMessage(studentId: string, chatId: string, message: string) {
    return requestStudent<{ chat_id: string; reply: string; sources: Array<Record<string, unknown>>; history_saved: boolean }>(
      studentId,
      `chats/${chatId}/messages`,
      { method: "POST", body: JSON.stringify({ message }) },
    );
  },

  deleteChat(studentId: string, chatId: string) {
    return requestStudent<{ chat_id: string }>(studentId, `chats/${chatId}`, { method: "DELETE" });
  },

  getStudentMarksPrediction(studentId: string) {
    return requestStudent<Record<string, unknown>>(studentId, "students/me/marks/prediction");
  },

  triggerNoteProcessing(noteId: string, sourceUrl?: string) {
    return requestInternal<{ note_id: string; status: string; job_id?: string }>(`notes/${noteId}/process`, {
      method: "POST",
      body: JSON.stringify(sourceUrl ? { source_url: sourceUrl } : {}),
    });
  },

  triggerPyqProcessing(pyqId: string) {
    return requestInternal<{ pyq_id: string; status: string; job_id?: string }>(`pyqs/${pyqId}/process`, { method: "POST" });
  },
};
