'use client'

import { useState } from 'react'
import { AlertTriangle, Loader2, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  totalCustomerDeletionCount,
  type CustomerDeletionPreview,
} from '@/lib/ops/customer-deletion'

type Props = {
  customerId: string
  label: string
  onDeleted?: (customerId: string) => void
  redirectTo?: string
}

export function CustomerDeleteControl({
  customerId,
  label,
  onDeleted,
  redirectTo,
}: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [preview, setPreview] = useState<CustomerDeletionPreview | null>(null)
  const [error, setError] = useState('')

  async function inspect() {
    setOpen(true)
    setLoading(true)
    setError('')
    try {
      const response = await fetch(
        `/api/admin/ops/customers/${customerId}/deletion`,
        { cache: 'no-store' },
      )
      const result = await response.json()
      if (!response.ok)
        throw new Error(result.error || 'Unable to inspect record')
      setPreview(result.preview)
    } catch (inspectError) {
      setError(
        inspectError instanceof Error
          ? inspectError.message
          : 'Unable to inspect record',
      )
    } finally {
      setLoading(false)
    }
  }

  function close() {
    if (deleting) return
    setOpen(false)
    setPreview(null)
    setConfirmation('')
    setError('')
  }

  async function remove() {
    setDeleting(true)
    setError('')
    try {
      const response = await fetch(
        `/api/admin/ops/customers/${customerId}/deletion`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmation }),
        },
      )
      const result = await response.json()
      if (!response.ok) {
        if (result.preview) setPreview(result.preview)
        throw new Error(result.error || 'Unable to delete customer')
      }
      onDeleted?.(customerId)
      if (redirectTo) {
        window.location.assign(redirectTo)
      } else {
        setOpen(false)
        setPreview(null)
        setConfirmation('')
      }
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : 'Unable to delete customer',
      )
    } finally {
      setDeleting(false)
    }
  }

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="border-red-500/35 text-red-300 hover:bg-red-500/10 hover:text-red-200"
        onClick={() => void inspect()}
      >
        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
        Delete
      </Button>
    )
  }

  const blockers = preview?.blocking.filter((item) => item.count > 0) || []
  const removed = preview?.removed.filter((item) => item.count > 0) || []
  const detached = preview?.detached.filter((item) => item.count > 0) || []

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`delete-title-${customerId}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
    >
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-red-500/40 bg-slate-950 p-5 shadow-2xl shadow-black/60">
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-300" />
            <div>
              <p
                id={`delete-title-${customerId}`}
                className="font-semibold text-red-100"
              >
                Delete {label}?
              </p>
              <p className="mt-1 text-sm text-red-100/70">
                This permanently removes the local customer profile. The
                database keeps a recovery record of the deleted customer and
                addresses.
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close deletion panel"
            className="rounded-md p-1 text-red-100/60 hover:bg-white/10 hover:text-red-100"
            onClick={close}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-red-100/70">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking linked records…
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="mt-4 text-sm font-medium text-red-200">
            {error}
          </p>
        ) : null}

        {preview && blockers.length > 0 ? (
          <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-100">
            <p className="font-semibold">
              Deletion is blocked to protect history.
            </p>
            <p className="mt-1">
              Remove or resolve these records first:{' '}
              {blockers.map((item) => `${item.count} ${item.label}`).join(', ')}
              .
            </p>
          </div>
        ) : null}

        {preview?.canDelete ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-xl border border-red-500/20 bg-black/15 p-3 text-sm text-red-50/80">
              <p>
                The customer plus {totalCustomerDeletionCount(removed)} linked
                setup record
                {totalCustomerDeletionCount(removed) === 1 ? '' : 's'} will be
                removed.
              </p>
              {removed.length > 0 ? (
                <p className="mt-1 text-xs text-red-50/60">
                  {removed
                    .map((item) => `${item.count} ${item.label}`)
                    .join(', ')}
                </p>
              ) : null}
              {detached.length > 0 ? (
                <p className="mt-2 text-xs text-red-50/60">
                  Retained but disconnected:{' '}
                  {detached
                    .map((item) => `${item.count} ${item.label}`)
                    .join(', ')}
                  .
                </p>
              ) : null}
              {preview.customer.quickbooksCustomerId ? (
                <p className="mt-2 text-xs font-medium text-amber-200">
                  The QuickBooks customer is not deleted.
                </p>
              ) : null}
            </div>
            <div>
              <label
                htmlFor={`delete-confirm-${customerId}`}
                className="text-xs font-medium text-red-100"
              >
                Type DELETE to confirm
              </label>
              <Input
                id={`delete-confirm-${customerId}`}
                className="mt-1 border-red-500/35 bg-black/20"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="destructive"
                disabled={confirmation !== 'DELETE' || deleting}
                onClick={() => void remove()}
              >
                {deleting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-4 w-4" />
                )}
                Delete customer permanently
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={deleting}
                onClick={close}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
