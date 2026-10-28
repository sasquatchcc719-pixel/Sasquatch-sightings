'use client'
import { useEffect, useState } from 'react'
import type { UnscheduledFollowUp } from '@/lib/ops/unscheduled-follow-up'
import type { UnscheduledActivity } from '@/lib/ops/unscheduled-activity'
import { Button } from '@/components/ui/button'

function planDate(date: string, time?: string | null) {
  const day = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'America/Denver',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  if (!time) return `${day} · time not set`
  const [hour, minute] = time.split(':').map(Number)
  return `${day} at ${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'} MT`
}

export function UnscheduledFollowUpEditor({
  appointmentId,
  followUp,
  onSaved,
}: {
  appointmentId: string
  followUp: UnscheduledFollowUp | null
  onSaved: (followUp: UnscheduledFollowUp) => void
}) {
  const [date, setDate] = useState(followUp?.next_follow_up_date ?? '')
  const [time, setTime] = useState(followUp?.next_follow_up_time ?? '')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')
  const [events, setEvents] = useState<UnscheduledActivity[]>([])
  const [historyError, setHistoryError] = useState('')
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setHistoryError('')
    void (async () => {
      try {
        const response = await fetch(
          `/api/admin/ops/schedule/parked/${appointmentId}/activity`,
          { signal: controller.signal },
        )
        const result = await response.json()
        if (!response.ok)
          throw new Error(result.error || 'Failed to load contact history')
        if (!controller.signal.aborted) setEvents(result.events)
      } catch (error) {
        if (!controller.signal.aborted)
          setHistoryError(
            error instanceof Error
              ? error.message
              : 'Failed to load contact history',
          )
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [appointmentId, refresh])

  async function save() {
    if (!followUp) return
    setSaving(true)
    setStatus('')
    try {
      const response = await fetch('/api/admin/ops/schedule/parked', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointment_id: appointmentId,
          next_follow_up_date: date,
          next_follow_up_time: time || null,
          expected_updated_at: followUp.updated_at,
          ...(note.trim() ? { review_note: note.trim() } : {}),
        }),
      })
      const result = await response.json()
      if (!response.ok)
        throw new Error(result.error || 'Failed to save follow-up')
      onSaved(result.follow_up)
      setNote('')
      setStatus('Follow-up saved to history.')
      setRefresh((value) => value + 1)
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : 'Failed to save follow-up',
      )
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="mt-4 border-t border-slate-700 pt-4">
      <div
        className={`rounded-lg border p-3 ${followUp?.due ? 'border-amber-400/40 bg-amber-400/10' : 'border-cyan-400/30 bg-cyan-400/5'}`}
      >
        <h3 className="text-sm font-semibold">Harry’s next follow-up</h3>
        <p className="mt-1 text-sm">
          {followUp
            ? planDate(
                followUp.next_follow_up_date,
                followUp.next_follow_up_time,
              )
            : 'No follow-up plan available'}
        </p>
        <p className="mt-1 text-xs text-slate-300">
          {followUp?.due
            ? 'Due / overdue · awaiting a recorded review'
            : 'Saved follow-up plan'}{' '}
          · Mountain Time
        </p>
        <p className="mt-1 text-xs text-slate-400">
          A saved plan records the expected attempt; completed contact appears
          below.
        </p>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <label
            className="block text-xs font-medium"
            htmlFor={`follow-up-${appointmentId}`}
          >
            Next follow-up date
          </label>
          <input
            id={`follow-up-${appointmentId}`}
            type="date"
            min={new Date().toLocaleDateString('en-CA', {
              timeZone: 'America/Denver',
            })}
            value={date}
            onClick={(event) => {
              try {
                event.currentTarget.showPicker?.()
              } catch {}
            }}
            onChange={(event) => {
              setDate(event.target.value)
              setStatus('')
            }}
            className="mt-1 min-h-11 max-w-full rounded-md border border-slate-600 bg-slate-900 px-3 text-slate-100 [color-scheme:dark]"
            disabled={!followUp || saving}
          />
        </div>
        <div>
          <label
            className="block text-xs font-medium"
            htmlFor={`follow-up-time-${appointmentId}`}
          >
            Time (optional · MT)
          </label>
          <input
            id={`follow-up-time-${appointmentId}`}
            type="time"
            value={time}
            onClick={(event) => {
              try {
                event.currentTarget.showPicker?.()
              } catch {}
            }}
            onChange={(event) => {
              setTime(event.target.value)
              setStatus('')
            }}
            className="mt-1 min-h-11 rounded-md border border-slate-600 bg-slate-900 px-3 text-slate-100 [color-scheme:dark]"
            disabled={!followUp || saving}
          />
        </div>
      </div>
      <label
        className="mt-3 block text-xs font-medium"
        htmlFor={`follow-up-note-${appointmentId}`}
      >
        Review / contact outcome
      </label>
      <textarea
        id={`follow-up-note-${appointmentId}`}
        value={note}
        maxLength={2000}
        rows={2}
        placeholder="What happened, and what should Harry do next?"
        onChange={(event) => {
          setNote(event.target.value)
          setStatus('')
        }}
        disabled={!followUp || saving}
        className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 p-3 text-sm text-slate-100"
      />
      <Button
        type="button"
        variant="outline"
        className="mt-2 min-h-11"
        disabled={
          !date ||
          !followUp ||
          saving ||
          (date === followUp.next_follow_up_date &&
            time === (followUp.next_follow_up_time ?? '') &&
            !note.trim())
        }
        onClick={() => void save()}
      >
        {saving ? 'Saving…' : 'Save follow-up'}
      </Button>
      {status ? (
        <p role="status" className="mt-2 text-sm">
          {status}
        </p>
      ) : null}
      {followUp?.review_note ? (
        <p className="mt-3 text-sm text-slate-300">
          Last review: {followUp.review_note}
        </p>
      ) : null}
      <div className="mt-5 border-t border-slate-700 pt-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Contact & follow-up history</h3>
          <button
            type="button"
            className="min-h-11 text-xs text-cyan-300 underline"
            disabled={loading}
            onClick={() => setRefresh((value) => value + 1)}
          >
            Refresh history
          </button>
        </div>
        <p className="mb-3 text-xs text-slate-400">
          Latest 100 recorded events · Mountain Time. Customer communications
          can include other jobs.
        </p>
        {loading ? (
          <p className="text-sm text-slate-400">Loading contact history…</p>
        ) : historyError ? (
          <p role="alert" className="text-sm text-amber-200">
            {historyError}
          </p>
        ) : events.length ? (
          <ol
            className="max-h-96 space-y-4 overflow-y-auto pr-2"
            aria-label="Contact and follow-up events"
          >
            {events.map((event) => (
              <li key={event.id} className="border-l-2 border-cyan-400/30 pl-3">
                <p className="text-xs text-cyan-200">
                  {event.at
                    ? new Date(event.at).toLocaleString('en-US', {
                        timeZone: 'America/Denver',
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                        timeZoneName: 'short',
                      })
                    : 'Time not recorded'}
                </p>
                <p className="mt-1 text-sm font-medium">{event.title}</p>
                {event.actor ? (
                  <p className="text-xs text-slate-400">{event.actor}</p>
                ) : null}
                {event.detail ? (
                  <p className="mt-1 text-sm break-words whitespace-pre-wrap text-slate-300">
                    {event.detail}
                  </p>
                ) : null}
                {event.next_date ? (
                  <p className="mt-1 text-xs text-slate-400">
                    Next plan: {planDate(event.next_date, event.next_time)}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-slate-400">
            No contact or review activity recorded.
          </p>
        )}
      </div>
    </div>
  )
}
