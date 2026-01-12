import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createClient } from '@/supabase/server';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

interface PageProps {
  params: Promise<{
    city: string;
    slug: string;
  }>;
}

async function getJob(slug: string) {
  const supabase = await createClient();

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
    `
    )
    .eq('slug', slug)
    .eq('status', 'published')
    .single();

  if (error || !job) {
    return null;
  }

  return job;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const job = await getJob(slug);

  if (!job) {
    return {
      title: 'Job Not Found',
    };
  }

  const serviceName = job.service?.name || 'Carpet Cleaning';
  const location = job.neighborhood ? `${job.neighborhood}, ${job.city}` : job.city;
  const title = `${serviceName} in ${location} | Sasquatch Carpet Cleaning`;
  const description = job.ai_description?.substring(0, 160) || `Professional ${serviceName.toLowerCase()} services in ${location}. Quality results from Sasquatch Carpet Cleaning.`;

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
  };
}

export default async function JobPage({ params }: PageProps) {
  const { slug } = await params;
  const job = await getJob(slug);

  if (!job) {
    notFound();
  }

  const serviceName = job.service?.name || 'Carpet Cleaning';
  const location = job.neighborhood ? `${job.neighborhood}, ${job.city}` : job.city;
  const publishedDate = job.published_at
    ? new Date(job.published_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

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
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <header className="bg-white border-b sticky top-0 z-10">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <a href="/" className="flex items-center">
                <img 
                  src="/logo.svg" 
                  alt="Sasquatch Carpet Cleaning" 
                  className="h-14 md:h-16 w-auto"
                />
              </a>
              <Button asChild>
                <a href="https://sasquatchcarpetcleaning.com" target="_blank" rel="noopener noreferrer">
                  Book Now
                </a>
              </Button>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="container mx-auto px-4 py-8 max-w-4xl">
          {/* Breadcrumbs */}
          <nav className="text-sm text-gray-600 mb-6">
            <a href="/" className="hover:text-green-600">
              Home
            </a>
            {' / '}
            <span>{job.city}</span>
            {' / '}
            <span className="text-gray-900">{serviceName}</span>
          </nav>

          <Card className="overflow-hidden">
            {/* Hero Image */}
            <div className="relative w-full h-[400px] md:h-[500px]">
              <img
                src={job.image_url}
                alt={`${serviceName} in ${location}`}
                className="w-full h-full object-cover"
              />
            </div>

            {/* Content */}
            <div className="p-6 md:p-8">
              <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-2">
                {serviceName} in {location}
              </h1>

              {publishedDate && (
                <p className="text-sm text-gray-500 mb-6">Completed {publishedDate}</p>
              )}

              {/* Description */}
              {job.ai_description && (
                <div className="prose prose-lg max-w-none mb-8">
                  <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
                    {job.ai_description}
                  </p>
                </div>
              )}

              {/* CTA Section */}
              <div className="border-t pt-8 mt-8">
                <div className="bg-green-50 rounded-lg p-6 text-center">
                  <h2 className="text-2xl font-bold text-gray-900 mb-2">
                    Need Professional Cleaning?
                  </h2>
                  <p className="text-gray-600 mb-6">
                    Serving {job.city} and surrounding areas with top-quality carpet and upholstery cleaning.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-4 justify-center">
                    <Button size="lg" asChild>
                      <a
                        href="https://sasquatchcarpetcleaning.com"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Book Online
                      </a>
                    </Button>
                    <Button size="lg" variant="outline" asChild>
                      <a href="tel:+17205551234">
                        📞 Call Us: (720) 555-1234
                      </a>
                    </Button>
                  </div>
                </div>
              </div>

              {/* Services List */}
              <div className="mt-8 border-t pt-8">
                <h3 className="text-xl font-semibold mb-4">Our Services</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex items-center gap-2 text-gray-700">
                    <span className="text-green-600">✓</span>
                    <span>Standard Carpet Cleaning</span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-700">
                    <span className="text-green-600">✓</span>
                    <span>Urine Treatment</span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-700">
                    <span className="text-green-600">✓</span>
                    <span>Deep Carpet Restoration</span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-700">
                    <span className="text-green-600">✓</span>
                    <span>Upholstery Cleaning</span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-700">
                    <span className="text-green-600">✓</span>
                    <span>Tile & Grout Cleaning</span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-700">
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
              <a href="/">← Back to Work Map</a>
            </Button>
          </div>
        </main>

        {/* Footer */}
        <footer className="bg-white border-t mt-16">
          <div className="container mx-auto px-4 py-8 text-center text-gray-600">
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
  );
}
