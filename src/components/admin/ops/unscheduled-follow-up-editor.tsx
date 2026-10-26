'use client'
import { useState } from 'react'
import type { UnscheduledFollowUp } from '@/lib/ops/unscheduled-follow-up'
import { Button } from '@/components/ui/button'

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
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')
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
          expected_updated_at: followUp.updated_at,
        }),
      })
      const result = await response.json()
      if (!response.ok)
        throw new Error(result.error || 'Failed to save follow-up')
      onSaved(result.follow_up)
      setStatus('Follow-up date saved.')
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : 'Failed to save follow-up',
      )
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="mt-4 border-t border-slate-700 pt-3">
      <label
        className="block text-sm font-medium"
        htmlFor={`follow-up-${appointmentId}`}
      >
        Next follow-up · Mountain Time
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
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
          className="min-h-11 rounded-md border border-slate-600 bg-slate-900 px-3 text-slate-100 [color-scheme:dark]"
          disabled={!followUp || saving}
        />
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={
            !date ||
            !followUp ||
            saving ||
            date === followUp.next_follow_up_date
          }
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : 'Save follow-up date'}
        </Button>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        {followUp
          ? followUp.due
            ? 'Due for review. Check recent contact before reaching out.'
            : 'Saved for a future review.'
          : 'Follow-up date unavailable. Refresh to try again.'}
      </p>
      {followUp?.review_note ? (
        <p className="mt-2 text-xs text-slate-300">
          Last review: {followUp.review_note}
        </p>
      ) : null}
      {status ? (
        <p role="status" className="mt-2 text-sm">
          {status}
        </p>
      ) : null}
    </div>
  )
}
