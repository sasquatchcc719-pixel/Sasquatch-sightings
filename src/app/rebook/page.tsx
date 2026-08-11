'use client'

/**
 * Landing page for the cleaning-reminder text.
 *
 * Deliberately the same light NFC booking widget the business cards use — no
 * marketing site chrome, no video background, straight into picking services.
 * Separate from /tap so reminder bookings get their own attribution and their
 * own promo code (REMIND20: $20 off $200+), rather than the NFC card's flat
 * SCC20.
 */

import { Suspense } from 'react'
import Image from 'next/image'
import { NfcBookingWidget } from '@/components/nfc/NfcBookingWidget'

const PROMO_CODE = 'REMIND20'
const PROMO_MIN_SPEND = 200
const LEAD_SOURCE_DETAIL = 'Cleaning reminder text'

function RebookContent() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <div className="mb-6 text-center">
        <Image
          src="/sasquatch-logo.svg"
          alt="Sasquatch Carpet Cleaning"
          width={96}
          height={96}
          className="mx-auto mb-4"
          priority
        />
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">
          Time for your next cleaning
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          You asked us to remind you — welcome back. Pick your services below
          and grab a time that works.
        </p>
        <p className="mt-3 inline-block rounded-full bg-green-600/10 px-4 py-2 text-sm font-bold text-green-700 dark:text-green-400">
          Code {PROMO_CODE} — $20 off jobs ${PROMO_MIN_SPEND}+
        </p>
      </div>

      <NfcBookingWidget
        couponCode={PROMO_CODE}
        cardId={null}
        leadSourceDetail={LEAD_SOURCE_DETAIL}
        onTrackClick={() => {}}
      />

      <p className="text-muted-foreground mt-6 text-center text-sm">
        Prefer to talk? Call or text{' '}
        <a href="tel:719-249-8791" className="font-semibold underline">
          719-249-8791
        </a>
      </p>
    </div>
  )
}

export default function RebookPage() {
  return (
    <Suspense fallback={null}>
      <RebookContent />
    </Suspense>
  )
}
