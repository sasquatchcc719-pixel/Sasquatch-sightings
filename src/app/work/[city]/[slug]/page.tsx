import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/supabase/server'
import { isUnknownCity } from '@/lib/geocode'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

interface PageProps {
  params: Promise<{
    city: string
    slug: string
  }>
}

async function getJob(slug: string) {
  const supabase = await createClient()

  const { data: job, error } = await supabase
    .from('jobs')
    .select(
      `
      id,
      slug,
      city,
      neighborhood,
      image_url,
      ai_description,
      created_at,
      published_at,
      service:services(name)
    `,
    )
    .eq('slug', slug)
    .eq('status', 'published')
    .single()

  if (error || !job) {
    return null
  }

  return job
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params
  const job = await getJob(slug)

  if (!job) {
    return {
      title: 'Job Not Found',
    }
  }

  const serviceName = (job.service as any)?.[0]?.name || 'Carpet Cleaning'
  const cityDisplay = isUnknownCity(job.city)
    ? 'Colorado'
    : (job.city ?? 'Colorado')
  const location = job.neighborhood
    ? `${job.neighborhood}, ${cityDisplay}`
    : cityDisplay
  const title = `${serviceName} in ${location} | Sasquatch Carpet Cleaning`
  const description =
    job.ai_description?.substring(0, 160) ||
    `Professional ${serviceName.toLowerCase()} services in ${location}. Quality results from Sasquatch Carpet Cleaning.`

  const hasUnknownCity = isUnknownCity(job.city)
  const hasUnknownSlug = job.slug?.includes('unknown')

  return {
    title,
    description,
    ...(hasUnknownCity || hasUnknownSlug
      ? { robots: { index: false, follow: false } }
      : {}),
    openGraph: {
      title,
      description,
      images: [job.image_url],
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [job.image_url],
    },
  }
}

export default async function JobPage({ params }: PageProps) {
  const { slug } = await params
  const job = await getJob(slug)

  if (!job) {
    notFound()
  }

  const serviceName = (job.service as any)?.[0]?.name || 'Carpet Cleaning'
  const cityDisplay = isUnknownCity(job.city)
    ? 'Colorado'
    : (job.city ?? 'Colorado')
  const location = job.neighborhood
    ? `${job.neighborhood}, ${cityDisplay}`
    : cityDisplay
  const publishedDate = job.published_at
    ? new Date(job.published_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null

  // JSON-LD structured data for local business
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: 'Sasquatch Carpet Cleaning',
    image: job.image_url,
    description: job.ai_description,
    address: {
      '@type': 'PostalAddress',
      addressLocality: cityDisplay,
      addressRegion: 'CO',
    },
    geo: job.neighborhood
      ? {
          '@type': 'GeoCoordinates',
          addressLocality: job.neighborhood,
        }
      : undefined,
    serviceType: serviceName,
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <header className="sticky top-0 z-10 border-b bg-white">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <Link href="/" className="flex items-center">
                <img
                  src="/clean-no-background.svg"
                  alt="Sasquatch Carpet Cleaning"
                  className="h-12 w-auto object-contain md:h-14"
                />
              </Link>
              <Button asChild>
                <a href="sms:7192498791?body=Hi!%20I%27d%20like%20to%20get%20a%20quote%20and%20book%20a%20cleaning.">
                  Book Now
                </a>
              </Button>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="container mx-auto max-w-4xl px-4 py-8">
          {/* Breadcrumbs */}
          <nav className="mb-6 text-sm text-gray-600">
            <Link href="/" className="hover:text-green-600">
              Home
            </Link>
            {' / '}
            <span>{cityDisplay}</span>
            {' / '}
            <span className="text-gray-900">{serviceName}</span>
          </nav>

          <Card className="overflow-hidden bg-white">
            {/* Hero Image */}
            <div className="relative h-[400px] w-full md:h-[500px]">
              <img
                src={job.image_url}
                alt={`${serviceName} in ${location}`}
                className="h-full w-full object-cover"
              />
            </div>

            {/* Content */}
            <div className="bg-white p-6 md:p-8">
              <h1 className="mb-2 text-3xl font-bold text-gray-900 md:text-4xl">
                {serviceName} in {location}
              </h1>

              {publishedDate && (
                <p className="mb-6 text-sm text-gray-600">
                  Completed {publishedDate}
                </p>
              )}

              {/* Description */}
              {job.ai_description && (
                <div className="prose prose-lg mb-8 max-w-none">
                  <p className="leading-relaxed whitespace-pre-wrap text-gray-800">
                    {job.ai_description}
                  </p>
                </div>
              )}

              {/* CTA Section */}
              <div className="mt-8 border-t pt-8">
                <div className="rounded-lg bg-green-50 p-6 text-center">
                  <h2 className="mb-2 text-2xl font-bold text-gray-900">
                    Need Professional Cleaning?
                  </h2>
                  <p className="mb-6 text-gray-600">
                    Serving {cityDisplay} and surrounding areas with top-quality
                    carpet and upholstery cleaning.
                  </p>
                  <div className="flex flex-col justify-center gap-4 sm:flex-row">
                    <Button size="lg" asChild>
                      <a href="sms:7192498791?body=Hi!%20I%27d%20like%20to%20get%20a%20quote%20and%20book%20a%20cleaning.">
                        Book Online
                      </a>
                    </Button>
                    <Button size="lg" variant="outline" asChild>
                      <a href="tel:+17192498791">📞 Call Us: (719) 249-8791</a>
                    </Button>
                  </div>
                </div>
              </div>

              {/* Services List */}
              <div className="mt-8 border-t pt-8">
                <h3 className="mb-4 text-xl font-semibold text-gray-900">
                  Our Services
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex items-center gap-2 text-gray-800">
                    <span className="text-green-600">✓</span>
                    <span>Standard Carpet Cleaning</span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-800">
                    <span className="text-green-600">✓</span>
                    <span>Urine Treatment</span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-800">
                    <span className="text-green-600">✓</span>
                    <span>Deep Carpet Restoration</span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-800">
                    <span className="text-green-600">✓</span>
                    <span>Upholstery Cleaning</span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-800">
                    <span className="text-green-600">✓</span>
                    <span>Tile & Grout Cleaning</span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-800">
                    <span className="text-green-600">✓</span>
                    <span>Commercial Services</span>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* Back to Map */}
          <div className="mt-8 text-center">
            <Button variant="outline" asChild>
              <Link href="/">← Back to Work Map</Link>
            </Button>
          </div>
        </main>

        {/* Footer */}
        <footer className="mt-16 border-t bg-white">
          <div className="container mx-auto px-4 py-8 text-center text-gray-600">
            <p className="mb-2">
              <strong>Sasquatch Carpet Cleaning</strong> - Professional cleaning
              services in Colorado
            </p>
            <p className="text-sm">
              © {new Date().getFullYear()} Sasquatch Carpet Cleaning. All rights
              reserved.
            </p>
          </div>
        </footer>
      </div>
    </>
  )
}
