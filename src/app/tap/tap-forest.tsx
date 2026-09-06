'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { Pause, Play } from 'lucide-react'
import styles from './tap.module.css'

/** The original lightweight forest loop, with a still fallback and motion control. */
export function TapForest() {
  const video = useRef<HTMLVideoElement>(null)
  const [moving, setMoving] = useState(false)
  const [canLoadVideo, setCanLoadVideo] = useState(false)

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => {
      setMoving(!preference.matches)
      if (!preference.matches) setCanLoadVideo(true)
    }
    sync()
    preference.addEventListener('change', sync)
    return () => preference.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    const syncPlayback = () => {
      if (moving && !document.hidden) {
        video.current?.play()?.catch(() => setMoving(false))
      } else {
        video.current?.pause()
      }
    }
    syncPlayback()
    document.addEventListener('visibilitychange', syncPlayback)
    return () => document.removeEventListener('visibilitychange', syncPlayback)
  }, [moving, canLoadVideo])

  return (
    <>
      <div className={styles.backdrop} aria-hidden="true">
        <Image
          src="/hero-layer-forest.png"
          alt=""
          fill
          sizes="100vw"
          className={styles.forest}
        />
        {canLoadVideo && (
          <video
            ref={video}
            src="/forest-loop-2.mp4"
            muted
            loop
            playsInline
            preload="metadata"
            className={styles.forestVideo}
          />
        )}
      </div>
      <button
        type="button"
        className={styles.motionToggle}
        aria-label={
          moving ? 'Pause background animation' : 'Play background animation'
        }
        onClick={() => {
          setCanLoadVideo(true)
          setMoving((value) => !value)
        }}
      >
        {moving ? (
          <Pause size={12} aria-hidden="true" />
        ) : (
          <Play size={12} aria-hidden="true" />
        )}
        {moving ? 'Pause scenery' : 'Play scenery'}
      </button>
    </>
  )
}
