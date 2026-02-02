import { Metadata } from 'next'
import { createAdminClient } from '@/supabase/server'
import { Card, CardContent } from '@/components/ui/card'
import { ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { VideoBackground } from '@/components/public/VideoBackground'

export const metadata: Metadata = {
  title: 'Our Preferred Partners | Sasquatch Carpet Cleaning',
  description:
    'Trusted local businesses we proudly recommend. These partners refer their clients to us, and we refer ours to them.',
  openGraph: {
    title: 'Our Preferred Partners | Sasquatch Carpet Cleaning',
    description:
      'Trusted local businesses we proudly recommend. These partners refer their clients to us, and we refer ours to them.',
    images: ['/partner-og-image.png'],
    url: 'https://sightings.sasquatchcarpet.com/preferred-partners',
    type: 'website',
    siteName: 'Sasquatch Carpet Cleaning',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Our Preferred Partners | Sasquatch Carpet Cleaning',
    description: 'Trusted local businesses we proudly recommend',
    images: ['/partner-og-image.png'],
  },
}

type Partner = {
  id: string
  name: string
  company_name: string
  company_website: string | null
}

export default async function PreferredPartnersPage() {
  const supabase = createAdminClient()

  // Only show partners who opted in AND are verified
  const { data: partners } = await supabase
    .from('partners')
    .select('id, name, company_name, company_website')
    .eq('backlink_opted_in', true)
    .eq('backlink_verified', true)
    .order('company_name', { ascending: true })

  return (
    <div className="relative min-h-screen overflow-hidden">
      <VideoBackground />

      {/* Header */}
      <header className="relative z-10 border-b border-white/20 bg-black/30 backdrop-blur-sm">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <Link href="/">
            <img
              src="/vector6-no-background.svg"
              alt="Sasquatch Carpet Cleaning"
              className="h-32 w-auto"
            />
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 mx-auto max-w-4xl px-4 py-12">
        <div className="mb-12 text-center">
          <h1 className="mb-4 text-4xl font-bold text-white">
            Our Preferred Partners
          </h1>
          <p className="mx-auto max-w-2xl text-lg text-white/80">
            These trusted local businesses refer their clients to us. We&apos;re
            proud to recommend them in return.
          </p>
        </div>

        {partners && partners.length > 0 && (
          <div className="grid gap-6 md:grid-cols-2">
            {partners.map((partner: Partner) => (
              <Card
                key={partner.id}
                className="border-white/20 bg-black/70 transition-colors hover:bg-black/80"
              >
                <CardContent className="p-6">
                  <h2 className="mb-2 text-xl font-bold text-white">
                    {partner.company_name}
                  </h2>
                  <p className="mb-4 text-sm text-white/60">
                    Trusted partner of Sasquatch Carpet Cleaning
                  </p>
                  {partner.company_website && (
                    <a
                      href={
                        partner.company_website.startsWith('http')
                          ? partner.company_website
                          : `https://${partner.company_website}`
                      }
                      target="_blank"
                      rel="noopener"
                      className="inline-flex items-center gap-2 text-white transition-colors hover:text-white/80"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Visit{' '}
                      {partner.company_website
                        .replace(/^https?:\/\//, '')
                        .replace(/\/$/, '')}
                    </a>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Why Become a Partner */}
        <div className="mt-16">
          <Card className="border-white/20 bg-black/80">
            <CardContent className="px-8 py-10">
              <h2 className="mb-6 text-center text-3xl font-bold text-white">
                Why Become a Partner?
              </h2>

              <div className="mb-10 grid gap-8 md:grid-cols-2">
                {/* Benefit 1 */}
                <div className="flex gap-4">
                  <div className="text-4xl">💰</div>
                  <div>
                    <h3 className="mb-2 text-xl font-bold text-white">
                      Earn $25 Per Referral
                    </h3>
                    <p className="text-white/70">
                      Every time someone you refer books a cleaning, you earn
                      $25 in credits. No limits on how much you can earn.
                    </p>
                  </div>
                </div>

                {/* Benefit 2 */}
                <div className="flex gap-4">
                  <div className="text-4xl">🏠</div>
                  <div>
                    <h3 className="mb-2 text-xl font-bold text-white">
                      Free Cleanings
                    </h3>
                    <p className="text-white/70">
                      Use your credits toward your own carpet, tile, or
                      upholstery cleaning. A few referrals = a free whole house
                      cleaning.
                    </p>
                  </div>
                </div>

                {/* Benefit 3 */}
                <div className="flex gap-4">
                  <div className="text-4xl">📊</div>
                  <div>
                    <h3 className="mb-2 text-xl font-bold text-white">
                      Track Everything
                    </h3>
                    <p className="text-white/70">
                      Your own partner dashboard shows referrals, conversions,
                      and credit balance in real-time. Full transparency.
                    </p>
                  </div>
                </div>

                {/* Benefit 4 */}
                <div className="flex gap-4">
                  <div className="text-4xl">🔗</div>
                  <div>
                    <h3 className="mb-2 text-xl font-bold text-white">
                      Bonus: Add a Backlink
                    </h3>
                    <p className="text-white/70">
                      Add a Sasquatch link to your website and earn $25 per
                      referral instead of $20. Plus boost your SEO.
                    </p>
                  </div>
                </div>
              </div>

              {/* Who It's For */}
              <div className="mb-10 rounded-xl border border-white/10 bg-white/5 p-6">
                <h3 className="mb-4 text-center text-xl font-bold text-white">
                  Perfect For:
                </h3>
                <div className="grid gap-3 text-center md:grid-cols-3">
                  <div className="text-white/80">🏡 Real Estate Agents</div>
                  <div className="text-white/80">🔧 Property Managers</div>
                  <div className="text-white/80">🏢 HOA Managers</div>
                  <div className="text-white/80">🛋️ Interior Designers</div>
                  <div className="text-white/80">🧹 Cleaning Services</div>
                  <div className="text-white/80">🤝 Anyone Who Refers!</div>
                </div>
              </div>

              {/* CTA */}
              <div className="text-center">
                <Link
                  href="/partners/register"
                  className="inline-block rounded-xl bg-green-600 px-10 py-4 text-xl font-bold text-white shadow-lg shadow-green-600/30 transition-colors hover:bg-green-500"
                >
                  Join the Partner Program
                </Link>
                <p className="mt-4 text-sm text-white/50">
                  Free to join. Start earning today.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/20 bg-black/30 py-8 backdrop-blur-sm">
        <div className="mx-auto max-w-4xl px-4 text-center text-sm text-white/50">
          © {new Date().getFullYear()} Sasquatch Carpet Cleaning. All rights
          reserved.
        </div>
      </footer>
    </div>
  )
}
