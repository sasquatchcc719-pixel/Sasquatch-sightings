import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/supabase/server'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { MapPin, Trophy } from 'lucide-react'

interface PageProps {
  params: Promise<{
    id: string
  }>
}

async function getSighting(id: string) {
  const supabase = await createClient()

  const { data: sighting, error } = await supabase
    .from('sightings')
    .select('id, image_url, gps_lat, gps_lng, city, state, created_at')
    .eq('id', id)
    .single()

  if (error || !sighting) {
    return null
  }

  return sighting
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params
  const sighting = await getSighting(id)

  if (!sighting) {
    return {
      title: 'Sighting Not Found',
    }
  }

  const location = sighting.city && sighting.state
    ? `${sighting.city}, ${sighting.state}`
    : 'Colorado'

  const title = `Sasquatch Spotted in ${location}!`
  const description = `A Sasquatch Carpet Cleaning truck was spotted in ${location} on ${new Date(sighting.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}. Join our contest to win a free whole house carpet cleaning!`
  const url = `https://sightings.sasquatchcarpet.com/sightings/share/${id}`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url,
      siteName: 'Sasquatch Carpet Cleaning Sightings',
      locale: 'en_US',
      type: 'article',
      publishedTime: sighting.created_at,
      images: [
        {
          url: sighting.image_url,
          width: 1200,
          height: 630,
          alt: `Sasquatch Carpet Cleaning truck spotted in ${location}`,
          type: 'image/jpeg',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [sighting.image_url],
      creator: '@SasquatchCC',
      site: '@SasquatchCC',
    },
    alternates: {
      canonical: url,
    },
    robots: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  }
}

export default async function SharePage({ params }: PageProps) {
  const { id } = await params
  const sighting = await getSighting(id)

  if (!sighting) {
    notFound()
  }

  const location = sighting.city && sighting.state
    ? `${sighting.city}, ${sighting.state}`
    : 'Colorado'

  const formattedDate = new Date(sighting.created_at).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  // JSON-LD structured data for SEO
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ImageObject',
    name: `Sasquatch Carpet Cleaning Truck Spotted in ${location}`,
    description: 'Sasquatch Carpet Cleaning truck sighting photo from our community contest',
    contentUrl: sighting.image_url,
    url: `https://sightings.sasquatchcarpet.com/sightings/share/${id}`,
    datePublished: sighting.created_at,
    author: {
      '@type': 'Organization',
      name: 'Sasquatch Carpet Cleaning',
      url: 'https://sasquatchcarpet.com',
    },
    ...(sighting.gps_lat && sighting.gps_lng && {
      contentLocation: {
        '@type': 'Place',
        name: location,
        geo: {
          '@type': 'GeoCoordinates',
          latitude: sighting.gps_lat,
          longitude: sighting.gps_lng,
        },
      },
    }),
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white dark:from-gray-900 dark:to-gray-800">
      {/* Header */}
      <header className="bg-white border-b shadow-sm dark:bg-gray-800 dark:border-gray-700">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <a href="/" className="flex items-center">
              <img
                src="/sasquatch-logo.png"
                alt="Sasquatch Carpet Cleaning"
                className="h-16 md:h-20 w-auto"
              />
            </a>
            <Button asChild>
              <a href="/sightings">
                <Trophy className="mr-2 h-4 w-4" />
                Join Contest
              </a>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-12 max-w-4xl">
        <Card className="overflow-hidden bg-white dark:bg-gray-800">
          {/* Hero Image */}
          <div className="relative w-full h-[400px] md:h-[500px] bg-gray-100 dark:bg-gray-700">
            <img
              src={sighting.image_url}
              alt={`Sasquatch Carpet Cleaning truck spotted in ${location}`}
              className="w-full h-full object-contain"
            />
          </div>

          {/* Content */}
          <div className="p-6 md:p-8">
            <div className="text-center mb-6">
              <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-2">
                🦍 Sasquatch Spotted!
              </h1>

              {sighting.city && sighting.state && (
                <div className="flex items-center justify-center gap-2 text-lg text-gray-600 dark:text-gray-300 mb-2">
                  <MapPin className="h-5 w-5" />
                  <span>{location}</span>
                </div>
              )}

              <p className="text-sm text-gray-500 dark:text-gray-400">
                Spotted on {formattedDate}
              </p>
            </div>

            {/* Contest CTA */}
            <div className="border-t pt-8 mt-8 dark:border-gray-700">
              <div className="bg-gradient-to-br from-blue-50 to-green-50 dark:from-blue-900/20 dark:to-green-900/20 rounded-lg p-6 text-center">
                <Trophy className="h-12 w-12 mx-auto mb-4 text-blue-600 dark:text-blue-400" />
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  Spotted Our Truck Too?
                </h2>
                <p className="text-gray-700 dark:text-gray-300 mb-6">
                  Upload your photo and get an instant <span className="font-bold text-green-600 dark:text-green-400">$20 OFF coupon</span> plus a chance to win a <span className="font-bold text-blue-600 dark:text-blue-400">FREE whole house carpet cleaning</span> (up to $350 value)!
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button size="lg" asChild className="bg-blue-600 hover:bg-blue-700">
                    <a href="/sightings">
                      <Trophy className="mr-2 h-5 w-5" />
                      Join the Contest
                    </a>
                  </Button>
                  <Button size="lg" variant="outline" asChild>
                    <a href="https://book.housecallpro.com/book/Sasquatch-Carpet-Cleaning-LLC/9841a0d5dee444b48d42e926168cb865?v2=true" target="_blank" rel="noopener noreferrer">
                      📞 Book a Cleaning
                    </a>
                  </Button>
                </div>
              </div>
            </div>

            {/* About */}
            <div className="mt-8 text-center text-sm text-gray-600 dark:text-gray-400">
              <p>
                Sasquatch Carpet Cleaning serves the Colorado Front Range with top-quality carpet and upholstery cleaning services.
              </p>
            </div>
          </div>
        </Card>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t mt-16 dark:bg-gray-800 dark:border-gray-700">
        <div className="container mx-auto px-4 py-8 text-center text-gray-600 dark:text-gray-400">
          <p className="mb-2">
            <strong>Sasquatch Carpet Cleaning</strong> - Professional cleaning services in Colorado
          </p>
          <p className="text-sm">
            © {new Date().getFullYear()} Sasquatch Carpet Cleaning. All rights reserved.
          </p>
        </div>
      </footer>
      </div>
    </>
  )
}
