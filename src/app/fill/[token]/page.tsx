import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { CalendarCheck2, MapPin, ShieldCheck, Sparkles } from 'lucide-react'
import { NfcBookingWidget } from '@/components/nfc/NfcBookingWidget'
import { loadPublicTomorrowFillOffer } from '@/lib/ops/tomorrow-fill'

export const metadata: Metadata = {
  title: 'Tomorrow Fill Offer | Sasquatch Carpet Cleaning',
  description:
    'A private returning-customer offer from Sasquatch Carpet Cleaning.',
  robots: { index: false, follow: false },
}

function displayDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

function OfferUnavailable() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#06130f] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_10%,rgba(34,197,94,.17),transparent_34%),radial-gradient(circle_at_80%_30%,rgba(245,158,11,.1),transparent_28%)]" />
      <div className="relative mx-auto flex min-h-screen max-w-xl items-center px-5 py-14">
        <section className="w-full rounded-[2rem] border border-white/10 bg-white/[0.055] p-7 text-center shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-10">
          <Image
            src="/sasquatch-logo.svg"
            alt="Sasquatch Carpet Cleaning"
            width={104}
            height={104}
            className="mx-auto"
            priority
          />
          <p className="mt-6 text-xs font-bold tracking-[0.22em] text-emerald-300 uppercase">
            Private returning-customer offer
          </p>
          <h1 className="mt-3 text-3xl font-black tracking-tight">
            This opening has been claimed
          </h1>
          <p className="mx-auto mt-4 max-w-md leading-7 text-white/65">
            The limited Tomorrow Fill offer is no longer available, but we would
            still love to get your home back on the schedule.
          </p>
          <Link
            href="/book"
            className="mt-7 inline-flex rounded-xl bg-emerald-500 px-6 py-3 font-bold text-emerald-950 transition hover:bg-emerald-400"
          >
            View regular availability
          </Link>
          <p className="mt-6 text-sm text-white/50">
            Prefer a person? Call or text{' '}
            <a
              className="font-semibold text-white underline"
              href="tel:7192498791"
            >
              719-249-8791
            </a>
          </p>
        </section>
      </div>
    </main>
  )
}

export default async function TomorrowFillPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const offer = await loadPublicTomorrowFillOffer(token)
  if (!offer?.available) return <OfferUnavailable />

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#06130f] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_5%,rgba(16,185,129,.18),transparent_30%),radial-gradient(circle_at_88%_18%,rgba(245,158,11,.11),transparent_26%),linear-gradient(to_bottom,transparent,#020806)]" />
      <div className="relative mx-auto max-w-6xl px-4 py-7 sm:px-6 sm:py-11">
        <header className="mb-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Image
              src="/sasquatch-logo.svg"
              alt="Sasquatch Carpet Cleaning"
              width={64}
              height={64}
              priority
            />
            <div>
              <p className="text-sm font-black tracking-wide">SASQUATCH</p>
              <p className="text-[10px] font-semibold tracking-[0.18em] text-emerald-300 uppercase">
                Carpet Cleaning
              </p>
            </div>
          </div>
          <a
            href="tel:7192498791"
            className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white/80"
          >
            719-249-8791
          </a>
        </header>

        <section className="mb-7 overflow-hidden rounded-[2rem] border border-emerald-300/20 bg-gradient-to-br from-emerald-400/15 via-white/[0.06] to-amber-400/10 p-6 shadow-2xl shadow-black/25 backdrop-blur-xl sm:p-9">
          <div className="grid gap-8 lg:grid-cols-[1.25fr_.75fr] lg:items-center">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1.5 text-xs font-bold tracking-wider text-amber-200 uppercase">
                <Sparkles className="h-3.5 w-3.5" /> A route opened near you
              </div>
              <h1 className="mt-5 max-w-3xl text-4xl font-black tracking-[-0.035em] sm:text-5xl">
                We can clean your home{' '}
                <span className="text-emerald-300">
                  {displayDate(offer.targetDate)}
                </span>
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-white/68 sm:text-lg">
                Because our crew is already in your ZIP code, we saved this
                private opening for a small group of returning customers.
              </p>
            </div>
            <div className="rounded-2xl border border-amber-300/25 bg-black/20 p-5 text-center">
              <p className="text-xs font-bold tracking-[0.2em] text-amber-200 uppercase">
                Your private offer
              </p>
              <p className="mt-2 text-5xl font-black text-white">
                ${offer.offerAmount} off
              </p>
              <p className="mt-2 text-sm text-white/60">
                cleanings of ${offer.minimumSubtotal}+
              </p>
              <p className="mt-4 rounded-lg bg-white/8 px-3 py-2 font-mono text-sm font-bold tracking-widest text-emerald-300">
                {offer.offerCode}
              </p>
            </div>
          </div>
          <div className="mt-7 grid gap-3 border-t border-white/10 pt-6 sm:grid-cols-3">
            {[
              [
                CalendarCheck2,
                'Tomorrow reserved',
                'Choose any opening that fits your job',
              ],
              [
                MapPin,
                'Already nearby',
                `Serving ${offer.customer.zip_code} that day`,
              ],
              [
                ShieldCheck,
                'No surprise terms',
                'Your discount appears on the invoice',
              ],
            ].map(([Icon, title, detail]) => {
              const FeatureIcon = Icon as typeof CalendarCheck2
              return (
                <div
                  key={String(title)}
                  className="flex gap-3 rounded-xl bg-white/[0.045] p-3"
                >
                  <FeatureIcon className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
                  <div>
                    <p className="text-sm font-bold">{String(title)}</p>
                    <p className="mt-0.5 text-xs leading-5 text-white/50">
                      {String(detail)}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <NfcBookingWidget
          appearance="forest"
          couponCode={offer.offerCode}
          cardId={null}
          leadSourceKey="repeat_customer"
          leadSourceDetail={`Tomorrow Fill SMS · ${offer.offerCode}`}
          campaignToken={token}
          preferredDate={offer.targetDate}
          initialCustomer={offer.customer}
        />

        <footer className="mx-auto mt-8 max-w-2xl text-center text-xs leading-6 text-white/35">
          Limited to the first two qualifying bookings or until route capacity
          is filled. Jobs requiring a longer appointment keep the discount and
          may be offered the next available date. Reply STOP to opt out of
          promotional texts.
        </footer>
      </div>
    </main>
  )
}
