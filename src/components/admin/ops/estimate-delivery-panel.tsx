'use client'

import { useRef, useState } from 'react'
import { Loader2, Mail, RotateCcw, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export type EstimateSendConfirmation = {
  reopen: boolean
  reason: string
  request_id: string
}

export type LastQuoteEmail = { to_email: string; sent_at: string }

export function EstimateDeliveryPanel({
  status,
  converted,
  email,
  total,
  blockedReason,
  busy,
  lastEmail,
  historyUnavailable,
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
  onSend: (
    confirmation: EstimateSendConfirmation,
  ) => Promise<{ to_email: string; warning: string | null }>
}) {
  const [requestId, setRequestId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [sending, setSending] = useState(false)
  const inFlight = useRef(false)
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

  async function send() {
    if (
      !requestId ||
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
    <Card className="space-y-4 border-sky-400/30 bg-gradient-to-br from-sky-500/10 to-transparent p-6">
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
            onClick={() => {
              setResult(null)
              setError(null)
              setRequestId(`${Date.now()}-${crypto.randomUUID()}`)
            }}
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
          <h3 className="font-semibold">
            Confirm {reopen ? 'reopen and resend' : 'estimate email'}
          </h3>
          <p className="text-sm">
            Send the current line items and pricing to{' '}
            <strong className="break-all">{email}</strong> for{' '}
            <strong>${total.toFixed(2)}</strong>?
          </p>
          <p className="text-muted-foreground text-sm">
            {reopen
              ? `This changes ${status === 'accepted' ? 'Accepted' : 'Declined'} to Sent — awaiting a new customer decision. It does not authorize or schedule work.`
              : 'The customer receives a link to review and accept or decline. Sending alone does not approve or schedule work.'}
          </p>
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
                sending || busy || !!blocked || (reopen && !reason.trim())
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
                setReason('')
                setError(null)
              }}
            >
              Cancel
            </Button>
          </div>
          {error ? (
            <p
              role="alert"
              className="text-sm text-rose-600 dark:text-rose-300"
            >
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
      {result ? (
        <div
          role="status"
          className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm"
        >
          <p>
            Estimate email sent to <strong>{result.to_email}</strong>.
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
