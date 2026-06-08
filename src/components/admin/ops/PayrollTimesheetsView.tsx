'use client'

import { FormEvent, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'

type StaffRow = {
  id: string
  user_id: string | null
  display_name: string
  role: string
}

type TimesheetEntry = {
  id: string
  staffUserId: string
  staffDisplayName: string
  staffRole: string
  workDate: string
  startedAt: string
  endedAt: string
  breakMinutes: number
  payableMinutes: number
  workType: string
  source: string
  status: string
  notes: string | null
}

type EntryFormState = {
  staffUserId: string
  startTime: string
  endTime: string
  breakMinutes: string
  workType: string
  notes: string
}

const DEFAULT_FORM: EntryFormState = {
  staffUserId: '',
  startTime: '08:00',
  endTime: '17:00',
  breakMinutes: '0',
  workType: 'training',
  notes: '',
}

function fmtMin(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function toIso(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString()
}

async function fetchStaff(): Promise<StaffRow[]> {
  const res = await fetch('/api/admin/ops/staff')
  if (!res.ok) throw new Error('Failed to load staff')
  const data = await res.json()
  return data.staff || []
}

async function fetchEntries(
  date: string,
  staffUserId: string,
): Promise<{ entries: TimesheetEntry[]; totalPayableMinutes: number }> {
  const params = new URLSearchParams({ date })
  if (staffUserId) params.set('staffUserId', staffUserId)

  const res = await fetch(
    `/api/admin/ops/payroll/timesheet-entries?${params.toString()}`,
  )
  if (!res.ok) throw new Error('Failed to load payroll timesheets')
  return res.json()
}

export function PayrollTimesheetsView() {
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
  const [staffFilter, setStaffFilter] = useState('')
  const [form, setForm] = useState<EntryFormState>(DEFAULT_FORM)
  const [newWorkerName, setNewWorkerName] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const staffQuery = useQuery({
    queryKey: ['payroll-staff'],
    queryFn: fetchStaff,
  })

  const entriesQuery = useQuery({
    queryKey: ['payroll-timesheet-entries', date, staffFilter],
    queryFn: () => fetchEntries(date, staffFilter),
  })

  const staff = staffQuery.data || []
  const entries = useMemo(
    () => entriesQuery.data?.entries ?? [],
    [entriesQuery.data?.entries],
  )
  const totalPayableMinutes = entriesQuery.data?.totalPayableMinutes || 0

  const totalsByStaff = useMemo(() => {
    const totals = new Map<string, { name: string; minutes: number }>()
    for (const entry of entries) {
      const existing = totals.get(entry.staffUserId) || {
        name: entry.staffDisplayName,
        minutes: 0,
      }
      existing.minutes += entry.payableMinutes
      totals.set(entry.staffUserId, existing)
    }
    return [...totals.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [entries])

  function changeDate(offset: number) {
    const d = new Date(date)
    d.setDate(d.getDate() + offset)
    setDate(d.toISOString().split('T')[0])
  }

  async function addWorker(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const displayName = newWorkerName.trim()
    if (!displayName) return

    setIsSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/admin/ops/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, role: 'tech' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to add worker')

      await staffQuery.refetch()
      setNewWorkerName('')
      setForm((current) => ({
        ...current,
        staffUserId: data.staff?.id || current.staffUserId,
      }))
      setMessage(`${displayName} was added to the staff roster.`)
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Failed to add worker',
      )
    } finally {
      setIsSaving(false)
    }
  }

  async function addEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!form.staffUserId) {
      setMessage('Choose a staff member before adding time.')
      return
    }

    setIsSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/admin/ops/payroll/timesheet-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffUserId: form.staffUserId,
          workDate: date,
          startedAt: toIso(date, form.startTime),
          endedAt: toIso(date, form.endTime),
          breakMinutes: Number(form.breakMinutes || 0),
          workType: form.workType,
          notes: form.notes,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to add time entry')

      await entriesQuery.refetch()
      setForm((current) => ({
        ...DEFAULT_FORM,
        staffUserId: current.staffUserId,
      }))
      setMessage('Payroll time entry added.')
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Failed to add time entry',
      )
    } finally {
      setIsSaving(false)
    }
  }

  async function updateStatus(entry: TimesheetEntry, status: string) {
    setIsSaving(true)
    setMessage(null)
    try {
      const res = await fetch(
        `/api/admin/ops/payroll/timesheet-entries/${entry.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to update entry')
      await entriesQuery.refetch()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to update')
    } finally {
      setIsSaving(false)
    }
  }

  async function deleteEntry(entry: TimesheetEntry) {
    if (!window.confirm('Delete this payroll time entry?')) return

    setIsSaving(true)
    setMessage(null)
    try {
      const res = await fetch(
        `/api/admin/ops/payroll/timesheet-entries/${entry.id}`,
        { method: 'DELETE' },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to delete entry')
      await entriesQuery.refetch()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to delete')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-200">
        <strong>Payroll source of truth:</strong> These entries are payable
        time. GPS activity is separate and remains dispatch/location history.
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => changeDate(-1)}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/5"
          >
            ‹ Prev
          </button>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="rounded-lg border border-white/10 bg-slate-800/60 px-3 py-1.5 text-sm text-white"
          />
          <button
            onClick={() => changeDate(1)}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/5"
          >
            Next ›
          </button>
        </div>

        <select
          value={staffFilter}
          onChange={(event) => setStaffFilter(event.target.value)}
          className="rounded-lg border border-white/10 bg-slate-800/60 px-3 py-1.5 text-sm text-white"
        >
          <option value="">All staff</option>
          {staff.map((person) => (
            <option key={person.id} value={person.id}>
              {person.display_name}
              {person.user_id ? '' : ' (no login)'}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <form
          onSubmit={addEntry}
          className="space-y-4 rounded-2xl border border-white/10 bg-slate-900/50 p-4"
        >
          <div>
            <h3 className="font-semibold text-white">Add Time Entry</h3>
            <p className="text-sm text-slate-400">
              Use this for training, missed punches, admin time, and other
              payable work.
            </p>
          </div>

          <label className="block text-sm text-slate-300">
            Staff member
            <select
              value={form.staffUserId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  staffUserId: event.target.value,
                }))
              }
              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-800/60 px-3 py-2 text-white"
            >
              <option value="">Choose staff</option>
              {staff.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.display_name}
                  {person.user_id ? '' : ' (no login)'}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-sm text-slate-300">
              Start
              <input
                type="time"
                value={form.startTime}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    startTime: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-800/60 px-3 py-2 text-white"
              />
            </label>
            <label className="block text-sm text-slate-300">
              End
              <input
                type="time"
                value={form.endTime}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    endTime: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-800/60 px-3 py-2 text-white"
              />
            </label>
            <label className="block text-sm text-slate-300">
              Break min
              <input
                type="number"
                min="0"
                value={form.breakMinutes}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    breakMinutes: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-800/60 px-3 py-2 text-white"
              />
            </label>
          </div>

          <label className="block text-sm text-slate-300">
            Work type
            <select
              value={form.workType}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  workType: event.target.value,
                }))
              }
              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-800/60 px-3 py-2 text-white"
            >
              <option value="training">Training</option>
              <option value="job">Job</option>
              <option value="admin">Admin</option>
              <option value="other">Other</option>
            </select>
          </label>

          <label className="block text-sm text-slate-300">
            Notes
            <textarea
              value={form.notes}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }
              rows={3}
              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-800/60 px-3 py-2 text-white"
              placeholder="What did they do?"
            />
          </label>

          <button
            type="submit"
            disabled={isSaving || staffQuery.isLoading}
            className="flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Add payable time
          </button>
        </form>

        <div className="space-y-4">
          <form
            onSubmit={addWorker}
            className="space-y-3 rounded-2xl border border-white/10 bg-slate-900/50 p-4"
          >
            <div>
              <h3 className="font-semibold text-white">
                Add Worker Without Login
              </h3>
              <p className="text-sm text-slate-400">
                Add a trainee to the staff roster before software access is
                ready.
              </p>
            </div>
            <div className="flex gap-2">
              <input
                value={newWorkerName}
                onChange={(event) => setNewWorkerName(event.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-800/60 px-3 py-2 text-white"
                placeholder="Worker name"
              />
              <button
                type="submit"
                disabled={isSaving}
                className="rounded-lg border border-white/10 px-3 py-2 text-sm font-semibold text-white hover:bg-white/5 disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </form>

          <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-4">
            <p className="text-sm text-slate-400">Total payable time</p>
            <p className="mt-1 text-3xl font-bold text-white">
              {fmtMin(totalPayableMinutes)}
            </p>
            {totalsByStaff.length > 0 && (
              <div className="mt-4 space-y-2">
                {totalsByStaff.map((total) => (
                  <div
                    key={total.name}
                    className="flex justify-between text-sm text-slate-300"
                  >
                    <span>{total.name}</span>
                    <span className="font-mono">{fmtMin(total.minutes)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {message && (
        <div className="rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-slate-200">
          {message}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-white/10">
        <div className="border-b border-white/10 bg-slate-900/70 px-4 py-3">
          <h3 className="font-semibold text-white">Entries for {date}</h3>
        </div>

        {entriesQuery.isLoading && (
          <div className="p-6 text-center text-slate-500">Loading…</div>
        )}

        {entriesQuery.error && (
          <div className="p-4 text-sm text-red-400">
            {entriesQuery.error instanceof Error
              ? entriesQuery.error.message
              : 'Failed to load payroll timesheets'}
          </div>
        )}

        {!entriesQuery.isLoading &&
          !entriesQuery.error &&
          entries.length === 0 && (
            <div className="p-6 text-center text-slate-500">
              No payable time entries for this date.
            </div>
          )}

        {entries.length > 0 && (
          <div className="divide-y divide-white/5">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="font-medium text-white">
                    {entry.staffDisplayName}
                  </p>
                  <p className="text-sm text-slate-400">
                    {fmtTime(entry.startedAt)} → {fmtTime(entry.endedAt)}
                    {entry.breakMinutes > 0
                      ? `, ${entry.breakMinutes}m break`
                      : ''}
                  </p>
                  {entry.notes && (
                    <p className="mt-1 text-sm text-slate-500">{entry.notes}</p>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="font-mono text-lg font-semibold text-emerald-300">
                      {fmtMin(entry.payableMinutes)}
                    </p>
                    <p className="text-xs text-slate-500 capitalize">
                      {entry.workType} · {entry.status}
                    </p>
                  </div>

                  <select
                    value={entry.status}
                    onChange={(event) =>
                      updateStatus(entry, event.target.value)
                    }
                    disabled={isSaving || entry.status === 'paid'}
                    className="rounded-lg border border-white/10 bg-slate-800/60 px-2 py-1.5 text-sm text-white disabled:opacity-50"
                  >
                    <option value="draft">Draft</option>
                    <option value="approved">Approved</option>
                    <option value="paid">Paid</option>
                  </select>

                  <button
                    onClick={() => deleteEntry(entry)}
                    disabled={isSaving || entry.status === 'paid'}
                    className="rounded-lg border border-red-500/20 p-2 text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                    title="Delete entry"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
