import { createClient } from '@/supabase/server'
import { MapView } from '@/components/public/MapView'
import { Button } from '@/components/ui/button'
import { Suspense } from 'react'
import { AdminLink } from '@/components/admin-link'
import { unstable_noStore as noStore } from 'next/cache'

async function getPublishedJobs() {
  noStore() // Opt out of caching for this function
  try {
    const supabase = await createClient()

    const { data: jobs, error } = await supabase
      .from('jobs')
      .select(
        `
        id,
        slug,
        city,
        image_url,
        gps_fuzzy_lat,
        gps_fuzzy_lng,
        service:services(name)
      `,
      )
      .eq('status', 'published')
      .order('published_at', { ascending: false })

    if (error) {
      console.error('Error fetching jobs:', error)
      return []
    }

    return jobs || []
  } catch (err) {
    console.error('Failed to fetch published jobs:', err)
    return []
  }
}

async function getSightings() {
  noStore() // Opt out of caching for this function
  try {
    const supabase = await createClient()

    const { data: sightings, error } = await supabase
      .from('sightings')
      .select(
        `
        id,
        image_url,
        gps_lat,
        gps_lng,
        created_at
      `,
      )
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching sightings:', error)
      return []
    }

    return sightings || []
  } catch (err) {
    console.error('Failed to fetch sightings:', err)
    return []
  }
}

export default async function Home() {
  const jobs = await getPublishedJobs()
  const sightings = await getSightings()

  return (
    <div className="flex h-screen flex-col">
      {/* Header with video background */}
      <header className="relative z-20 overflow-hidden border-b border-white/20">
        {/* Video background for header only */}
        <video
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 h-full w-full object-cover"
        >
          <source src="/forest-loop-3.mp4" type="video/mp4" />
        </video>
        {/* Dark overlay for readability */}
        <div className="absolute inset-0 bg-black/40" />

        <div className="relative container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img
                src="/logo.svg"
                alt="Sasquatch Carpet Cleaning"
                className="h-16 w-auto drop-shadow-lg md:h-20"
              />
            </div>
            <div className="flex items-center gap-4">
              <Button
                size="sm"
                variant="outline"
                asChild
                className="hidden border-white/50 bg-white/10 text-white hover:bg-white/20 hover:text-white sm:inline-flex"
              >
                <a
                  href="https://book.housecallpro.com/book/Sasquatch-Carpet-Cleaning-LLC/9841a0d5dee444b48d42e926168cb865?v2=true"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Book Service
                </a>
              </Button>
              <Button
                size="sm"
                variant="default"
                asChild
                className="hidden bg-blue-600 hover:bg-blue-700 sm:inline-flex"
              >
                <a href="/sightings">🦍 Spot Our Truck</a>
              </Button>
              <Suspense>
                <AdminLink />
              </Suspense>
            </div>
          </div>
        </div>
      </header>

      {/* Map Section */}
      <main className="relative flex-1">
        {jobs.length === 0 && sightings.length === 0 ? (
          <div className="flex h-full items-center justify-center bg-gray-50">
            <div className="p-8 text-center">
              <h2 className="mb-2 text-2xl font-bold text-gray-900">
                No Jobs Published Yet
              </h2>
              <p className="mb-6 text-gray-600">
                Check back soon to see our latest work across Colorado!
              </p>
              <Button asChild>
                <a
                  href="https://book.housecallpro.com/book/Sasquatch-Carpet-Cleaning-LLC/9841a0d5dee444b48d42e926168cb865?v2=true"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Book Online
                </a>
              </Button>
            </div>
          </div>
        ) : (
          <MapView jobs={jobs} sightings={sightings} />
        )}
      </main>

      {/* Info Bar */}
      <div className="z-10 bg-green-600 px-4 py-3 text-white">
        <div className="container mx-auto">
          <div className="flex flex-col items-center justify-between gap-2 text-sm sm:flex-row">
            <p className="font-medium">
              📍 Serving Colorado&apos;s Front Range • Professional Carpet &
              Upholstery Cleaning
            </p>
            <div className="flex gap-4">
              <a
                href="tel:+17192498791"
                className="font-semibold hover:underline"
              >
                📞 (719) 249-8791
              </a>
              <span className="hidden sm:inline">|</span>
              <a
                href="https://book.housecallpro.com/book/Sasquatch-Carpet-Cleaning-LLC/9841a0d5dee444b48d42e926168cb865?v2=true"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold hover:underline"
              >
                Book Online →
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
