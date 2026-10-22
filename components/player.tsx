"use client"

import type React from "react"

import { useState, useRef } from "react"
import { Play, Pause, SkipForward, SkipBack, Volume2, Plus } from "lucide-react"
import { useAudioPlayer } from "@/hooks/use-audio-player"

// Degrees of wheel rotation per 1% of volume: one full turn covers the whole range.
const DEGREES_PER_VOLUME_STEP = 3.6
const KEYBOARD_VOLUME_STEP = 5

const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
const wheelButton = `cursor-pointer disabled:cursor-default disabled:opacity-40 rounded-full ${focusRing}`

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--"
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`
}

function AddSongItem({ label, onFiles }: { label: string; onFiles: (files: File[]) => void }) {
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    // Reset so picking the same file again still fires a change event.
    event.target.value = ""
    onFiles(files)
  }

  return (
    <li className="hover:bg-blue-500 focus-within:bg-blue-500 px-2 py-0.5 rounded">
      <label className="flex items-center cursor-pointer">
        {label}
        <Plus className="w-5 h-5 mr-2" />
        <input type="file" accept="audio/*" multiple className="sr-only" onChange={handleChange} />
      </label>
    </li>
  )
}

export default function Player() {
  const {
    tracks,
    currentTrack,
    isPlaying,
    error,
    volume,
    currentTime,
    addFiles,
    togglePlay,
    next,
    previous,
    selectTrack,
    setVolume,
    changeVolume,
  } = useAudioPlayer()
  const [menuActive, setMenuActive] = useState(true)
  const [allSongScreen, setAllSongsScreen] = useState(false)
  const wheelGestureRef = useRef<{ pointerId: number; angle: number; carry: number } | null>(null)

  const duration = currentTrack?.duration ?? 0
  const progress = Number.isFinite(duration) && duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0
  const hasTrack = currentTrack !== null

  const handleAddFiles = (files: File[]) => {
    void addFiles(files)
  }

  const pointerAngle = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    return Math.atan2(e.clientY - centerY, e.clientX - centerX) * (180 / Math.PI)
  }

  // Volume follows the wheel only while it is pressed: clockwise turns it up, counter-clockwise down.
  const handleWheelPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    wheelGestureRef.current = { pointerId: e.pointerId, angle: pointerAngle(e), carry: 0 }
  }

  const handleWheelPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const gesture = wheelGestureRef.current
    if (!gesture || gesture.pointerId !== e.pointerId) return

    const angle = pointerAngle(e)
    let delta = angle - gesture.angle
    if (delta > 180) delta -= 360
    if (delta < -180) delta += 360
    gesture.angle = angle
    gesture.carry += delta / DEGREES_PER_VOLUME_STEP

    const steps = Math.trunc(gesture.carry)
    if (steps !== 0) {
      gesture.carry -= steps
      changeVolume(steps)
    }
  }

  const handleWheelPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (wheelGestureRef.current?.pointerId === e.pointerId) {
      wheelGestureRef.current = null
    }
  }

  const handleWheelKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, () => void> = {
      ArrowUp: () => changeVolume(KEYBOARD_VOLUME_STEP),
      ArrowRight: () => changeVolume(KEYBOARD_VOLUME_STEP),
      ArrowDown: () => changeVolume(-KEYBOARD_VOLUME_STEP),
      ArrowLeft: () => changeVolume(-KEYBOARD_VOLUME_STEP),
      Home: () => setVolume(0),
      End: () => setVolume(100),
    }
    const action = keys[e.key]
    if (action) {
      e.preventDefault()
      action()
    }
  }

  const handleMenuClick = () => {
    setMenuActive(!menuActive)
  }

  const handleNowPlayingClick = () => {
    setMenuActive(false)
    setAllSongsScreen(false)
  }

  const handleAllSongsClick = () => {
    setMenuActive(false)
    setAllSongsScreen(true)
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 p-2 sm:p-4">
      <div className="w-full max-w-[280px] sm:max-w-[320px] md:max-w-[400px] bg-gradient-to-b from-gray-100 to-gray-200 rounded-[30px] shadow-xl overflow-hidden border-2 border-gray-300">

        <div className="bg-white mx-2 sm:mx-4 mt-4 rounded-lg p-3 shadow-inner">
          <div className="bg-gray-800 rounded-md p-3 h-[150px] sm:h-[180px] md:h-[200px] text-white flex flex-col">
            <div className="flex-1 min-h-0">
              {menuActive ? (
                <div className="h-full flex flex-col">
                  <h3 className="text-center font-semibold text-sm mb-2 bg-blue-500 py-1 rounded">Music Menu</h3>
                  <ul className="text-sm space-y-1 overflow-y-auto min-h-0 flex-1">
                    <li>
                      <button
                        type="button"
                        className={`w-full text-left hover:bg-blue-500 focus-visible:bg-blue-500 px-2 py-0.5 rounded cursor-pointer ${focusRing}`}
                        onClick={handleNowPlayingClick}
                      >
                        Now Playing
                      </button>
                    </li>
                    <AddSongItem label="Add new song" onFiles={handleAddFiles} />
                    <li>
                      <button
                        type="button"
                        className={`w-full text-left hover:bg-blue-500 focus-visible:bg-blue-500 px-2 py-0.5 rounded cursor-pointer ${focusRing}`}
                        onClick={handleAllSongsClick}
                      >
                        Songs
                      </button>
                    </li>
                  </ul>
                </div>
              ) : allSongScreen ? (
                <div className="h-full flex flex-col">
                  <ul className="text-sm space-y-1 overflow-y-auto min-h-0 flex-1">
                    {tracks.length > 0 ? (
                      tracks.map((track) => (
                        <li key={track.id}>
                          <button
                            type="button"
                            title={track.title}
                            aria-current={track.id === currentTrack?.id ? "true" : undefined}
                            className={`w-full text-left truncate px-2 py-0.5 rounded cursor-pointer ${focusRing} ${
                              track.id === currentTrack?.id ? "bg-blue-500" : ""
                            }`}
                            onClick={() => selectTrack(track.id)}
                          >
                            {track.title}
                          </button>
                        </li>
                      ))
                    ) : (
                      <AddSongItem label="Add your first song" onFiles={handleAddFiles} />
                    )}
                  </ul>
                </div>
              ) : (
                <div className="h-full flex flex-col">
                  <div className="text-center text-xs mb-2">Now Playing</div>
                  <div className="flex-1 flex flex-col items-center justify-center">
                    <h2 className="font-bold text-center mb-1">{currentTrack ? currentTrack.title : "Add your music"}</h2>
                    <p className="text-sm text-gray-300 text-center">{currentTrack?.artist ?? ""}</p>
                    <div className="w-full mt-4 bg-gray-600 h-1 rounded-full overflow-hidden">
                      <div className="bg-white h-full" style={{ width: `${progress}%` }} />
                    </div>
                    <div className="w-full flex justify-between text-xs mt-1">
                      <span>{formatTime(currentTime)}</span>
                      <span>{currentTrack ? formatTime(duration) : null}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
            {error && (
              <p role="status" className="text-xs text-red-300 truncate mt-1" title={error}>
                {error}
              </p>
            )}
          </div>
        </div>

        <div className="mt-4 mb-6 mx-auto w-[180px] h-[180px] sm:w-[220px] sm:h-[220px] md:w-[260px] md:h-[260px] relative">
          <div
            role="slider"
            tabIndex={0}
            aria-label="Volume"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={volume}
            aria-valuetext={`${volume}%`}
            className={`absolute inset-0 rounded-full bg-gray-200 shadow-inner cursor-pointer touch-none ${focusRing}`}
            onPointerDown={handleWheelPointerDown}
            onPointerMove={handleWheelPointerMove}
            onPointerUp={handleWheelPointerEnd}
            onPointerCancel={handleWheelPointerEnd}
            onKeyDown={handleWheelKeyDown}
          />

          <button
            type="button"
            aria-label={isPlaying ? "Pause" : "Play"}
            disabled={!hasTrack}
            className={`absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[60px] h-[60px] sm:w-[80px] sm:h-[80px] md:w-[90px] md:h-[90px] bg-gray-300 flex items-center justify-center ${wheelButton}`}
            onClick={togglePlay}
          >
            {isPlaying ? <Pause size={24} /> : <Play size={24} />}
          </button>

          <button
            type="button"
            className={`absolute top-[20px] sm:top-[30px] left-1/2 transform -translate-x-1/2 text-sm font-medium px-1 ${wheelButton}`}
            onClick={handleMenuClick}
          >
            MENU
          </button>

          <button
            type="button"
            aria-label="Next track"
            disabled={!hasTrack}
            className={`absolute top-1/2 right-[20px] sm:right-[30px] transform -translate-y-1/2 ${wheelButton}`}
            onClick={next}
          >
            <SkipForward size={20} />
          </button>

          <button
            type="button"
            aria-label="Previous track"
            disabled={!hasTrack}
            className={`absolute top-1/2 left-[20px] sm:left-[30px] transform -translate-y-1/2 ${wheelButton}`}
            onClick={previous}
          >
            <SkipBack size={20} />
          </button>

          <div className="absolute bottom-[20px] sm:bottom-[30px] left-1/2 transform -translate-x-1/2 flex items-center gap-1 pointer-events-none">
            <Volume2 size={16} />
            <span className="text-xs">{volume}%</span>
          </div>
        </div>
      </div>
    </div>
  )
}
