/**
 * Create the missing restoration line items in QuickBooks and link them back to
 * restoration_catalog_items.quickbooks_item_id.
 *
 * Decisions (confirmed by Charles 2026-08-30):
 *   - every new item is a sub-item of the root "Water Restoration" category
 *   - names are "CODE - description" so Cat 1/2/3 variants stay distinguishable
 *     in a QuickBooks dropdown
 *   - the 17 already-linked items keep their existing names untouched
 *
 * Dry run by default. Pass --apply to write to QuickBooks.
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.vercel.production'), quiet: true })

import { createAdminClient } from '@/supabase/server'
import { getValidQBAccessToken } from '@/lib/quickbooks-auth'

const QB_BASE = 'https://quickbooks.api.intuit.com/v3/company'
const WATER_RESTORATION_CATEGORY_ID = '44'
const APPLY = process.argv.includes('--apply')

type QBItem = {
  Id?: string
  Name?: string
  Type?: string
  Active?: boolean
  UnitPrice?: number
  IncomeAccountRef?: { value: string; name?: string }
  ParentRef?: { value: string; name?: string }
  SyncToken?: string
}

async function qbGet(realmId: string, token: string, path: string) {
  const res = await fetch(`${QB_BASE}/${realmId}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`QB GET ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return res.json()
}

async function qbPost(realmId: string, token: string, path: string, body: unknown) {
  const res = await fetch(`${QB_BASE}/${realmId}${path}?minorversion=65`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`QB POST ${res.status}: ${text.slice(0, 500)}`)
  return JSON.parse(text)
}

/** QuickBooks Item.Name is capped at 100 characters and must be unique. */
function buildName(code: string, description: string, taken: Set<string>): string {
  const base = `${code} - ${description}`.slice(0, 100).trim()
  if (!taken.has(base.toLowerCase())) return base
  for (let n = 2; n < 50; n++) {
    const candidate = `${base.slice(0, 96)} (${n})`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
  throw new Error(`could not build a unique name for ${code}`)
}

async function main() {
  const auth = await getValidQBAccessToken()
  if (!auth) {
    console.error('QuickBooks not connected — aborting')
    process.exit(1)
  }
  const { accessToken, realmId } = auth
  const supabase = createAdminClient()

  // Existing QuickBooks items: for name-collision checks and the income account.
  const existing: QBItem[] = []
  for (let start = 1; ; start += 100) {
    const data = await qbGet(
      realmId,
      accessToken,
      `/query?query=${encodeURIComponent(
        `select * from Item startposition ${start} maxresults 100`,
      )}&minorversion=65`,
    )
    const page: QBItem[] = data?.QueryResponse?.Item ?? []
    existing.push(...page)
    if (page.length < 100) break
  }
  const taken = new Set(existing.map((i) => String(i.Name ?? '').toLowerCase()))
  const byId = new Map(existing.map((i) => [String(i.Id), i]))

  // Mirror the income account the existing restoration items already post to.
  const template = byId.get('65') ?? byId.get('75')
  const incomeAccountRef = template?.IncomeAccountRef
  if (!incomeAccountRef) throw new Error('could not resolve the income account from an existing item')
  console.log(`Income account: ${incomeAccountRef.name} (${incomeAccountRef.value})`)
  console.log(`Parent category: Water Restoration (${WATER_RESTORATION_CATEGORY_ID})\n`)

  const { data: rows } = await supabase
    .from('restoration_catalog_items')
    .select('id, code, description, unit, unit_price, quickbooks_item_id')
    .eq('is_enabled', true)
    .order('code')

  const todo = (rows ?? []).filter(
    (r) => !r.quickbooks_item_id || !byId.has(String(r.quickbooks_item_id)),
  )
  console.log(`${rows?.length ?? 0} enabled items, ${todo.length} need a QuickBooks item\n`)

  let created = 0
  const failures: Array<{ code: string; error: string }> = []

  for (const r of todo) {
    const name = buildName(r.code, r.description, taken)
    if (!APPLY) {
      console.log(`  [dry-run] create "${name}"  $${r.unit_price}  (${r.unit})`)
      taken.add(name.toLowerCase())
      continue
    }
    try {
      const result = await qbPost(realmId, accessToken, '/item', {
        Name: name,
        Description: r.description,
        Type: 'Service',
        Active: true,
        Taxable: false,
        UnitPrice: Number(r.unit_price),
        IncomeAccountRef: incomeAccountRef,
        ParentRef: { value: WATER_RESTORATION_CATEGORY_ID },
        SubItem: true,
      })
      const newId = String(result?.Item?.Id)
      if (!newId || newId === 'undefined') throw new Error('no Id returned')

      const { error } = await supabase
        .from('restoration_catalog_items')
        .update({ quickbooks_item_id: newId, updated_at: new Date().toISOString() })
        .eq('id', r.id)
      if (error) throw new Error(`created QB item ${newId} but failed to link: ${error.message}`)

      taken.add(name.toLowerCase())
      created++
      console.log(`  [${newId}] ${name}  $${r.unit_price}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      failures.push({ code: r.code, error: msg })
      console.error(`  FAILED ${r.code}: ${msg}`)
    }
  }

  console.log(`\n${APPLY ? 'created' : 'would create'}: ${APPLY ? created : todo.length}`)
  if (failures.length) {
    console.log(`failures: ${failures.length}`)
    for (const f of failures) console.log(`  ${f.code}: ${f.error}`)
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
