import { createClient } from '@/supabase/server'
import { MapView } from '@/components/public/MapView'
import { DarkHero } from '@/components/public/DarkHero'
import { Button } from '@/components/ui/button'
import { Suspense } from 'react'
import { AdminLink } from '@/components/admin-link'
import { unstable_noStore as noStore } from 'next/cache'

async function getPublishedJobs() {
  noStore()
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
  noStore()
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
    <div className="flex flex-col">
      {/* Admin link - fixed position */}
      <div className="fixed top-4 right-4 z-50">
        <Suspense>
          <AdminLink />
        </Suspense>
      </div>

      {/* Dark Hero Section */}
      <DarkHero />

      {/* Map Section */}
      <section id="map" className="relative h-screen bg-[#0a0a0a]">
        {/* Section header */}
        <div className="absolute top-0 right-0 left-0 z-10 bg-gradient-to-b from-[#0a0a0a] to-transparent py-8">
          <div className="container mx-auto px-4 text-center">
            <h2 className="mb-2 text-3xl font-light tracking-[0.15em] text-white md:text-4xl">
              OUR WORK
            </h2>
            <p className="tracking-wider text-cyan-100/60">
              Explore our completed projects across Colorado
            </p>
          </div>
        </div>

        {jobs.length === 0 && sightings.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="p-8 text-center">
              <h2 className="mb-2 text-2xl font-bold text-white">
                No Jobs Published Yet
              </h2>
              <p className="mb-6 text-gray-400">
                Check back soon to see our latest work across Colorado!
              </p>
              <Button asChild className="bg-cyan-600 hover:bg-cyan-500">
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
          <div className="h-full pt-24">
            <MapView jobs={jobs} sightings={sightings} />
          </div>
        )}
      </section>

      {/* Info Bar */}
      <div className="z-10 bg-gradient-to-r from-cyan-700 to-cyan-600 px-4 py-4 text-white">
        <div className="container mx-auto">
          <div className="flex flex-col items-center justify-between gap-3 text-sm sm:flex-row">
            <p className="font-medium tracking-wide">
              📍 Serving Colorado&apos;s Front Range • Professional Carpet &
              Upholstery Cleaning
            </p>
            <div className="flex gap-6">
              <a
                href="tel:+17192498791"
                className="font-semibold transition-colors hover:underline"
              >
                📞 (719) 249-8791
              </a>
              <a
                href="https://book.housecallpro.com/book/Sasquatch-Carpet-Cleaning-LLC/9841a0d5dee444b48d42e926168cb865?v2=true"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold transition-colors hover:underline"
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
