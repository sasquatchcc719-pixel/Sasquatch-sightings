import { createClient } from '@/supabase/server';
import { MapView } from '@/components/public/MapView';
import { Button } from '@/components/ui/button';
import { Suspense } from 'react';
import { AuthButton } from '@/components/auth-button';

async function getPublishedJobs() {
  const supabase = await createClient();

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
    `
    )
    .eq('status', 'published')
    .order('published_at', { ascending: false });

  if (error) {
    console.error('Error fetching jobs:', error);
    return [];
  }

  return jobs || [];
}

export default async function Home() {
  const jobs = await getPublishedJobs();

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="bg-white border-b z-20 shadow-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl md:text-3xl font-bold text-green-600">
                🦍 Sasquatch Carpet Cleaning
              </h1>
            </div>
            <div className="flex items-center gap-4">
              <Button size="sm" variant="outline" asChild className="hidden sm:inline-flex">
                <a href="https://sasquatchcarpetcleaning.com" target="_blank" rel="noopener noreferrer">
                  Book Service
                </a>
              </Button>
              <Suspense>
                <AuthButton />
              </Suspense>
            </div>
          </div>
        </div>
      </header>

      {/* Map Section */}
      <main className="flex-1 relative">
        {jobs.length === 0 ? (
          <div className="flex items-center justify-center h-full bg-gray-50">
            <div className="text-center p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">No Jobs Published Yet</h2>
              <p className="text-gray-600 mb-6">
                Check back soon to see our latest work across Colorado!
              </p>
              <Button asChild>
                <a href="https://sasquatchcarpetcleaning.com" target="_blank" rel="noopener noreferrer">
                  Visit Our Website
                </a>
              </Button>
            </div>
          </div>
        ) : (
          <MapView jobs={jobs} />
        )}
      </main>

      {/* Info Bar */}
      <div className="bg-green-600 text-white py-3 px-4 z-10">
        <div className="container mx-auto">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-sm">
            <p className="font-medium">
              📍 Serving Colorado&apos;s Front Range • Professional Carpet & Upholstery Cleaning
            </p>
            <div className="flex gap-4">
              <a
                href="tel:+17205551234"
                className="hover:underline font-semibold"
              >
                📞 (720) 555-1234
              </a>
              <span className="hidden sm:inline">|</span>
              <a
                href="https://sasquatchcarpetcleaning.com"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline font-semibold"
              >
                Book Online →
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
