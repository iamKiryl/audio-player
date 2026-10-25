export const POLL_MS = 5_000
export const MAX_POSITION_MS = 604_800_000

export interface PlayerState {
  trackId: string | null
  title: string
  status: "idle" | "paused" | "playing" | "error"
  positionMs: number
  durationMs: number
  error: string | null
}

export type CommandDraft =
  | { type: "play" | "pause" | "next" }
  | { type: "seek"; trackId: string; positionMs: number }

export type CommandInput = CommandDraft & { seq: number }

export type Command = CommandInput & {
  status: "pending" | "applied" | "failed" | "expired"
  expiresAt: number
  error: string | null
}

export interface Ack {
  seq: number
  status: "applied" | "failed"
  error: string | null
}

export interface CreatedSession {
  sessionId: string
  hostToken: string
  remoteToken: string
  expiresAt: number
}

export interface RemoteSnapshot {
  sessionId: string
  expiresAt: number
  online: boolean
  state: PlayerState
  commandSeq: number
  command: Command | null
}

export interface CommandResponse {
  commandSeq: number
  command: Command
}

export interface SyncResponse {
  expiresAt: number
  command: Command | null
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
    this.name = "ApiError"
  }
}

export function terminalError(error: unknown) {
  return error instanceof ApiError && [400, 401, 403, 404, 410].includes(error.status)
}

export function describeApiError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 410) return "Сессия истекла. Создайте новый пульт на ноутбуке."
    if (error.status === 401 || error.status === 403) return "Неверный токен или роль. Откройте ссылку пульта с ноутбука."
    if (error.status === 404) return "Сессия не найдена. Создайте новый пульт на ноутбуке."
    if (error.status === 429) return "Слишком много запросов. Повторим с задержкой."
    return error.message
  }
  return "Нет связи с API. Проверьте сеть и настройку API/CORS."
}

export function retryDelay(failures: number) {
  return Math.min(30_000, POLL_MS * 2 ** Math.min(failures, 3)) + Math.floor(Math.random() * 500)
}

async function request<T>(path: string, method: "GET" | "POST", token: string | null, body: unknown, signal: AbortSignal): Promise<T> {
  const base = process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/+$/, "")
  if (!base) throw new ApiError(400, "missing_api_url", "Задайте NEXT_PUBLIC_API_URL и перезапустите frontend.")
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal.addEventListener("abort", abort, { once: true })
  if (signal.aborted) controller.abort()
  const timeout = setTimeout(abort, 15_000)
  try {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
      body: method === "POST" ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    })
    // Gateway throttling and integration failures need not have the Lambda error shape.
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      throw new ApiError(response.status, payload?.error?.code ?? "http_error", payload?.error?.message ?? "Ошибка API. Повторите позже.")
    }
    if (!payload || typeof payload !== "object") throw new Error("Invalid API response")
    return payload as T
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener("abort", abort)
  }
}

const sessionPath = (id: string) => `/sessions/${encodeURIComponent(id)}`

export const playerApi = {
  create: (signal: AbortSignal) => request<CreatedSession>("/sessions", "POST", null, {}, signal),
  get: (id: string, token: string, signal: AbortSignal) => request<RemoteSnapshot>(sessionPath(id), "GET", token, undefined, signal),
  command: (id: string, token: string, command: CommandInput, signal: AbortSignal) => request<CommandResponse>(`${sessionPath(id)}/commands`, "POST", token, command, signal),
  sync: (id: string, token: string, state: PlayerState, ack: Ack | null, signal: AbortSignal) => request<SyncResponse>(`${sessionPath(id)}/sync`, "POST", token, { state, ...(ack ? { ack } : {}) }, signal),
}
