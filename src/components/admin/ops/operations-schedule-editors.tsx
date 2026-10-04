'use client'

import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type {
  BlockFormState,
  BusinessHoursRow,
  CalendarEvent,
  EditEventFormState,
} from './operations-schedule-types'
import {
  addMonths,
  buildMonthGrid,
  DEFAULT_BUSINESS_HOURS_ROWS,
  formatDateKey,
  startOfMonth,
  WEEKDAY_LABELS,
} from './operations-schedule-utils'

type DatePickerDialogProps = {
  open: boolean
  pickerMonth: Date
  anchorDate: Date
  todayKey: string
  setPickerMonth: Dispatch<SetStateAction<Date>>
  onSelectDate: (date: Date) => void
  onClose: () => void
  onToday: (date: Date) => void
}

export function DatePickerDialog({
  open,
  pickerMonth,
  anchorDate,
  todayKey,
  setPickerMonth,
  onSelectDate,
  onClose,
  onToday,
}: DatePickerDialogProps) {
  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <div
      role="dialog"
      aria-label="Pick a date"
      aria-modal="true"
      className="fixed inset-0 z-[220] flex items-start justify-center px-4 pt-20 sm:items-center sm:pt-0"
    >
      <button
        type="button"
        aria-label="Close calendar"
        className="absolute inset-0 cursor-default bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="border-border/60 bg-background animate-slide-up relative w-[19rem] max-w-[calc(100vw-2rem)] rounded-2xl border p-3 shadow-xl">
        <div className="mb-2 flex items-center justify-between gap-2">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Previous month"
            onClick={() => setPickerMonth((month) => addMonths(month, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <button
            type="button"
            onClick={() => setPickerMonth(startOfMonth(new Date()))}
            className="hover:bg-muted rounded-md px-2 py-1 text-sm font-semibold"
            title="Jump to current month"
          >
            {pickerMonth.toLocaleDateString('en-US', {
              month: 'long',
              year: 'numeric',
            })}
          </button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Next month"
            onClick={() => setPickerMonth((month) => addMonths(month, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="text-muted-foreground mb-1 grid grid-cols-7 gap-1 text-center text-[10px] font-medium tracking-wide uppercase">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
            <div key={`${day}-${index}`}>{day}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {buildMonthGrid(pickerMonth).map((date) => {
            const dateKey = formatDateKey(date)
            const inMonth = date.getMonth() === pickerMonth.getMonth()
            const isToday = dateKey === todayKey
            const isSelected = dateKey === formatDateKey(anchorDate)
            return (
              <button
                key={dateKey}
                type="button"
                onClick={() => onSelectDate(date)}
                className={[
                  'flex h-9 items-center justify-center rounded-lg text-sm transition',
                  isSelected
                    ? 'bg-emerald-500 font-semibold text-white shadow'
                    : isToday
                      ? 'border-emerald-500 text-emerald-600 ring-1 ring-emerald-500 hover:bg-emerald-50'
                      : inMonth
                        ? 'text-foreground hover:bg-muted'
                        : 'text-muted-foreground/60 hover:bg-muted/60',
                ].join(' ')}
              >
                {date.getDate()}
              </button>
            )
          })}
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onToday(new Date())}
          >
            Today
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

type EventFieldsProps<T extends EditEventFormState> = {
  form: T
  setForm: Dispatch<SetStateAction<T>>
  prefix: string
  layout: 'create' | 'edit'
}

function EventFields<T extends EditEventFormState>({
  form,
  setForm,
  prefix,
  layout,
}: EventFieldsProps<T>) {
  const editing = layout === 'edit'
  return (
    <>
      <div className={editing ? 'md:col-span-2' : 'md:col-span-3'}>
        <Label htmlFor={`${prefix}-title`}>Description</Label>
        <Input
          id={`${prefix}-title`}
          className={editing ? 'mt-1' : undefined}
          value={form.title}
          onChange={(event) =>
            setForm((current) => ({ ...current, title: event.target.value }))
          }
          placeholder={
            editing
              ? 'Vacation, doctor, sick day, hold…'
              : 'Vacation, doctor, sick day, hold, or anything else'
          }
        />
      </div>
      <div
        className={`grid gap-3 md:grid-cols-2 ${editing ? 'md:col-span-2' : 'md:col-span-3'}`}
      >
        <fieldset className="border-border/70 rounded-2xl border p-3">
          <legend className="px-1 text-sm font-semibold">Starts</legend>
          <div className={form.is_all_day ? '' : 'grid gap-3 sm:grid-cols-2'}>
            <div>
              <Label htmlFor={`${prefix}-start-date`}>Date</Label>
              <Input
                id={`${prefix}-start-date`}
                type="date"
                className="mt-1"
                value={form.start_date}
                onChange={(event) =>
                  setForm((current) => {
                    const startDate = event.target.value
                    return {
                      ...current,
                      start_date: startDate,
                      end_date:
                        current.end_date && current.end_date >= startDate
                          ? current.end_date
                          : startDate,
                    }
                  })
                }
              />
            </div>
            {!form.is_all_day ? (
              <div>
                <Label htmlFor={`${prefix}-start-time`}>Time</Label>
                <Input
                  id={`${prefix}-start-time`}
                  type="time"
                  className="mt-1"
                  value={form.start_time}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      start_time: event.target.value,
                    }))
                  }
                />
              </div>
            ) : null}
          </div>
        </fieldset>
        <fieldset className="border-border/70 rounded-2xl border p-3">
          <legend className="px-1 text-sm font-semibold">Ends</legend>
          <div className={form.is_all_day ? '' : 'grid gap-3 sm:grid-cols-2'}>
            <div>
              <Label htmlFor={`${prefix}-end-date`}>Date</Label>
              <Input
                id={`${prefix}-end-date`}
                type="date"
                min={form.start_date || undefined}
                className="mt-1"
                value={form.end_date}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    end_date: event.target.value,
                  }))
                }
              />
            </div>
            {!form.is_all_day ? (
              <div>
                <Label htmlFor={`${prefix}-end-time`}>Time</Label>
                <Input
                  id={`${prefix}-end-time`}
                  type="time"
                  className="mt-1"
                  value={form.end_time}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      end_time: event.target.value,
                    }))
                  }
                />
              </div>
            ) : null}
          </div>
        </fieldset>
      </div>
      <label
        className={
          editing
            ? 'text-muted-foreground flex cursor-pointer items-center gap-3 rounded-xl p-2 text-sm md:col-span-2'
            : 'text-muted-foreground flex items-center gap-2 self-end text-sm'
        }
      >
        <input
          type="checkbox"
          className={editing ? 'h-4 w-4' : undefined}
          checked={form.is_all_day}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              is_all_day: event.target.checked,
              start_time: event.target.checked ? '' : current.start_time,
              end_time: event.target.checked ? '' : current.end_time,
            }))
          }
        />
        All day / full range
      </label>
      <div className={editing ? 'md:col-span-2' : 'md:col-span-3'}>
        <Label htmlFor={`${prefix}-notes`}>Notes</Label>
        <Textarea
          id={`${prefix}-notes`}
          className={editing ? 'mt-1' : undefined}
          value={form.description}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              description: event.target.value,
            }))
          }
          placeholder={
            editing ? 'Optional notes' : 'Optional notes for the block'
          }
        />
      </div>
    </>
  )
}

type BlockTimeFormProps = {
  open: boolean
  form: BlockFormState
  saving: boolean
  setForm: Dispatch<SetStateAction<BlockFormState>>
  onSubmit: (event: FormEvent) => void
  onCancel: () => void
}

export function BlockTimeForm({
  open,
  form,
  saving,
  setForm,
  onSubmit,
  onCancel,
}: BlockTimeFormProps) {
  if (!open) return null
  return (
    <form
      className="border-border/60 bg-background/70 mt-4 grid gap-3 rounded-2xl border p-4 md:grid-cols-3"
      onSubmit={onSubmit}
    >
      <EventFields
        form={form}
        setForm={setForm}
        prefix="block"
        layout="create"
      />
      <div className="flex flex-wrap gap-2 md:col-span-3">
        <Button type="submit" disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save Block
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

type EditEventDialogProps = {
  event: CalendarEvent | null
  form: EditEventFormState
  saving: boolean
  setForm: Dispatch<SetStateAction<EditEventFormState>>
  onSubmit: (event: FormEvent) => void
  onClose: () => void
  onDelete: (id: string) => void
}

export function EditEventDialog({
  event,
  form,
  saving,
  setForm,
  onSubmit,
  onClose,
  onDelete,
}: EditEventDialogProps) {
  if (!event || typeof document === 'undefined') return null
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit blocked time"
      className="fixed inset-x-0 top-14 bottom-0 z-[220] flex items-start justify-center overflow-hidden bg-black/50 px-3 pt-8 pb-[calc(5rem+env(safe-area-inset-bottom))] backdrop-blur-sm sm:inset-0 sm:items-center sm:p-4"
    >
      <button
        type="button"
        aria-label="Close edit blocked time"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div className="bg-background border-border/60 relative z-10 flex max-h-full w-full flex-col overflow-hidden rounded-3xl border shadow-2xl sm:max-h-[92dvh] sm:max-w-lg">
        <div className="mx-auto mt-3 mb-1 h-1 w-10 rounded-full bg-slate-300 md:hidden" />
        <form
          className="grid gap-4 overflow-y-auto p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] md:grid-cols-2"
          onSubmit={onSubmit}
        >
          <div className="flex items-center justify-between md:col-span-2">
            <span className="text-base font-semibold">Edit Blocked Time</span>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground rounded-full p-1 text-xl leading-none transition-colors"
              onClick={onClose}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <EventFields
            form={form}
            setForm={setForm}
            prefix="edit-block"
            layout="edit"
          />
          <div className="flex flex-col gap-2 pt-1 md:col-span-2 md:flex-row">
            <Button
              type="submit"
              className="w-full md:w-auto"
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Save Changes
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full md:w-auto"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="w-full md:ml-auto md:w-auto"
              onClick={() => onDelete(event.id)}
              disabled={saving}
            >
              Delete Block
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}

type BusinessHoursFormProps = {
  open: boolean
  rows: BusinessHoursRow[]
  saving: boolean
  setRows: Dispatch<SetStateAction<BusinessHoursRow[]>>
  onSubmit: (event: FormEvent) => void
}

export function BusinessHoursForm({
  open,
  rows,
  saving,
  setRows,
  onSubmit,
}: BusinessHoursFormProps) {
  if (!open) return null
  return (
    <form
      className="border-border/60 bg-background/70 mt-4 space-y-3 rounded-2xl border p-4"
      onSubmit={onSubmit}
    >
      <div>
        <div className="text-sm font-semibold">Business Hours</div>
        <p className="text-muted-foreground mt-1 text-xs">
          Set the working window by day. Outside this window is treated as
          off-hours in the calendar and slot generation.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {rows.map((row) => (
          <div
            key={row.day_of_week}
            className="border-border/60 rounded-xl border p-3"
          >
            <label className="flex items-center justify-between gap-2 text-sm font-medium">
              <span>{WEEKDAY_LABELS[row.day_of_week]}</span>
              <input
                type="checkbox"
                checked={row.is_active}
                onChange={(event) =>
                  setRows((current) =>
                    current.map((entry) =>
                      entry.day_of_week === row.day_of_week
                        ? { ...entry, is_active: event.target.checked }
                        : entry,
                    ),
                  )
                }
              />
            </label>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor={`biz-start-${row.day_of_week}`}>Start</Label>
                <Input
                  id={`biz-start-${row.day_of_week}`}
                  type="time"
                  value={row.start_time}
                  disabled={!row.is_active}
                  onChange={(event) =>
                    setRows((current) =>
                      current.map((entry) =>
                        entry.day_of_week === row.day_of_week
                          ? { ...entry, start_time: event.target.value }
                          : entry,
                      ),
                    )
                  }
                />
              </div>
              <div>
                <Label htmlFor={`biz-end-${row.day_of_week}`}>End</Label>
                <Input
                  id={`biz-end-${row.day_of_week}`}
                  type="time"
                  value={row.end_time}
                  disabled={!row.is_active}
                  onChange={(event) =>
                    setRows((current) =>
                      current.map((entry) =>
                        entry.day_of_week === row.day_of_week
                          ? { ...entry, end_time: event.target.value }
                          : entry,
                      ),
                    )
                  }
                />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save Business Hours
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            setRows(DEFAULT_BUSINESS_HOURS_ROWS.map((row) => ({ ...row })))
          }
        >
          Reset to Mon-Sat 9:00-18:00
        </Button>
      </div>
    </form>
  )
}
