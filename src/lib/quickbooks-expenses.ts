/**
 * Read the expense side of QuickBooks.
 *
 * The existing QuickBooks integration only ever writes Invoices. The OAuth scope
 * already granted (`com.intuit.quickbooks.accounting`) also covers Purchase,
 * Bill, Vendor and Account, so spend is readable with no new consent.
 *
 * Everything here is read-only.
 *
 * Why it scans rather than filters by account: the same vendor's spend routinely
 * lands in several accounts (Facebook spans four, including Meals), and roughly
 * 40% of expense lines carry no payee at all — the merchant name only appears in
 * the bank memo. An account-scoped or vendor-scoped query under-reports badly.
 */

import { getValidQBAccessToken } from '@/lib/quickbooks-auth'

const BASE = 'https://quickbooks.api.intuit.com/v3/company'

export type QBExpenseLine = {
  /** `${entity}:${txnId}:${lineIndex}` — stable enough to link a campaign cost to. */
  key: string
  txnId: string
  entity: 'Purchase' | 'Bill'
  date: string
  amount: number
  account: string
  vendor: string
  memo: string
}

export const MARKETING_SPEND_CHANNELS = [
  'Vehicle wraps',
  'Google ads',
  'Nextdoor',
  'Facebook / Meta',
  'Print, mail & signage',
  'Directories & marketplaces',
  'Website & marketing software',
  'AI & creative tools',
  'Other marketing',
] as const

export type MarketingSpendChannel = (typeof MARKETING_SPEND_CHANNELS)[number]

export type QBMarketingExpenseLine = QBExpenseLine & {
  channel: MarketingSpendChannel
}

const CHANNEL_PATTERNS: Array<{
  channel: Exclude<MarketingSpendChannel, 'Other marketing'>
  pattern: RegExp
}> = [
  {
    channel: 'Vehicle wraps',
    pattern: /inkferno|vehicle\s*wrap|car\s*wrap|truck\s*wrap|\bwraps?\b/i,
  },
  {
    channel: 'Google ads',
    pattern:
      /google\s*ads|google\*ads|adwords|local\s*service|localservice|google.*guarantee|\blsa\b/i,
  },
  { channel: 'Nextdoor', pattern: /nextdoor/i },
  {
    channel: 'Facebook / Meta',
    pattern: /facebook|meta\s*plat|fb\.me/i,
  },
  {
    channel: 'Print, mail & signage',
    pattern:
      /nextdayflyer|next\s*day\s*flyer|vistaprint|printing|print\s*for|sticker|logo&team|tagstand|\bnfc\b|signage|postal\s*service|\busps\b|postage|stamps\.com/i,
  },
  {
    channel: 'Directories & marketplaces',
    pattern:
      /yelp|tiktok|angi|home\s*advisor|homeadvisor|thumbtack|411for|the411|craigslist|yellow\s*pages|manta|alignable/i,
  },
  {
    channel: 'AI & creative tools',
    pattern:
      /cursor|anthropic|claude|openai|leonardo\.ai|midjourney|elevenlabs|higgsfield/i,
  },
  {
    channel: 'Website & marketing software',
    pattern:
      /vercel|netlify|godaddy|namecheap|squarespace|wix|hostinger|supabase/i,
  },
]

function isQuickBooksMarketingAccount(account: string): boolean {
  return (
    /(^|:)advertising\s*&\s*marketing(?::|$)/i.test(account) ||
    /(^|:)(listing fees|social media|website ads|printing\s*&\s*photocopying)$/i.test(
      account,
    )
  )
}

/**
 * Decide whether one QuickBooks expense line belongs in the marketing ledger.
 *
 * QuickBooks' own marketing/printing accounts are authoritative. Known vendors
 * are also included across other accounts because real charges are sometimes
 * booked under Software, Meals, or bank-fee categories. Unknown lines outside
 * those two signals stay out instead of silently treating every expense as
 * marketing.
 */
export function classifyMarketingExpense(
  line: Pick<QBExpenseLine, 'account' | 'vendor' | 'memo'>,
): MarketingSpendChannel | null {
  const text = `${line.vendor} ${line.memo} ${line.account}`
  const matched = CHANNEL_PATTERNS.find(({ pattern }) => pattern.test(text))
  if (matched) return matched.channel
  return isQuickBooksMarketingAccount(line.account) ? 'Other marketing' : null
}

export function marketingExpenseLines(
  lines: QBExpenseLine[],
): QBMarketingExpenseLine[] {
  return lines.flatMap((line) => {
    const channel = classifyMarketingExpense(line)
    return channel ? [{ ...line, channel }] : []
  })
}

async function qbQuery(realmId: string, token: string, sql: string) {
  const url = `${BASE}/${realmId}/query?query=${encodeURIComponent(sql)}&minorversion=75`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  const text = await res.text()
  if (!res.ok)
    throw new Error(`QuickBooks ${res.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text).QueryResponse ?? {}
}

/**
 * Every expense line, newest first.
 *
 * `since` trims the scan; omit it and the whole ledger is read (~3,300 lines,
 * a few seconds). Do NOT add `orderby TxnDate desc` with a page cap — an earlier
 * version did and silently truncated before reaching 2025, under-reporting
 * Nextdoor by $468.
 */
export async function listExpenseLines(options?: {
  since?: string
  maxPages?: number
}): Promise<QBExpenseLine[]> {
  const auth = await getValidQBAccessToken()
  if (!auth) {
    throw new Error(
      'QuickBooks is not connected — reconnect it in admin settings before reading expenses.',
    )
  }
  const { accessToken, realmId } = auth
  const since = options?.since
  const maxPages = options?.maxPages ?? 40

  const out: QBExpenseLine[] = []

  for (const entity of ['Purchase', 'Bill'] as const) {
    for (let page = 0; page < maxPages; page++) {
      const start = page * 100 + 1
      const where = since ? ` where TxnDate >= '${since}'` : ''
      const batch =
        (
          await qbQuery(
            realmId,
            accessToken,
            `select * from ${entity}${where} startposition ${start} maxresults 100`,
          )
        )[entity] ?? []
      if (!batch.length) break

      for (const t of batch) {
        const vendor = t.EntityRef?.name || t.VendorRef?.name || ''
        const lines = (t.Line ?? []) as Array<Record<string, any>>
        lines.forEach((line, i) => {
          const acct = line.AccountBasedExpenseLineDetail?.AccountRef
          if (!acct) return
          out.push({
            key: `${entity}:${t.Id}:${i}`,
            txnId: String(t.Id),
            entity,
            date: t.TxnDate,
            amount: Number(line.Amount || 0),
            account: String(acct.name || ''),
            vendor,
            memo: String(line.Description || t.PrivateNote || ''),
          })
        })
      }
      if (batch.length < 100) break
    }
  }

  out.sort((a, b) => (a.date < b.date ? 1 : -1))
  return out
}

/**
 * Free-text search across vendor, memo and account.
 *
 * Memo matters most: it is the only place the merchant appears on the ~40% of
 * lines with no payee, and it is how the door-hanger print cost was found.
 */
export function searchExpenseLines(
  lines: QBExpenseLine[],
  query: string,
  limit = 50,
): QBExpenseLine[] {
  const q = query.trim().toLowerCase()
  if (!q) return lines.slice(0, limit)
  const terms = q.split(/\s+/)
  return lines
    .filter((l) => {
      const hay = `${l.vendor} ${l.memo} ${l.account} ${l.amount}`.toLowerCase()
      return terms.every((t) => hay.includes(t))
    })
    .slice(0, limit)
}
