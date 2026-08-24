'use client'

import { AlertCircle, CheckCircle2, History } from 'lucide-react'
import {
  formatPaymentTextPhone,
  formatPaymentTextStamp,
  paymentTextTypeLabel,
  type PaymentTextSend,
} from '@/lib/ops/payment-texts'

function sendSummary(send: PaymentTextSend): string {
  const stamp = formatPaymentTextStamp(send.sent_at)
  const phone = formatPaymentTextPhone(send.recipient_phone)
  const who = send.sent_by?.trim()
  const prefix = send.status === 'failed' ? 'Last send failed' : 'Sent'
  const parts = [
    stamp ? `${prefix} ${stamp}` : prefix,
    phone ? `to ${phone}` : null,
    who ? `by ${who}` : null,
  ].filter(Boolean)
  return parts.join(' · ')
}

export function PaymentTextLastSent({
  send,
  tone = 'light',
}: {
  send: PaymentTextSend | null
  tone?: 'light' | 'dark'
}) {
  const failed = send?.status === 'failed'
  if (!send) {
    return (
      <p
        className={`mt-2 text-xs ${tone === 'dark' ? 'text-neutral-400' : 'text-blue-800/70'}`}
      >
        No payment text sent yet.
      </p>
    )
  }

  return (
    <p
      className={`mt-2 flex items-start gap-1.5 text-xs ${
        failed
          ? 'text-red-400'
          : tone === 'dark'
            ? 'text-emerald-300'
            : 'text-emerald-700'
      }`}
    >
      {failed ? (
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      ) : (
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      )}
      <span>{sendSummary(send)}</span>
    </p>
  )
}

export function PaymentTextHistoryList({
  sends,
  tone = 'light',
}: {
  sends: PaymentTextSend[]
  tone?: 'light' | 'dark'
}) {
  const dark = tone === 'dark'
  return (
    <div
      className={
        dark
          ? 'mt-4 rounded-xl border border-white/10 bg-black/30 p-4'
          : 'border-border/60 bg-muted/20 mt-5 rounded-xl border p-4'
      }
    >
      <p
        className={`mb-3 flex items-center gap-2 text-xs font-semibold tracking-widest uppercase ${
          dark ? 'text-slate-400' : 'text-muted-foreground'
        }`}
      >
        <History className="h-3.5 w-3.5 shrink-0" />
        Payment texts
      </p>
      {sends.length === 0 ? (
        <p
          className={`text-sm ${dark ? 'text-slate-400' : 'text-muted-foreground'}`}
        >
          No Square, Venmo, or invoice payment text has been sent for this
          invoice yet.
        </p>
      ) : (
        <div className="space-y-2">
          {sends.map((send) => {
            const failed = send.status === 'failed'
            return (
              <div
                key={send.id}
                className={
                  dark
                    ? 'flex items-start justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2'
                    : 'flex items-start justify-between gap-3 rounded-lg border border-black/5 bg-white/60 px-3 py-2'
                }
              >
                <div className="min-w-0">
                  <p
                    className={`text-sm font-medium ${dark ? 'text-white' : ''}`}
                  >
                    {paymentTextTypeLabel(send.message_type)}
                    {failed ? (
                      <span className="ml-2 text-xs font-semibold text-red-400">
                        Failed
                      </span>
                    ) : (
                      <span
                        className={`ml-2 text-xs font-semibold ${dark ? 'text-emerald-300' : 'text-emerald-700'}`}
                      >
                        Sent
                      </span>
                    )}
                  </p>
                  <p
                    className={`mt-0.5 text-xs ${dark ? 'text-slate-400' : 'text-muted-foreground'}`}
                  >
                    {formatPaymentTextPhone(send.recipient_phone)}
                    {send.sent_by ? ` · ${send.sent_by}` : ''}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-xs ${dark ? 'text-slate-400' : 'text-muted-foreground'}`}
                >
                  {formatPaymentTextStamp(send.sent_at)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
