import { SupabaseClient } from '@supabase/supabase-js'

export async function resolveServiceAddress(
  supabase: SupabaseClient,
  customerId: string,
  inlineAddress: {
    label?: string | null
    street_1?: string | null
    street_2?: string | null
    city?: string | null
    state?: string | null
    zip_code?: string | null
    gate_code?: string | null
    notes?: string | null
  } | null
): Promise<{
    id: string
    label: string | null
    street_1: string
    street_2: string | null
    city: string
    state: string
    zip_code: string
    gate_code: string | null
    notes: string | null
  } | null> {
  if (!inlineAddress || !inlineAddress.street_1) return null

  const streetRaw = (inlineAddress.street_1 || '').trim()
  if (!streetRaw) return null

  const searchStreet = streetRaw.toLowerCase()

  // Find existing address for this customer matching the normalized street
  const { data: existing, error: findError } = await supabase
    .from('ops_service_addresses')
    .select('*')
    .eq('customer_id', customerId)

  if (!findError && existing) {
    const match = existing.find((a: any) => (a.street_1 || '').trim().toLowerCase() === searchStreet)
    if (match) {
      return match
    }
  }

  // Not found, insert new
  const { data: inserted, error: insertError } = await supabase
    .from('ops_service_addresses')
    .insert({
      customer_id: customerId,
      label: inlineAddress.label || 'Service Address',
      street_1: streetRaw,
      street_2: inlineAddress.street_2 || null,
      city: String(inlineAddress.city || '').trim(),
      state: String(inlineAddress.state || '').trim(),
      zip_code: String(inlineAddress.zip_code || '').trim(),
      gate_code: inlineAddress.gate_code || null,
      notes: inlineAddress.notes || null,
    })
    .select('*')

  if (insertError) throw insertError
  return inserted?.[0] || null
}
