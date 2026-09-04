import type { SupabaseClient } from '@supabase/supabase-js'
import { sendCustomerSMSWithResult } from '@/lib/twilio'
import { opsPhoneLookupVariants } from '@/lib/ops/phone'

export const SERVICE_CONCERN_ACTIVE_STATUSES = [
  'awaiting_customer',
  'ready_for_review',
  'approved_return',
] as const

export const SERVICE_CONCERN_STATUSES = [
  ...SERVICE_CONCERN_ACTIVE_STATUSES,
  'resolved',
  'declined',
] as const

export const SERVICE_CONCERN_CATEGORIES = [
  'unclassified',
  'visible_spot',
  'odor',
  'excess_moisture',
  'texture',
  'pricing',
  'technician',
  'damage',
  'other',
] as const

export type ServiceConcernStatus = (typeof SERVICE_CONCERN_STATUSES)[number]
export type ServiceConcernCategory = (typeof SERVICE_CONCERN_CATEGORIES)[number]

type ConcernSource = 'admin' | 'telegram_text' | 'telegram_media'

type ConcernRow = {
  id: string
  customer_id: string
  appointment_id: string | null
  conversation_id: string | null
  status: ServiceConcernStatus
  intake_sms_sent_at: string | null
}

export function buildServiceConcernIntakeMessage(): string {
  return [
    'Thanks for letting us know. Before we schedule a return visit, please reply with:',
    '1) the room or area,',
    '2) what you are seeing or smelling and when you first noticed it,',
    '3) for a visible concern, one wide photo and one close-up.',
    'Please wait until the carpet is fully dry and vacuum once unless the concern is excess moisture. We will review the original job and recommend the right next step.',
  ].join('\n')
}

function latestInboundMessage(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index]
    if (
      item &&
      typeof item === 'object' &&
      'role' in item &&
      item.role === 'user' &&
      'content' in item &&
      typeof item.content === 'string' &&
      item.content.trim()
    ) {
      return item.content.trim()
    }
  }
  return null
}

async function findConversationForCustomer(
  supabase: SupabaseClient,
  customerId: string,
  phone: string,
): Promise<{ id: string; messages: unknown } | null> {
  const byCustomer = await supabase
    .from('conversations')
    .select('id, messages')
    .eq('ops_customer_id', customerId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (byCustomer.error) throw byCustomer.error
  if (byCustomer.data) return byCustomer.data

  const variants = opsPhoneLookupVariants(phone)
  if (variants.length === 0) return null
  const byPhone = await supabase
    .from('conversations')
    .select('id, messages')
    .in('phone_number', variants)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (byPhone.error) throw byPhone.error
  return byPhone.data
}

async function latestCompletedAppointmentId(
  supabase: SupabaseClient,
  customerId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('ops_appointments')
    .select('id')
    .eq('customer_id', customerId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false, nullsFirst: false })
    .order('appointment_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data?.id || null
}

export async function openServiceConcern(params: {
  supabase: SupabaseClient
  customerId: string
  appointmentId?: string | null
  conversationId?: string | null
  initialMessage?: string | null
  source: ConcernSource
  businessNumber?: string | null
  mediaIds?: string[]
}): Promise<{
  concern: ConcernRow
  created: boolean
  intakeSent: boolean
  intakeError: string | null
}> {
  const { supabase, customerId } = params
  const { data: customer, error: customerError } = await supabase
    .from('ops_customers')
    .select('id, phone')
    .eq('id', customerId)
    .maybeSingle()
  if (customerError) throw customerError
  if (!customer?.phone) throw new Error('The customer has no phone number.')

  let conversationId = params.conversationId || null
  let initialMessage = params.initialMessage?.trim() || null
  if (!conversationId || !initialMessage) {
    const conversation = await findConversationForCustomer(
      supabase,
      customerId,
      customer.phone,
    )
    conversationId ||= conversation?.id || null
    initialMessage ||= latestInboundMessage(conversation?.messages) || null
  }

  const { data: existing, error: existingError } = await supabase
    .from('ops_service_concerns')
    .select(
      'id, customer_id, appointment_id, conversation_id, status, intake_sms_sent_at',
    )
    .eq('customer_id', customerId)
    .in('status', [...SERVICE_CONCERN_ACTIVE_STATUSES])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (existingError) throw existingError

  let concern = existing as ConcernRow | null
  let created = false
  if (!concern) {
    const appointmentId =
      params.appointmentId === undefined
        ? await latestCompletedAppointmentId(supabase, customerId)
        : params.appointmentId
    const { data, error } = await supabase
      .from('ops_service_concerns')
      .insert({
        customer_id: customerId,
        appointment_id: appointmentId || null,
        conversation_id: conversationId,
        source: params.source,
        initial_message: initialMessage,
      })
      .select(
        'id, customer_id, appointment_id, conversation_id, status, intake_sms_sent_at',
      )
      .single()
    if (error) throw error
    concern = data as ConcernRow
    created = true
  }

  if (params.mediaIds?.length) {
    const { error } = await supabase
      .from('ops_customer_media')
      .update({
        service_concern_id: concern.id,
        category: 'service_concern',
        classified_at: new Date().toISOString(),
      })
      .in('id', params.mediaIds)
    if (error) throw error
  }

  let intakeSent = false
  let intakeError: string | null = null
  if (!concern.intake_sms_sent_at) {
    try {
      await sendCustomerSMSWithResult(
        customer.phone,
        buildServiceConcernIntakeMessage(),
        undefined,
        'service_concern_intake',
        params.businessNumber || undefined,
      )
      const sentAt = new Date().toISOString()
      const { error } = await supabase
        .from('ops_service_concerns')
        .update({ intake_sms_sent_at: sentAt, updated_at: sentAt })
        .eq('id', concern.id)
      if (error) throw error
      concern = { ...concern, intake_sms_sent_at: sentAt }
      intakeSent = true
    } catch (error) {
      intakeError =
        error instanceof Error
          ? error.message
          : 'The intake text failed to send.'
    }
  }

  return { concern, created, intakeSent, intakeError }
}

export async function openServiceConcernFromPhone(params: {
  supabase: SupabaseClient
  phone: string
  source: Extract<ConcernSource, 'telegram_text'>
  businessNumber?: string | null
}) {
  const variants = opsPhoneLookupVariants(params.phone)
  const { data, error } = await params.supabase
    .from('ops_customers')
    .select('id')
    .in('phone', variants)
    .order('updated_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data?.id)
    throw new Error('No customer record matches this phone number.')
  return openServiceConcern({
    supabase: params.supabase,
    customerId: data.id,
    source: params.source,
    businessNumber: params.businessNumber,
  })
}

export async function recordInboundServiceConcernActivity(params: {
  supabase: SupabaseClient
  customerId: string
  mediaIds?: string[]
  receivedAt?: string
}): Promise<string | null> {
  const { data: concern, error } = await params.supabase
    .from('ops_service_concerns')
    .select('id, status')
    .eq('customer_id', params.customerId)
    .in('status', [...SERVICE_CONCERN_ACTIVE_STATUSES])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!concern) return null

  const receivedAt = params.receivedAt || new Date().toISOString()
  const nextStatus =
    concern.status === 'awaiting_customer' ? 'ready_for_review' : concern.status
  const { error: updateError } = await params.supabase
    .from('ops_service_concerns')
    .update({
      status: nextStatus,
      last_customer_message_at: receivedAt,
      updated_at: receivedAt,
    })
    .eq('id', concern.id)
  if (updateError) throw updateError

  if (params.mediaIds?.length) {
    const { error: mediaError } = await params.supabase
      .from('ops_customer_media')
      .update({
        service_concern_id: concern.id,
        category: 'service_concern',
        classified_at: receivedAt,
      })
      .in('id', params.mediaIds)
    if (mediaError) throw mediaError
  }

  return concern.id
}
