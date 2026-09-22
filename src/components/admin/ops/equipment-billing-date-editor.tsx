'use client'

import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function EquipmentBillingDateEditor({
  id,
  code,
  units,
  placedOn,
  removedOn,
  disabled = false,
  onSave,
}: {
  id: string
  code: string
  units: number
  placedOn: string
  removedOn: string | null
  disabled?: boolean
  onSave: (placedOn: string, removedOn: string | null) => Promise<boolean>
}) {
  const [inDate, setInDate] = useState(placedOn)
  const [outDate, setOutDate] = useState(removedOn ?? '')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    'idle',
  )

  const changed = inDate !== placedOn || outDate !== (removedOn ?? '')
  const valid = Boolean(inDate) && (!outDate || outDate >= inDate)

  return (
    <div
      id={id}
      className="border-border/60 bg-muted/25 mt-2 rounded-md border p-3"
    >
      <div className="mb-2 flex items-center justify-between gap-3 text-xs">
        <span className="font-medium">
          ×{units} {code} date{units === 1 ? '' : 's'}
        </span>
        <span className="text-muted-foreground">
          {outDate ? 'Pulled' : 'Running until an out date is saved'}
        </span>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-32 flex-1 flex-col gap-1 text-xs">
          <span className="text-muted-foreground">In</span>
          <Input
            aria-label={`${code} in date`}
            className="h-9"
            type="date"
            value={inDate}
            disabled={disabled || status === 'saving'}
            onChange={(event) => {
              setInDate(event.target.value)
              setStatus('idle')
            }}
          />
        </label>
        <label className="flex min-w-32 flex-1 flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Out</span>
          <Input
            aria-label={`${code} out date`}
            className="h-9"
            type="date"
            value={outDate}
            disabled={disabled || status === 'saving'}
            onChange={(event) => {
              setOutDate(event.target.value)
              setStatus('idle')
            }}
          />
        </label>
        <Button
          size="sm"
          className="h-9 min-w-28 bg-sky-600 text-white hover:bg-sky-500"
          disabled={disabled || status === 'saving' || !changed || !valid}
          onClick={async () => {
            setStatus('saving')
            const saved = await onSave(inDate, outDate || null)
            setStatus(saved ? 'saved' : 'error')
          }}
        >
          {status === 'saving' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : status === 'saved' ? (
            <Check className="h-4 w-4" />
          ) : null}
          {status === 'saving'
            ? 'Saving…'
            : status === 'saved'
              ? 'Saved'
              : 'Save dates'}
        </Button>
      </div>
      <div aria-live="polite" className="mt-1 min-h-4 text-xs">
        {!valid ? (
          <span className="text-destructive">
            Out date cannot be before the in date.
          </span>
        ) : status === 'error' ? (
          <span className="text-destructive">Could not save these dates.</span>
        ) : status === 'saved' ? (
          <span className="text-emerald-600 dark:text-emerald-400">
            Dates saved. The running bill has been refreshed.
          </span>
        ) : (
          <span className="text-muted-foreground">
            Set the actual out date to stop daily accrual.
          </span>
        )}
      </div>
    </div>
  )
}
