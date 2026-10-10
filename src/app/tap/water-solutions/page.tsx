'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, Phone } from 'lucide-react'

export default function WaterSolutionsPage() {
  const cardId = useSearchParams().get('card')
  const cardHref = cardId ? `/tap?card=${encodeURIComponent(cardId)}` : '/tap'

  return (
    <main className="min-h-svh bg-[#f6f5ee] px-4 py-6 text-[#073e50]">
      <div className="mx-auto max-w-[1102px]">
        <Link
          href={cardHref}
          className="mb-5 inline-flex min-h-11 items-center gap-2 rounded px-2 font-semibold focus-visible:outline-2 focus-visible:outline-offset-4"
        >
          <ArrowLeft size={18} aria-hidden="true" /> Back to your card
        </Link>
        <h1 className="sr-only">Water Testing, Treatment & Leak Protection</h1>
        <figure>
          <Image
            src="/tap/water-solutions-flyer.png"
            alt="Sasquatch Carpet Cleaning: We Know Clean. And Clean Starts With Water. Start with an independent lab test, review results, choose a solution, then professional installation. Options include water softeners, whole-house filtration, reverse osmosis, specialty filtration and automatic emergency water shutoff. Recommendations follow lab results. Call (719) 249-8791 to arrange your water test."
            width={1102}
            height={1427}
            sizes="(max-width: 1134px) 100vw, 1102px"
            className="h-auto w-full rounded-lg shadow-lg"
            priority
          />
          <figcaption className="mt-4 text-center">
            <a
              href="/tap/water-solutions-flyer.png"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center rounded px-3 underline underline-offset-4 focus-visible:outline-2"
            >
              Open full-size image to zoom in
            </a>
          </figcaption>
        </figure>
        <a
          href="tel:+17192498791"
          className="mx-auto mt-3 flex max-w-md flex-col items-center gap-1 rounded-xl bg-[#073e50] px-5 py-4 text-center text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#073e50]"
        >
          <span className="font-semibold">Call to arrange your water test</span>
          <span className="flex items-center gap-2 text-2xl font-bold">
            <Phone size={22} aria-hidden="true" /> (719) 249-8791
          </span>
        </a>
        <a
          href="https://www.sasquatchcarpet.com"
          className="mt-5 flex min-h-11 items-center justify-center rounded text-sm underline underline-offset-4 focus-visible:outline-2"
        >
          www.sasquatchcarpet.com
        </a>
      </div>
    </main>
  )
}
