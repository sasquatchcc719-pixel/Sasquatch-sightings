import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/supabase/server'
import { isUnknownCity } from '@/lib/geocode'
import { buildJobUrl } from '@/lib/google-indexing'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

// Cities with a dedicated service-area page on the marketing site. Job pages
// link into these (absolute www URLs — these pages are served on both the
// sightings subdomain and the www /sightings/* proxy, so relative links would
// 404 on one host).
const SERVICE_AREA_SLUGS = new Set([
  'monument',
  'palmer-lake',
  'woodmoor',
  'black-forest',
  'gleneagle',
  'colorado-springs',
  'larkspur',
  'castle-rock',
  'castle-pines',
  'falcon',
  'flying-horse',
])

function serviceAreaUrl(city: string | null): string | null {
  const slug = String(city || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return SERVICE_AREA_SLUGS.has(slug)
    ? `https://www.sasquatchcarpet.com/service-areas/${slug}`
    : null
}

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

// The services join is many-to-one, so supabase-js returns an object — but
// older rows/types have surfaced it as a one-element array. Handle both so the
// real service name always reaches the title (the array-only read left every
// page titled generic "Carpet Cleaning", which made same-city pages exact
// duplicates in Google's eyes).
function getServiceName(job: { service: unknown }): string {
  const svc = job.service as { name?: string } | { name?: string }[] | null
  if (Array.isArray(svc)) return svc[0]?.name || 'Carpet Cleaning'
  return svc?.name || 'Carpet Cleaning'
}

/** Other recent published jobs in the same city (for internal links). */
async function getRelatedJobs(city: string | null, excludeId: string) {
  if (!city || isUnknownCity(city)) return []
  const supabase = await createClient()
  const { data } = await supabase
    .from('jobs')
    .select('id, slug, city, published_at, service:services(name)')
    .eq('status', 'published')
    .eq('city', city)
    .neq('id', excludeId)
    .not('slug', 'ilike', '%unknown%')
    .order('published_at', { ascending: false })
    .limit(6)
  return data ?? []
}

function formatDate(iso: string | null): string | null {
  return iso
    ? new Date(iso).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null
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

  const serviceName = getServiceName(job)
  const cityDisplay = isUnknownCity(job.city)
    ? 'Colorado'
    : (job.city ?? 'Colorado')
  const location = job.neighborhood
    ? `${job.neighborhood}, ${cityDisplay}`
    : cityDisplay
  // Completion date in the title keeps same-city, same-service jobs from
  // sharing an identical title (Google was deduping them as one page).
  const titleDate = formatDate(job.published_at)
  const title = titleDate
    ? `${serviceName} in ${location} — ${titleDate} | Sasquatch Carpet Cleaning`
    : `${serviceName} in ${location} | Sasquatch Carpet Cleaning`
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
      : {
          // Job pages are served at BOTH sightings.../work/* and (via the
          // marketing site's Vercel proxy) www.sasquatchcarpet.com/sightings/*
          // with no referee — the duplicate split was suppressing both copies.
          // Canonical consolidates every signal onto the www URL.
          alternates: {
            canonical: buildJobUrl(job.city ?? 'Colorado', job.slug),
          },
        }),
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

  const serviceName = getServiceName(job)
  const cityDisplay = isUnknownCity(job.city)
    ? 'Colorado'
    : (job.city ?? 'Colorado')
  const location = job.neighborhood
    ? `${job.neighborhood}, ${cityDisplay}`
    : cityDisplay
  const publishedDate = formatDate(job.published_at)

  const canonicalUrl = buildJobUrl(job.city ?? 'Colorado', job.slug)
  const areaPageUrl = serviceAreaUrl(job.city)
  const relatedJobs = await getRelatedJobs(job.city, job.id)

  // JSON-LD: the completed job as a Service performed by the business.
  // Business identity fields (phone, base address, url) match the marketing
  // site's LocalBusiness schema so Google entity-resolves them together.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    '@id': canonicalUrl,
    name: `${serviceName} in ${location}`,
    serviceType: serviceName,
    description: job.ai_description,
    image: job.image_url,
    url: canonicalUrl,
    areaServed: { '@type': 'City', name: cityDisplay },
    provider: {
      '@type': 'LocalBusiness',
      name: 'Sasquatch Carpet Cleaning',
      telephone: '+1-719-249-8791',
      url: 'https://www.sasquatchcarpet.com',
      address: {
        '@type': 'PostalAddress',
        addressLocality: 'Palmer Lake',
        addressRegion: 'CO',
        postalCode: '80133',
        addressCountry: 'US',
      },
      priceRange: '$$',
    },
  }

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Sightings',
        item: 'https://www.sasquatchcarpet.com/sightings',
      },
      ...(areaPageUrl
        ? [
            {
              '@type': 'ListItem',
              position: 2,
              name: cityDisplay,
              item: areaPageUrl,
            },
          ]
        : []),
      {
        '@type': 'ListItem',
        position: areaPageUrl ? 3 : 2,
        name: `${serviceName} in ${location}`,
        item: canonicalUrl,
      },
    ],
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />

      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <header className="sticky top-0 z-10 border-b bg-white">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <Link href="/" className="flex items-center">
                <img
                  src="https://sightings.sasquatchcarpet.com/clean-no-background.svg"
                  alt="Sasquatch Carpet Cleaning"
                  className="h-12 w-auto object-contain md:h-14"
                />
              </Link>
              <Button asChild>
                <a href="https://www.sasquatchcarpet.com/#instant-quote">
                  Book Now
                </a>
              </Button>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="container mx-auto max-w-4xl px-4 py-8">
          {/* Breadcrumbs — city links to its marketing service-area page */}
          <nav className="mb-6 text-sm text-gray-600">
            <Link href="/" className="hover:text-green-600">
              Home
            </Link>
            {' / '}
            {areaPageUrl ? (
              <a href={areaPageUrl} className="hover:text-green-600">
                {cityDisplay}
              </a>
            ) : (
              <span>{cityDisplay}</span>
            )}
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
                    Serving{' '}
                    {areaPageUrl ? (
                      <a
                        href={areaPageUrl}
                        className="font-medium text-green-700 hover:underline"
                      >
                        {cityDisplay}
                      </a>
                    ) : (
                      cityDisplay
                    )}{' '}
                    and surrounding areas with top-quality carpet and upholstery
                    cleaning.
                  </p>
                  <div className="flex flex-col justify-center gap-4 sm:flex-row">
                    <Button size="lg" asChild>
                      <a href="https://www.sasquatchcarpet.com/#instant-quote">
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

          {/* Recent work in the same city — server-rendered links so Google
              can crawl job-to-job instead of relying on the sitemap alone. */}
          {relatedJobs.length > 0 && (
            <Card className="mt-8 bg-white p-6 md:p-8">
              <h2 className="mb-4 text-xl font-semibold text-gray-900">
                More Recent Work in {cityDisplay}
              </h2>
              <ul className="space-y-3">
                {relatedJobs.map((r) => {
                  const rService = getServiceName(r)
                  const rDate = formatDate(r.published_at)
                  return (
                    <li key={r.id}>
                      <a
                        href={buildJobUrl(r.city ?? 'Colorado', r.slug)}
                        className="text-green-700 hover:underline"
                      >
                        {rService} in {r.city}
                        {rDate ? ` — ${rDate}` : ''}
                      </a>
                    </li>
                  )
                })}
              </ul>
            </Card>
          )}

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
