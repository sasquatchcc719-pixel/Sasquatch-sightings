export type ScheduleView = 'week' | 'day' | 'month'

export type QueuedVisit = {
  id: string
  /** 'restoration' for a queued monitor visit, 'appointment' for a parked job. */
  source: 'restoration' | 'appointment'
  projectId: string
  label: string
  /** Street and city — two losses for the same customer look identical without it. */
  place: string
  visitType: string
  sequence: number | null
  /** Minutes, so a parked job keeps the length it was booked for. */
  durationMinutes?: number
}

export type StaffMember = {
  id: string
  user_id: string
  display_name: string
  role: string
  is_active: boolean
  default_open: boolean
  scheduling_priority: number
}

export type DailyAvailability = {
  staff_user_id: string
  date: string
  is_open: boolean
}

export type Appointment = {
  id: string
  appointment_date: string
  start_time: string
  end_time: string
  status: string
  quoted_total: number
  lead_source: string | null
  booking_channel: string | null
  source: string | null
  is_repeat_customer?: boolean
  tomorrow_fill_recipient_id?: string | null
  tomorrow_fill_recipients?:
    | {
        id: string
        tomorrow_fill_campaigns:
          | { target_date: string; offer_code: string }
          | Array<{ target_date: string; offer_code: string }>
          | null
      }
    | Array<{
        id: string
        tomorrow_fill_campaigns:
          | { target_date: string; offer_code: string }
          | Array<{ target_date: string; offer_code: string }>
          | null
      }>
    | null
  assigned_staff_user_id?: string | null
  ops_customers:
    | {
        full_name: string
        business_name: string | null
        phone: string | null
      }
    | Array<{
        full_name: string
        business_name: string | null
        phone: string | null
      }>
    | null
  ops_service_addresses:
    | {
        street_1: string
        city: string
        state: string
        zip_code: string
      }
    | Array<{
        street_1: string
        city: string
        state: string
        zip_code: string
      }>
    | null
  recurring_template_id?: string | null
  kind?: 'service' | 'estimate' | 'restoration' | null
  estimate_status?: string | null
  visit_type?: 'mitigation' | 'monitor' | 'final' | null
  restoration_project_id?: string | null
  service_concern_id?: string | null
  parked_at?: string | null
  is_subcontracted?: boolean | null
  subcontractor_name?: string | null
  ops_appointment_line_items: Array<{
    id: string
    name_snapshot: string
    notes?: string | null
    quantity?: number | null
    duration_minutes?: number | null
    line_total?: number | null
    service_catalog_items?:
      | { slug?: string | null }
      | Array<{ slug?: string | null }>
      | null
  }>
  ops_invoices:
    | {
        id: string
        status: string
        total?: number
        payment_status?: string
        payment_method?: string | null
      }
    | Array<{
        id: string
        status: string
        total?: number
        payment_status?: string
        payment_method?: string | null
      }>
    | null
}

export type CalendarEvent = {
  id: string
  title: string
  description: string | null
  start_date: string
  end_date: string
  start_time: string | null
  end_time: string | null
  is_all_day: boolean
  assigned_staff_user_id?: string | null
}

export type RecurringFrequencyInfo = {
  frequency: string
  interval_days: number | null
}

export type ScheduleResponse = {
  appointments: Appointment[]
  /** Open subcontracted visits dated before today, from outside the loaded range. */
  overdueSubcontracted?: Appointment[]
  events: CalendarEvent[]
  recurringFrequencyMap?: Record<string, RecurringFrequencyInfo>
  staff?: StaffMember[]
  dailyAvailability?: DailyAvailability[]
  currentUserId?: string
  currentUserRole?: string
}

export type AvailabilityTemplate = {
  id?: string
  day_of_week: number
  start_time: string
  end_time: string
  slot_interval_minutes: number
  is_active?: boolean
}

export type BusinessHoursRow = {
  day_of_week: number
  is_active: boolean
  start_time: string
  end_time: string
}

export type BlockFormState = {
  title: string
  description: string
  start_date: string
  end_date: string
  start_time: string
  end_time: string
  is_all_day: boolean
  assigned_staff_user_id: string | null
}

export type EditEventFormState = Omit<BlockFormState, 'assigned_staff_user_id'>

export type AppointmentResizeSession = {
  appointmentId: string
  originEndMinutes: number
  startMinutes: number
  grabClientY: number
  minDurationMinutes: number
}

export type DragPreview = {
  dateKey: string
  snappedMinutes: number
  staffId?: string | null
}
