import type { SupabaseClient } from '@supabase/supabase-js'

type LocationPartner = {
  id: string
  location_name: string | null
  company_name: string | null
  coupon_code: string | null
}

function normalizePartnerLabel(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function matchLocationPartner(
  partners: LocationPartner[],
  detail: string | null | undefined,
): LocationPartner | null {
  const lookup = normalizePartnerLabel(detail)
  if (!lookup) return null

  const matches = partners.filter((partner) =>
    [partner.location_name, partner.company_name, partner.coupon_code]
      .map(normalizePartnerLabel)
      .filter(Boolean)
      .includes(lookup),
  )
  const unique = new Map(matches.map((partner) => [partner.id, partner]))
  return unique.size === 1 ? [...unique.values()][0] : null
}

export async function resolveLocationPartner(
  supabase: SupabaseClient,
  detail: string | null | undefined,
): Promise<LocationPartner | null> {
  const { data, error } = await supabase
    .from('partners')
    .select('id, location_name, company_name, coupon_code')
    .eq('partner_type', 'location')
    .limit(500)

  if (error) {
    console.error('[partner-attribution] location lookup failed:', error)
    return null
  }

  return matchLocationPartner((data || []) as LocationPartner[], detail)
}
