'use client'

import { SERVICE_CITIES, type ServiceCity } from '@/lib/ops/service-cities'
import { cn } from '@/utils/tailwind'

type CityQuickPickProps = {
  /** Current city value, used to show which button is active. */
  value: string
  /**
   * Called with the picked city. Zip is only present for single-zip towns —
   * callers should leave an existing zip alone when it is undefined.
   */
  onPick: (picked: ServiceCity) => void
  className?: string
}

/**
 * One-tap buttons for the towns we work in, so the common case never gets
 * typed (and never gets misspelled). Anywhere else is still typed by hand
 * in the City field below.
 */
export function CityQuickPick({
  value,
  onPick,
  className,
}: CityQuickPickProps) {
  const current = value.trim().toLowerCase()

  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {SERVICE_CITIES.map((entry) => {
        const active = current === entry.city.toLowerCase()
        return (
          <button
            key={entry.city}
            type="button"
            aria-pressed={active}
            onClick={() => onPick(entry)}
            className={cn(
              'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
              active
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card hover:bg-accent text-muted-foreground',
            )}
          >
            {entry.city}
          </button>
        )
      })}
    </div>
  )
}
