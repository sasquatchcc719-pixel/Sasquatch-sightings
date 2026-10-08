'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Ban, Loader2, ShieldCheck, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

type Props = {
  customerId: string
  label: string
  isBlacklisted: boolean
  reason?: string | null
  onChanged: (blacklisted: boolean, reason: string | null) => void
}

export function CustomerBlacklistControl({
  customerId,
  label,
  isBlacklisted,
  reason,
  onChanged,
}: Props) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [nextReason, setNextReason] = useState(reason || '')
  const [error, setError] = useState('')

  function close() {
    if (saving) return
    setOpen(false)
    setNextReason(reason || '')
    setError('')
  }

  async function updateBlacklist() {
    setSaving(true)
    setError('')
    try {
      const response = await fetch(
        `/api/admin/ops/customers/${customerId}/blacklist`,
        isBlacklisted
          ? { method: 'DELETE' }
          : {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ reason: nextReason }),
            },
      )
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Unable to update blacklist')
      }

      onChanged(
        !isBlacklisted,
        isBlacklisted ? null : nextReason.trim() || null,
      )
      setOpen(false)
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : 'Unable to update blacklist',
      )
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant={isBlacklisted ? 'destructive' : 'outline'}
        className={
          isBlacklisted
            ? 'gap-1.5'
            : 'gap-1.5 border-red-500/35 text-red-300 hover:bg-red-500/10 hover:text-red-200'
        }
        onClick={() => setOpen(true)}
      >
        <Ban className="h-3.5 w-3.5" />
        {isBlacklisted ? 'Blacklisted' : 'Blacklist'}
      </Button>
    )
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`blacklist-title-${customerId}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-lg rounded-2xl border border-red-500/40 bg-slate-950 p-5 shadow-2xl shadow-black/60">
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-3">
            {isBlacklisted ? (
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
            ) : (
              <Ban className="mt-0.5 h-5 w-5 shrink-0 text-red-300" />
            )}
            <div>
              <p
                id={`blacklist-title-${customerId}`}
                className="font-semibold text-red-100"
              >
                {isBlacklisted
                  ? `Remove ${label} from the blacklist?`
                  : `Blacklist ${label}?`}
              </p>
              <p className="mt-1 text-sm text-red-100/70">
                {isBlacklisted
                  ? 'This allows calls, texts, and web bookings again. Email suppression stays on until you turn it off separately.'
                  : 'This blocks calls, texts, outgoing messages, and web bookings. Pending campaigns and review requests will be cancelled.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close blacklist panel"
            className="rounded-md p-1 text-red-100/60 hover:bg-white/10 hover:text-red-100"
            onClick={close}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!isBlacklisted ? (
          <div className="mt-4">
            <label
              htmlFor={`blacklist-reason-${customerId}`}
              className="text-xs font-medium text-red-100"
            >
              Internal reason (optional)
            </label>
            <Textarea
              id={`blacklist-reason-${customerId}`}
              className="mt-1 min-h-20 border-red-500/35 bg-black/20"
              value={nextReason}
              onChange={(event) => setNextReason(event.target.value)}
              placeholder="Why should this customer not be accepted?"
            />
          </div>
        ) : reason ? (
          <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-100/80">
            <span className="font-medium">Reason:</span> {reason}
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="mt-4 text-sm font-medium text-red-200">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-2">
          <Button
            type="button"
            variant={isBlacklisted ? 'outline' : 'destructive'}
            disabled={saving}
            onClick={() => void updateBlacklist()}
          >
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : isBlacklisted ? (
              <ShieldCheck className="mr-2 h-4 w-4" />
            ) : (
              <Ban className="mr-2 h-4 w-4" />
            )}
            {isBlacklisted ? 'Remove from blacklist' : 'Blacklist customer'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={saving}
            onClick={close}
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
