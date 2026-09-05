'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, Loader2, Mail, ShieldCheck, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { commercialFetch } from '@/components/client/commercial-details'
import { buildCommercialSetupEmailDraft } from '@/lib/ops/commercial-setup-email'

export type CommercialSetupContact = {
  id?: string
  display_name: string
  email: string
}

export type CommercialSetupAgreement = {
  id: string
  version: number
  content: { title: string }
}

export function CommercialSetupEmailReview({
  businessName,
  customerId,
  contact,
  agreement,
  onClose,
}: {
  businessName: string
  customerId: string
  contact: CommercialSetupContact
  agreement: CommercialSetupAgreement
  onClose: () => void
}) {
  const initial = buildCommercialSetupEmailDraft({
    businessName,
    contactName: contact.display_name,
    contactEmail: contact.email,
    agreementTitle: agreement.content.title,
    agreementVersion: agreement.version,
  })
  const [subject, setSubject] = useState(initial.subject)
  const [body, setBody] = useState(initial.body)
  const [operationId] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [portalContactId, setPortalContactId] = useState(contact.id)
  const [attempted, setAttempted] = useState(false)
  const [warning, setWarning] = useState('')
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  async function send() {
    setBusy(true)
    setError('')
    try {
      let contactId = portalContactId
      if (!contactId) {
        const result = await commercialFetch(
          `/api/admin/ops/commercial/${customerId}/users`,
          'POST',
          {
            display_name: contact.display_name || businessName,
            email: contact.email,
            can_sign_agreements: true,
          },
        )
        contactId = result.contact.id
        setPortalContactId(contactId)
      }
      setAttempted(true)
      const result = await commercialFetch(
        `/api/admin/ops/commercial/${customerId}/users/${contactId}/send-setup`,
        'POST',
        {
          agreement_id: agreement.id,
          operation_id: operationId,
          subject,
          body,
        },
      )
      setWarning(result.warning || '')
      setSent(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to send setup email')
    } finally {
      setBusy(false)
    }
  }

  // The workspace shell uses a backdrop filter, which otherwise makes a fixed
  // dialog anchor to the scrolled page instead of the viewport.
  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      className="fixed inset-0 z-[240] overflow-y-auto bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="commercial-email-review-title"
    >
      <div className="mx-auto my-4 max-w-6xl overflow-hidden rounded-3xl border border-cyan-300/20 bg-slate-950 text-slate-100 shadow-2xl shadow-cyan-950/40">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 bg-gradient-to-r from-cyan-950/80 to-emerald-950/50 px-6 py-5">
          <div>
            <p className="text-xs font-semibold tracking-[0.18em] text-cyan-300 uppercase">
              Customer delivery
            </p>
            <h2
              id="commercial-email-review-title"
              className="mt-1 text-2xl font-bold"
            >
              Review setup email before sending
            </h2>
            <p className="mt-1 text-sm text-slate-300">
              Nothing is sent until you approve the final email below.
            </p>
          </div>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Close email review"
            onClick={onClose}
            disabled={busy}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {sent ? (
          <div className="p-10 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-400" />
            <h3 className="mt-4 text-2xl font-semibold">
              Customer setup email sent
            </h3>
            <p className="mt-2 text-slate-300">
              Sent the agreement PDF, setup instructions, and secure portal link
              to {contact.email}. They choose their password, save business
              details, and sign in their own account.
            </p>
            {warning && (
              <p role="status" className="mt-3 text-amber-300">
                {warning}
              </p>
            )}
            <Button className="mt-6" onClick={onClose}>
              Done
            </Button>
          </div>
        ) : (
          <div className="grid lg:grid-cols-[1.05fr_0.95fr]">
            <div className="space-y-4 border-b border-white/10 p-6 lg:border-r lg:border-b-0">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <p className="text-xs text-slate-500">Recipient</p>
                  <p className="mt-1 font-medium">{contact.display_name}</p>
                  <p className="text-sm text-slate-400">{contact.email}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <p className="text-xs text-slate-500">Agreement</p>
                  <p className="mt-1 font-medium">{agreement.content.title}</p>
                  <p className="text-sm text-slate-400">
                    Published version {agreement.version}
                  </p>
                </div>
              </div>
              <label className="block text-sm">
                <span className="mb-1 block text-slate-300">Subject</span>
                <Input
                  value={subject}
                  disabled={attempted || busy}
                  onChange={(event) => setSubject(event.target.value)}
                  maxLength={200}
                  className="border-white/15 bg-black/30"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-slate-300">Message</span>
                <Textarea
                  value={body}
                  disabled={attempted || busy}
                  onChange={(event) => setBody(event.target.value)}
                  rows={21}
                  maxLength={10000}
                  className="border-white/15 bg-black/30 font-sans text-sm leading-6"
                />
              </label>
            </div>

            <div className="bg-slate-900/60 p-6">
              <p className="mb-3 text-xs font-semibold tracking-[0.16em] text-slate-400 uppercase">
                Customer preview
              </p>
              <div className="overflow-hidden rounded-2xl bg-white text-slate-800 shadow-xl">
                <div className="bg-[#2d6a4f] px-6 py-5 text-center text-lg font-bold text-white">
                  Sasquatch Carpet Cleaning
                </div>
                <div className="p-6">
                  <p className="text-xs font-semibold text-slate-500">
                    {subject || 'Email subject'}
                  </p>
                  <div className="mt-5 max-h-[490px] overflow-y-auto text-sm leading-6 whitespace-pre-wrap">
                    {body || 'Email message'}
                  </div>
                  <div className="mt-6 rounded-lg bg-[#2d6a4f] px-5 py-3 text-center font-semibold text-white">
                    Open portal and review agreement
                  </div>
                  <p className="mt-3 text-center text-xs text-slate-500">
                    A secure one-time sign-in link is created only when you
                    press Send.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {!sent && (
          <div className="flex flex-col gap-3 border-t border-white/10 bg-slate-900/80 px-6 py-4 sm:flex-row sm:items-center">
            <p className="flex flex-1 items-center gap-2 text-xs text-slate-400">
              <ShieldCheck className="h-4 w-4 text-cyan-300" />
              Sending authorizes this recipient to sign for this business. Their
              legal name and consent are collected at signing.
            </p>
            {error && <p className="text-sm text-red-300">{error}</p>}
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
              onClick={() => void send()}
              disabled={
                busy || subject.trim().length < 5 || body.trim().length < 100
              }
            >
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Mail className="mr-2 h-4 w-4" />
              )}
              {busy ? 'Sending…' : 'Send customer setup'}
            </Button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
