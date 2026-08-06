'use client'

import { useState } from 'react'

/**
 * Keeps LSA spend current without any Google API access.
 *
 * Charles selects the rows on Google Ads → Billing → Billing activity, copies,
 * and pastes here. The parser is deliberately lenient about shape because that
 * paste arrives as loose text: it looks for a date, a lead count, and dollar
 * amounts anywhere on a line, rather than assuming fixed columns.
 */

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
}

export type ParsedRow = {
  date: string
  leads: number
  cost: number
  credits: number
}

export function parsePastedCharges(input: string): ParsedRow[] {
  const rows: ParsedRow[] = []

  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    // Payment/credit-card rows are not lead charges — skip them.
    if (/monthly charge|threshold charge|payments?\b/i.test(line)) continue

    let date = ''
    const iso = line.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
    if (iso) {
      date = `${iso[1]}-${iso[2]}-${iso[3]}`
    } else {
      const named = line.match(/\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/)
      if (named) {
        const mm = MONTHS[named[1].toLowerCase()]
        if (mm) date = `${named[3]}-${mm}-${String(named[2]).padStart(2, '0')}`
      }
    }
    if (!date) continue

    const amounts = [...line.matchAll(/\$\s?([\d,]+\.\d{2})/g)].map((m) =>
      Number(m[1].replace(/,/g, '')),
    )
    if (!amounts.length) continue

    const leadMatch = line.match(/(\d+)\s*leads?/i)

    rows.push({
      date,
      leads: leadMatch ? Number(leadMatch[1]) : 1,
      cost: amounts[0],
      credits: amounts.length > 1 ? amounts[1] : 0,
    })
  }

  return rows
}

export function LsaSpendEntry({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const preview = parsePastedCharges(text)
  const previewTotal = preview.reduce((s, r) => s + r.cost, 0)

  async function save() {
    if (!preview.length) return
    setSaving(true)
    setNote(null)
    try {
      const res = await fetch('/api/admin/marketing/lsa/charges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: preview }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to save')
      setNote(`Saved ${data.saved} day(s) of spend.`)
      setText('')
      onSaved()
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <span className="text-sm font-semibold text-white">Update spend</span>
        <span className="text-xs text-slate-400">
          {open ? 'Close' : 'Paste from Google →'}
        </span>
      </button>

      {open ? (
        <div className="space-y-3 border-t border-white/10 px-3 py-3">
          <ol className="list-decimal space-y-1 pl-4 text-xs text-slate-400">
            <li>
              Open Google Ads → <strong>Billing</strong> →{' '}
              <strong>Billing activity</strong>
            </li>
            <li>Select the rows in the table and copy them</li>
            <li>Paste below and hit Save</li>
          </ol>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder={'Aug 6, 2026  Campaigns  Home Services Ads activity  1 leads  $50.28  $0.00'}
            className="w-full rounded-lg border border-white/10 bg-slate-800/60 px-2 py-2 font-mono text-xs text-white"
          />

          {text.trim() ? (
            preview.length ? (
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
                <p className="text-xs text-emerald-300">
                  Found {preview.length} day(s), $
                  {previewTotal.toFixed(2)} total
                </p>
                <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-slate-300">
                  {preview.slice(0, 8).map((r) => (
                    <li key={r.date}>
                      {r.date} · {r.leads} lead(s) · ${r.cost.toFixed(2)}
                      {r.credits > 0 ? ` · credit $${r.credits.toFixed(2)}` : ''}
                    </li>
                  ))}
                  {preview.length > 8 ? (
                    <li>…and {preview.length - 8} more</li>
                  ) : null}
                </ul>
              </div>
            ) : (
              <p className="text-xs text-amber-300">
                Couldn&apos;t find any charge rows in that. Each line needs a
                date and a dollar amount.
              </p>
            )
          ) : null}

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!preview.length || saving}
              onClick={save}
              className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm text-white disabled:opacity-40"
            >
              {saving ? 'Saving…' : `Save ${preview.length || ''} day(s)`}
            </button>
            {note ? (
              <span className="text-xs text-emerald-300">{note}</span>
            ) : null}
          </div>

          <p className="text-[11px] text-slate-500">
            Re-pasting a range you already saved updates those days rather than
            adding them twice.
          </p>
        </div>
      ) : null}
    </div>
  )
}
