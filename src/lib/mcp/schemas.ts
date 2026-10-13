import { z } from 'zod'

const nullableString = z.string().nullable()
const nullableNumber = z.number().finite().nullable()

export const paginationSchema = z
  .object({
    limit: z.number().int().min(1).max(100),
    offset: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .strict()

export const customerSchema = z
  .object({
    id: z.string(),
    name: nullableString,
    first_name: nullableString,
    last_name: nullableString,
    business_name: nullableString,
    phone: nullableString,
    email: nullableString,
    notes: nullableString.optional(),
  })
  .strict()
  .nullable()

export const addressSchema = z
  .object({
    id: z.string(),
    label: nullableString,
    street_1: nullableString,
    street_2: nullableString,
    city: nullableString,
    state: nullableString,
    zip_code: nullableString,
    gate_code: nullableString.optional(),
    notes: nullableString.optional(),
  })
  .strict()
  .nullable()

export const technicianSchema = z
  .object({ id: z.string(), name: z.string() })
  .strict()
  .nullable()

export const timeWindowSchema = z
  .object({
    date: z.string(),
    start_time: nullableString,
    end_time: nullableString,
    timezone: z.literal('America/Denver'),
  })
  .strict()

export const lineItemSchema = z
  .object({
    id: z.string(),
    service_id: nullableString,
    name: nullableString,
    quantity: nullableNumber,
    unit_price: nullableNumber,
    amount: nullableNumber,
    duration_minutes: z.number().int().nullable(),
    notes: nullableString,
  })
  .strict()

export const appointmentSummarySchema = z
  .object({
    id: z.string(),
    customer: customerSchema,
    address: addressSchema,
    tech: technicianSchema,
    time_window: timeWindowSchema,
    status: z.enum(['scheduled', 'completed', 'cancelled']),
    price: nullableNumber,
  })
  .strict()

export const appointmentDetailSchema = appointmentSummarySchema.extend({
  customer: customerSchema,
  address: addressSchema,
  services: z.array(lineItemSchema),
  notes: nullableString,
  visit_type: nullableString,
  payment_status: nullableString,
})

export const estimateSummarySchema = z
  .object({
    id: z.string(),
    customer: customerSchema,
    address: addressSchema,
    amount: nullableNumber,
    status: z.enum(['accepted', 'pending', 'declined']),
    time_window: timeWindowSchema,
  })
  .strict()

export const estimateDetailSchema = z
  .object({
    id: z.string(),
    line_items: z.array(lineItemSchema),
    amount: nullableNumber,
    customer: customerSchema,
    address: addressSchema,
    status: z.enum(['accepted', 'pending', 'declined']),
    notes: nullableString,
  })
  .strict()

export const customerSearchResultSchema = z
  .object({
    id: z.string(),
    name: nullableString,
    first_name: nullableString,
    last_name: nullableString,
    business_name: nullableString,
    phone: nullableString,
    email: nullableString,
    notes: nullableString,
    addresses: z.array(addressSchema),
  })
  .strict()

export const availabilitySlotSchema = z
  .object({
    start_time: z.string(),
    end_time: z.string(),
    technicians: z.array(
      z.object({ id: z.string(), name: z.string() }).strict(),
    ),
  })
  .strict()

export const callSchema = z
  .object({
    id: z.string(),
    call_sid: nullableString,
    caller_phone: nullableString,
    outcome: nullableString,
    duration_seconds: z.number().int().nonnegative().nullable(),
    recording_url: nullableString,
    transcription: nullableString,
    created_at: z.string(),
  })
  .strict()

export const appointmentListOutputSchema = z
  .object({
    data: z.array(appointmentSummarySchema),
    pagination: paginationSchema,
  })
  .strict()

export const appointmentDetailOutputSchema = z
  .object({ data: appointmentDetailSchema })
  .strict()

export const estimateListOutputSchema = z
  .object({
    data: z.array(estimateSummarySchema),
    pagination: paginationSchema,
  })
  .strict()

export const estimateDetailOutputSchema = z
  .object({ data: estimateDetailSchema })
  .strict()

export const customerListOutputSchema = z
  .object({
    data: z.array(customerSearchResultSchema),
    pagination: paginationSchema,
  })
  .strict()

export const availabilityOutputSchema = z
  .object({
    date: z.string(),
    timezone: z.literal('America/Denver'),
    duration_minutes: z.literal(120),
    data: z.array(availabilitySlotSchema),
    pagination: paginationSchema,
  })
  .strict()

export const callsOutputSchema = z
  .object({
    data: z.array(callSchema),
    since: z.string(),
    pagination: paginationSchema,
  })
  .strict()
