"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { useAudioPlayer } from "@/hooks/use-audio-player"
import { playerApi, describeApiError, terminalError, retryDelay, POLL_MS, type Ack, type Command, type CreatedSession } from "@/lib/player-api"

type AudioPlayer = ReturnType<typeof useAudioPlayer>
type SessionStatus = "idle" | "creating" | "syncing" | "connected" | "retrying" | "ended"
interface HostSession extends CreatedSession {
  url: string
}
interface ExecutionProgress {
  sessionId: string
  handledSeq: number
  ack: Ack | null
  operation: Promise<Ack> | null
}

async function execute(player: AudioPlayer, command: Command): Promise<Ack> {
  let ok = false
  const controller = new AbortController()
  const remaining = command.expiresAt * 1000 - Date.now()
  if (remaining <= 0) return { seq: command.seq, status: "failed", error: "Command expired before execution." }
  // Bound remote audio.play() waits, so sync cannot stall indefinitely.
  const timeout = setTimeout(() => controller.abort(), Math.min(10_000, remaining))
  try {
    if (command.type === "play") ok = await player.play(controller.signal)
    else if (command.type === "pause") ok = player.pause()
    else if (command.type === "next") ok = await player.next(controller.signal)
    else if (command.type === "seek") ok = player.seek(command.positionMs / 1000, command.trackId)
  } catch {
    ok = false
  } finally {
    clearTimeout(timeout)
  }
  return {
    seq: command.seq,
    status: ok ? "applied" : "failed",
    error: ok ? null : player.getPlaybackState().error ?? "Operation failed: no track, track changed, or audio is not ready. Press Play on the laptop if playback is blocked.",
  }
}

export function usePlayerSession(player: AudioPlayer) {
  const latest = useRef(player)
  latest.current = player
  const [session, setSession] = useState<HostSession | null>(null)
  const [status, setStatus] = useState<SessionStatus>("idle")
  const [error, setError] = useState<string | null>(null)
  const creating = useRef(false)
  const createController = useRef<AbortController | null>(null)
  const execution = useRef<ExecutionProgress>({ sessionId: "", handledSeq: 0, ack: null, operation: null })

  useEffect(() => () => { createController.current?.abort() }, [])

  const create = useCallback(async () => {
    if (creating.current || (session && status !== "ended")) return
    creating.current = true
    const controller = new AbortController()
    createController.current = controller
    setStatus("creating")
    setError(null)
    try {
      const created = await playerApi.create(controller.signal)
      if (controller.signal.aborted) return
      execution.current = { sessionId: created.sessionId, handledSeq: 0, ack: null, operation: null }
      setSession({
        ...created,
        url: `${window.location.origin}/remote/${created.sessionId}#token=${encodeURIComponent(created.remoteToken)}`,
      })
      setStatus("syncing")
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(describeApiError(failure))
        setStatus(session ? "ended" : "idle")
      }
    } finally {
      creating.current = false
    }
  }, [session, status])

  useEffect(() => {
    if (!session) return
    const progress = execution.current
    if (progress.sessionId !== session.sessionId) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let failures = 0
    const controller = new AbortController()

    const tick = async () => {
      if (disposed) return
      if (Date.now() >= session.expiresAt * 1000) {
        setStatus("ended")
        setError("Сессия истекла. Создайте новый пульт.")
        return
      }
      let delay = POLL_MS
      try {
        // A Strict Mode effect restart can join an already executing operation.
        if (progress.operation) {
          const ack = await progress.operation
          if (disposed) return
          progress.ack = ack
          progress.operation = null
        }
        const sentAck = progress.ack
        const result = await playerApi.sync(session.sessionId, session.hostToken, latest.current.getPlaybackState(), sentAck, controller.signal)
        if (disposed) return
        failures = 0
        setStatus("connected")
        setError(null)
        if (sentAck && (!result.command || result.command.seq !== sentAck.seq)) {
          progress.ack = null
        }
        const command = result.command
        if (command && command.expiresAt * 1000 > Date.now()) {
          if (command.seq > progress.handledSeq) {
            // Mark before execution. Retries send its saved ACK, never run Next again.
            progress.handledSeq = command.seq
            progress.operation = execute(latest.current, command)
            const ack = await progress.operation
            // Keep the result even if this effect was cleaned up during audio.play().
            progress.ack = ack
            progress.operation = null
            if (disposed) return
            delay = 0 // Immediate ACK, on the same sequential loop.
          } else if (progress.ack?.seq === command.seq) {
            delay = POLL_MS
          }
        }
      } catch (failure) {
        if (disposed) return
        setError(describeApiError(failure))
        if (terminalError(failure)) {
          setStatus("ended")
          return
        }
        setStatus("retrying")
        delay = retryDelay(++failures)
      }
      if (!disposed) timer = setTimeout(() => { void tick() }, delay)
    }
    void tick()
    return () => {
      disposed = true
      clearTimeout(timer)
      controller.abort()
    }
  }, [session])

  return { create, status, error, remoteUrl: session?.url ?? "", canCreate: status === "idle" || status === "ended" }
}
