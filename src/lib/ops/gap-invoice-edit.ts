import type { SupabaseClient } from '@supabase/supabase-js'
type Row = Record<string, unknown>
const text = (value: unknown) => (typeof value === 'string' ? value : '')
const object = (value: unknown): Row =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Row)
    : {}
/** Read-only projection BEFORE any contact, bonus, appointment or invoice mutation. */
export async function validateReturningInvoiceEdit(
  db: SupabaseClient,
  current: Row,
  body: Row,
) {
  const metadata = object(current.discount_metadata),
    promo = object(metadata.promo)
  const requested = Object.hasOwn(body, 'promo_code')
    ? text(body.promo_code).trim().toUpperCase()
    : undefined
  if (requested === 'TF35' && promo.code !== 'TF35')
    throw new Error(
      'TF35 requires an approved returning-customer offer context',
    )
  const terms = object(metadata.gap_offer || metadata.returning_offer)
  if (!Object.keys(terms).length) return
  if (requested !== undefined && requested !== 'TF35') return // explicitly removing/replacing the offer
  if (
    body.discount_amount !== undefined &&
    Number(body.discount_amount) !== Number(promo.amount || 35)
  )
    throw new Error('Remove TF35 before applying a different dollar discount')
  if (
    Number(
      body.percentage_discount_amount ??
        current.percentage_discount_amount ??
        0,
    ) !== 0
  )
    throw new Error('TF35 cannot combine with another discount')
  const existing = (
    Array.isArray(current.ops_invoice_line_items)
      ? current.ops_invoice_line_items
      : []
  ) as Row[]
  const supplied = Array.isArray(body.line_items)
    ? (body.line_items as Row[])
    : null
  const useSaved =
    !supplied ||
    (supplied.length === 0 &&
      existing.length > 0 &&
      body.clear_line_items !== true)
  const links = existing
    .map((l) => text(l.appointment_line_item_id))
    .filter(Boolean)
  const resolved = new Map<string, string>()
  if (links.length) {
    const { data, error } = await db
      .from('ops_appointment_line_items')
      .select('id,service_catalog_item_id')
      .in('id', links)
    if (error) throw error
    for (const row of data || [])
      resolved.set(row.id, row.service_catalog_item_id)
  }
  const seen = new Set<string>()
  const lines = (useSaved ? existing : supplied!).flatMap((line) => {
    const id = text(line.id),
      saved = existing.find((old) => old.id === id)
    if (!useSaved && id && !id.startsWith('new-') && !saved) return []
    if (id && seen.has(id))
      throw new Error('Duplicate invoice line IDs are not allowed')
    if (id) seen.add(id)
    const catalog =
      text(saved?.service_catalog_item_id) ||
      resolved.get(text(saved?.appointment_line_item_id)) ||
      (!saved ? text(line.service_catalog_item_id) : '') ||
      ''
    const amount = saved?.excluded_at
      ? 0
      : useSaved
        ? Number(line.line_total)
        : Math.round(
            Number(line.quantity || 1) * Number(line.unit_price || 0) * 100,
          ) / 100
    if (!Number.isFinite(amount) || amount < 0)
      throw new Error(
        'TF35 cannot combine with a credit or invalid invoice line',
      )
    return [{ catalog, amount, is_new: !saved }]
  })
  const ids = [...new Set(lines.map((l) => l.catalog).filter(Boolean))]
  const services = new Set<string>()
  const known = new Map<string, boolean>()
  if (ids.length) {
    const { data, error } = await db
      .from('service_catalog_items')
      .select('id,name,category,slug,is_active')
      .in('id', ids)
    if (error) throw error
    for (const row of data || []) {
      known.set(row.id, row.is_active !== false)
      if (
        !/^(travel|fees?|tax)$/i.test(text(row.category)) &&
        !/^(mileage[ /-]*travel|travel fee|tax|fees?|google lsa.*)$/i.test(
          text(row.name),
        ) &&
        !/^(mileage-travel|travel-fee|tax|fee)$/.test(text(row.slug))
      ) {
        if (
          row.is_active === false &&
          lines.some((line) => line.catalog === row.id && line.is_new)
        )
          throw new Error('Selected service is no longer available')
        services.add(row.id)
      }
    }
  }
  for (const line of lines)
    if (line.is_new && line.catalog && !known.get(line.catalog))
      throw new Error('Selected service is no longer available')
  const serviceSubtotal = lines
    .filter((l) => services.has(l.catalog))
    .reduce((n, l) => n + l.amount, 0)
  if (Math.round(serviceSubtotal * 100) < Number(terms.minimum_service_cents))
    throw new Error(
      'The edited invoice no longer qualifies for TF35; remove the offer or keep its service minimum before saving',
    )
}
