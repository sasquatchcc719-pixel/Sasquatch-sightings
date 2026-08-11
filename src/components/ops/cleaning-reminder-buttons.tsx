'use client'

/**
 * "Text me a reminder" buttons for job close-out.
 *
 * Rendered on both the admin invoice detail page and the tech job screen, so
 * Charles and any tech can set it while standing with the customer. Pressing a
 * button texts the customer an immediate confirmation and queues the future
 * reminder; the row then shows what's set with a Cancel, because this gets
 * tapped on a phone in the field and mis-taps must be undoable.
 */

import { useCallback, useEffect, useState } from 'react'
import { BellRing, Check, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Declared locally, not imported from lib/ops/cleaning-reminders — that module
// pulls in Twilio and the service-role Supabase client, which must never reach
// the browser bundle.
const REMINDER_INTERVALS = [3, 6, 12] as const

type Reminder = {
  id: string
  interval_months: number
  scheduled_for: string
}

function formatDue(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Denver',
    month: 'long',
    year: 'numeric',
  })
}

export function CleaningReminderButtons({
  appointmentId,
  tone = 'admin',
}: {
  appointmentId: string
  /** `tech` matches the dark field UI; `admin` matches the dashboard cards. */
  tone?: 'admin' | 'tech'
}) {
  const [reminder, setReminder] = useState<Reminder | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<number | 'cancel' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const isTech = tone === 'tech'

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/ops/cleaning-reminders?appointmentId=${encodeURIComponent(appointmentId)}`,
        { cache: 'no-store' },
      )
      const data = await res.json()
      if (res.ok) setReminder(data.reminder ?? null)
    } catch {
      // A failed read just leaves the buttons in their default state.
    } finally {
      setLoading(false)
    }
  }, [appointmentId])

  useEffect(() => {
    void load()
  }, [load])

  const setMonths = async (months: number) => {
    setBusy(months)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/ops/cleaning-reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appointmentId, months }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Could not set the reminder')
        return
      }
      setReminder({
        id: data.reminderId,
        interval_months: data.months,
        scheduled_for: data.scheduledFor,
      })
      // The reminder is saved either way — say so plainly if the confirmation
      // text itself failed, so nobody tells the customer it went out.
      setNotice(
        data.confirmationSent
          ? 'Confirmation text sent.'
          : `Reminder saved, but the confirmation text failed: ${data.confirmationError ?? 'unknown error'}`,
      )
    } catch {
      setError('Could not set the reminder')
    } finally {
      setBusy(null)
    }
  }

  const cancel = async () => {
    if (!reminder) return
    setBusy('cancel')
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(
        `/api/ops/cleaning-reminders?id=${encodeURIComponent(reminder.id)}`,
        { method: 'DELETE' },
      )
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Could not cancel the reminder')
        return
      }
      setReminder(null)
      setNotice('Reminder cancelled.')
    } catch {
      setError('Could not cancel the reminder')
    } finally {
      setBusy(null)
    }
  }

  const shellClass = isTech
    ? 'rounded-2xl border border-white/10 bg-white/[0.06] p-4'
    : 'rounded-2xl border border-border/60 bg-muted/30 p-4'
  const labelClass = isTech
    ? 'text-sm font-semibold text-white'
    : 'text-sm font-semibold'
  const subClass = isTech
    ? 'text-xs text-white/60'
    : 'text-muted-foreground text-xs'

  if (loading) {
    return (
      <div className={shellClass}>
        <div className={subClass}>Loading reminder…</div>
      </div>
    )
  }

  return (
    <div className={shellClass}>
      <div className="mb-1 flex items-center gap-2">
        <BellRing className={isTech ? 'h-4 w-4 text-white/70' : 'h-4 w-4'} />
        <span className={labelClass}>Next cleaning reminder</span>
      </div>

      {reminder ? (
        <>
          <p className={subClass}>
            Set for {reminder.interval_months} months out — texting them around{' '}
            <span className="font-semibold">
              {formatDue(reminder.scheduled_for)}
            </span>
            .
          </p>
          <Button
            type="button"
            variant={isTech ? 'secondary' : 'outline'}
            size="sm"
            className="mt-3 gap-2"
            disabled={busy !== null}
            onClick={() => void cancel()}
          >
            {busy === 'cancel' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <X className="h-3.5 w-3.5" />
            )}
            Cancel reminder
          </Button>
        </>
      ) : (
        <>
          <p className={subClass}>
            Texts them a confirmation now, then a reminder when it&apos;s time.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {REMINDER_INTERVALS.map((months) => (
              <Button
                key={months}
                type="button"
                variant={isTech ? 'secondary' : 'outline'}
                size="sm"
                className="gap-2"
                disabled={busy !== null}
                onClick={() => void setMonths(months)}
              >
                {busy === months ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                {months === 12 ? '1 year' : `${months} months`}
              </Button>
            ))}
          </div>
        </>
      )}

      {notice ? (
        <p
          className={`mt-2 flex items-center gap-1.5 text-xs ${
            notice.startsWith('Reminder saved, but')
              ? 'text-amber-500'
              : isTech
                ? 'text-emerald-300'
                : 'text-emerald-600'
          }`}
        >
          <Check className="h-3.5 w-3.5 shrink-0" />
          {notice}
        </p>
      ) : null}
      {error ? <p className="text-destructive mt-2 text-xs">{error}</p> : null}
    </div>
  )
}
