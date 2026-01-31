import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/supabase/server'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import Link from 'next/link'

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
  const location = job.neighborhood
    ? `${job.neighborhood}, ${job.city}`
    : job.city
  const title = `${serviceName} in ${location} | Sasquatch Carpet Cleaning`
  const description =
    job.ai_description?.substring(0, 160) ||
    `Professional ${serviceName.toLowerCase()} services in ${location}. Quality results from Sasquatch Carpet Cleaning.`

  return {
    title,
    description,
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
  const location = job.neighborhood
    ? `${job.neighborhood}, ${job.city}`
    : job.city
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
      addressLocality: job.city,
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

      <div className="bg-background min-h-screen">
        {/* Header */}
        <header className="sticky top-0 z-10 border-b border-green-800/50 bg-green-950">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <Link href="/" className="flex items-center">
                <img
                  src="/vector6-no-background.svg"
                  alt="Sasquatch Carpet Cleaning"
                  className="h-14 w-auto md:h-16"
                />
              </Link>
              <Button asChild className="bg-green-600 hover:bg-green-500">
                <a
                  href="https://book.housecallpro.com/book/Sasquatch-Carpet-Cleaning-LLC/9841a0d5dee444b48d42e926168cb865?v2=true"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Book Now
                </a>
              </Button>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="container mx-auto max-w-4xl px-4 py-8">
          {/* Breadcrumbs */}
          <nav className="text-muted-foreground mb-6 text-sm">
            <Link href="/" className="hover:text-green-500">
              Home
            </Link>
            {' / '}
            <span>{job.city}</span>
            {' / '}
            <span className="text-foreground">{serviceName}</span>
          </nav>

          <Card className="overflow-hidden">
            {/* Hero Image */}
            <div className="relative h-[400px] w-full md:h-[500px]">
              <img
                src={job.image_url}
                alt={`${serviceName} in ${location}`}
                className="h-full w-full object-cover"
              />
            </div>

            {/* Content */}
            <div className="p-6 md:p-8">
              <h1 className="mb-2 text-3xl font-bold md:text-4xl">
                {serviceName} in {location}
              </h1>

              {publishedDate && (
                <p className="text-muted-foreground mb-6 text-sm">
                  Completed {publishedDate}
                </p>
              )}

              {/* Description */}
              {job.ai_description && (
                <div className="prose prose-lg dark:prose-invert mb-8 max-w-none">
                  <p className="text-foreground/90 leading-relaxed whitespace-pre-wrap">
                    {job.ai_description}
                  </p>
                </div>
              )}

              {/* CTA Section */}
              <div className="border-border mt-8 border-t pt-8">
                <div className="rounded-lg bg-green-950/50 p-6 text-center">
                  <h2 className="mb-2 text-2xl font-bold">
                    Need Professional Cleaning?
                  </h2>
                  <p className="text-muted-foreground mb-6">
                    Serving {job.city} and surrounding areas with top-quality
                    carpet and upholstery cleaning.
                  </p>
                  <div className="flex flex-col justify-center gap-4 sm:flex-row">
                    <Button
                      size="lg"
                      asChild
                      className="bg-green-600 hover:bg-green-500"
                    >
                      <a
                        href="https://book.housecallpro.com/book/Sasquatch-Carpet-Cleaning-LLC/9841a0d5dee444b48d42e926168cb865?v2=true"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Book Online
                      </a>
                    </Button>
                    <Button
                      size="lg"
                      variant="outline"
                      asChild
                      className="border-green-600 text-green-400 hover:bg-green-900/50"
                    >
                      <a href="tel:+17192498791">📞 Call Us: (719) 249-8791</a>
                    </Button>
                  </div>
                </div>
              </div>

              {/* Services List */}
              <div className="border-border mt-8 border-t pt-8">
                <h3 className="mb-4 text-xl font-semibold">Our Services</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex items-center gap-2">
                    <span className="text-green-500">✓</span>
                    <span>Standard Carpet Cleaning</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-green-500">✓</span>
                    <span>Urine Treatment</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-green-500">✓</span>
                    <span>Deep Carpet Restoration</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-green-500">✓</span>
                    <span>Upholstery Cleaning</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-green-500">✓</span>
                    <span>Tile & Grout Cleaning</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-green-500">✓</span>
                    <span>Commercial Services</span>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* Back to Map */}
          <div className="mt-8 text-center">
            <Button
              variant="outline"
              asChild
              className="border-green-600 text-green-400 hover:bg-green-900/50"
            >
              <Link href="/">← Back to Work Map</Link>
            </Button>
          </div>
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
