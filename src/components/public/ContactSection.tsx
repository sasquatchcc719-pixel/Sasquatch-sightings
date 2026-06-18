'use client'

import { Phone, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'

const PHONE = '7192498791'
const PHONE_DISPLAY = '(719) 249-8791'
const SMS_BODY = encodeURIComponent(
  "Hi! I'm interested in carpet cleaning. Can I get a quote?",
)

export function ContactSection() {
  return (
    <section id="contact" className="bg-[#0a0a0a] px-4 py-20">
      <div className="container mx-auto max-w-2xl text-center">
        <h2 className="mb-3 text-4xl font-light tracking-[0.15em] text-white md:text-5xl">
          BOOK YOUR CLEAN
        </h2>
        <p className="mb-2 text-sm tracking-[0.25em] text-cyan-400/70 uppercase">
          Fast · Easy · No Forms
        </p>
        <p className="mb-10 text-sm text-white/50">
          Text us and we&apos;ll get you a quote and schedule your appointment —
          right from your phone.
        </p>

        <div className="flex flex-col gap-4 sm:flex-row sm:justify-center">
          <Button
            size="lg"
            className="border-0 bg-gradient-to-r from-cyan-600 to-cyan-500 px-10 py-6 text-lg tracking-wider text-white shadow-lg shadow-cyan-500/25 transition-all hover:scale-105 hover:from-cyan-500 hover:to-cyan-400"
            asChild
          >
            <a href={`sms:${PHONE}?body=${SMS_BODY}`}>
              <MessageSquare className="mr-2 h-5 w-5" />
              TEXT TO BOOK
            </a>
          </Button>

          <Button
            size="lg"
            variant="outline"
            className="border-white/30 bg-white/5 px-10 py-6 text-lg tracking-wider text-white backdrop-blur-sm transition-all hover:scale-105 hover:border-white/50 hover:bg-white/10"
            asChild
          >
            <a href={`tel:+1${PHONE}`}>
              <Phone className="mr-2 h-5 w-5" />
              {PHONE_DISPLAY}
            </a>
          </Button>
        </div>

        <p className="mt-8 text-xs tracking-wider text-white/30">
          $150 minimum · Serving Colorado&apos;s Front Range · Monument ·
          Colorado Springs · Castle Rock
        </p>
      </div>
    </section>
  )
}
