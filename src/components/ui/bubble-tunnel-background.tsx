type BubbleTunnelBackgroundProps = {
  count?: number
}

type BubbleConfig = {
  left: number
  size: number
  delay: number
  duration: number
  opacity: number
  blur: number
}

function buildBubble(index: number): BubbleConfig {
  // Deterministic values keep render stable and avoid hydration mismatch.
  const left = (index * 13.37) % 100
  const size = 10 + ((index * 7) % 44)
  const delay = -((index * 0.91) % 18)
  const duration = 14 + ((index * 1.71) % 20)
  const opacity = 0.1 + ((index * 0.017) % 0.18)
  const blur = (index % 3) * 0.6
  return { left, size, delay, duration, opacity, blur }
}

export function BubbleTunnelBackground({
  count = 120,
}: BubbleTunnelBackgroundProps) {
  const bubbles = Array.from({ length: count }, (_, index) =>
    buildBubble(index),
  )

  return (
    <div aria-hidden className="bubble-tunnel">
      <div className="bubble-tunnel__glow bubble-tunnel__glow--top" />
      <div className="bubble-tunnel__glow bubble-tunnel__glow--bottom" />
      {bubbles.map((bubble, index) => (
        <span
          key={`bubble-${index}`}
          className="bubble-tunnel__bubble"
          style={{
            left: `${bubble.left}%`,
            width: `${bubble.size}px`,
            height: `${bubble.size}px`,
            animationDelay: `${bubble.delay}s`,
            animationDuration: `${bubble.duration}s`,
            opacity: bubble.opacity,
            filter: `blur(${bubble.blur}px)`,
          }}
        />
      ))}
    </div>
  )
}
