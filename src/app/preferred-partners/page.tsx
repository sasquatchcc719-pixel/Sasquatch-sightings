import { Metadata } from 'next'
import { createAdminClient } from '@/supabase/server'
import { Card, CardContent } from '@/components/ui/card'
import { ExternalLink } from 'lucide-react'
import Link from 'next/link'

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
    <div className="min-h-screen bg-gradient-to-b from-green-950 to-black">
      {/* Header */}
      <header className="border-b border-green-800/50 bg-black/50">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <Link href="/" className="flex items-center gap-2">
            <img
              src="/vector6-no-background.svg"
              alt="Sasquatch Carpet Cleaning"
              className="h-10 w-auto"
            />
            <span className="font-bold text-white">
              Sasquatch Carpet Cleaning
            </span>
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-4xl px-4 py-12">
        <div className="mb-12 text-center">
          <h1 className="mb-4 text-4xl font-bold text-white">
            Our Preferred Partners
          </h1>
          <p className="mx-auto max-w-2xl text-lg text-green-200/80">
            These trusted local businesses refer their clients to us. We&apos;re
            proud to recommend them in return.
          </p>
        </div>

        {!partners || partners.length === 0 ? (
          <Card className="border-green-800/50 bg-green-900/20">
            <CardContent className="py-12 text-center">
              <p className="text-green-200/60">
                Our partner program is just getting started. Check back soon!
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            {partners.map((partner: Partner) => (
              <Card
                key={partner.id}
                className="border-green-800/50 bg-green-900/20 transition-colors hover:bg-green-900/30"
              >
                <CardContent className="p-6">
                  <h2 className="mb-2 text-xl font-bold text-white">
                    {partner.company_name}
                  </h2>
                  <p className="mb-4 text-sm text-green-200/60">
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
                      className="inline-flex items-center gap-2 text-green-400 transition-colors hover:text-green-300"
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

        {/* CTA for becoming a partner */}
        <div className="mt-16 text-center">
          <Card className="border-green-600/50 bg-gradient-to-r from-green-800/30 to-green-700/30">
            <CardContent className="py-8">
              <h3 className="mb-2 text-xl font-bold text-white">
                Want to become a partner?
              </h3>
              <p className="mb-4 text-green-200/70">
                Join our referral program and earn credits for every client you
                send our way.
              </p>
              <Link
                href="/partners/register"
                className="inline-block rounded-lg bg-green-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-green-500"
              >
                Register as a Partner
              </Link>
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-green-800/50 bg-black/50 py-8">
        <div className="mx-auto max-w-4xl px-4 text-center text-sm text-green-200/50">
          © {new Date().getFullYear()} Sasquatch Carpet Cleaning. All rights
          reserved.
        </div>
      </footer>
    </div>
  )
}
