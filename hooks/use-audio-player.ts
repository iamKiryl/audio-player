"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export interface Track {
  id: string
  title: string
  artist: string
  duration: number
  file: File
}

// What the audio element is actually doing, as reported by its events.
export type PlaybackStatus = "idle" | "paused" | "playing" | "error"

const METADATA_TIMEOUT_MS = 15_000

function readDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = new Audio()
    const finish = (error?: Error) => {
      clearTimeout(timer)
      const duration = probe.duration
      probe.onloadedmetadata = null
      probe.onerror = null
      probe.removeAttribute("src")
      probe.load()
      if (error) reject(error)
      else resolve(duration)
    }
    const timer = setTimeout(() => finish(new Error("Metadata timeout")), METADATA_TIMEOUT_MS)
    probe.preload = "metadata"
    probe.onloadedmetadata = () => finish()
    probe.onerror = () => finish(new Error("Unreadable audio file"))
    probe.src = url
  })
}

function describePlayError(error: unknown) {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Playback blocked by the browser. Press Play."
  }
  if (error instanceof DOMException && error.name === "NotSupportedError") {
    return "This file can't be played."
  }
  return "Playback failed."
}

export function useAudioPlayer() {
  const [tracks, setTracks] = useState<Track[]>([])
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null)
  const [status, setStatus] = useState<PlaybackStatus>("idle")
  const [error, setError] = useState<string | null>(null)
  const [volume, setVolumeState] = useState(70)
  const [currentTime, setCurrentTime] = useState(0)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  // Refs mirror state so audio event handlers always see the latest values.
  const tracksRef = useRef<Track[]>([])
  const currentIdRef = useRef<string | null>(null)
  const volumeRef = useRef(70)
  // Whether the user wants sound; survives track changes, cleared by pause/stop/errors.
  const wantsToPlayRef = useRef(false)
  // One object URL per track, released when the player closes.
  const urlsRef = useRef(new Map<string, string>())
  const nextIdRef = useRef(1)
  const importQueueRef = useRef<Promise<void>>(Promise.resolve())

  const urlFor = useCallback((track: Track) => {
    let url = urlsRef.current.get(track.id)
    if (!url) {
      url = URL.createObjectURL(track.file)
      urlsRef.current.set(track.id, url)
    }
    return url
  }, [])

  const play = useCallback(async () => {
    const audio = audioRef.current
    if (!audio || !currentIdRef.current) return false

    wantsToPlayRef.current = true
    setError(null)
    try {
      await audio.play()
      return true
    } catch (err) {
      // A newer pause() or track change interrupted this request; that action owns the state.
      if (err instanceof DOMException && err.name === "AbortError") return false
      wantsToPlayRef.current = false
      setStatus(audio.error ? "error" : "paused")
      setError(describePlayError(err))
      return false
    }
  }, [])

  const pause = useCallback(() => {
    wantsToPlayRef.current = false
    audioRef.current?.pause()
  }, [])

  const togglePlay = useCallback(() => {
    if (audioRef.current && !audioRef.current.paused) pause()
    else void play()
  }, [play, pause])

  const loadTrack = useCallback(
    (track: Track, autoplay: boolean) => {
      const audio = audioRef.current
      if (!audio) return

      currentIdRef.current = track.id
      setCurrentTrackId(track.id)
      setCurrentTime(0)
      setError(null)
      audio.src = urlFor(track)

      if (autoplay) {
        void play()
      } else {
        wantsToPlayRef.current = false
        setStatus("paused")
      }
    },
    [play, urlFor],
  )

  const stepTrack = useCallback(
    (offset: number) => {
      const list = tracksRef.current
      if (list.length === 0) return
      const index = list.findIndex((track) => track.id === currentIdRef.current)
      const nextIndex = (Math.max(index, 0) + offset + list.length) % list.length
      loadTrack(list[nextIndex], wantsToPlayRef.current)
    },
    [loadTrack],
  )

  const next = useCallback(() => stepTrack(1), [stepTrack])
  const previous = useCallback(() => stepTrack(-1), [stepTrack])

  const selectTrack = useCallback(
    (trackId: string) => {
      const track = tracksRef.current.find((item) => item.id === trackId)
      if (track) loadTrack(track, wantsToPlayRef.current)
    },
    [loadTrack],
  )

  const setVolume = useCallback((value: number) => {
    const clamped = Math.round(Math.min(100, Math.max(0, value)))
    volumeRef.current = clamped
    setVolumeState(clamped)
    if (audioRef.current) audioRef.current.volume = clamped / 100
  }, [])

  const changeVolume = useCallback(
    (delta: number) => setVolume(volumeRef.current + delta),
    [setVolume],
  )

  const addFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return Promise.resolve()

      // Batches are imported one after another, and each batch keeps the order the files were picked in.
      const batch = importQueueRef.current.then(async () => {
        const results = await Promise.all(
          files.map(async (file) => {
            const id = `track-${nextIdRef.current++}`
            const url = URL.createObjectURL(file)
            try {
              const duration = await readDuration(url)
              return { ok: true as const, track: { id, title: file.name, artist: "Unknown", duration, file }, url }
            } catch {
              URL.revokeObjectURL(url)
              return { ok: false as const, name: file.name }
            }
          }),
        )

        const added: Track[] = []
        const failed: string[] = []
        for (const result of results) {
          if (!result.ok) {
            failed.push(result.name)
          } else if (!audioRef.current) {
            // The player closed while metadata was loading.
            URL.revokeObjectURL(result.url)
          } else {
            urlsRef.current.set(result.track.id, result.url)
            added.push(result.track)
          }
        }

        if (added.length > 0) {
          tracksRef.current = [...tracksRef.current, ...added]
          setTracks(tracksRef.current)
          if (!currentIdRef.current) loadTrack(added[0], false)
        }
        if (failed.length > 0) {
          setError(`Couldn't read: ${failed.join(", ")}`)
        }
      })

      importQueueRef.current = batch.catch(() => undefined)
      return batch
    },
    [loadTrack],
  )

  useEffect(() => {
    const audio = new Audio()
    audio.preload = "auto"
    audio.volume = volumeRef.current / 100
    audioRef.current = audio
    const urls = urlsRef.current

    const handlePlaying = () => {
      setStatus("playing")
      setError(null)
    }
    const handlePause = () => {
      setStatus((prev) => (prev === "error" ? prev : "paused"))
    }
    const handleTimeUpdate = () => setCurrentTime(audio.currentTime)
    const handleError = () => {
      if (!audio.getAttribute("src")) return
      wantsToPlayRef.current = false
      setStatus("error")
      setError("This file can't be played.")
    }
    // Play the queue in order and stop after the last track.
    const handleEnded = () => {
      const list = tracksRef.current
      const index = list.findIndex((track) => track.id === currentIdRef.current)
      if (index >= 0 && index < list.length - 1) {
        loadTrack(list[index + 1], true)
      } else {
        wantsToPlayRef.current = false
        audio.currentTime = 0
        setCurrentTime(0)
        setStatus("paused")
      }
    }

    audio.addEventListener("playing", handlePlaying)
    audio.addEventListener("pause", handlePause)
    audio.addEventListener("timeupdate", handleTimeUpdate)
    audio.addEventListener("error", handleError)
    audio.addEventListener("ended", handleEnded)

    // Re-attach the current track after a remount (Strict Mode, Fast Refresh).
    const current = tracksRef.current.find((track) => track.id === currentIdRef.current)
    if (current) {
      audio.src = urlFor(current)
      wantsToPlayRef.current = false
      setStatus("paused")
    }

    return () => {
      audio.removeEventListener("playing", handlePlaying)
      audio.removeEventListener("pause", handlePause)
      audio.removeEventListener("timeupdate", handleTimeUpdate)
      audio.removeEventListener("error", handleError)
      audio.removeEventListener("ended", handleEnded)
      audio.pause()
      audio.removeAttribute("src")
      audio.load()
      audioRef.current = null
      urls.forEach((url) => URL.revokeObjectURL(url))
      urls.clear()
    }
  }, [loadTrack, urlFor])

  const currentTrack = tracks.find((track) => track.id === currentTrackId) ?? null

  return {
    tracks,
    currentTrack,
    status,
    isPlaying: status === "playing",
    error,
    volume,
    currentTime,
    addFiles,
    play,
    pause,
    togglePlay,
    next,
    previous,
    selectTrack,
    setVolume,
    changeVolume,
  }
}
