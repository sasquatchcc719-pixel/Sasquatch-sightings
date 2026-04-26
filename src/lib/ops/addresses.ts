import { SupabaseClient } from '@supabase/supabase-js'
import { queueGeocodeForAddress } from '@/lib/ops/forward-geocode'

function normStreet1(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase()
}

/** Digits only — prevents "80133" vs "80133 " mismatches. */
function normZip(value: string | null | undefined): string {
  return (value || '').replace(/\D/g, '')
}

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
  } | null,
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

  const searchStreet = normStreet1(streetRaw)
  const inputZip = normZip(inlineAddress.zip_code)
  // When both street and zip are known, require a zip match to reuse a row
  // (avoids collapsing two different units on the same road).

  // Find existing address for this customer matching the normalized street (+ zip when provided)
  const { data: existing, error: findError } = await supabase
    .from('ops_service_addresses')
    .select('*')
    .eq('customer_id', customerId)

  if (!findError && existing) {
    const match = existing.find((a: { street_1: string; zip_code: string }) => {
      if (normStreet1(a.street_1) !== searchStreet) return false
      if (inputZip) {
        return normZip(a.zip_code) === inputZip
      }
      return true
    })
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

  const newAddress = inserted?.[0] || null

  // Fire-and-forget background geocode for new addresses
  if (newAddress && !newAddress.latitude) {
    queueGeocodeForAddress(supabase, newAddress.id, {
      street_1: newAddress.street_1,
      city: newAddress.city,
      state: newAddress.state,
      zip_code: newAddress.zip_code,
    })
  }

  return newAddress
}
