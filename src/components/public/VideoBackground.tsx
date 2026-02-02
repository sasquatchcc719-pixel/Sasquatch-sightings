'use client'

interface VideoBackgroundProps {
  video?: 'forest' | 'clouds' | 'psychedelic'
}

export function VideoBackground({ video = 'forest' }: VideoBackgroundProps) {
  const videoSrc =
    video === 'clouds'
      ? '/forest-loop-2.mp4'
      : video === 'psychedelic'
        ? '/forest-loop-3.mp4'
        : '/forest-loop-1.mp4'

  return (
    <div className="fixed inset-0 -z-10 bg-black">
      <video
        autoPlay
        muted
        loop
        playsInline
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          minWidth: '100%',
          minHeight: '100%',
          width: 'auto',
          height: 'auto',
        }}
      >
        <source src={videoSrc} type="video/mp4" />
      </video>
    </div>
  )
}
