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
    <div className="bg-background flex min-h-screen flex-col">
      {/* Hero Section */}
      <section className="to-background relative overflow-hidden bg-gradient-to-b from-green-950 via-green-900">
        {/* Background pattern */}
        <div className="absolute inset-0 opacity-10">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `radial-gradient(circle at 25% 25%, rgba(34, 197, 94, 0.3) 0%, transparent 50%),
                              radial-gradient(circle at 75% 75%, rgba(34, 197, 94, 0.2) 0%, transparent 50%)`,
            }}
          />
        </div>

        {/* Header */}
        <header className="relative z-20 border-b border-green-800/50">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xl font-bold text-white">Sasquatch</span>
              </div>
              <div className="flex items-center gap-4">
                <Button
                  size="sm"
                  variant="outline"
                  asChild
                  className="hidden border-green-600 text-green-400 hover:bg-green-900/50 hover:text-green-300 sm:inline-flex"
                >
                  <a
                    href="https://book.housecallpro.com/book/Sasquatch-Carpet-Cleaning-LLC/9841a0d5dee444b48d42e926168cb865?v2=true"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Book Service
                  </a>
                </Button>
                <Suspense>
                  <AdminLink />
                </Suspense>
              </div>
            </div>
          </div>
        </header>

        {/* Hero Content */}
        <div className="relative z-10 container mx-auto px-4 py-16 md:py-24">
          <div className="flex flex-col items-center text-center">
            {/* Logo as Hero Graphic */}
            <div className="animate-fade-in mb-8">
              <img
                src="/vector6-no-background.svg"
                alt="Sasquatch Carpet Cleaning"
                className="h-48 w-auto drop-shadow-2xl md:h-64 lg:h-80"
              />
            </div>

            {/* Hero Text */}
            <h1 className="mb-4 text-4xl font-extrabold tracking-tight text-white md:text-5xl lg:text-6xl">
              Colorado&apos;s Premier
              <span className="block text-green-400">Carpet Cleaning</span>
            </h1>
            <p className="mb-8 max-w-2xl text-lg text-green-200/80 md:text-xl">
              Professional carpet, upholstery, and tile cleaning services across
              Colorado&apos;s Front Range. Quality you can see, results you can
              feel.
            </p>

            {/* CTA Buttons */}
            <div className="mb-12 flex flex-col gap-4 sm:flex-row">
              <Button
                size="lg"
                asChild
                className="bg-green-600 px-8 py-6 text-lg text-white hover:bg-green-500"
              >
                <a
                  href="https://book.housecallpro.com/book/Sasquatch-Carpet-Cleaning-LLC/9841a0d5dee444b48d42e926168cb865?v2=true"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Book Online Now
                </a>
              </Button>
              <Button
                size="lg"
                variant="outline"
                asChild
                className="border-green-500 px-8 py-6 text-lg text-green-400 hover:bg-green-900/50 hover:text-green-300"
              >
                <a href="/sightings">🦍 Spot Our Truck & Win!</a>
              </Button>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-3 gap-8 text-center md:gap-16">
              <div>
                <div className="text-3xl font-bold text-green-400 md:text-4xl">
                  {jobs.length || '50'}+
                </div>
                <div className="text-sm text-green-200/60">Jobs Completed</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-green-400 md:text-4xl">
                  {sightings.length || '100'}+
                </div>
                <div className="text-sm text-green-200/60">Truck Sightings</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-green-400 md:text-4xl">
                  5★
                </div>
                <div className="text-sm text-green-200/60">Google Rating</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Map Section */}
      <section className="relative min-h-[500px] flex-1">
        <div className="container mx-auto px-4 py-8">
          <h2 className="mb-2 text-center text-2xl font-bold md:text-3xl">
            Our Work Across Colorado
          </h2>
          <p className="text-muted-foreground mb-8 text-center">
            See where we&apos;ve been cleaning and our latest truck sightings
          </p>
        </div>
        <div className="h-[500px] md:h-[600px]">
          {jobs.length === 0 && sightings.length === 0 ? (
            <div className="bg-muted/30 flex h-full items-center justify-center">
              <div className="p-8 text-center">
                <h3 className="mb-2 text-xl font-bold">
                  No Jobs Published Yet
                </h3>
                <p className="text-muted-foreground mb-6">
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
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-green-950 px-4 py-6 text-white">
        <div className="container mx-auto">
          <div className="flex flex-col items-center justify-between gap-4 text-sm sm:flex-row">
            <p className="font-medium text-green-200/80">
              📍 Serving Colorado&apos;s Front Range • Professional Carpet &
              Upholstery Cleaning
            </p>
            <div className="flex items-center gap-4">
              <a
                href="tel:+17192498791"
                className="font-semibold transition-colors hover:text-green-400"
              >
                📞 (719) 249-8791
              </a>
              <span className="hidden text-green-700 sm:inline">|</span>
              <a
                href="https://book.housecallpro.com/book/Sasquatch-Carpet-Cleaning-LLC/9841a0d5dee444b48d42e926168cb865?v2=true"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold transition-colors hover:text-green-400"
              >
                Book Online →
              </a>
            </div>
          </div>
          <div className="mt-4 border-t border-green-800/50 pt-4 text-center text-xs text-green-200/50">
            © {new Date().getFullYear()} Sasquatch Carpet Cleaning. All rights
            reserved.
          </div>
        </div>
      </footer>
    </div>
  )
}
