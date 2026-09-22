'use client'

import { useState } from 'react'
import { Check, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function RestorationChargeRemoveButton({
  label,
  target,
  amount,
  disabled = false,
  onRemove,
}: {
  label?: string
  target: string
  amount: number
  disabled?: boolean
  onRemove: () => Promise<boolean>
}) {
  const [status, setStatus] = useState<
    'idle' | 'deleting' | 'deleted' | 'error'
  >('idle')

  const buttonLabel = label ?? 'Remove'
  const formattedAmount = amount.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  })

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="text-destructive hover:text-destructive h-8 gap-1.5"
      disabled={disabled || status === 'deleting' || status === 'deleted'}
      aria-label={`${buttonLabel}: ${target}`}
      onClick={async () => {
        const confirmed = window.confirm(
          `Remove ${target}?\n\nThis removes exactly this charge (${formattedAmount}) from the running job total. It cannot be undone.`,
        )
        if (!confirmed) return

        setStatus('deleting')
        const removed = await onRemove()
        setStatus(removed ? 'deleted' : 'error')
      }}
    >
      {status === 'deleting' ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : status === 'deleted' ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <Trash2 className="h-3.5 w-3.5" />
      )}
      {status === 'deleting'
        ? 'Removing…'
        : status === 'deleted'
          ? 'Removed'
          : status === 'error'
            ? 'Try again'
            : buttonLabel}
    </Button>
  )
}
