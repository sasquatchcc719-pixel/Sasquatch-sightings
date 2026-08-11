'use client'

import {
  SERVICE_CITIES,
  zipOptionsForCity,
  type ServiceCity,
} from '@/lib/ops/service-cities'
import { cn } from '@/utils/tailwind'

type CityQuickPickProps = {
  /** Current city value, used to show which button is active. */
  value: string
  /**
   * Called with the picked city. Zip is only present for single-zip towns —
   * callers should leave an existing zip alone when it is undefined.
   */
  onPick: (picked: ServiceCity) => void
  /** Current zip value, used to show which zip button is active. */
  zipValue?: string
  /**
   * Called when a zip button is tapped. Omit to hide the zip row entirely
   * (callers that don't manage a zip field).
   */
  onPickZip?: (zip: string) => void
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
  zipValue,
  onPickZip,
  className,
}: CityQuickPickProps) {
  const current = value.trim().toLowerCase()

  // Multi-zip towns can't be auto-filled, so once one is picked we offer its
  // zips as buttons rather than making someone type a zip they work weekly.
  const zipOptions = onPickZip ? zipOptionsForCity(value) : []
  const currentZip = (zipValue ?? '').trim()

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex flex-wrap gap-1.5">
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

      {zipOptions.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-1.5"
          aria-label={`Zip codes for ${value.trim()}`}
        >
          <span className="text-muted-foreground text-[11px]">Zip</span>
          {zipOptions.map((zip) => {
            const active = currentZip === zip
            return (
              <button
                key={zip}
                type="button"
                aria-pressed={active}
                onClick={() => onPickZip?.(zip)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card hover:bg-accent text-muted-foreground',
                )}
              >
                {zip}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
