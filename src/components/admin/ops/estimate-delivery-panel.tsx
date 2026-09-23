'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Mail, RotateCcw, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export type EstimateSendConfirmation = {
  reopen: boolean
  reason: string
  request_id: string
  expected_fingerprint: string
}

export type LastQuoteEmail = { to_email: string; sent_at: string }

export type EstimateEmailPreview = {
  to_email: string
  subject: string
  body_text: string
  html: string
  total: number
  preview_fingerprint: string
}

export function EstimateDeliveryPanel({
  status,
  converted,
  email,
  total,
  blockedReason,
  busy,
  lastEmail,
  historyUnavailable,
  openConfirmationRequest = 0,
  onPreview,
  onSend,
}: {
  status: string
  converted: boolean
  email: string
  total: number
  blockedReason: string | null
  busy: boolean
  lastEmail: LastQuoteEmail | null
  historyUnavailable: boolean
  openConfirmationRequest?: number
  onPreview: (requestId: string) => Promise<EstimateEmailPreview>
  onSend: (
    confirmation: EstimateSendConfirmation,
  ) => Promise<{ to_email: string; warning: string | null }>
}) {
  const [requestId, setRequestId] = useState<string | null>(null)
  const [preview, setPreview] = useState<EstimateEmailPreview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [reason, setReason] = useState('')
  const [sending, setSending] = useState(false)
  const inFlight = useRef(false)
  const previewInFlight = useRef(false)
  const lastHandledOpenRequest = useRef(0)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    to_email: string
    warning: string | null
  } | null>(null)
  const reopen = status === 'accepted' || status === 'declined'
  const action = reopen
    ? 'Reopen & resend'
    : status === 'sent' || lastEmail
      ? 'Resend estimate'
      : 'Send estimate'
  const blocked = converted
    ? 'Already converted to a job. Use the service appointment for further changes.'
    : blockedReason

  const openConfirmation = useCallback(async () => {
    if (previewInFlight.current || busy || blocked) return
    const nextRequestId = `${Date.now()}-${crypto.randomUUID()}`
    previewInFlight.current = true
    setResult(null)
    setError(null)
    setPreview(null)
    setRequestId(nextRequestId)
    setPreviewing(true)
    try {
      setPreview(await onPreview(nextRequestId))
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to prepare the email preview.',
      )
    } finally {
      previewInFlight.current = false
      setPreviewing(false)
    }
  }, [blocked, busy, onPreview])

  useEffect(() => {
    if (
      !openConfirmationRequest ||
      openConfirmationRequest === lastHandledOpenRequest.current
    )
      return

    lastHandledOpenRequest.current = openConfirmationRequest
    if (converted) return
    void openConfirmation()
  }, [converted, openConfirmation, openConfirmationRequest])

  async function send() {
    if (
      !requestId ||
      !preview ||
      inFlight.current ||
      busy ||
      blocked ||
      (reopen && !reason.trim())
    )
      return
    inFlight.current = true
    setSending(true)
    setError(null)
    try {
      const sent = await onSend({
        reopen,
        reason: reason.trim(),
        request_id: requestId,
        expected_fingerprint: preview.preview_fingerprint,
      })
      setResult(sent)
      setRequestId(null)
      setReason('')
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to confirm sending. Check email history before starting another send.',
      )
    } finally {
      inFlight.current = false
      setSending(false)
    }
  }

  return (
    <Card
      id="estimate-delivery-panel"
      className="space-y-4 border-sky-400/30 bg-gradient-to-br from-sky-500/10 to-transparent p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Mail className="h-5 w-5 text-sky-500" /> Send or resend estimate
          </h2>
          <p className="mt-2 text-sm break-all">
            To:{' '}
            <span className="font-semibold">
              {email.trim() ||
                'No email address — add one in contact information below.'}
            </span>
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            Current estimate:{' '}
            <span className="font-semibold tabular-nums">
              ${total.toFixed(2)}
            </span>{' '}
            · Saves current edits before emailing.
          </p>
        </div>
        {!requestId && !converted ? (
          <Button
            className="gap-2 bg-sky-600 font-semibold text-white hover:bg-sky-500"
            disabled={busy || !!blocked}
            onClick={() => void openConfirmation()}
          >
            {reopen ? (
              <RotateCcw className="h-4 w-4" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {action}
          </Button>
        ) : null}
      </div>
      <p className="text-muted-foreground text-xs">
        {historyUnavailable
          ? 'Email history is temporarily unavailable.'
          : lastEmail
            ? `Last estimate email sent ${new Date(lastEmail.sent_at).toLocaleString()} to ${lastEmail.to_email}. Sent does not confirm the customer read or approved it.`
            : 'No estimate email is recorded. Manually marking an estimate sent does not email the customer.'}
      </p>
      {blocked ? (
        <p className="text-sm text-amber-600 dark:text-amber-300">{blocked}</p>
      ) : null}
      {requestId && !converted ? (
        <div className="bg-background/70 space-y-3 rounded-xl border border-sky-400/30 p-4">
          <h3 className="font-semibold">Review the exact customer email</h3>
          <p className="text-muted-foreground text-sm">
            {reopen
              ? `This changes ${status === 'accepted' ? 'Accepted' : 'Declined'} to Sent — awaiting a new customer decision. It does not authorize or schedule work.`
              : 'The customer receives a link to review and accept or decline. Sending alone does not approve or schedule work.'}
          </p>
          {previewing ? (
            <div
              role="status"
              className="flex items-center gap-2 rounded-lg border p-4 text-sm"
            >
              <Loader2 className="h-4 w-4 animate-spin" /> Saving current edits
              and preparing the exact email…
            </div>
          ) : null}
          {preview ? (
            <div className="space-y-3">
              <div className="rounded-lg border bg-slate-950/5 p-3 text-sm dark:bg-white/5">
                <p className="break-all">
                  <span className="text-muted-foreground">To:</span>{' '}
                  <strong>{preview.to_email}</strong>
                </p>
                <p className="mt-1">
                  <span className="text-muted-foreground">Subject:</span>{' '}
                  <strong>{preview.subject}</strong>
                </p>
                <p className="mt-1">
                  <span className="text-muted-foreground">Total:</span>{' '}
                  <strong>${preview.total.toFixed(2)}</strong>
                </p>
              </div>
              <iframe
                title="Estimate email preview"
                srcDoc={preview.html}
                sandbox=""
                className="h-[34rem] w-full rounded-lg border bg-white"
              />
              <p className="text-muted-foreground text-xs">
                This is the customer-facing email, including service notes, line
                items, discounts or trade credits, totals, and the accept
                button.
              </p>
            </div>
          ) : null}
          {reopen ? (
            <div className="space-y-2">
              <Label htmlFor="estimate-reopen-reason">
                Reason for reopening (required, internal only)
              </Label>
              <Textarea
                id="estimate-reopen-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={1000}
                disabled={sending}
                placeholder="For example: customer says they did not receive or approve the estimate."
              />
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              className="gap-2 bg-sky-600 text-white hover:bg-sky-500"
              disabled={
                sending ||
                previewing ||
                busy ||
                !preview ||
                !!blocked ||
                (reopen && !reason.trim())
              }
              onClick={() => void send()}
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {sending
                ? 'Sending…'
                : reopen
                  ? 'Confirm reopen & send'
                  : 'Confirm & send email'}
            </Button>
            <Button
              variant="outline"
              disabled={sending}
              onClick={() => {
                setRequestId(null)
                setPreview(null)
                setReason('')
                setError(null)
              }}
            >
              Cancel
            </Button>
          </div>
          {error ? (
            <div className="space-y-2">
              <p
                role="alert"
                className="text-sm text-rose-600 dark:text-rose-300"
              >
                {error}
              </p>
              {!preview && !previewing ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void openConfirmation()}
                >
                  Retry email preview
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {result ? (
        <div
          id="estimate-delivery-result"
          role="status"
          aria-live="polite"
          className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm"
        >
          <p className="font-semibold text-emerald-700 dark:text-emerald-300">
            Email sent successfully
          </p>
          <p className="mt-1">
            The estimate was sent to <strong>{result.to_email}</strong>.
          </p>
          {result.warning ? (
            <p className="mt-2 text-amber-600 dark:text-amber-300">
              {result.warning}
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  )
}
