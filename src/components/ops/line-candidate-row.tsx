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
 *
 * Equipment gets a second box. "Eight fans" is never eight of anything billable:
 * it is eight units running some number of days, and the price sheet charges per
 * 24 hours. Multiplying it in your head is exactly the arithmetic this replaces,
 * so the row shows both numbers and does the multiply where you can see it.
 */
export function LineCandidateRow({
  code,
  label,
  unit,
  unitPrice,
  defaultQuantity,
  billable = true,
  daily = false,
  defaultDays = 1,
  onAdd,
  onDismiss,
}: {
  code: string
  label: string
  unit: string
  unitPrice: number
  defaultQuantity: number
  billable?: boolean
  /** Priced per 24-hour period — ask for units and days, not a quantity. */
  daily?: boolean
  defaultDays?: number
  onAdd: (
    quantity: number,
    parts?: { units: number; days: number },
  ) => void | Promise<void>
  onDismiss?: () => void
}) {
  const [quantity, setQuantity] = useState(String(defaultQuantity))
  const [days, setDays] = useState(String(defaultDays))

  const units = Number(quantity)
  const dayCount = daily ? Number(days) : 1
  const total = daily ? units * dayCount : units
  const valid = units > 0 && (!daily || dayCount > 0)
  const amount = valid ? total * unitPrice : 0

  const submit = () => {
    if (!valid) return
    void onAdd(total, daily ? { units, days: dayCount } : undefined)
  }

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
          ${unitPrice.toFixed(2)} per {daily ? 'day' : unit}
          {daily && valid
            ? ` · ${units} × ${dayCount} day${dayCount === 1 ? '' : 's'} = ${total}`
            : ''}
          {amount > 0 ? ` · ${money(amount)}` : ''}
          {billable ? '' : ' · not linked to QuickBooks'}
        </span>
      </span>
      <Input
        className="h-9 w-16 text-right"
        type="number"
        step="any"
        min={0}
        placeholder={daily ? 'how many' : unit}
        aria-label={daily ? `How many for ${label}` : `Quantity for ${label}`}
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
        }}
      />
      {daily ? (
        <>
          <span className="text-muted-foreground text-xs">×</span>
          <Input
            className="h-9 w-14 text-right"
            type="number"
            step="any"
            min={0}
            aria-label={`Days for ${label}`}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
          />
          <span className="text-muted-foreground text-xs">days</span>
        </>
      ) : null}
      <Button size="sm" className={ACTION_BUTTON} disabled={!valid} onClick={submit}>
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
