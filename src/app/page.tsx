import { createClient } from '@/supabase/server';
import { MapView } from '@/components/public/MapView';
import { Button } from '@/components/ui/button';
import { Suspense } from 'react';
import { AuthButton } from '@/components/auth-button';
import { AdminLink } from '@/components/admin-link';
import { unstable_noStore as noStore } from 'next/cache';

async function getPublishedJobs() {
  noStore(); // Opt out of caching for this function
  try {
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
  } catch (err) {
    console.error('Failed to fetch published jobs:', err);
    return [];
  }
}

async function getSightings() {
  noStore(); // Opt out of caching for this function
  try {
    const supabase = await createClient();

    const { data: sightings, error } = await supabase
      .from('sightings')
      .select(
        `
        id,
        image_url,
        gps_lat,
        gps_lng,
        created_at
      `
      )
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching sightings:', error);
      return [];
    }

    return sightings || [];
  } catch (err) {
    console.error('Failed to fetch sightings:', err);
    return [];
  }
}

export default async function Home() {
  const jobs = await getPublishedJobs();
  const sightings = await getSightings();

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="bg-white border-b z-20 shadow-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img 
                src="/logo.svg" 
                alt="Sasquatch Carpet Cleaning" 
                className="h-16 md:h-20 w-auto"
              />
            </div>
            <div className="flex items-center gap-4">
              <Button size="sm" variant="outline" asChild className="hidden sm:inline-flex">
                <a href="https://book.housecallpro.com/book/Sasquatch-Carpet-Cleaning-LLC/9841a0d5dee444b48d42e926168cb865?v2=true" target="_blank" rel="noopener noreferrer">
                  Book Service
                </a>
              </Button>
              <Button size="sm" variant="default" asChild className="hidden sm:inline-flex bg-blue-600 hover:bg-blue-700">
                <a href="/sightings">
                  🦍 Spot Our Truck
                </a>
              </Button>
              <Suspense>
                <AdminLink />
              </Suspense>
              <Suspense>
                <AuthButton />
              </Suspense>
            </div>
          </div>
        </div>
      </header>

      {/* Map Section */}
      <main className="flex-1 relative">
        {jobs.length === 0 && sightings.length === 0 ? (
          <div className="flex items-center justify-center h-full bg-gray-50">
            <div className="text-center p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">No Jobs Published Yet</h2>
              <p className="text-gray-600 mb-6">
                Check back soon to see our latest work across Colorado!
              </p>
              <Button asChild>
                <a href="https://book.housecallpro.com/book/Sasquatch-Carpet-Cleaning-LLC/9841a0d5dee444b48d42e926168cb865?v2=true" target="_blank" rel="noopener noreferrer">
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
      <div className="bg-green-600 text-white py-3 px-4 z-10">
        <div className="container mx-auto">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-sm">
            <p className="font-medium">
              📍 Serving Colorado&apos;s Front Range • Professional Carpet & Upholstery Cleaning
            </p>
            <div className="flex gap-4">
              <a
                href="tel:+17192498791"
                className="hover:underline font-semibold"
              >
                📞 (719) 249-8791
              </a>
              <span className="hidden sm:inline">|</span>
              <a
                href="https://book.housecallpro.com/book/Sasquatch-Carpet-Cleaning-LLC/9841a0d5dee444b48d42e926168cb865?v2=true"
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
