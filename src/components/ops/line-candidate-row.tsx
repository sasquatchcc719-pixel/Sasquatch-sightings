'use client'

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

const ACTION_BUTTON = 'bg-sky-600 text-white hover:bg-sky-500'

/**
 * One candidate line, used by both the scan results and the manual picker —
 * they are the same interaction: see what it is, set how much, add it.
 *
 * The quantity box opens pre-filled (from a spoken number, or from what the room
 * measured out at) so the common case is one tap, and correcting it is one edit.
 */
export function LineCandidateRow({
  code,
  label,
  unit,
  unitPrice,
  defaultQuantity,
  billable = true,
  onAdd,
  onDismiss,
}: {
  code: string
  label: string
  unit: string
  unitPrice: number
  defaultQuantity: number
  billable?: boolean
  onAdd: (quantity: number) => void | Promise<void>
  onDismiss?: () => void
}) {
  const [quantity, setQuantity] = useState(String(defaultQuantity))
  const amount = Number(quantity) > 0 ? Number(quantity) * unitPrice : 0

  return (
    <div className="hover:bg-muted/40 border-border/60 flex items-center gap-2 border-t px-3 py-2.5 text-sm first:border-t-0">
      <span className="min-w-0 flex-1">
        <span className="leading-snug">
          <code className="font-mono text-xs tracking-tight text-sky-600 dark:text-sky-400">
            {code}
          </code>{' '}
          {label}
        </span>
        <span className="text-muted-foreground mt-0.5 block text-xs tabular-nums">
          ${unitPrice.toFixed(2)} per {unit}
          {amount > 0 ? ` · ${money(amount)}` : ''}
          {billable ? '' : ' · not linked to QuickBooks'}
        </span>
      </span>
      <Input
        className="h-9 w-20 text-right"
        type="number"
        step="any"
        min={0}
        placeholder={unit}
        aria-label={`Quantity for ${label}`}
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && Number(quantity) > 0) void onAdd(Number(quantity))
        }}
      />
      <Button
        size="sm"
        className={ACTION_BUTTON}
        disabled={!(Number(quantity) > 0)}
        onClick={() => void onAdd(Number(quantity))}
      >
        Add
      </Button>
      {onDismiss ? (
        <button type="button" aria-label={`Dismiss ${label}`} onClick={onDismiss}>
          <Trash2 className="text-muted-foreground h-4 w-4" />
        </button>
      ) : null}
    </div>
  )
}
