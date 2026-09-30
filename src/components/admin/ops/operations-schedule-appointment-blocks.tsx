'use client'

import type {
  Dispatch,
  DragEvent,
  MutableRefObject,
  PointerEvent,
  SetStateAction,
} from 'react'
import Link from 'next/link'
import {
  GripVertical,
  Loader2,
  Repeat,
  Ruler,
  UserRoundCog,
} from 'lucide-react'
import { isWarrantyAppointment } from '@/lib/ops/warranty-appointment'
import type {
  Appointment,
  AppointmentResizeSession,
  DragPreview,
  RecurringFrequencyInfo,
  ScheduleView,
  StaffMember,
} from './operations-schedule-types'
import {
  appointmentHref,
  calendarDisplayAmount,
  computeOverlapColumns,
  customerNameOf,
  getAppointmentPlacement,
  getEstimateTone,
  getRecurringTone,
  getRestorationTone,
  getScheduleCardSources,
  getStatusTone,
  overlapStyle,
  STAFF_LANE_COLORS,
  unwrapRelation,
} from './operations-schedule-utils'

const PAYMENT_METHOD_STYLES: Record<
  string,
  { label: string; className: string }
> = {
  venmo: { label: 'Venmo', className: 'bg-blue-100 text-blue-700' },
  check: { label: 'Check', className: 'bg-amber-100 text-amber-800' },
  cash: { label: 'Cash', className: 'bg-emerald-100 text-emerald-700' },
  card: { label: 'Card', className: 'bg-sky-100 text-sky-700' },
  square: { label: 'Square', className: 'bg-violet-100 text-violet-700' },
}

export function recurringLineItemDescriptionBoxes(
  appointment: Appointment,
  compact: boolean,
) {
  if (!appointment.recurring_template_id) return null
  const withNotes = appointment.ops_appointment_line_items.filter((item) =>
    (item.notes || '').trim(),
  )
  if (withNotes.length === 0) return null
  return (
    <div className={compact ? 'mt-0.5 space-y-0.5' : 'mt-1.5 space-y-1'}>
      {withNotes.map((item, index) => (
        <div
          key={item.id || String(index)}
          className={
            compact
              ? 'line-clamp-2 rounded border border-amber-400/80 bg-amber-50 px-1.5 py-0.5 text-[9px] leading-tight text-amber-950'
              : 'rounded-md border border-amber-400/80 bg-amber-50 px-2 py-1.5 text-[10px] leading-snug text-amber-950'
          }
        >
          {(item.notes || '').trim()}
        </div>
      ))}
    </div>
  )
}

export function tomorrowFillBadge(appointment: Appointment, compact = false) {
  if (!appointment.tomorrow_fill_recipient_id) return null
  const recipient = unwrapRelation(appointment.tomorrow_fill_recipients)
  const campaign = unwrapRelation(recipient?.tomorrow_fill_campaigns)
  const rescheduled =
    Boolean(campaign?.target_date) &&
    campaign?.target_date !== appointment.appointment_date
  const label = `FILL-IN · ${campaign?.offer_code || 'TF35'}${rescheduled ? ' · RESCHEDULED' : ''}`
  return (
    <span
      className={`inline-flex w-fit items-center rounded-full border border-amber-400/70 bg-amber-100 font-black tracking-wide text-amber-900 ${compact ? 'px-1.5 py-0.5 text-[8px]' : 'px-2 py-0.5 text-[9px]'}`}
    >
      {label}
    </span>
  )
}

function paymentMethodChip(appointment: Appointment) {
  if (appointment.status !== 'completed') return null
  if (isWarrantyAppointment(appointment)) {
    return (
      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700">
        Warranty
      </span>
    )
  }
  const invoice = unwrapRelation(appointment.ops_invoices)
  if (!invoice) return null
  const raw = invoice.payment_method?.trim().toLowerCase()
  const isPaid = invoice.payment_status?.trim().toLowerCase() === 'paid'
  if (!raw) {
    if (isPaid) return null
    return (
      <span className="rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-semibold text-red-700">
        Unpaid
      </span>
    )
  }
  const style = PAYMENT_METHOD_STYLES[raw] ?? {
    label: raw.replace(/\b\w/g, (character) => character.toUpperCase()),
    className: 'bg-slate-100 text-slate-700',
  }
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${style.className}`}
    >
      {style.label}
    </span>
  )
}

type WeekendSliverProps = {
  dateKey: string
  dayName: 'Sunday' | 'Saturday'
  appointments: Appointment[]
  onOpen: () => void
  onDragOver: (event: DragEvent<HTMLDivElement>) => void
  onDragLeave: () => void
  onDrop: (event: DragEvent<HTMLDivElement>) => void
  gridStartHour: number
}

export function WeekendSliver({
  dateKey,
  dayName,
  appointments,
  onOpen,
  onDragOver,
  onDragLeave,
  onDrop,
  gridStartHour,
}: WeekendSliverProps) {
  return (
    <div
      data-date-column={dateKey}
      className="relative border-r border-slate-200 bg-slate-100/70 transition-colors hover:bg-sky-50"
      title={
        appointments.length > 0
          ? `${appointments.length} on ${dayName} — click to open the day`
          : `${dayName} — click to open, or drag a visit here`
      }
      onClick={onOpen}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {appointments.map((appointment) => {
        const placement = getAppointmentPlacement(
          appointment,
          null,
          gridStartHour,
        )
        return (
          <Link
            key={appointment.id}
            href={appointmentHref(appointment)}
            className="absolute right-1 left-1 flex flex-col overflow-hidden rounded-md bg-sky-500/90 px-1 py-0.5 text-[9px] leading-tight text-white shadow-sm hover:bg-sky-600"
            style={{
              top: placement.top + 6,
              height: Math.max(28, placement.height),
            }}
            title={`${placement.startLabel} · ${customerNameOf(appointment)}`}
            onClick={(event) => event.stopPropagation()}
          >
            <span className="font-semibold">{placement.startLabel}</span>
            <span className="truncate">{customerNameOf(appointment)}</span>
          </Link>
        )
      })}
    </div>
  )
}

type AppointmentBlocksProps = {
  appointments: Appointment[]
  resizeSession: AppointmentResizeSession | null
  resizeLiveEndMinutes: number | null
  draggingAppointment: Appointment | null
  recurringFrequencyMap: Record<string, RecurringFrequencyInfo>
  pointerDragging: boolean
  isMobile: boolean
  view: ScheduleView
  staffList: StaffMember[]
  reassigningAppointmentId: string | null
  statusActionAppointmentId: string | null
  focusedAppointmentId: string | null
  gridStartHour: number
  draggingYOffsetRef: MutableRefObject<number>
  didDragRef: MutableRefObject<boolean>
  setDraggingAppointment: Dispatch<SetStateAction<Appointment | null>>
  setDragPreview: Dispatch<SetStateAction<DragPreview | null>>
  onMovePointerDown: (
    event: PointerEvent<HTMLDivElement>,
    appointment: Appointment,
  ) => void
  onMovePointerMove: (event: PointerEvent<HTMLDivElement>) => void
  onMovePointerUp: (event: PointerEvent<HTMLDivElement>) => Promise<void>
  onMobileStaffReassignment: (
    appointment: Appointment,
    staff: StaffMember,
  ) => Promise<void>
  onOpenStatusAction: (
    event: React.MouseEvent<HTMLButtonElement>,
    appointment: Appointment,
  ) => void
  onBeginResize: (
    event: PointerEvent<HTMLButtonElement>,
    appointment: Appointment,
  ) => void
}

export function AppointmentBlocks({
  appointments,
  resizeSession,
  resizeLiveEndMinutes,
  draggingAppointment,
  recurringFrequencyMap,
  pointerDragging,
  isMobile,
  view,
  staffList,
  reassigningAppointmentId,
  statusActionAppointmentId,
  focusedAppointmentId,
  gridStartHour,
  draggingYOffsetRef,
  didDragRef,
  setDraggingAppointment,
  setDragPreview,
  onMovePointerDown,
  onMovePointerMove,
  onMovePointerUp,
  onMobileStaffReassignment,
  onOpenStatusAction,
  onBeginResize,
}: AppointmentBlocksProps) {
  const overlapColumns = computeOverlapColumns(appointments)
  return appointments.map((appointment) => {
    const customer = unwrapRelation(appointment.ops_customers)
    const invoice = unwrapRelation(appointment.ops_invoices)
    const customerLabel =
      customer?.business_name || customer?.full_name || 'Customer'
    const isWarranty = isWarrantyAppointment(appointment)
    const serviceAddress = unwrapRelation(appointment.ops_service_addresses)
    const { leadLabel, bookingLabel } = getScheduleCardSources(appointment)
    const endOverride =
      resizeSession?.appointmentId === appointment.id &&
      resizeLiveEndMinutes != null
        ? resizeLiveEndMinutes
        : null
    const placement = getAppointmentPlacement(
      appointment,
      endOverride,
      gridStartHour,
    )
    const isEstimate = appointment.kind === 'estimate'
    const isRestoration = appointment.kind === 'restoration'
    const href = isRestoration
      ? `/admin/operations/restoration/${appointment.restoration_project_id}?visit=${appointment.id}`
      : isEstimate
        ? `/admin/operations/estimates/${appointment.id}`
        : invoice?.id
          ? `/admin/operations/invoices/${invoice.id}`
          : appointment.recurring_template_id
            ? `/admin/operations/recurring/visit/${appointment.id}`
            : `/admin/operations/appointments/${appointment.id}`
    const isDragging = draggingAppointment?.id === appointment.id
    const overlap = overlapColumns.get(appointment.id) ?? {
      col: 0,
      totalCols: 1,
    }
    const blockTone = isRestoration
      ? getRestorationTone(appointment)
      : isEstimate
        ? getEstimateTone(appointment)
        : appointment.status === 'completed' ||
            appointment.status === 'cancelled'
          ? getStatusTone(appointment.status)
          : appointment.recurring_template_id
            ? (getRecurringTone(
                recurringFrequencyMap[appointment.recurring_template_id],
              ) ?? getStatusTone(appointment.status))
            : getStatusTone(appointment.status)
    const isPointerDraggingThis =
      pointerDragging && draggingAppointment?.id === appointment.id
    const effectiveStaffId =
      appointment.assigned_staff_user_id ?? staffList[0]?.id
    const assignedStaff = staffList.find(
      (staff) => staff.id === effectiveStaffId,
    )
    const otherStaff = staffList.filter(
      (staff) => staff.id !== effectiveStaffId,
    )

    return (
      <div
        key={appointment.id}
        data-appointment-block
        data-appointment-id={appointment.id}
        data-warranty-appointment={isWarranty ? 'true' : undefined}
        className={`absolute flex flex-col overflow-hidden rounded-2xl border text-xs text-slate-900 shadow-sm transition ${blockTone} ${isDragging ? 'opacity-40' : 'hover:shadow-md'} ${isPointerDraggingThis ? 'pointer-events-none' : ''} ${focusedAppointmentId === appointment.id ? 'ring-4 ring-amber-400/60 ring-offset-2' : ''}`}
        style={{
          top: placement.top + 6,
          height: placement.height - 8,
          ...overlapStyle(overlap.col, overlap.totalCols),
        }}
      >
        <div
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData('appointmentId', appointment.id)
            event.dataTransfer.effectAllowed = 'move'
            const block = (event.currentTarget as HTMLElement).closest(
              '[data-appointment-block]',
            ) as HTMLElement | null
            draggingYOffsetRef.current = block
              ? event.clientY - block.getBoundingClientRect().top
              : event.nativeEvent.offsetY
            didDragRef.current = false
            setDraggingAppointment(appointment)
            setTimeout(() => {
              didDragRef.current = true
            }, 50)
          }}
          onDragEnd={() => {
            setDraggingAppointment(null)
            setDragPreview(null)
          }}
          onPointerDown={(event) => onMovePointerDown(event, appointment)}
          onPointerMove={onMovePointerMove}
          onPointerUp={(event) => void onMovePointerUp(event)}
          onPointerCancel={(event) => void onMovePointerUp(event)}
          style={{ touchAction: 'none' }}
          className="flex shrink-0 cursor-grab touch-none items-center gap-1.5 border-b border-black/5 bg-black/[0.03] px-2 py-1 active:cursor-grabbing"
          title={`Drag ${customerLabel} to move start time`}
        >
          <GripVertical className="h-4 w-4 shrink-0 text-slate-500 sm:h-3.5 sm:w-3.5" />
          <span className="min-w-0 flex-1 truncate text-[11px] leading-tight font-semibold tracking-tight text-slate-800 sm:text-[10px]">
            {customerLabel}
          </span>
          {isMobile && view === 'day'
            ? otherStaff.map((staff) => (
                <button
                  key={staff.id}
                  type="button"
                  draggable={false}
                  className="ml-auto inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-slate-300 bg-white/80 px-2 text-[10px] font-semibold text-slate-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={reassigningAppointmentId === appointment.id}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    void onMobileStaffReassignment(appointment, staff)
                  }}
                  aria-label={`Move job to ${staff.display_name}`}
                >
                  {reassigningAppointmentId === appointment.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <UserRoundCog className="h-3 w-3" />
                  )}
                  To {staff.display_name.split(' ')[0]}
                </button>
              ))
            : null}
          {view === 'week' && staffList.length > 1
            ? (() => {
                const staffIndex = staffList.findIndex(
                  (staff) => staff.id === appointment.assigned_staff_user_id,
                )
                if (staffIndex < 0) return null
                return (
                  <span
                    className="ml-auto shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold text-white"
                    style={{
                      backgroundColor:
                        STAFF_LANE_COLORS[
                          staffIndex % STAFF_LANE_COLORS.length
                        ],
                    }}
                  >
                    {staffList[staffIndex].display_name.split(' ')[0]}
                  </span>
                )
              })()
            : null}
        </div>
        <Link
          href={href}
          aria-label={`Open ${customerLabel}${isWarranty ? ' warranty clean' : ''}`}
          className={`flex min-h-0 flex-1 flex-col overflow-hidden ${isWarranty ? 'justify-center px-2 py-1' : 'p-2 pt-1'}`}
          onClick={(event) => {
            if (didDragRef.current) event.preventDefault()
          }}
        >
          {isWarranty ? (
            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 rounded-full border border-rose-300 bg-rose-100 px-2 py-0.5 text-[10px] leading-tight font-bold text-rose-800">
                #Warranty clean
              </span>
              {serviceAddress?.city ? (
                <span className="truncate text-[10px] leading-tight font-semibold text-slate-600">
                  {serviceAddress.city}
                </span>
              ) : null}
            </div>
          ) : null}
          {!isWarranty && isEstimate ? (
            <>
              {appointment.is_repeat_customer ? (
                <span className="w-fit rounded-full bg-violet-50 px-1.5 py-0.5 text-[9px] font-semibold text-violet-700">
                  Repeat
                </span>
              ) : null}
              <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                <Ruler className="h-2.5 w-2.5" />
                Commercial walkthrough
              </span>
              {customer?.business_name && customer.full_name ? (
                <div className="mt-1 line-clamp-1 shrink-0 text-[10px] text-slate-600">
                  Contact: {customer.full_name}
                </div>
              ) : null}
              <div className="mt-0.5 line-clamp-2 shrink-0 text-[10px] leading-tight text-slate-600">
                {serviceAddress
                  ? `${serviceAddress.street_1}, ${serviceAddress.city}`
                  : 'Address pending'}
                {assignedStaff?.display_name
                  ? ` · Tech: ${assignedStaff.display_name}`
                  : ''}
              </div>
              <div className="mt-1 shrink-0 text-slate-700">
                {placement.startLabel} - {placement.endLabel}
              </div>
              {appointment.ops_appointment_line_items.length === 0 ? (
                <div className="mt-1 shrink-0 text-[10px] text-slate-600">
                  Measurements and pricing pending
                </div>
              ) : null}
              <div className="mt-auto flex items-center justify-between gap-1 pt-2">
                <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">
                  {(appointment.estimate_status || 'draft').replace(
                    /^./,
                    (value) => value.toUpperCase(),
                  )}
                </span>
              </div>
            </>
          ) : null}
          {!isWarranty && !isEstimate ? (
            <>
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="shrink-0 font-semibold text-slate-700 tabular-nums">
                  {placement.startLabel} - {placement.endLabel}
                </span>
                {appointment.is_repeat_customer ? (
                  <span className="shrink-0 rounded-full bg-violet-50 px-1.5 py-0.5 text-[9px] font-semibold text-violet-700">
                    Repeat
                  </span>
                ) : null}
                {appointment.recurring_template_id ? (
                  <a
                    href={`/admin/operations/recurring/${appointment.recurring_template_id}`}
                    onClick={(event) => event.stopPropagation()}
                    className="inline-flex shrink-0 items-center gap-1 rounded-full bg-blue-50 px-1.5 py-0.5 text-[9px] font-semibold text-blue-600 hover:bg-blue-100"
                  >
                    <Repeat className="h-2.5 w-2.5" />
                    Recurring
                  </a>
                ) : null}
                <span
                  className={`ml-auto shrink-0 text-right font-semibold tabular-nums ${
                    appointment.status === 'completed'
                      ? 'text-slate-600'
                      : 'text-slate-800'
                  }`}
                >
                  ${calendarDisplayAmount(appointment)}
                </span>
              </div>
              {tomorrowFillBadge(appointment)}
              <div className="mt-1 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                <span className="truncate text-[10px] font-medium text-slate-600">
                  {serviceAddress
                    ? `${serviceAddress.street_1}, ${serviceAddress.city}`
                    : 'Address pending'}
                </span>
                <span>{paymentMethodChip(appointment)}</span>
              </div>
              <div className="mt-1.5 line-clamp-2 leading-tight font-medium text-slate-800">
                {appointment.ops_appointment_line_items
                  .map((item) => item.name_snapshot)
                  .join(', ')}
              </div>
              {recurringLineItemDescriptionBoxes(appointment, false)}
              {leadLabel || bookingLabel ? (
                <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[10px] leading-tight text-slate-500">
                  {leadLabel ? <span>Lead: {leadLabel}</span> : null}
                  {leadLabel && bookingLabel ? <span>·</span> : null}
                  {bookingLabel ? <span>Booked: {bookingLabel}</span> : null}
                </div>
              ) : null}
            </>
          ) : null}
        </Link>
        {!isWarranty && !isEstimate && appointment.status !== 'completed' ? (
          <div className="pointer-events-none -mt-7 mb-1.5 flex justify-start px-2">
            <button
              type="button"
              className={`pointer-events-auto rounded-md border px-2 py-0.5 text-[9px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                appointment.status === 'cancelled'
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  : 'border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100'
              }`}
              disabled={statusActionAppointmentId === appointment.id}
              onClick={(event) => onOpenStatusAction(event, appointment)}
            >
              {statusActionAppointmentId === appointment.id ? (
                <span className="inline-flex items-center gap-1">
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  Saving
                </span>
              ) : appointment.status === 'cancelled' ? (
                'Restore'
              ) : (
                'Cancel'
              )}
            </button>
          </div>
        ) : null}
        <button
          type="button"
          aria-label="Drag to change end time"
          title="Drag to extend or shorten"
          style={{ touchAction: 'none' }}
          className="relative flex h-3 shrink-0 cursor-ns-resize touch-none items-center justify-center rounded-b-[13px] border-t border-black/10 bg-black/[0.08] hover:bg-black/[0.14] sm:h-2.5"
          onPointerDown={(event) => onBeginResize(event, appointment)}
        >
          <span
            aria-hidden
            className="block h-0.5 w-8 rounded-full bg-black/30 sm:hidden"
          />
        </button>
      </div>
    )
  })
}
