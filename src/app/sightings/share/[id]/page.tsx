import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
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

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params
  const sighting = await getSighting(id)

  if (!sighting) {
    return {
      title: 'Sighting Not Found',
    }
  }

  const location =
    sighting.city && sighting.state
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

  const location =
    sighting.city && sighting.state
      ? `${sighting.city}, ${sighting.state}`
      : 'Colorado'

  const formattedDate = new Date(sighting.created_at).toLocaleDateString(
    'en-US',
    {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    },
  )

  // JSON-LD structured data for SEO
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ImageObject',
    name: `Sasquatch Carpet Cleaning Truck Spotted in ${location}`,
    description:
      'Sasquatch Carpet Cleaning truck sighting photo from our community contest',
    contentUrl: sighting.image_url,
    url: `https://sightings.sasquatchcarpet.com/sightings/share/${id}`,
    datePublished: sighting.created_at,
    author: {
      '@type': 'Organization',
      name: 'Sasquatch Carpet Cleaning',
      url: 'https://sasquatchcarpet.com',
    },
    ...(sighting.gps_lat &&
      sighting.gps_lng && {
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
      <div className="to-background min-h-screen bg-gradient-to-b from-green-950">
        {/* Header */}
        <header className="border-b border-green-800/50 bg-green-950">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <Link href="/" className="flex items-center">
                <img
                  src="/vector6-no-background.svg"
                  alt="Sasquatch Carpet Cleaning"
                  className="h-16 w-auto md:h-20"
                />
              </Link>
              <Button asChild className="bg-green-600 hover:bg-green-500">
                <a href="/sightings">
                  <Trophy className="mr-2 h-4 w-4" />
                  Join Contest
                </a>
              </Button>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="container mx-auto max-w-4xl px-4 py-12">
          <Card className="bg-card overflow-hidden border-green-800/30">
            {/* Hero Image */}
            <div className="bg-muted relative h-[400px] w-full md:h-[500px]">
              <img
                src={sighting.image_url}
                alt={`Sasquatch Carpet Cleaning truck spotted in ${location}`}
                className="h-full w-full object-contain"
              />
            </div>

            {/* Content */}
            <div className="p-6 md:p-8">
              <div className="mb-6 text-center">
                <h1 className="mb-2 text-3xl font-bold md:text-4xl">
                  🦍 Sasquatch Spotted!
                </h1>

                {sighting.city && sighting.state && (
                  <div className="text-muted-foreground mb-2 flex items-center justify-center gap-2 text-lg">
                    <MapPin className="h-5 w-5" />
                    <span>{location}</span>
                  </div>
                )}

                <p className="text-muted-foreground text-sm">
                  Spotted on {formattedDate}
                </p>
              </div>

              {/* Contest CTA */}
              <div className="border-border mt-8 border-t pt-8">
                <div className="rounded-lg bg-green-900/30 p-6 text-center">
                  <Trophy className="mx-auto mb-4 h-12 w-12 text-green-400" />
                  <h2 className="mb-2 text-2xl font-bold">
                    Spotted Our Truck Too?
                  </h2>
                  <p className="text-muted-foreground mb-6">
                    Upload your photo and get an instant{' '}
                    <span className="font-bold text-green-400">
                      $20 OFF coupon
                    </span>{' '}
                    plus a chance to win a{' '}
                    <span className="font-bold text-green-300">
                      FREE whole house carpet cleaning
                    </span>{' '}
                    (up to $350 value)!
                  </p>
                  <div className="flex flex-col justify-center gap-4 sm:flex-row">
                    <Button
                      size="lg"
                      asChild
                      className="bg-green-600 hover:bg-green-500"
                    >
                      <a href="/sightings">
                        <Trophy className="mr-2 h-5 w-5" />
                        Join the Contest
                      </a>
                    </Button>
                    <Button
                      size="lg"
                      variant="outline"
                      asChild
                      className="border-green-600 text-green-400 hover:bg-green-900/50"
                    >
                      <a
                        href="https://book.housecallpro.com/book/Sasquatch-Carpet-Cleaning-LLC/9841a0d5dee444b48d42e926168cb865?v2=true"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        📞 Book a Cleaning
                      </a>
                    </Button>
                  </div>
                </div>
              </div>

              {/* About */}
              <div className="text-muted-foreground mt-8 text-center text-sm">
                <p>
                  Sasquatch Carpet Cleaning serves the Colorado Front Range with
                  top-quality carpet and upholstery cleaning services.
                </p>
              </div>
            </div>
          </Card>
        </main>

        {/* Footer */}
        <footer className="mt-16 border-t border-green-800/50 bg-green-950">
          <div className="container mx-auto px-4 py-8 text-center text-green-200/70">
            <p className="mb-2">
              <strong className="text-white">Sasquatch Carpet Cleaning</strong>{' '}
              - Professional cleaning services in Colorado
            </p>
            <p className="text-sm text-green-200/50">
              © {new Date().getFullYear()} Sasquatch Carpet Cleaning. All rights
              reserved.
            </p>
          </div>
        </footer>
      </div>
    </>
  )
}
