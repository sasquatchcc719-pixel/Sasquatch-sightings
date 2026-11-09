'use client'
import { useState, type FormEvent } from 'react'
import { seoChangeSchema, type SeoChange } from '@/lib/seo/change-ledger'

type Entry = {
  id: string
  title: string
  seo_revision: number
  seo_change: unknown
}
const empty = (): SeoChange => ({
  version: 1,
  hypothesis: '',
  exactChange: '',
  deploymentRef: null,
  deployedAt: null,
  affectedUrls: [],
  queries: [],
  baseline: [],
  reviewDates: [],
  outcomes: [],
})
const lines = (value: string) =>
  value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
const inputStyle =
  'mt-1 w-full rounded border border-white/20 bg-slate-950 p-2 text-white'
function Field({
  label,
  value,
  onChange,
  type = 'text',
  multiline = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  multiline?: boolean
}) {
  return (
    <label className="block text-sm text-slate-300">
      {label}
      {multiline ? (
        <textarea
          className={inputStyle}
          rows={3}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className={inputStyle}
          type={type}
          step={type === 'number' ? 'any' : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  )
}
function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  return (
    <label className="block text-sm text-slate-300">
      {label}
      <select
        className={inputStyle}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option.replaceAll('_', ' ')}
          </option>
        ))}
      </select>
    </label>
  )
}
export function SeoLedgerEditor({ onSaved }: { onSaved?: () => void }) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [selected, setSelected] = useState<Entry | null>(null)
  const [change, setChange] = useState<SeoChange>(empty)
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const set = <K extends keyof SeoChange>(key: K, value: SeoChange[K]) =>
    setChange((old) => ({ ...old, [key]: value }))
  async function load() {
    setBusy(true)
    try {
      const response = await fetch('/api/admin/marketing/events', {
        cache: 'no-store',
      })
      if (!response.ok) throw new Error('Read failed')
      const body = await response.json()
      setEntries(
        body.events.filter(
          (entry: Entry) =>
            Number.isInteger(entry.seo_revision) &&
            entry.seo_revision >= 0 &&
            seoChangeSchema.safeParse(entry.seo_change).success,
        ),
      )
      setMessage(
        'Latest records loaded. Select a record to inspect its saved evidence before editing.',
      )
    } catch {
      setMessage('Could not read saved changes. Your draft is preserved.')
    } finally {
      setBusy(false)
    }
  }
  function select(id: string) {
    const entry = entries.find((row) => row.id === id)
    if (!entry) return
    const result = seoChangeSchema.safeParse(entry.seo_change)
    if (!result.success) return
    setSelected(entry)
    setTitle(entry.title)
    setChange(result.data)
    setUncertain(false)
    setMessage(
      'Editing saved evidence. Saving does not deploy website changes.',
    )
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    const parsed = seoChangeSchema.safeParse({
      ...change,
      affectedUrls: lines(change.affectedUrls.join('\n')),
      queries: lines(change.queries.join('\n')),
      reviewDates: lines(change.reviewDates.join('\n')),
      outcomes: change.outcomes.map((row) => ({
        ...row,
        evidenceRefs: lines(row.evidenceRefs.join('\n')),
        confounders: lines(row.confounders.join('\n')),
      })),
    })
    if (!title.trim()) {
      setMessage('Add a title.')
      return
    }
    if (!parsed.success) {
      setMessage(
        parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; '),
      )
      return
    }
    setBusy(true)
    setMessage('Saving…')
    try {
      const response = await fetch('/api/admin/marketing/events', {
        method: selected ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          selected
            ? {
                id: selected.id,
                expected_revision: selected.seo_revision,
                title: title.trim(),
                seo_change: parsed.data,
              }
            : {
                title: title.trim(),
                category: 'website',
                seo_change: parsed.data,
              },
        ),
      })
      if (response.status === 409) {
        setMessage(
          'This record changed elsewhere. Your draft is preserved. Load latest records, then select it to review before editing again.',
        )
        setUncertain(true)
        return
      }
      if (!response.ok) {
        if (response.status >= 500) setUncertain(true)
        setMessage(
          response.status >= 500
            ? 'Save outcome is uncertain. Do not retry blindly. Load latest records and inspect the saved evidence first.'
            : 'Save rejected. Check your fields and permissions; draft preserved.',
        )
        return
      }
      setMessage(
        'Saved. This records evidence only; no website change or scan was started.',
      )
      setSelected(null)
      setTitle('')
      setChange(empty())
      setEntries([])
      onSaved?.()
    } catch {
      setUncertain(true)
      setMessage(
        'Save outcome is uncertain. Do not retry blindly. Load latest records and inspect the saved evidence first.',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <details className="rounded-xl border border-white/15 p-4">
      <summary className="cursor-pointer font-semibold text-white">
        Record or review an SEO change
      </summary>
      <p className="mt-3 text-sm text-slate-400">
        Keep a baseline and review the outcome later. A later improvement is not
        proof that this change caused it. Dates below use the stated source
        period; deployment and review timestamps use ISO time with timezone.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={load}
        className="my-3 text-sky-300 underline"
      >
        Load latest saved changes
      </button>
      {entries.length > 0 && (
        <label className="block text-sm text-slate-300">
          Saved change
          <select
            className={inputStyle}
            value=""
            onChange={(e) => select(e.target.value)}
          >
            <option value="">Choose a saved change</option>
            {entries.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.title}
              </option>
            ))}
          </select>
        </label>
      )}
      {selected && (
        <button
          type="button"
          disabled={busy}
          className="my-3 text-sky-300 underline"
          onClick={() => {
            setSelected(null)
            setChange(empty())
            setTitle('')
            setMessage('New draft.')
            setUncertain(false)
          }}
        >
          Start a new record
        </button>
      )}
      <form onSubmit={save} className="mt-3 space-y-4">
        <fieldset disabled={busy} className="space-y-4">
          <Field label="Change title" value={title} onChange={setTitle} />
          <Field
            label="Hypothesis: what should improve and why?"
            value={change.hypothesis}
            onChange={(v) => set('hypothesis', v)}
            multiline
          />
          <Field
            label="Exact change made or planned"
            value={change.exactChange}
            onChange={(v) => set('exactChange', v)}
            multiline
          />
          <Field
            label="Deployment reference (optional commit or URL)"
            value={change.deploymentRef ?? ''}
            onChange={(v) => set('deploymentRef', v || null)}
          />
          <Field
            label="Verified deployed at (optional ISO timestamp, e.g. 2026-11-09T15:00:00Z)"
            value={change.deployedAt ?? ''}
            onChange={(v) => set('deployedAt', v || null)}
          />
          <Field
            label="Affected page URLs (one per line)"
            value={change.affectedUrls.join('\n')}
            onChange={(v) => set('affectedUrls', v.split('\n'))}
            multiline
          />
          <Field
            label="Target queries (one per line)"
            value={change.queries.join('\n')}
            onChange={(v) => set('queries', v.split('\n'))}
            multiline
          />
          <Field
            label="Review dates (YYYY-MM-DD, one per line)"
            value={change.reviewDates.join('\n')}
            onChange={(v) => set('reviewDates', v.split('\n'))}
            multiline
          />
          <h3 className="font-semibold text-white">Baseline evidence</h3>
          <p className="text-sm text-slate-400">
            Leave the value blank when unavailable. Do not invent a zero. An
            empty baseline means no baseline has been captured.
          </p>
          {change.baseline.map((row, i) => {
            const update = (patch: Partial<typeof row>) =>
              set(
                'baseline',
                change.baseline.map((r, n) =>
                  n === i ? { ...r, ...patch } : r,
                ),
              )
            return (
              <fieldset
                key={i}
                className="space-y-3 rounded border border-white/15 p-3"
              >
                <legend className="text-white">Baseline {i + 1}</legend>
                <Choice
                  label={`Baseline ${i + 1} surface`}
                  value={row.surface}
                  options={['maps', 'organic', 'business']}
                  onChange={(v) => update({ surface: v as typeof row.surface })}
                />
                <Field
                  label={`Baseline ${i + 1} metric`}
                  value={row.metric}
                  onChange={(v) => update({ metric: v })}
                />
                <Field
                  label={`Baseline ${i + 1} value`}
                  type="number"
                  value={row.value === null ? '' : String(row.value)}
                  onChange={(v) =>
                    update({ value: v === '' ? null : Number(v) })
                  }
                />
                <Field
                  label={`Baseline ${i + 1} unit`}
                  value={row.unit}
                  onChange={(v) => update({ unit: v })}
                />
                <Field
                  label={`Baseline ${i + 1} period start`}
                  type="date"
                  value={row.period.start}
                  onChange={(v) =>
                    update({ period: { ...row.period, start: v } })
                  }
                />
                <Field
                  label={`Baseline ${i + 1} period end`}
                  type="date"
                  value={row.period.end}
                  onChange={(v) =>
                    update({ period: { ...row.period, end: v } })
                  }
                />
                <Field
                  label={`Baseline ${i + 1} source reference`}
                  value={row.sourceRef}
                  onChange={(v) => update({ sourceRef: v })}
                />
                <Field
                  label={`Baseline ${i + 1} method and source timezone`}
                  value={row.method}
                  onChange={(v) => update({ method: v })}
                  multiline
                />
                <Choice
                  label={`Baseline ${i + 1} evidence status`}
                  value={row.state}
                  options={[
                    'measured',
                    'partial',
                    'failed',
                    'stale',
                    'unavailable',
                  ]}
                  onChange={(v) => update({ state: v as typeof row.state })}
                />
                <button
                  type="button"
                  className="text-sky-300 underline"
                  onClick={() =>
                    set(
                      'baseline',
                      change.baseline.filter((_, n) => n !== i),
                    )
                  }
                >
                  Remove baseline {i + 1} from draft
                </button>
              </fieldset>
            )
          })}
          <button
            type="button"
            disabled={change.baseline.length >= 30}
            className="text-sky-300 underline"
            onClick={() =>
              set('baseline', [
                ...change.baseline,
                {
                  surface: 'organic',
                  metric: '',
                  value: null,
                  unit: '',
                  period: { start: '', end: '' },
                  sourceRef: '',
                  method: '',
                  state: 'unavailable',
                },
              ])
            }
          >
            Add baseline
          </button>
          <h3 className="font-semibold text-white">Outcome reviews</h3>
          {change.outcomes.map((row, i) => {
            const update = (patch: Partial<typeof row>) =>
              set(
                'outcomes',
                change.outcomes.map((r, n) =>
                  n === i ? { ...r, ...patch } : r,
                ),
              )
            return (
              <fieldset
                key={i}
                className="space-y-3 rounded border border-white/15 p-3"
              >
                <legend className="text-white">Review {i + 1}</legend>
                <Field
                  label={`Review ${i + 1} timestamp (ISO with timezone)`}
                  value={row.reviewedAt}
                  onChange={(v) => update({ reviewedAt: v })}
                />
                <Field
                  label={`Review ${i + 1} observation`}
                  value={row.observation}
                  onChange={(v) => update({ observation: v })}
                  multiline
                />
                <Field
                  label={`Review ${i + 1} evidence references (one per line)`}
                  value={row.evidenceRefs.join('\n')}
                  onChange={(v) => update({ evidenceRefs: v.split('\n') })}
                  multiline
                />
                <Field
                  label={`Review ${i + 1} confounders (one per line)`}
                  value={row.confounders.join('\n')}
                  onChange={(v) => update({ confounders: v.split('\n') })}
                  multiline
                />
                <Choice
                  label={`Review ${i + 1} interpretation`}
                  value={row.interpretation}
                  options={[
                    'inconclusive',
                    'consistent_with_hypothesis',
                    'not_consistent_with_hypothesis',
                  ]}
                  onChange={(v) =>
                    update({ interpretation: v as typeof row.interpretation })
                  }
                />
                <button
                  type="button"
                  className="text-sky-300 underline"
                  onClick={() =>
                    set(
                      'outcomes',
                      change.outcomes.filter((_, n) => n !== i),
                    )
                  }
                >
                  Remove review {i + 1} from draft
                </button>
              </fieldset>
            )
          })}
          <button
            type="button"
            disabled={change.outcomes.length >= 20}
            className="text-sky-300 underline"
            onClick={() =>
              set('outcomes', [
                ...change.outcomes,
                {
                  reviewedAt: new Date().toISOString(),
                  observation: '',
                  evidenceRefs: [],
                  confounders: [],
                  interpretation: 'inconclusive',
                },
              ])
            }
          >
            Add outcome review
          </button>
          <button
            type="submit"
            disabled={uncertain}
            className="block rounded bg-sky-700 px-4 py-2 text-white disabled:opacity-50"
          >
            {busy
              ? 'Saving…'
              : selected
                ? 'Save reviewed evidence'
                : 'Save new change record'}
          </button>
        </fieldset>
        {message && (
          <p role="status" className="text-sm text-amber-200">
            {message}
          </p>
        )}
      </form>
    </details>
  )
}
