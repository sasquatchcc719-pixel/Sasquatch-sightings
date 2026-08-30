import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.vercel.production') })

import { createAdminClient } from '@/supabase/server'
import { getValidQBAccessToken } from '@/lib/quickbooks-auth'

const QB_BASE = 'https://quickbooks.api.intuit.com/v3/company'

async function qbQuery(realmId: string, token: string, q: string) {
  const res = await fetch(
    `${QB_BASE}/${realmId}/query?query=${encodeURIComponent(q)}&minorversion=65`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
  )
  if (!res.ok) throw new Error(`QB ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return res.json()
}

async function main() {
  const auth = await getValidQBAccessToken()
  if (!auth) {
    console.error('QuickBooks not connected — aborting')
    process.exit(1)
  }
  const { accessToken, realmId } = auth
  console.log(`Connected to QuickBooks realm ${realmId}\n`)

  // Page through every Item in QuickBooks.
  const items: Array<Record<string, unknown>> = []
  for (let start = 1; ; start += 100) {
    const data = await qbQuery(
      realmId,
      accessToken,
      `select * from Item startposition ${start} maxresults 100`,
    )
    const page = data?.QueryResponse?.Item ?? []
    items.push(...page)
    if (page.length < 100) break
  }
  console.log(`QuickBooks has ${items.length} Items total\n`)

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const qbByName = new Map<string, Record<string, unknown>>()
  for (const it of items) qbByName.set(norm(String(it.Name ?? '')), it)

  // Which QuickBooks items look restoration-related?
  const restorationish = items.filter((it) => {
    const hay = `${it.Name ?? ''} ${it.Description ?? ''} ${
      (it.ParentRef as { name?: string } | undefined)?.name ?? ''
    }`.toLowerCase()
    return /water|dehum|air mover|extract|restor|flood|mitigat|drywall|antimicrob|anti-micro|baseboard|insulation|tear ?out|emergency|fan|monitor|debris|muck|carpet pad/.test(
      hay,
    )
  })

  console.log(`--- ${restorationish.length} restoration-looking Items in QuickBooks ---`)
  for (const it of restorationish) {
    const price = (it as { UnitPrice?: number }).UnitPrice
    console.log(
      `  [${it.Id}] ${it.Name}` +
        (price != null ? `  $${price}` : '') +
        (it.Active === false ? '  (INACTIVE)' : '') +
        `  type=${it.Type}`,
    )
  }

  // Enabled restoration catalog rows and their QuickBooks status.
  const supabase = createAdminClient()
  const { data: cat } = await supabase
    .from('restoration_catalog_items')
    .select('code, description, unit, unit_price, quickbooks_item_id, water_category, after_hours')
    .eq('is_enabled', true)
    .order('code')

  const rows = cat ?? []
  const linked: string[] = []
  const nameMatch: Array<{ code: string; qbId: string; qbName: string; qbPrice?: number; ourPrice: number }> = []
  const missing: Array<{ code: string; description: string; unit: string; price: number }> = []

  const qbById = new Map(items.map((it) => [String(it.Id), it]))

  for (const r of rows) {
    if (r.quickbooks_item_id && qbById.has(String(r.quickbooks_item_id))) {
      linked.push(`${r.code} -> [${r.quickbooks_item_id}] ${qbById.get(String(r.quickbooks_item_id))?.Name}`)
      continue
    }
    const hit = qbByName.get(norm(r.description))
    if (hit) {
      nameMatch.push({
        code: r.code,
        qbId: String(hit.Id),
        qbName: String(hit.Name),
        qbPrice: (hit as { UnitPrice?: number }).UnitPrice,
        ourPrice: Number(r.unit_price),
      })
    } else {
      missing.push({
        code: r.code,
        description: r.description,
        unit: r.unit,
        price: Number(r.unit_price),
      })
    }
  }

  console.log(`\n--- ${rows.length} enabled restoration catalog items ---`)
  console.log(`  already linked to a live QB item: ${linked.length}`)
  for (const l of linked) console.log(`    ${l}`)
  console.log(`  matched by name (not yet linked):  ${nameMatch.length}`)
  for (const m of nameMatch) {
    const drift = m.qbPrice != null && Math.abs(m.qbPrice - m.ourPrice) > 0.005
    console.log(
      `    ${m.code} -> [${m.qbId}] ${m.qbName}` +
        (drift ? `   PRICE DRIFT qb=$${m.qbPrice} ours=$${m.ourPrice}` : ''),
    )
  }
  console.log(`  no QuickBooks item at all:         ${missing.length}`)
  for (const m of missing) {
    console.log(`    ${m.code.padEnd(10)} ${m.unit.padEnd(3)} $${String(m.price).padEnd(8)} ${m.description}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
