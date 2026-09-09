'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { Check, Loader2, Mail, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type EstimateInput = {
  customer_id: string | null
  customer: {
    first_name: string
    last_name: string
    email: string
    phone: string
  }
  address:
    | { id: string }
    | {
        street_1: string
        street_2: string
        city: string
        state: string
        zip_code: string
      }
  line_items: Array<{
    service_catalog_item_id: string | null
    name_snapshot: string
    quantity: number
    unit_price: number
  }>
  promo_code: string | null
  discount_amount: number
}

type EstimatePreview = {
  to_email: string
  subject: string
  body_text: string
  html: string
  total: number
  preview_fingerprint: string
}

export function ResidentialEstimatePanel({
  estimateMode,
  onModeChange,
  input,
  onEmailChange,
  onNameChange,
  disabled,
  onBusyChange,
}: {
  estimateMode: boolean
  onModeChange: (value: boolean) => void
  input: EstimateInput
  onEmailChange: (value: string) => void
  onNameChange: (value: string) => void
  disabled: boolean
  onBusyChange: (value: boolean) => void
}) {
  const [busy, setBusy] = useState<'preview' | 'send' | null>(null)
  const inFlight = useRef(false)
  const lastRequest = useRef<{ payload: string; id: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [review, setReview] = useState<{
    preview: EstimatePreview
    payload: string
    requestId: string
  } | null>(null)
  const [sent, setSent] = useState<{
    to_email: string
    total: number
    payload: string
    warning?: string | null
  } | null>(null)
  const payload = JSON.stringify({
    ...input,
    recipient_email: input.customer.email.trim(),
  })
  const currentReview = review?.payload === payload ? review : null
  const alreadySent = sent?.payload === payload
  const ready = input.customer.email.trim() && input.line_items.length > 0

  async function request(action: 'preview' | 'send') {
    if (
      inFlight.current ||
      disabled ||
      !ready ||
      (action === 'send' && (!currentReview || alreadySent))
    )
      return
    inFlight.current = true
    setBusy(action)
    onBusyChange(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/ops/residential-estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...JSON.parse(payload),
          action,
          ...(action === 'send' && currentReview
            ? {
                expected_fingerprint: currentReview.preview.preview_fingerprint,
                request_id: currentReview.requestId,
              }
            : {}),
        }),
      })
      const result = await response.json()
      if (!response.ok) {
        if (
          result.code === 'request_expired' ||
          result.code === 'request_reused'
        ) {
          lastRequest.current = null
          setReview(null)
        }
        if (response.status === 409 && action === 'send') setReview(null)
        throw new Error(result.error || 'Unable to prepare the estimate email.')
      }
      if (action === 'preview') {
        if (lastRequest.current?.payload !== payload) {
          lastRequest.current = {
            payload,
            id: `${Date.now()}-${crypto.randomUUID()}`,
          }
        }
        setReview({
          preview: result,
          payload,
          requestId: lastRequest.current.id,
        })
      } else {
        setSent({
          to_email: result.to_email,
          total: currentReview!.preview.total,
          payload,
          warning: result.warning,
        })
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to confirm sending. Retry this send to check its status.',
      )
    } finally {
      inFlight.current = false
      setBusy(null)
      onBusyChange(false)
    }
  }

  return (
    <Card
      id="email-estimate"
      className="border-teal-400/30 bg-gradient-to-br from-teal-500/10 to-transparent p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <Mail className="h-5 w-5 text-teal-400" /> Email an estimate
          </h3>
          <p className="text-muted-foreground mt-1 max-w-lg text-sm">
            Send these services and prices to the customer. No appointment or
            time slot is reserved.
          </p>
        </div>
        <Button
          type="button"
          variant={estimateMode ? 'outline' : 'default'}
          aria-expanded={estimateMode}
          aria-controls="email-estimate-details"
          disabled={disabled || !!busy}
          onClick={() => onModeChange(!estimateMode)}
        >
          {estimateMode ? 'Continue to booking' : 'Email estimate instead'}
        </Button>
      </div>
      {estimateMode ? (
        <div id="email-estimate-details" className="mt-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="estimate-email">Send estimate to *</Label>
              <Input
                id="estimate-email"
                type="email"
                autoComplete="email"
                placeholder="customer@example.com"
                value={input.customer.email}
                disabled={!!busy}
                onChange={(event) => onEmailChange(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="estimate-first-name">First name (optional)</Label>
              <Input
                id="estimate-first-name"
                autoComplete="given-name"
                placeholder="For the email greeting"
                value={input.customer.first_name}
                disabled={!!busy}
                onChange={(event) => onNameChange(event.target.value)}
              />
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            Uses the line items and discounts above. Customer and address
            details below are optional for an estimate.
          </p>
          {!ready ? (
            <p className="text-sm text-amber-600 dark:text-amber-300">
              Select at least one service and enter an email address to preview.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
          {sent ? (
            <div
              role="status"
              className="space-y-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm"
            >
              <p className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Estimate email sent to{' '}
                  <strong className="break-all">{sent.to_email}</strong> for{' '}
                  <strong>${sent.total.toFixed(2)}</strong>. No appointment was
                  created.
                </span>
              </p>
              {sent.warning ? (
                <p className="text-amber-600 dark:text-amber-300">
                  {sent.warning}
                </p>
              ) : null}
              <Link
                className="underline underline-offset-4"
                href="/admin/email-outbox"
              >
                View email outbox
              </Link>
            </div>
          ) : null}
          {currentReview && !alreadySent ? (
            <div className="bg-background/70 space-y-3 rounded-xl border border-teal-400/30 p-4">
              <div className="text-sm">
                <p className="break-all">
                  <span className="text-muted-foreground">To:</span>{' '}
                  {currentReview.preview.to_email}
                </p>
                <p className="mt-1">
                  <span className="text-muted-foreground">Subject:</span>{' '}
                  {currentReview.preview.subject}
                </p>
              </div>
              <iframe
                title="Estimate email preview"
                srcDoc={currentReview.preview.html}
                sandbox=""
                className="h-[28rem] w-full rounded-lg border bg-white"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={disabled || !!busy}
                  className="gap-2"
                  onClick={() => void request('send')}
                >
                  {busy === 'send' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  {busy === 'send' ? 'Sending…' : 'Send estimate email'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!!busy}
                  onClick={() => setReview(null)}
                >
                  Close preview
                </Button>
              </div>
            </div>
          ) : !alreadySent ? (
            <Button
              type="button"
              disabled={disabled || !!busy || !ready}
              className="gap-2"
              onClick={() => void request('preview')}
            >
              {busy === 'preview' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Mail className="h-4 w-4" />
              )}
              {busy === 'preview'
                ? 'Preparing preview…'
                : 'Preview estimate email'}
            </Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  )
}
