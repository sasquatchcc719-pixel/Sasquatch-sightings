'use client'

import { Button } from '@/components/ui/button'

function scrollToContact() {
  document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' })
}

const STANDARD_PRICING = [
  { label: 'Urine Eliminator Treatment', price: '$30' },
  { label: 'Step / Landing', price: '$4', unit: 'per step' },
  {
    label: 'Small Area / Walk-in Closet',
    sublabel: 'up to 100 sqft',
    price: '$30',
  },
  { label: 'Regular Room', sublabel: '100–200 sqft', price: '$46' },
  { label: 'Sasquatch Size Room', sublabel: '200–400 sqft', price: '$90' },
  { label: 'Monster Size Room', sublabel: '400–600 sqft', price: '$138' },
  { label: 'Jumbo Humongous Room', sublabel: '600–800 sqft', price: '$175' },
]

const LEGENDARY_PRICING = [
  { label: 'Step / Landing', price: '$6', unit: 'per step' },
  {
    label: 'Small Area / Walk-in Closet',
    sublabel: 'up to 100 sqft',
    price: '$50',
  },
  { label: 'Regular Room', sublabel: '100–200 sqft', price: '$75' },
  { label: 'Sasquatch Size Room', sublabel: '200–400 sqft', price: '$145' },
  { label: 'Monster Size Room', sublabel: '400–600 sqft', price: '$210' },
  { label: 'Jumbo Humongous Room', sublabel: '600–800 sqft', price: '$265' },
]

const ADD_ONS = [
  {
    title: 'Pre-Vacuuming',
    tagline: 'The detail that makes the difference.',
    description:
      "We vacuum before we clean — loosening dry soil so our extraction system can pull it out completely. It's the prep work most companies skip.",
    icon: '✨',
    highlights: [
      'Dry soil removal first',
      'Maximizes extraction',
      'Included on request',
    ],
  },
]

function PriceTable({ rows }: { rows: typeof STANDARD_PRICING }) {
  return (
    <div className="mb-6 divide-y divide-white/5 overflow-hidden rounded-xl border border-white/10">
      {rows.map((row) => (
        <div
          key={row.label}
          className="flex items-center justify-between px-4 py-2.5"
        >
          <div>
            <span className="text-sm text-white/80">{row.label}</span>
            {row.sublabel && (
              <span className="ml-2 text-xs text-white/35">{row.sublabel}</span>
            )}
          </div>
          <span className="text-sm font-semibold text-cyan-400">
            {row.price}
            {row.unit && (
              <span className="ml-1 text-xs font-normal text-white/35">
                /{row.unit}
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  )
}

export function ServicesSection() {
  return (
    <section className="bg-[#0a0a0a] px-4 py-20">
      <div className="container mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-14 text-center">
          <h2 className="mb-3 text-4xl font-light tracking-[0.15em] text-white md:text-5xl">
            OUR SERVICES
          </h2>
          <p className="text-sm tracking-[0.25em] text-cyan-400/70 uppercase">
            Professional. Thorough. Legendary.
          </p>
        </div>

        {/* Main service cards */}
        <div className="mb-6 grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* Standard Carpet Cleaning */}
          <div className="flex flex-col rounded-2xl border border-white/10 bg-white/5 p-8 transition-all duration-300 hover:-translate-y-1 hover:border-white/20">
            <div className="mb-4 text-4xl">🧹</div>
            <h3 className="mb-1 text-xl font-semibold tracking-wide text-white">
              Standard Carpet Cleaning
            </h3>
            <p className="mb-5 text-sm tracking-wider text-cyan-400/60 uppercase">
              Hot water extraction. Fresh results.
            </p>
            <PriceTable rows={STANDARD_PRICING} />
            <div className="mt-auto">
              <Button
                className="w-full border border-white/20 bg-transparent tracking-wider text-white hover:bg-white/10"
                onClick={scrollToContact}
              >
                BOOK NOW
              </Button>
            </div>
          </div>

          {/* Legendary Restoration Clean */}
          <div className="relative flex flex-col rounded-2xl border border-cyan-500/50 bg-gradient-to-b from-cyan-950/60 to-[#0d1a1a] p-8 shadow-lg shadow-cyan-500/10 transition-all duration-300 hover:-translate-y-1">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2">
              <span className="rounded-full bg-cyan-500 px-3 py-1 text-xs font-semibold tracking-widest text-black uppercase">
                Most Popular
              </span>
            </div>
            <div className="mb-4 text-4xl">⚡</div>
            <h3 className="mb-1 text-xl font-semibold tracking-wide text-white">
              Legendary Restoration Clean
            </h3>
            <p className="mb-5 text-sm tracking-wider text-cyan-400/60 uppercase">
              Deep clean. Legendary results.
            </p>
            <PriceTable rows={LEGENDARY_PRICING} />
            <div className="mt-auto">
              <Button
                className="w-full bg-gradient-to-r from-cyan-600 to-cyan-500 tracking-wider text-white hover:from-cyan-500 hover:to-cyan-400"
                onClick={scrollToContact}
              >
                BOOK NOW
              </Button>
            </div>
          </div>
        </div>

        {/* Add-on cards */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {ADD_ONS.map((service) => (
            <div
              key={service.title}
              className="flex flex-col rounded-2xl border border-white/10 bg-white/5 p-8 transition-all duration-300 hover:-translate-y-1 hover:border-white/20"
            >
              <div className="mb-3 text-3xl">{service.icon}</div>
              <h3 className="mb-1 text-lg font-semibold tracking-wide text-white">
                {service.title}
              </h3>
              <p className="mb-3 text-xs tracking-wider text-cyan-400/60 uppercase">
                {service.tagline}
              </p>
              <p className="mb-5 text-sm leading-relaxed text-white/60">
                {service.description}
              </p>
              <ul className="mb-6 space-y-2">
                {service.highlights.map((h) => (
                  <li
                    key={h}
                    className="flex items-center gap-2 text-sm text-white/70"
                  >
                    <span className="h-1 w-1 rounded-full bg-cyan-400" />
                    {h}
                  </li>
                ))}
              </ul>
              <div className="mt-auto">
                <Button
                  className="w-full border border-white/20 bg-transparent tracking-wider text-white hover:bg-white/10"
                  onClick={scrollToContact}
                >
                  ADD TO BOOKING
                </Button>
              </div>
            </div>
          ))}
        </div>

        {/* Add-ons note */}
        <p className="mt-4 text-center text-xs tracking-wider text-white/30">
          Pre-Vacuuming available as an add-on with any service.
        </p>
      </div>
    </section>
  )
}
