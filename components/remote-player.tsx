"use client"

import { useRef, useState } from "react"
import { Pause, Play, SkipForward } from "lucide-react"
import { useRemoteSession } from "@/hooks/use-remote-session"

interface Gesture { trackId: string; positionMs: number; durationMs: number }
const seekKeys = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"])
const buttonClass = "rounded-full bg-gray-200 p-5 shadow-inner outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-40"

function time(ms: number) {
  const seconds = Math.floor(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

export default function RemotePlayer({ sessionId }: { sessionId: string }) {
  const remote = useRemoteSession(sessionId)
  const [draft, setDraft] = useState<Gesture | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const state = remote.snapshot?.state
  const beginSeek = () => {
    if (gesture.current || !remote.canSend || !state?.trackId) return
    gesture.current = { trackId: state.trackId, positionMs: state.positionMs, durationMs: state.durationMs }
    setDraft(gesture.current)
  }
  const finishSeek = () => {
    const value = gesture.current
    gesture.current = null
    setDraft(null)
    if (value) remote.send({ type: "seek", trackId: value.trackId, positionMs: value.positionMs })
  }
  const cancelSeek = () => {
    gesture.current = null
    setDraft(null)
  }
  const command = remote.outbox?.phase ?? remote.snapshot?.command?.status
  const commandText = command ? {
    queued: "В очереди отправки", sending: "Отправляется", unknown: "Результат отправки неизвестен",
    retry: "Команда не найдена — можно повторить", pending: "Принята, ожидает плеера",
    applied: "Выполнено плеером", failed: "Не выполнено", expired: "Срок команды истёк", conflict: "Конфликт команды",
  }[command] : "Команд пока нет"
  const playbackText = state ? { idle: "Нет трека", paused: "Пауза", playing: "Воспроизводится", error: "Ошибка воспроизведения" }[state.status] : "Загрузка состояния…"

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
      <div className="w-full max-w-[400px] space-y-5 rounded-[30px] border-2 border-gray-300 bg-gradient-to-b from-gray-100 to-gray-200 p-5 shadow-xl">
        <h1 className="text-center font-semibold">Пульт Audio Player</h1>
        {remote.fatal ? (
          <p role="alert" className="rounded-lg bg-white p-4 text-sm text-red-700">{remote.fatal}</p>
        ) : (
          <>
            <div className="space-y-3 rounded-md bg-gray-800 p-4 text-white shadow-inner">
              <p role="status" className="text-xs text-gray-300">
                {!remote.connected ? "Нет свежего состояния — подключение…" : remote.snapshot?.online ? "Плеер online" : "Плеер offline"}
              </p>
              <h2 className="break-words text-center font-bold">{state?.title || "Добавьте музыку на ноутбуке"}</h2>
              <p className="text-center text-sm">{playbackText}</p>
              <input
                type="range"
                aria-label="Позиция трека"
                min={0}
                max={draft?.durationMs ?? state?.durationMs ?? 0}
                step={1}
                value={draft?.positionMs ?? state?.positionMs ?? 0}
                disabled={!remote.canSend || !state?.durationMs}
                className="w-full touch-none accent-blue-500 disabled:opacity-40"
                onPointerDown={(event) => {
                  beginSeek()
                  event.currentTarget.setPointerCapture(event.pointerId)
                }}
                onChange={(event) => {
                  beginSeek()
                  if (gesture.current) {
                    gesture.current = { ...gesture.current, positionMs: Math.round(event.currentTarget.valueAsNumber) }
                    setDraft(gesture.current)
                  }
                }}
                onPointerUp={finishSeek}
                onPointerCancel={cancelSeek}
                onKeyDown={(event) => { if (seekKeys.has(event.key)) beginSeek() }}
                onKeyUp={(event) => { if (seekKeys.has(event.key)) finishSeek() }}
                onBlur={finishSeek}
              />
              <div className="flex justify-between text-xs">
                <span>{time(draft?.positionMs ?? state?.positionMs ?? 0)}</span>
                <span>{time(draft?.durationMs ?? state?.durationMs ?? 0)}</span>
              </div>
              {state?.error && <p role="alert" className="break-words text-xs text-red-300">{state.error}</p>}
            </div>
            <div className="flex justify-center gap-6">
              <button
                type="button"
                aria-label={state?.status === "playing" ? "Pause" : "Play"}
                disabled={!remote.canSend}
                className={buttonClass}
                onClick={() => remote.send({ type: state?.status === "playing" ? "pause" : "play" })}
              >
                {state?.status === "playing" ? <Pause /> : <Play />}
              </button>
              <button type="button" aria-label="Next track" disabled={!remote.canSend} className={buttonClass} onClick={() => remote.send({ type: "next" })}>
                <SkipForward />
              </button>
            </div>
            <div role="status" className="space-y-2 text-sm">
              <p>{commandText}{remote.outbox ? ` · seq ${remote.outbox.payload.seq}` : ""}</p>
              {(remote.outbox?.error || remote.snapshot?.command?.error) && <p className="text-red-700">{remote.outbox?.error ?? remote.snapshot?.command?.error}</p>}
              {remote.outbox?.phase === "retry" && (
                <button type="button" disabled={!remote.canRetry} onClick={remote.retry} className="rounded bg-blue-500 px-3 py-2 text-white disabled:opacity-40">
                  Повторить ту же команду
                </button>
              )}
              {remote.error && <p role="alert" className="text-red-700">{remote.error}</p>}
            </div>
          </>
        )}
        {remote.storageWarning && <p className="text-xs text-amber-800">{remote.storageWarning}</p>}
        <p className="text-xs text-gray-600">Состояние обновляется раз в 5 секунд, пока эта страница видима. Музыка звучит на ноутбуке.</p>
      </div>
    </main>
  )
}
