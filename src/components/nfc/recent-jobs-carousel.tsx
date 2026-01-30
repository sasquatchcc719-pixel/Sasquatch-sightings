'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import { Card } from '@/components/ui/card'

type Job = {
  id: string
  title: string
  description: string
  image_url: string
  city: string
  neighborhood: string
  service_type: string
  detail_url: string
}

export function RecentJobsCarousel() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isAutoPlaying, setIsAutoPlaying] = useState(true)

  useEffect(() => {
    fetchJobs()
  }, [])

  // Auto-advance carousel
  useEffect(() => {
    if (!isAutoPlaying || jobs.length === 0) return

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % jobs.length)
    }, 4000) // Change every 4 seconds

    return () => clearInterval(interval)
  }, [isAutoPlaying, jobs.length])

  const fetchJobs = async () => {
    try {
      const response = await fetch('/api/public/jobs?limit=6')
      const data = await response.json()
      if (data.success && data.jobs) {
        setJobs(data.jobs)
      }
    } catch (error) {
      console.error('Failed to fetch jobs:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handlePrev = () => {
    setIsAutoPlaying(false)
    setCurrentIndex((prev) => (prev - 1 + jobs.length) % jobs.length)
  }

  const handleNext = () => {
    setIsAutoPlaying(false)
    setCurrentIndex((prev) => (prev + 1) % jobs.length)
  }

  if (isLoading) {
    return (
      <div className="rounded-lg bg-gray-100 p-8 text-center dark:bg-gray-800">
        <p className="text-gray-600 dark:text-gray-400">
          Loading recent work...
        </p>
      </div>
    )
  }

  if (jobs.length === 0) {
    return null
  }

  const currentJob = jobs[currentIndex]

  return (
    <div className="space-y-4">
      {/* Carousel */}
      <Card className="relative overflow-hidden">
        {/* Image */}
        <div className="relative aspect-[4/3] w-full bg-gray-200 dark:bg-gray-700">
          {currentJob.image_url ? (
            <Image
              src={currentJob.image_url}
              alt={currentJob.title}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 600px"
              unoptimized
              onError={(e) => {
                // Fallback if image fails to load
                e.currentTarget.style.display = 'none'
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-gray-400">
              <p>No image available</p>
            </div>
          )}

          {/* Navigation Arrows */}
          {jobs.length > 1 && (
            <>
              <button
                onClick={handlePrev}
                className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white transition-all hover:bg-black/70"
                aria-label="Previous job"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                onClick={handleNext}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white transition-all hover:bg-black/70"
                aria-label="Next job"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          )}

          {/* Service Badge */}
          <div className="absolute top-3 left-3 rounded-full bg-green-600 px-3 py-1 text-xs font-bold text-white shadow-lg">
            {currentJob.service_type}
          </div>

          {/* Counter */}
          {jobs.length > 1 && (
            <div className="absolute right-3 bottom-3 rounded-full bg-black/50 px-3 py-1 text-xs font-semibold text-white">
              {currentIndex + 1} / {jobs.length}
            </div>
          )}
        </div>

        {/* Job Details */}
        <div className="p-4">
          <div className="mb-2 flex items-start justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {currentJob.neighborhood || currentJob.city}
              </p>
              <h3 className="font-bold">{currentJob.title}</h3>
            </div>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {currentJob.description}
          </p>
        </div>

        {/* Progress Dots */}
        {jobs.length > 1 && (
          <div className="flex justify-center gap-2 pb-4">
            {jobs.map((_, index) => (
              <button
                key={index}
                onClick={() => {
                  setIsAutoPlaying(false)
                  setCurrentIndex(index)
                }}
                className={`h-2 rounded-full transition-all ${
                  index === currentIndex
                    ? 'w-8 bg-green-600'
                    : 'w-2 bg-gray-300 hover:bg-gray-400'
                }`}
                aria-label={`Go to slide ${index + 1}`}
              />
            ))}
          </div>
        )}
      </Card>

      {/* View All Link */}
      <Link
        href="/work/colorado-springs/all"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-2 text-sm font-semibold text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
      >
        View All Our Work
        <ExternalLink className="h-4 w-4" />
      </Link>
    </div>
  )
}
