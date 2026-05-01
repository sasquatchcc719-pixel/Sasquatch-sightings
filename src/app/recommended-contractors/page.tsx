'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import {
  ArrowLeft,
  ChevronRight,
  ExternalLink,
  MessageSquare,
  Phone,
  Wrench,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { VideoBackground } from '@/components/public/VideoBackground'
import {
  contractorCategories,
  type ContractorCategory,
} from '@/lib/recommended-contractors'

function formatWebsite(url: string) {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

function buildTextMessage(category: ContractorCategory) {
  return `Hi Charles, I found your recommended contractors page. Who do you recommend for ${category.label.toLowerCase()}?`
}

const brandAccentClasses = {
  amber: 'border-amber-300/70 bg-amber-300/15 text-amber-100',
  green: 'border-green-300/70 bg-green-300/15 text-green-100',
}

export default function RecommendedContractorsPage() {
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    null,
  )

  return (
    <div className="relative min-h-screen overflow-hidden">
      <VideoBackground video="clouds" />

      <main className="relative z-10 mx-auto max-w-2xl px-4 py-8">
        <Link
          href="/tap"
          className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-white/80 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Sasquatch card
        </Link>

        <Card className="mb-6 border-white/20 bg-black/80 p-6">
          <div className="mb-4 flex items-start gap-3">
            <div className="rounded-full bg-green-500/20 p-3 text-green-300">
              <Wrench className="h-6 w-6" />
            </div>
            <div>
              <p className="mb-1 text-sm font-semibold tracking-wide text-green-200 uppercase">
                Sasquatch local list
              </p>
              <h1 className="text-3xl font-black text-white">
                Recommended Local Contractors
              </h1>
            </div>
          </div>
          <p className="text-sm leading-6 text-white/80">
            Customers ask Sasquatch who we trust for work outside carpet
            cleaning. Pick a service below and we will point you toward the
            local pros we recommend.
          </p>
        </Card>

        <div className="mb-6 grid gap-3">
          {contractorCategories.map((category) => {
            const isSelected = category.id === selectedCategoryId

            return (
              <div key={category.id} className="overflow-hidden rounded-xl">
                <button
                  type="button"
                  onClick={() =>
                    setSelectedCategoryId(isSelected ? null : category.id)
                  }
                  className={`w-full border p-4 text-left shadow transition-all ${
                    isSelected
                      ? 'rounded-t-xl border-green-300 bg-green-500/20'
                      : 'rounded-xl border-white/20 bg-black/75 hover:border-white/40 hover:bg-black/85'
                  }`}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h2 className="font-bold text-white">{category.label}</h2>
                      <p className="mt-1 text-sm text-white/65">
                        {category.description}
                      </p>
                    </div>
                    <ChevronRight
                      className={`h-5 w-5 shrink-0 text-white/70 transition-transform ${
                        isSelected ? 'rotate-90' : ''
                      }`}
                    />
                  </div>
                </button>

                {isSelected && (
                  <div className="rounded-b-xl border-x border-b border-green-300/60 bg-black/80 p-4">
                    <p className="mb-2 text-sm font-semibold tracking-wide text-green-200 uppercase">
                      {category.shortLabel}
                    </p>
                    <h2 className="mb-4 text-xl font-black text-white">
                      Who we recommend
                    </h2>

                    {category.companies.length > 0 ? (
                      <div className="space-y-4">
                        {category.companies.map((company) => (
                          <Card
                            key={company.name}
                            className="border-white/10 bg-white/10 p-4"
                          >
                            <div className="flex items-start gap-3">
                              {company.brand && (
                                <div
                                  className={`flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border text-sm font-black ${brandAccentClasses[company.brand.accent]}`}
                                >
                                  {company.brand.logoSrc ? (
                                    <Image
                                      src={company.brand.logoSrc}
                                      alt=""
                                      width={40}
                                      height={40}
                                      className="h-10 w-10 object-contain"
                                    />
                                  ) : (
                                    company.brand.initials
                                  )}
                                </div>
                              )}
                              <div>
                                <h3 className="text-lg font-bold text-white">
                                  {company.name}
                                </h3>
                                <p className="mt-2 text-sm leading-6 text-white/75">
                                  {company.whyRecommended}
                                </p>
                              </div>
                            </div>
                            {company.notes && (
                              <p className="mt-2 text-xs leading-5 text-white/60">
                                {company.notes}
                              </p>
                            )}
                            <div className="mt-4 flex flex-wrap gap-2">
                              {company.phone && (
                                <Button asChild size="sm">
                                  <a href={`tel:${company.phone}`}>
                                    <Phone className="h-4 w-4" />
                                    Call
                                  </a>
                                </Button>
                              )}
                              {company.website && (
                                <Button asChild size="sm" variant="outline">
                                  <a
                                    href={company.website}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    <ExternalLink className="h-4 w-4" />
                                    {formatWebsite(company.website)}
                                  </a>
                                </Button>
                              )}
                              {company.googleMapsUrl && (
                                <Button asChild size="sm" variant="outline">
                                  <a
                                    href={company.googleMapsUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    <ExternalLink className="h-4 w-4" />
                                    Google listing
                                  </a>
                                </Button>
                              )}
                            </div>
                          </Card>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-white/10 bg-white/10 p-5">
                        <h3 className="text-lg font-bold text-white">
                          Ask Sasquatch for this recommendation
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-white/75">
                          We are still filling in the public list for this
                          category. If you need someone now, call or text and
                          ask who we recommend for{' '}
                          {category.label.toLowerCase()}.
                        </p>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <Button
                            asChild
                            className="bg-blue-600 hover:bg-blue-700"
                          >
                            <a href="tel:719-249-8791">
                              <Phone className="h-4 w-4" />
                              Call Sasquatch
                            </a>
                          </Button>
                          <Button asChild variant="outline">
                            <a
                              href={`sms:719-249-8791?body=${encodeURIComponent(
                                buildTextMessage(category),
                              )}`}
                            >
                              <MessageSquare className="h-4 w-4" />
                              Text Sasquatch
                            </a>
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <p className="text-center text-xs leading-5 text-white/55">
          Recommendations are based on Sasquatch Carpet Cleaning&apos;s local
          experience and customer conversations. Always verify licensing,
          insurance, availability, and pricing before hiring any contractor.
        </p>
      </main>
    </div>
  )
}
