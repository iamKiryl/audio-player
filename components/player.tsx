"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import { Play, Pause, SkipForward, SkipBack, Volume2, Plus } from "lucide-react"

interface Track {
  id: number
  title: string
  artist: string
  duration: number
  src: string
}

export default function Player() {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTrack, setCurrentTrack] = useState(0)
  const [volume, setVolume] = useState(70)
  const [currentTime, setCurrentTime] = useState(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [menuActive, setMenuActive] = useState(true)
  const [allSongScreen, setAllSongsScreen] = useState(false)

  const [tracks, setTrack] = useState<Track[]>([])

  useEffect(() => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.play()
      } else {
        audioRef.current.pause()
      }
    }
  }, [isPlaying, currentTrack])

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume / 100
    }
  }, [volume])


  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`
  }

  const handlePlayPause = () => {
    setIsPlaying(!isPlaying)
  }

  const handleNextTrack = () => {
    setCurrentTrack((prev) => (prev + 1) % tracks.length)
    if (isPlaying && audioRef.current) {
      audioRef.current.currentTime = 0
    }
  }

  const handlePrevTrack = () => {
    setCurrentTrack((prev) => (prev === 0 ? tracks.length - 1 : prev - 1))
    if (isPlaying && audioRef.current) {
      audioRef.current.currentTime = 0
    }
  }

  const handleWheelRotation = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    const angle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * (180 / Math.PI)

    if (angle > -90 && angle < 90) {
      setVolume((prev) => Math.min(prev + 1, 100))
    } else {
      setVolume((prev) => Math.max(prev - 1, 0))
    }
  }

  const handleMenuClick = () => {
    setMenuActive(!menuActive)
  }

  const handleNowPlaingClick = () => {
    setMenuActive(false);
    setAllSongsScreen(false);
  }

  const handleAllSongsClick = () => {
    setMenuActive(false)
    setAllSongsScreen(true)
  }

  const handleUploadTrack = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    if (event.target?.files) {
      const files = event.target.files
      Array.from(files).forEach((el) => {
        const nextId =
          tracks.length === 0 ? 1 : tracks[tracks.length - 1].id + 1
        const objectUrl = URL.createObjectURL(el)
        const audio = new Audio(objectUrl)

        audio.onloadedmetadata = () => {
          setTrack((prevTracks) => [
            ...prevTracks,
            {
              title: el.name,
              src: objectUrl,
              duration: audio.duration,
              artist: "Unknown",
              id: nextId,
            },
          ])

          URL.revokeObjectURL(objectUrl)
        }
      })
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 p-4">
      <div className="w-full max-w-[320px] bg-gradient-to-b from-gray-100 to-gray-200 rounded-[30px] shadow-xl overflow-hidden border-2 border-gray-300">

        <div className="bg-white mx-4 mt-4 rounded-lg p-3 shadow-inner">
          <div className="bg-gray-800 rounded-md p-3 h-[180px] text-white">
            {menuActive ? (
              <div className="h-full flex flex-col">
                <h3 className="text-center font-semibold text-sm mb-2 bg-blue-500 py-1 rounded">Music Menu</h3>
                <ul className="text-sm space-y-1 overflow-hidden flex-1">
                  <li className="hover:bg-blue-500 px-2 py-0.5 rounded cursor-pointer"
                  onClick={() => handleNowPlaingClick()}>
                    Now Playing
                  </li>
                  <li className="hover:bg-blue-500 px-2 py-0.5 rounded">  
                    <label className="flex items-center cursor-pointer">
                    Add new song
                          <Plus className="w-5 h-5 mr-2" />
                          <input
                            type="file"
                            accept="audio/*"
                            multiple
                            className="hidden"
                            onChange={handleUploadTrack}
                          />
                      </label>
                    </li>
                  <li className="hover:bg-blue-500 px-2 py-0.5 rounded cursor-pointer"
                  onClick={() => {
                    handleAllSongsClick()
                  }}>
                    Songs
                  </li>
                </ul>
              </div>
            ) : (allSongScreen ? (
              <div className="h-full flex flex-col">
                 <ul className="text-sm space-y-1 overflow-hidden flex-1">
                  {tracks.length != 0 ? tracks.map((el, idx) => {
                   return (
                    <li key={idx} className={idx === currentTrack ? "bg-blue-500 px-2 py-0.5 rounded cursor-pointer" : "px-2 py-0.5 rounded cursor-pointer"}
                      onClick={() => setCurrentTrack(idx)}                
                    >
                      
                      {el.title}
                    </li>) 
                  }) : <li key={0} className="hover:bg-blue-500 px-2 py-0.5 rounded">
                     <label className="flex items-center cursor-pointer">
                     Add you first song
                     <Plus className="w-5 h-5 mr-2" />
                     <input
                            type="file"
                            accept="audio/*"
                            multiple
                            className="hidden"
                            onChange={handleUploadTrack}
                          />
                     </label>
                </li>}
                </ul>

              </div>
            ) 
            : (
              <div className="h-full flex flex-col">
                <div className="text-center text-xs mb-2">Now Playing</div>
                <div className="flex-1 flex flex-col items-center justify-center">
                  <h2 className="font-bold text-center mb-1">{tracks.length > 0 ? tracks[currentTrack].title : 'Add you music'}</h2>
                  <p className="text-sm text-gray-300 text-center">{tracks.length > 0 ? tracks[currentTrack].artist : ''}</p>
                  <div className="w-full mt-4 bg-gray-600 h-1 rounded-full overflow-hidden">
                    <div
                      className="bg-white h-full"
                      style={{ width: `${(currentTime / tracks[currentTrack]?.duration) * 100}%` }}
                    />
                  </div>
                  <div className="w-full flex justify-between text-xs mt-1">
                    <span>{formatTime(currentTime)}</span>
                    <span>{tracks[currentTrack] ? formatTime(tracks[currentTrack]?.duration) : null}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 mb-6 mx-auto w-[220px] h-[220px] relative">
          <div
            className="absolute inset-0 rounded-full bg-gray-200 shadow-inner cursor-pointer"
            onMouseMove={handleWheelRotation}
          />

          <div
            className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[80px] h-[80px] rounded-full bg-gray-300 flex items-center justify-center cursor-pointer"
            onClick={handlePlayPause}
          >
            {isPlaying ? <Pause size={24} /> : <Play size={24} />}
          </div>

          <div
            className="absolute top-[30px] left-1/2 transform -translate-x-1/2 text-sm font-medium cursor-pointer"
            onClick={handleMenuClick}
          >
            MENU
          </div>

          <div
            className="absolute top-1/2 right-[30px] transform -translate-y-1/2 cursor-pointer"
            onClick={handleNextTrack}
          >
            <SkipForward size={20} />
          </div>

          <div
            className="absolute top-1/2 left-[30px] transform -translate-y-1/2 cursor-pointer"
            onClick={handlePrevTrack}
          >
            <SkipBack size={20} />
          </div>

          <div className="absolute bottom-[30px] left-1/2 transform -translate-x-1/2 flex items-center gap-1">
            <Volume2 size={16} />
            <span className="text-xs">{volume}%</span>
          </div>
        </div>

        <audio
          ref={audioRef}
          src={tracks.length > 0 ? tracks[currentTrack].src : undefined}
          onTimeUpdate={() => audioRef.current && setCurrentTime(audioRef.current.currentTime)}
          onEnded={handleNextTrack}
          className="hidden"
        />
      </div>
    </div>
  )
}

