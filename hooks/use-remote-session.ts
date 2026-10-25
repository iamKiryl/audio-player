"use client"

import { useEffect, useRef, useState } from "react"
import { ApiError, describeApiError, playerApi, POLL_MS, retryDelay, terminalError, type Command, type CommandDraft, type CommandInput, type RemoteSnapshot } from "@/lib/player-api"

type Phase = "queued" | "sending" | "unknown" | "retry" | "pending" | "applied" | "failed" | "expired" | "conflict"
interface Outbox { payload: CommandInput; phase: Phase; error: string | null }
interface Actions { send: (draft: CommandDraft) => void; retry: () => void }
const locked = (outbox: Outbox | null) => outbox !== null && ["queued", "sending", "unknown", "retry", "pending"].includes(outbox.phase)

function sameCommand(payload: CommandInput, command: Command) {
  return payload.seq === command.seq && payload.type === command.type &&
    (payload.type !== "seek" || (command.type === "seek" && payload.trackId === command.trackId && payload.positionMs === command.positionMs))
}

export function useRemoteSession(sessionId: string) {
  const [snapshot, setSnapshot] = useState<RemoteSnapshot | null>(null)
  const [outbox, setOutbox] = useState<Outbox | null>(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [storageWarning, setStorageWarning] = useState<string | null>(null)
  const actions = useRef<Actions | null>(null)
  // Keep a memory fallback across effect restarts when sessionStorage is blocked.
  const credentials = useRef<{ sessionId: string; token: string } | null>(null)

  useEffect(() => {
    setSnapshot(null)
    setOutbox(null)
    setConnected(false)
    setError(null)
    setFatal(null)
    setStorageWarning(null)
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(sessionId)) {
      setFatal("Неверный адрес сессии. Откройте ссылку с ноутбука.")
      return
    }
    const storageKey = `audio-player:remote:${sessionId}`
    const fragmentToken = new URLSearchParams(window.location.hash.slice(1)).get("token")
    let token = fragmentToken ?? (credentials.current?.sessionId === sessionId ? credentials.current.token : null)
    try {
      if (fragmentToken !== null) sessionStorage.setItem(storageKey, fragmentToken)
      else if (token === null) token = sessionStorage.getItem(storageKey)
    } catch {
      setStorageWarning("Хранилище вкладки недоступно. После обновления откройте исходную ссылку заново.")
    }
    if (token !== null) credentials.current = { sessionId, token }
    // Fragments never go to the server; remove this one from the visible URL/history too.
    if (window.location.hash) window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search)
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      setFatal("Нет действительного токена. Откройте полную ссылку пульта с ноутбука.")
      return
    }
    const remoteToken = token
    let disposed = false
    let stopped = false
    let busy = false
    let mustRead = true
    let wakeRequested = false
    let failures = 0
    let current: RemoteSnapshot | null = null
    let outgoing: Outbox | null = null
    let isConnected = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | null = null

    const publishOutbox = (value: Outbox | null) => {
      outgoing = value
      setOutbox(value)
    }
    const connect = (value: boolean) => {
      isConnected = value
      setConnected(value)
    }
    const canOperate = () => !disposed && !stopped && document.visibilityState === "visible" && isConnected && current?.online === true && current.expiresAt * 1000 > Date.now()
    const schedule = (delay: number) => {
      clearTimeout(timer)
      if (!disposed && !stopped && document.visibilityState === "visible") timer = setTimeout(() => { void tick() }, delay)
    }
    const wake = () => {
      if (busy) wakeRequested = true
      else schedule(0)
    }
    const reconcile = (value: RemoteSnapshot) => {
      if (!outgoing) return
      if (value.commandSeq === outgoing.payload.seq && value.command) {
        if (sameCommand(outgoing.payload, value.command)) {
          publishOutbox({ ...outgoing, phase: value.command.status, error: value.command.error })
        } else {
          publishOutbox({ ...outgoing, phase: "conflict", error: "Этот seq уже занят другой командой. Состояние обновлено." })
        }
      } else if (value.commandSeq > outgoing.payload.seq) {
        publishOutbox({ ...outgoing, phase: "conflict", error: "Появилась более новая команда; результат предыдущей уже недоступен." })
      } else if (value.commandSeq < outgoing.payload.seq && outgoing.phase !== "queued") {
        publishOutbox({ ...outgoing, phase: "retry", error: "GET не обнаружил команду. Можно повторить тот же seq и payload." })
      }
    }

    async function tick() {
      if (disposed || stopped || busy || document.visibilityState !== "visible") return
      if (current && Date.now() >= current.expiresAt * 1000) {
        stopped = true
        connect(false)
        setFatal("Сессия истекла. Создайте новый пульт на ноутбуке.")
        return
      }
      busy = true
      wakeRequested = false
      controller = new AbortController()
      const requestController = controller
      const posting = outgoing?.phase === "queued" && !mustRead
      let delay = POLL_MS
      try {
        if (posting && outgoing) {
          if (!canOperate() || current?.command?.status === "pending") {
            publishOutbox({ ...outgoing, phase: "retry", error: "Плеер offline или занят. Повтор будет доступен после обновления состояния." })
            mustRead = true
            return
          }
          const payload = outgoing.payload
          publishOutbox({ ...outgoing, phase: "sending", error: null })
          const result = await playerApi.command(sessionId, remoteToken, payload, requestController.signal)
          if (disposed || requestController.signal.aborted) return
          // POST carries no playback state. Only GET can refresh the actual track/status.
          if (!current || result.commandSeq >= current.commandSeq) {
            if (current) current = { ...current, commandSeq: result.commandSeq, command: result.command }
            publishOutbox({ payload, phase: result.command.status, error: result.command.error })
          }
          mustRead = true
          connect(false)
        } else {
          const result = await playerApi.get(sessionId, remoteToken, requestController.signal)
          if (disposed || requestController.signal.aborted) return
          // Each request is sequential; additionally reject any sequence regression.
          if (!current || result.commandSeq >= current.commandSeq) {
            current = result
            setSnapshot(result)
            reconcile(result)
          }
          mustRead = false
          connect(true)
          if (outgoing?.phase === "queued") delay = 0
        }
        failures = 0
        setError(null)
      } catch (failure) {
        if (disposed) return
        connect(false)
        mustRead = true
        // A lost/aborted POST might have been accepted. Never send a replacement Next.
        if (posting && outgoing) publishOutbox({ ...outgoing, phase: "unknown", error: "Результат отправки неизвестен. Сначала выясняем состояние через GET." })
        if (terminalError(failure)) {
          stopped = true
          setFatal(describeApiError(failure))
          return
        }
        if (!requestController.signal.aborted) setError(describeApiError(failure))
        delay = failure instanceof ApiError && failure.status === 409 ? 0 : retryDelay(++failures)
      } finally {
        busy = false
        controller = null
        if (!disposed && !stopped) schedule(wakeRequested ? 0 : delay)
      }
    }

    const runtime: Actions = {
      send(draft) {
        if (!canOperate() || !current || locked(outgoing) || current.command?.status === "pending" || !current.state.trackId || current.commandSeq >= Number.MAX_SAFE_INTEGER) return
        publishOutbox({ payload: { ...draft, seq: current.commandSeq + 1 }, phase: "queued", error: null })
        wake()
      },
      retry() {
        if (!canOperate() || outgoing?.phase !== "retry" || current?.command?.status === "pending") return
        publishOutbox({ ...outgoing, phase: "queued", error: null })
        wake()
      },
    }
    actions.current = runtime
    const visibility = () => {
      mustRead = true
      connect(false)
      clearTimeout(timer)
      if (document.visibilityState === "visible") wake()
      else controller?.abort()
    }
    document.addEventListener("visibilitychange", visibility)
    wake()
    return () => {
      disposed = true
      clearTimeout(timer)
      controller?.abort()
      document.removeEventListener("visibilitychange", visibility)
      if (actions.current === runtime) actions.current = null
    }
  }, [sessionId])

  const canSend = connected && snapshot?.online === true && !!snapshot.state.trackId && !fatal && !locked(outbox) && snapshot.command?.status !== "pending" && snapshot.commandSeq < Number.MAX_SAFE_INTEGER
  return {
    snapshot, outbox, error, fatal, storageWarning, connected, canSend,
    canRetry: connected && snapshot?.online === true && outbox?.phase === "retry" && snapshot.command?.status !== "pending" && !fatal,
    send: (draft: CommandDraft) => actions.current?.send(draft),
    retry: () => actions.current?.retry(),
  }
}
