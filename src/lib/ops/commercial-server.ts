import 'server-only'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  emptyProfile,
  commercialContactName,
  newAgreementContent,
  type AgreementContent,
  type CommercialData,
  type ScopeLine,
} from './commercial'

export const AGREEMENT_SELECT =
  'id, customer_id, source_estimate_id, previous_version_id, version, revision, status, content, content_hash, published_at, signed_at, signed_name, signed_title, signed_email, signature_consent, created_at'
export function agreementHash(content: AgreementContent) {
  // Hash a canonical JSON representation; JSONB key order is not stable.
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
    if (value && typeof value === 'object')
      return `{${Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`)
        .join(',')}}`
    return JSON.stringify(value)
  }
  return createHash('sha256').update(canonical(content)).digest('hex')
}
export async function loadCommercialData(
  db: SupabaseClient,
  customerId: string,
  admin = false,
): Promise<CommercialData> {
  const queries = await Promise.all([
    db
      .from('ops_customers')
      .select('business_name,full_name,email')
      .eq('id', customerId)
      .single(),
    db
      .from('ops_commercial_profiles')
      .select('*')
      .eq('customer_id', customerId)
      .maybeSingle(),
    db
      .from('ops_commercial_agreements')
      .select(AGREEMENT_SELECT)
      .eq('customer_id', customerId)
      .in(
        'status',
        admin
          ? ['draft', 'published', 'signed', 'withdrawn']
          : ['published', 'signed', 'withdrawn'],
      )
      .order('created_at', { ascending: false }),
    db
      .from('ops_service_addresses')
      .select('id,label,street_1,city,state,zip_code')
      .eq('customer_id', customerId),
  ])
  for (const result of queries) if (result.error) throw result.error
  const [customer, profile, agreements, addresses] = queries
  const businessName = customer.data!.business_name || customer.data!.full_name
  const contactName = commercialContactName(
    customer.data!.full_name,
    businessName,
  )
  const savedProfile = { ...emptyProfile, ...profile.data }
  return {
    businessName,
    customerContact: {
      display_name:
        commercialContactName(savedProfile.billing_contact, businessName) ||
        contactName,
      email: (customer.data!.email || savedProfile.billing_email || '')
        .trim()
        .toLowerCase(),
    },
    profile: {
      ...savedProfile,
      billing_contact: savedProfile.billing_contact || contactName,
      billing_email: savedProfile.billing_email || customer.data!.email || '',
    },
    agreements: agreements.data || [],
    addresses: addresses.data || [],
  } as CommercialData
}
export async function contentFromEstimate(
  db: SupabaseClient,
  customerId: string,
  estimateId: string,
): Promise<AgreementContent> {
  const { data, error } = await db
    .from('ops_appointments')
    .select('id,service_address_id,ops_appointment_line_items(*)')
    .eq('id', estimateId)
    .eq('customer_id', customerId)
    .eq('kind', 'estimate')
    .in('estimate_status', ['accepted', 'converted'])
    .single()
  if (error || !data)
    throw new Error('Choose an accepted estimate belonging to this business.')
  const commercial = await loadCommercialData(db, customerId, true)
  const content = newAgreementContent(
    commercial.profile.legal_name || commercial.businessName,
  )
  const address = commercial.addresses.find(
    (a) => a.id === data.service_address_id,
  )
  content.service_address_id = address?.id || null
  content.service_address = address
    ? [address.street_1, address.city, address.state, address.zip_code]
        .filter(Boolean)
        .join(', ')
    : ''
  content.lines = data.ops_appointment_line_items
    .filter((l) => !l.excluded_at)
    .map((l) => ({
      id: crypto.randomUUID(),
      name: l.name_snapshot,
      area: '',
      phase: 'initial',
      quantity: Number(l.quantity),
      unit: l.pricing_unit_snapshot || 'each',
      unit_price: Number(l.unit_price),
      method: '',
      frequency: 'One-time service',
      service_window: '',
      notes: l.notes || '',
      service_catalog_item_id: l.service_catalog_item_id,
      length_value: l.length_value == null ? null : Number(l.length_value),
      width_value: l.width_value == null ? null : Number(l.width_value),
      area_segments: l.area_segments,
    })) as ScopeLine[]
  if (!content.lines.length)
    throw new Error('The estimate has no active service lines.')
  return content
}
