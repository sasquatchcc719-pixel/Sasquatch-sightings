'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import styles from './tap.module.css'

/** The original lightweight forest loop, with a still fallback. */
export function TapForest() {
  const video = useRef<HTMLVideoElement>(null)
  const [canLoadVideo, setCanLoadVideo] = useState(false)

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setCanLoadVideo(!preference.matches)
    sync()
    preference.addEventListener('change', sync)
    return () => preference.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    const syncPlayback = () => {
      if (canLoadVideo && !document.hidden) {
        video.current?.play()?.catch(() => {})
      } else {
        video.current?.pause()
      }
    }
    syncPlayback()
    document.addEventListener('visibilitychange', syncPlayback)
    return () => document.removeEventListener('visibilitychange', syncPlayback)
  }, [canLoadVideo])

  return (
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
  )
}
