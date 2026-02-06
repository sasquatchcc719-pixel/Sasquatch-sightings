'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ChevronDown } from 'lucide-react'
import Image from 'next/image'

// Pre-generate particle data to avoid Math.random during render
function generateParticles(count: number) {
  const particles = []
  for (let i = 0; i < count; i++) {
    particles.push({
      id: i,
      width: ((i * 7) % 4) + 1,
      height: ((i * 11) % 4) + 1,
      left: (i * 17) % 100,
      top: (i * 23) % 100,
      delay: (i * 13) % 5,
      duration: ((i * 19) % 10) + 10,
    })
  }
  return particles
}

const PARTICLES = generateParticles(50)

export function DarkHero() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const x = (e.clientX - rect.left - rect.width / 2) / rect.width
      const y = (e.clientY - rect.top - rect.height / 2) / rect.height
      setMousePosition({ x, y })
    }

    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  const scrollToContent = () => {
    window.scrollTo({
      top: window.innerHeight,
      behavior: 'smooth',
    })
  }

  return (
    <div
      ref={containerRef}
      className="relative h-screen w-full overflow-hidden bg-[#0a0a0a]"
    >
      {/* Particle effect overlay */}
      <div className="pointer-events-none absolute inset-0 z-10">
        {PARTICLES.map((p) => (
          <div
            key={p.id}
            className="animate-float absolute rounded-full bg-cyan-400/20"
            style={{
              width: p.width + 'px',
              height: p.height + 'px',
              left: p.left + '%',
              top: p.top + '%',
              animationDelay: p.delay + 's',
              animationDuration: p.duration + 's',
            }}
          />
        ))}
      </div>

      {/* Mountain layer - moves slowest */}
      <div
        className="absolute inset-0 transition-transform duration-300 ease-out"
        style={{
          transform: `translate(${mousePosition.x * -10}px, ${mousePosition.y * -10}px) scale(1.1)`,
        }}
      >
        <Image
          src="/hero-layer-mountains.png"
          alt=""
          fill
          className="object-cover object-bottom"
          priority
        />
      </div>

      {/* Forest layer - moves medium */}
      <div
        className="absolute inset-0 transition-transform duration-200 ease-out"
        style={{
          transform: `translate(${mousePosition.x * -25}px, ${mousePosition.y * -15}px) scale(1.15)`,
        }}
      >
        <Image
          src="/hero-layer-forest.png"
          alt=""
          fill
          className="object-cover object-bottom"
          priority
        />
      </div>

      {/* Fog overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-transparent to-transparent opacity-80" />
      <div className="absolute inset-0 bg-gradient-to-b from-[#0a0a0a]/50 via-transparent to-transparent" />

      {/* Sasquatch layer - moves most */}
      <div
        className="absolute inset-0 flex items-end justify-center transition-transform duration-150 ease-out"
        style={{
          transform: `translate(${mousePosition.x * -40}px, ${mousePosition.y * -20}px)`,
        }}
      >
        <div className="relative h-[80%] w-full">
          <Image
            src="/hero-sasquatch.png"
            alt=""
            fill
            className="object-contain object-bottom"
            priority
          />
        </div>
      </div>

      {/* Content overlay */}
      <div className="absolute inset-0 z-20 flex flex-col items-center justify-center px-4 text-center">
        {/* Logo */}
        <div
          className="animate-fade-in mb-6 opacity-0"
          style={{ animationDelay: '0.2s', animationFillMode: 'forwards' }}
        >
          <Image
            src="/logo.svg"
            alt="Sasquatch Carpet Cleaning"
            width={224}
            height={112}
            className="h-20 w-auto drop-shadow-2xl md:h-28"
            priority
          />
        </div>

        {/* Main headline */}
        <h1
          className="animate-fade-in mb-4 text-5xl font-extralight tracking-[0.2em] text-white opacity-0 md:text-7xl lg:text-8xl"
          style={{
            textShadow:
              '0 0 60px rgba(6, 182, 212, 0.5), 0 0 120px rgba(6, 182, 212, 0.3)',
            animationDelay: '0.4s',
            animationFillMode: 'forwards',
          }}
        >
          LEGENDARY CLEAN
        </h1>

        {/* Subheadline */}
        <p
          className="animate-fade-in mb-8 text-lg tracking-[0.3em] text-cyan-100/80 uppercase opacity-0 md:text-xl"
          style={{ animationDelay: '0.6s', animationFillMode: 'forwards' }}
        >
          Colorado&apos;s Premier Carpet Cleaning
        </p>

        {/* CTA Buttons */}
        <div
          className="animate-fade-in flex flex-col gap-4 opacity-0 sm:flex-row"
          style={{ animationDelay: '0.8s', animationFillMode: 'forwards' }}
        >
          <Button
            size="lg"
            className="border-0 bg-gradient-to-r from-cyan-600 to-cyan-500 px-8 py-6 text-lg tracking-wider text-white shadow-lg shadow-cyan-500/25 transition-all hover:scale-105 hover:from-cyan-500 hover:to-cyan-400 hover:shadow-cyan-500/40"
            asChild
          >
            <a
              href="https://book.housecallpro.com/book/Sasquatch-Carpet-Cleaning-LLC/9841a0d5dee444b48d42e926168cb865?v2=true"
              target="_blank"
              rel="noopener noreferrer"
            >
              BOOK NOW
            </a>
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="border-white/30 bg-white/5 px-8 py-6 text-lg tracking-wider text-white backdrop-blur-sm transition-all hover:scale-105 hover:border-white/50 hover:bg-white/10"
            asChild
          >
            <a href="/sightings">SPOT OUR TRUCK</a>
          </Button>
        </div>
      </div>

      {/* Scroll indicator */}
      <div
        className="animate-fade-in absolute bottom-8 left-1/2 z-20 -translate-x-1/2 cursor-pointer opacity-0"
        style={{ animationDelay: '1.2s', animationFillMode: 'forwards' }}
        onClick={scrollToContent}
      >
        <div className="flex flex-col items-center gap-2 text-white/50 transition-colors hover:text-white/80">
          <span className="text-xs tracking-[0.3em] uppercase">Explore</span>
          <ChevronDown className="h-6 w-6 animate-bounce" />
        </div>
      </div>

      {/* Vignette overlay */}
      <div className="pointer-events-none absolute inset-0 z-30 shadow-[inset_0_0_200px_rgba(0,0,0,0.8)]" />
    </div>
  )
}
