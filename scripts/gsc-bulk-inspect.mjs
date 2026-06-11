/** Bulk GSC URL inspection across properties. Usage: node scripts/gsc-bulk-inspect.mjs */
import { config } from 'dotenv'
import { google } from 'googleapis'
config({ path: '.env.local' })

const o = new google.auth.OAuth2(process.env.RANGER_GMAIL_CLIENT_ID, process.env.RANGER_GMAIL_CLIENT_SECRET)
o.setCredentials({ refresh_token: process.env.GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN })
const sc = google.searchconsole({ version: 'v1', auth: o })

const WWW = 'https://www.sasquatchcarpet.com/'
const SIGHT = 'https://sightings.sasquatchcarpet.com/'

async function fetchLocs(url) {
  const res = await fetch(url)
  const xml = await res.text()
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
}

const wwwMain = await fetchLocs('https://www.sasquatchcarpet.com/sitemap.xml')
const wwwJobs = await fetchLocs('https://www.sasquatchcarpet.com/sitemap-jobs.xml')
const sightLocs = await fetchLocs('https://sightings.sasquatchcarpet.com/sitemap.xml')

// Targets: all main www URLs; newest 25 proxied job URLs; newest 25 subdomain work URLs; monument variants
const targets = []
for (const u of wwwMain.filter((u) => !u.endsWith('llms.txt'))) targets.push({ site: WWW, url: u, group: 'www-main' })
for (const u of wwwJobs.slice(0, 25)) targets.push({ site: WWW, url: u, group: 'www-jobs-proxy' })
for (const u of sightLocs.filter((u) => u.includes('/work/')).slice(0, 25)) targets.push({ site: SIGHT, url: u, group: 'sight-work' })
targets.push({ site: SIGHT, url: 'https://sightings.sasquatchcarpet.com', group: 'sight-home' })
targets.push({ site: 'https://sasquatchcarpet.com/', url: 'https://sasquatchcarpet.com/service-areas/monument', group: 'nonwww-monument' })
targets.push({ site: WWW, url: 'https://www.sasquatchcarpet.com/service-areas/monument/', group: 'monument-slash' })

console.log(`inspecting ${targets.length} URLs...`)
const out = []
let i = 0
async function worker() {
  while (i < targets.length) {
    const t = targets[i++]
    try {
      const { data } = await sc.urlInspection.index.inspect({
        requestBody: { inspectionUrl: t.url, siteUrl: t.site },
      })
      const r = data.inspectionResult?.indexStatusResult || {}
      out.push({
        group: t.group, url: t.url,
        verdict: r.verdict, coverage: r.coverageState,
        lastCrawl: (r.lastCrawlTime || '').slice(0, 10) || null,
        robots: r.robotsTxtState, fetch: r.pageFetchState,
        googleCanonical: r.googleCanonical || null, userCanonical: r.userCanonical || null,
        inSitemaps: (r.sitemap || []).length, referringUrls: (r.referringUrls || []).slice(0, 3),
      })
    } catch (e) {
      out.push({ group: t.group, url: t.url, error: String(e.message).slice(0, 120) })
    }
  }
}
await Promise.all(Array.from({ length: 5 }, worker))

// Summary by group+coverage
const tally = {}
for (const r of out) {
  const k = `${r.group} :: ${r.coverage || r.error || '?'}`
  tally[k] = (tally[k] || 0) + 1
}
console.log('\n=== TALLY (group :: coverage -> count) ===')
for (const [k, v] of Object.entries(tally).sort()) console.log(`  ${v}  ${k}`)

console.log('\n=== DETAIL ===')
for (const r of out) {
  if (r.error) { console.log(`ERR ${r.url} :: ${r.error}`); continue }
  const path = r.url.replace(/https:\/\/(www\.|sightings\.)?sasquatchcarpet\.com/, '')
  console.log(`[${r.group}] ${path || '/'}\n    ${r.coverage} | crawl:${r.lastCrawl || 'never'} | sitemaps:${r.inSitemaps} | refs:${r.referringUrls.length}${r.googleCanonical && r.googleCanonical !== r.url ? ` | G-canonical:${r.googleCanonical}` : ''}`)
}
