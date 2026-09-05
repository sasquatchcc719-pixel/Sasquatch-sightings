'use client'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  Building2,
  FileCheck2,
  Plus,
  ArrowUpRight,
  CalendarDays,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  AgreementView,
  Field,
  ProfileForm,
  commercialFetch,
  fieldClass,
  panelClass,
} from '@/components/client/commercial-details'
import {
  type CommercialData,
  type AgreementContent,
  type CommercialAgreement,
  blankScopeLine,
  phaseTotal,
  publicationIssues,
} from '@/lib/ops/commercial'
import { formatMoney } from '@/lib/ops/client-portal'
import { ClientRequestsPanel } from './client-requests-panel'

type Account = {
  id: string
  business_name: string
  full_name: string
  ops_commercial_agreements: { id: string; status: string }[]
  ops_client_users: { id: string; is_active: boolean }[]
}
type AccountData = CommercialData & {
  estimates: {
    id: string
    appointment_date: string
    quoted_total: number
    estimate_status: string
  }[]
  users: PortalUser[]
  plans: Plan[]
}
type PortalUser = {
  id: string
  display_name: string
  email: string
  is_active: boolean
  can_sign_agreements: boolean
}
type Plan = {
  id: string
  label: string
  is_active: boolean
  commercial_agreement_id: string
  start_time: string
}

export function CommercialAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  async function load(q = '') {
    setLoading(true)
    try {
      const data = await commercialFetch(
        `/api/admin/ops/commercial${q ? `?q=${encodeURIComponent(q)}` : ''}`,
      )
      setAccounts(data.customers)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void load()
  }, [])
  return (
    <div className="space-y-6 text-slate-100">
      <div className="relative overflow-hidden rounded-3xl border border-cyan-400/20 bg-gradient-to-br from-cyan-950 via-slate-900 to-slate-950 p-7">
        <p className="text-xs font-semibold tracking-[0.2em] text-cyan-300 uppercase">
          Commercial accounts
        </p>
        <h2 className="mt-2 text-3xl font-bold">
          A clear plan for every property.
        </h2>
        <p className="mt-3 max-w-2xl text-sm text-slate-300">
          Measured scope, service agreements, authorized contacts, and recurring
          care. Start with an accepted estimate or build an agreement for an
          existing account.
        </p>
        <div className="mt-6 flex flex-wrap gap-5 text-sm text-cyan-200">
          <span>
            <Building2 className="mr-2 inline h-4 w-4" />
            {accounts.length} accounts shown
          </span>
          <span>
            <FileCheck2 className="mr-2 inline h-4 w-4" />
            Versioned agreements
          </span>
          <span>
            <CalendarDays className="mr-2 inline h-4 w-4" />
            Connected scheduling
          </span>
        </div>
      </div>
      <ClientRequestsPanel />
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void load(search)
        }}
      >
        <Input
          className={`${fieldClass} max-w-md`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Find an existing business to manage…"
        />
        <Button>Search businesses</Button>
        <Button
          variant="outline"
          type="button"
          onClick={() => {
            setSearch('')
            void load()
          }}
        >
          Show commercial accounts
        </Button>
        <Link
          className="p-2 text-sm text-cyan-300"
          href="/admin/operations/customers"
        >
          Create a customer first <ArrowUpRight className="inline h-4 w-4" />
        </Link>
      </form>
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
      {loading ? (
        <p>Loading commercial accounts…</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {accounts.map((c) => (
            <Link
              href={`/admin/operations/commercial/${c.id}`}
              key={c.id}
              className={`${panelClass} transition hover:border-cyan-400/50`}
            >
              <Building2 className="mb-5 h-7 w-7 text-cyan-400" />
              <h3 className="text-xl font-semibold">
                {c.business_name || c.full_name}
              </h3>
              <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-400">
                <span>
                  {
                    c.ops_commercial_agreements.filter(
                      (a) => a.status === 'signed',
                    ).length
                  }{' '}
                  signed agreements
                </span>
                <span>
                  {
                    c.ops_commercial_agreements.filter(
                      (a) => a.status === 'draft',
                    ).length
                  }{' '}
                  drafts
                </span>
                <span>
                  {c.ops_client_users.filter((u) => u.is_active).length} portal
                  contacts
                </span>
              </div>
              <p className="mt-5 text-sm text-cyan-300">Open account →</p>
            </Link>
          ))}
          {accounts.length === 0 && (
            <p>
              No businesses found. Add the business to Customers, then search
              here.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export function CommercialAccount({ customerId }: { customerId: string }) {
  const [data, setData] = useState<AccountData | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState('')
  const [estimateId, setEstimateId] = useState('')
  const base = `/api/admin/ops/commercial/${customerId}`
  const load = useCallback(async () => {
    const next = await commercialFetch(base)
    setData(next)
  }, [base])
  useEffect(() => {
    void load().catch((e) => setError(e.message))
  }, [load])
  async function create() {
    setBusy(true)
    setError('')
    try {
      await commercialFetch('/api/admin/ops/commercial', 'POST', {
        customer_id: customerId,
      })
      const result = await commercialFetch(
        `${base}/agreements`,
        'POST',
        estimateId ? { estimate_id: estimateId } : {},
      )
      await load()
      setSelected(result.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }
  if (!data)
    return (
      <div className={panelClass}>{error || 'Loading commercial account…'}</div>
    )
  const agreement = data.agreements.find((a) => a.id === selected)
  return (
    <div className="space-y-5 text-slate-100">
      <Link
        href="/admin/operations/commercial"
        className="text-sm text-cyan-300"
      >
        ← Commercial accounts
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs tracking-widest text-cyan-400 uppercase">
            Commercial workspace
          </p>
          <h2 className="text-3xl font-bold">{data.businessName}</h2>
        </div>
        <div className="flex gap-2">
          <Link
            className="rounded-lg border border-white/15 px-3 py-2 text-sm"
            href={`/admin/operations/commercial/${customerId}/preview`}
          >
            Preview client view
          </Link>
          <Link
            className="rounded-lg border border-white/15 px-3 py-2 text-sm"
            href="/admin/operations/recurring"
          >
            Recurring calendar
          </Link>
        </div>
      </div>
      {error && (
        <p role="alert" className="rounded-xl bg-red-500/10 p-3 text-red-300">
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-xl bg-cyan-500/10 p-3 text-cyan-200"
        >
          {notice}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          [
            'Initial agreed scope',
            formatMoney(
              agreement ? phaseTotal(agreement.content, 'initial') : 0,
            ),
          ],
          ['Agreements', String(data.agreements.length)],
          [
            'Portal contacts',
            String(data.users.filter((u) => u.is_active).length),
          ],
        ].map(([label, value]) => (
          <div key={label} className={panelClass}>
            <p className="text-sm text-slate-400">
              {label}
              {label === 'Initial agreed scope' && !agreement
                ? ' (select agreement)'
                : ''}
            </p>
            <p className="mt-2 text-2xl font-bold text-cyan-200">{value}</p>
          </div>
        ))}
      </div>
      <details className={panelClass}>
        <summary className="cursor-pointer font-semibold">
          Business profile & service locations
        </summary>
        <div className="mt-4">
          <ProfileForm
            key={customerId}
            profile={data.profile}
            admin
            onSave={async (p) => {
              await commercialFetch('/api/admin/ops/commercial', 'POST', {
                customer_id: customerId,
              })
              await commercialFetch(base, 'PATCH', p)
              await load()
            }}
          />
          <div className="mt-3 space-y-2">
            {data.addresses.map((a) => (
              <p key={a.id} className="text-sm text-slate-400">
                {a.label} · {a.street_1}, {a.city}, {a.state} {a.zip_code}
              </p>
            ))}
          </div>
          <Link
            className="mt-3 inline-block text-sm text-cyan-300"
            href="/admin/operations/customers"
          >
            Manage customer addresses →
          </Link>
        </div>
      </details>
      <section className={panelClass}>
        <h3 className="mb-3 text-lg font-semibold">Agreements</h3>
        <div className="flex flex-wrap gap-2">
          <select
            aria-label="Accepted estimate"
            value={estimateId}
            onChange={(e) => setEstimateId(e.target.value)}
            className={`${fieldClass} rounded-lg border p-2 text-sm`}
          >
            <option value="">Start a blank agreement</option>
            {data.estimates.map((e) => (
              <option key={e.id} value={e.id}>
                Import accepted bid · {e.appointment_date} ·{' '}
                {formatMoney(e.quoted_total)}
              </option>
            ))}
          </select>
          <Button disabled={busy} onClick={() => void create()}>
            <Plus className="mr-1 h-4 w-4" />
            {busy ? 'Creating…' : 'Create draft'}
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {data.agreements.map((a) => (
            <button
              key={a.id}
              onClick={() => setSelected(a.id)}
              className={`rounded-lg border px-3 py-2 text-left text-sm ${selected === a.id ? 'border-cyan-400 bg-cyan-500/10' : 'border-white/10 bg-black/20'}`}
            >
              <span className="block font-medium">
                {a.content.title} · v{a.version}
              </span>
              <span className="text-xs text-slate-400">
                {a.status} · {new Date(a.created_at).toLocaleDateString()}
              </span>
            </button>
          ))}
        </div>
      </section>
      {agreement && (
        <AgreementEditor
          key={`${agreement.id}:${agreement.revision}`}
          agreement={agreement}
          addresses={data.addresses}
          onChange={async (id) => {
            await load()
            if (id) setSelected(id)
          }}
        />
      )}
      {agreement?.status === 'signed' && (
        <ServicePlanForm
          agreement={agreement}
          onSaved={async () => {
            await load()
            setNotice(
              'Service plan saved paused. Review it below, then activate and generate visits when you are ready.',
            )
          }}
        />
      )}
      <section className={panelClass}>
        <h3 className="text-lg font-semibold">Agreement service plans</h3>
        <p className="mt-1 text-sm text-slate-400">
          Plans are saved paused. Activation generates visits using the existing
          conflict checks. Review any skipped dates.
        </p>
        <div className="mt-4 space-y-3">
          {data.plans?.map((plan) => (
            <div
              key={plan.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 p-3"
            >
              <div className="flex-1">
                <p>{plan.label}</p>
                <p className="text-xs text-slate-400">
                  {plan.is_active ? 'Active' : 'Paused'} · {plan.start_time}
                </p>
              </div>
              <Button
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  setError('')
                  try {
                    await commercialFetch(
                      `/api/admin/ops/recurring/${plan.id}`,
                      'PATCH',
                      { template: { is_active: true } },
                    )
                    const result = await commercialFetch(
                      `/api/admin/ops/recurring/${plan.id}`,
                      'POST',
                      { action: 'generate' },
                    )
                    setNotice(
                      `${result.result.created} visits created; ${result.result.skipped} already present or skipped. ${result.result.errors.join(' ')}`,
                    )
                    await load()
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : 'Could not generate visits',
                    )
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                {plan.is_active
                  ? 'Generate missing visits'
                  : 'Activate & generate visits'}
              </Button>
              <Link
                className="text-sm text-cyan-300"
                href="/admin/operations/recurring"
              >
                Manage →
              </Link>
            </div>
          ))}
          {!data.plans?.length && (
            <p className="text-sm text-slate-400">
              No agreement-linked plans yet. Select a signed agreement to set
              one up. Existing recurring jobs remain available in the calendar.
            </p>
          )}
        </div>
      </section>
      <PortalUsers customerId={customerId} users={data.users} onChange={load} />
    </div>
  )
}

export function AgreementEditor({
  agreement,
  addresses,
  onChange,
}: {
  agreement: CommercialAgreement
  addresses: CommercialData['addresses']
  onChange: (id?: string) => Promise<void>
}) {
  const [content, setContent] = useState<AgreementContent>(agreement.content)
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reviewed, setReviewed] = useState(false)
  const editable = agreement.status === 'draft'
  function update<K extends keyof AgreementContent>(
    key: K,
    value: AgreementContent[K],
  ) {
    setContent({ ...content, [key]: value })
    setReviewed(false)
  }
  async function action(action: string) {
    setBusy(true)
    setError('')
    try {
      const result = await commercialFetch(
        `/api/admin/ops/commercial/agreements/${agreement.id}`,
        'PATCH',
        {
          action,
          revision: agreement.revision,
          ...(action === 'save' || action === 'publish' ? { content } : {}),
        },
      )
      await onChange(result.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className={panelClass}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-xl font-semibold">
          {editable ? 'Agreement draft' : 'Agreement record'} · v
          {agreement.version}
        </h3>
        {editable && (
          <Button variant="outline" onClick={() => setPreview(!preview)}>
            {preview ? 'Edit draft' : 'Preview agreement'}
          </Button>
        )}
      </div>
      {!editable || preview ? (
        <>
          <AgreementView
            agreement={{ ...agreement, content }}
            showExport={!editable}
          />
          {editable && (
            <p className="mt-3 text-xs text-slate-400">
              Preview includes your current edits. Save the draft before
              downloading a copy.
            </p>
          )}
        </>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Agreement title">
              <Input
                className={fieldClass}
                value={content.title}
                onChange={(e) => update('title', e.target.value)}
              />
            </Field>
            <Field label="Client legal business name">
              <Input
                className={fieldClass}
                value={content.business_name}
                onChange={(e) => update('business_name', e.target.value)}
              />
            </Field>
            <Field label="Service location">
              <select
                className={`${fieldClass} w-full rounded-lg border p-2`}
                value={content.service_address_id || ''}
                onChange={(e) => {
                  const a = addresses.find((a) => a.id === e.target.value)
                  setContent({
                    ...content,
                    service_address_id: a?.id || null,
                    service_address: a
                      ? [a.street_1, a.city, a.state, a.zip_code]
                          .filter(Boolean)
                          .join(', ')
                      : '',
                  })
                  setReviewed(false)
                }}
              >
                <option value="">Select a saved address</option>
                {addresses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.street_1} · {a.city}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Effective start">
              <Input
                type="date"
                className={fieldClass}
                value={content.effective_from}
                onChange={(e) => update('effective_from', e.target.value)}
              />
            </Field>
            <Field label="End date (optional)">
              <Input
                type="date"
                className={fieldClass}
                value={content.effective_until}
                onChange={(e) => update('effective_until', e.target.value)}
              />
            </Field>
          </div>
          <div className="flex justify-between">
            <h4 className="font-semibold">Service scope & measurements</h4>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                update('lines', [...content.lines, blankScopeLine()])
              }
            >
              Add service
            </Button>
          </div>
          {content.lines.map((line, index) => {
            const set = (key: string, value: unknown) =>
              update(
                'lines',
                content.lines.map((l, i) =>
                  i === index ? { ...l, [key]: value } : l,
                ),
              )
            return (
              <div
                className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-4"
                key={line.id}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-cyan-300">
                    Service {index + 1}
                  </span>
                  <button
                    className="text-xs text-red-300"
                    disabled={content.lines.length === 1}
                    onClick={() =>
                      update(
                        'lines',
                        content.lines.filter((l) => l.id !== line.id),
                      )
                    }
                  >
                    Remove
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Service">
                    <Input
                      className={fieldClass}
                      value={line.name}
                      onChange={(e) => set('name', e.target.value)}
                    />
                  </Field>
                  <Field label="Phase">
                    <select
                      className={`${fieldClass} w-full rounded-lg border p-2`}
                      value={line.phase}
                      onChange={(e) => set('phase', e.target.value)}
                    >
                      <option value="initial">Initial service</option>
                      <option value="recurring">Recurring service</option>
                      <option value="optional">Optional / on request</option>
                    </select>
                  </Field>
                  <Field label="Area / zone">
                    <Input
                      className={fieldClass}
                      value={line.area}
                      onChange={(e) => set('area', e.target.value)}
                    />
                  </Field>
                  <Field label="Quantity">
                    <Input
                      type="number"
                      min="0.001"
                      step="any"
                      className={fieldClass}
                      value={line.quantity}
                      onChange={(e) => set('quantity', Number(e.target.value))}
                    />
                  </Field>
                  <Field label="Unit (sq ft, hours, each)">
                    <Input
                      className={fieldClass}
                      value={line.unit}
                      onChange={(e) => set('unit', e.target.value)}
                    />
                  </Field>
                  <Field label="Price per unit ($)">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      className={fieldClass}
                      value={line.unit_price}
                      onChange={(e) =>
                        set('unit_price', Number(e.target.value))
                      }
                    />
                  </Field>
                  <Field label="Cleaning method">
                    <Input
                      className={fieldClass}
                      value={line.method}
                      onChange={(e) => set('method', e.target.value)}
                      placeholder="Hot water extraction, VLM…"
                    />
                  </Field>
                  <Field label="Frequency / season">
                    <Input
                      className={fieldClass}
                      value={line.frequency}
                      onChange={(e) => set('frequency', e.target.value)}
                      placeholder="Monthly, quarterly, on request…"
                    />
                  </Field>
                  <Field label="Service window">
                    <Input
                      className={fieldClass}
                      value={line.service_window}
                      onChange={(e) => set('service_window', e.target.value)}
                      placeholder="After closing; confirm access time"
                    />
                  </Field>
                </div>
                <Field label="Scope notes / measurements / conditions">
                  <Textarea
                    className={fieldClass}
                    rows={3}
                    value={line.notes}
                    onChange={(e) => set('notes', e.target.value)}
                  />
                </Field>
                {line.area_segments?.length ? (
                  <p className="text-xs text-slate-400">
                    Source measurements preserved:{' '}
                    {line.area_segments
                      .map((s) => `${s.length} × ${s.width}`)
                      .join(' + ')}
                    . Quantity changes above are an agreed scope adjustment;
                    source measurements remain in this version.
                  </p>
                ) : null}
              </div>
            )
          })}
          <div className="grid gap-4 sm:grid-cols-2">
            {(
              [
                ['payment_terms', 'Payment terms — confirm with the client'],
                [
                  'cancellation_terms',
                  'Cancellation / notice terms — confirm with the client',
                ],
                ['access_terms', 'Access and preparation'],
                ['quality_standards', 'Quality and inspection'],
                ['exclusions', 'Exclusions and scope changes'],
                ['additional_terms', 'Additional terms'],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} label={label}>
                <Textarea
                  rows={5}
                  className={fieldClass}
                  value={content[key]}
                  onChange={(e) => update(key, e.target.value)}
                />
              </Field>
            ))}
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-4 text-red-300">
          {error}
        </p>
      )}
      {editable ? (
        <div className="mt-6 space-y-3 border-t border-white/10 pt-4">
          <p className="text-xs text-slate-400">
            This starter agreement is editable business language, not a
            lawyer-reviewed contract. Review the actual scope, legal business
            names, pricing, and terms before publishing. Publishing makes the
            exact version available to the client; it does not send a message.
          </p>
          <div className="max-w-md rounded-xl border border-cyan-400/30 bg-cyan-500/5 p-4">
            <Field label="Sasquatch approving representative (required)">
              <Input
                className={fieldClass}
                value={content.provider_name}
                onChange={(e) => update('provider_name', e.target.value)}
                placeholder="Enter your full name"
                autoComplete="name"
              />
            </Field>
            <p className="mt-2 text-xs text-slate-400">
              This name appears on the agreement as the Sasquatch representative
              approving the terms for customer review.
            </p>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            I approve this version for customer review on behalf of Sasquatch.
          </label>
          {reviewed && publicationIssues(content).length > 0 && (
            <p className="text-sm text-amber-300">
              {publicationIssues(content).join(' ')}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              disabled={busy}
              variant="outline"
              onClick={() => void action('save')}
            >
              {busy ? 'Saving…' : 'Save draft'}
            </Button>
            <Button
              disabled={
                busy || !reviewed || publicationIssues(content).length > 0
              }
              onClick={() => void action('publish')}
            >
              Publish for signature
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-5 flex gap-2">
          <Button disabled={busy} onClick={() => void action('revise')}>
            Create new version
          </Button>
          {agreement.status === 'published' && (
            <Button
              disabled={busy}
              variant="outline"
              onClick={() => void action('withdraw')}
            >
              Withdraw unsigned version
            </Button>
          )}
        </div>
      )}
      {editable && (
        <a
          className="mt-4 mr-5 inline-block text-sm text-cyan-300"
          href={`/api/commercial/agreements/${agreement.id}/document?download=1`}
        >
          Download saved draft
        </a>
      )}
      {agreement.source_estimate_id && (
        <Link
          href={`/admin/operations/estimates/${agreement.source_estimate_id}`}
          className="mt-4 inline-block text-sm text-cyan-300"
        >
          Open source estimate / schedule initial cleaning →
        </Link>
      )}
    </section>
  )
}

function PortalUsers({
  customerId,
  users,
  onChange,
}: {
  customerId: string
  users: PortalUser[]
  onChange: () => Promise<void>
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [canSign, setCanSign] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [credentials, setCredentials] = useState<{
    email: string
    temporary_password: string
    login_url: string
  } | null>(null)
  const endpoint = `/api/admin/ops/commercial/${customerId}/users`
  async function change(user: PortalUser, updates: Partial<PortalUser>) {
    setBusy(true)
    setError('')
    try {
      await commercialFetch(endpoint, 'PATCH', {
        user_id: user.id,
        is_active: user.is_active,
        can_sign_agreements: user.can_sign_agreements,
        ...updates,
      })
      await onChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className={panelClass}>
      <h3 className="flex items-center gap-2 text-lg font-semibold">
        <Users className="h-5 w-5 text-cyan-400" />
        Portal contacts & signing access
      </h3>
      <div className="my-4 space-y-3">
        {users.map((u) => (
          <div
            key={u.id}
            className="flex flex-wrap items-center gap-4 rounded-xl border border-white/10 p-3"
          >
            <div className="flex-1">
              <p>{u.display_name}</p>
              <p className="text-xs text-slate-400">
                {u.email} · {u.is_active ? 'Active' : 'Disabled'}
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={busy}
                checked={u.can_sign_agreements}
                onChange={(e) =>
                  void change(u, { can_sign_agreements: e.target.checked })
                }
              />
              Can sign agreements
            </label>
            <Button
              disabled={busy}
              size="sm"
              variant="outline"
              onClick={() => void change(u, { is_active: !u.is_active })}
            >
              {u.is_active ? 'Disable access' : 'Enable access'}
            </Button>
          </div>
        ))}
      </div>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError('')
          try {
            await commercialFetch('/api/admin/ops/commercial', 'POST', {
              customer_id: customerId,
            })
            setCredentials(
              await commercialFetch(endpoint, 'POST', {
                display_name: name,
                email,
                can_sign_agreements: canSign,
              }),
            )
            setName('')
            setEmail('')
            await onChange()
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed')
          } finally {
            setBusy(false)
          }
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Contact name">
            <Input
              required
              minLength={2}
              className={fieldClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Contact email">
            <Input
              required
              type="email"
              className={fieldClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={canSign}
            onChange={(e) => setCanSign(e.target.checked)}
          />
          Authorized to sign service agreements
        </label>
        <Button disabled={busy}>Create portal login</Button>
        <p className="text-xs text-slate-400">
          Creates a temporary password for you to share. No invitation is sent
          automatically. The contact must choose their own password before
          signing.
        </p>
      </form>
      {credentials && (
        <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-500/10 p-4">
          <p className="font-medium">
            Save these login details before leaving this page
          </p>
          <p className="mt-2 text-sm break-all">
            {credentials.login_url}
            <br />
            {credentials.email}
            <br />
            Temporary password: <code>{credentials.temporary_password}</code>
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => setCredentials(null)}
          >
            Dismiss credentials
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-red-300">
          {error}
        </p>
      )}
    </section>
  )
}

function ServicePlanForm({
  agreement,
  onSaved,
}: {
  agreement: CommercialAgreement
  onSaved: () => Promise<void>
}) {
  const [operationId, setOperationId] = useState(() => crypto.randomUUID())
  const [lineIds, setLineIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dates, setDates] = useState<string[]>([])
  const [saved, setSaved] = useState(false)
  const [form, setForm] = useState({
    label: 'Maintenance cleaning',
    frequency: 'monthly',
    interval_days: 90,
    start_date: '',
    end_date: agreement.content.effective_until,
    start_time: '',
    duration: 120,
    invoice_mode: 'per_visit',
  })
  const recurring = agreement.content.lines.filter(
    (l) => l.phase === 'recurring',
  )
  if (!recurring.length)
    return (
      <p className={panelClass}>
        This agreement has no recurring services. Use the source estimate to
        schedule the initial work, or create a new version when the maintenance
        plan is agreed.
      </p>
    )
  async function submit(preview: boolean) {
    setBusy(true)
    setError('')
    try {
      const result = await commercialFetch(
        `/api/admin/ops/commercial/agreements/${agreement.id}/schedule`,
        'POST',
        { ...form, operation_id: operationId, line_ids: lineIds, preview },
      )
      setDates(result.dates)
      if (!preview) {
        setSaved(true)
        await onSaved()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className={panelClass}>
      <h3 className="text-lg font-semibold">
        Build a service schedule from this agreement
      </h3>
      <p className="mt-1 text-sm text-slate-400">
        Choose services with the same frequency and timing. Create separate
        plans for different seasons or methods. The plan starts paused.
      </p>
      <div className="my-4 space-y-2">
        {recurring.map((l) => (
          <label key={l.id} className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={lineIds.includes(l.id)}
              onChange={(e) => {
                setLineIds(
                  e.target.checked
                    ? [...lineIds, l.id]
                    : lineIds.filter((id) => id !== l.id),
                )
                setDates([])
              }}
            />
            {l.name} · {l.frequency} · {l.service_window}
          </label>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {(
          [
            ['label', 'Plan name', 'text'],
            ['start_date', 'First service date', 'date'],
            ['end_date', 'Last date / season end', 'date'],
            ['start_time', 'Arrival time', 'time'],
            ['duration', 'Working duration (minutes)', 'number'],
          ] as const
        ).map(([key, label, type]) => (
          <Field label={label} key={key}>
            <Input
              className={fieldClass}
              type={type}
              value={form[key]}
              onChange={(e) => {
                setForm({
                  ...form,
                  [key]:
                    type === 'number' ? Number(e.target.value) : e.target.value,
                })
                setDates([])
              }}
            />
          </Field>
        ))}
        <Field label="Frequency">
          <select
            className={`${fieldClass} rounded-lg border p-2`}
            value={form.frequency}
            onChange={(e) => {
              setForm({ ...form, frequency: e.target.value })
              setDates([])
            }}
          >
            <option value="weekly">Weekly</option>
            <option value="biweekly">Every other week</option>
            <option value="monthly">Monthly on this date</option>
            <option value="custom">Every N days</option>
          </select>
        </Field>
        {form.frequency === 'custom' && (
          <Field label="Days between visits">
            <Input
              className={fieldClass}
              type="number"
              min={1}
              value={form.interval_days}
              onChange={(e) => {
                setForm({ ...form, interval_days: Number(e.target.value) })
                setDates([])
              }}
            />
          </Field>
        )}
        <Field label="Billing">
          <select
            className={`${fieldClass} rounded-lg border p-2`}
            value={form.invoice_mode}
            onChange={(e) => setForm({ ...form, invoice_mode: e.target.value })}
          >
            <option value="per_visit">Invoice per visit</option>
            <option value="batch_monthly">Monthly consolidated invoice</option>
          </select>
        </Field>
      </div>
      {dates.length > 0 && (
        <p className="mt-3 text-sm text-cyan-300">
          Upcoming dates: {dates.join(' · ')}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-red-300">
          {error}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <Button
          variant="outline"
          disabled={busy || saved}
          onClick={() => void submit(true)}
        >
          Preview dates
        </Button>
        <Button
          disabled={busy || saved || dates.length === 0}
          onClick={() => void submit(false)}
        >
          {saved ? 'Plan saved paused' : 'Save paused service plan'}
        </Button>
        {saved && (
          <Button
            variant="outline"
            onClick={() => {
              setOperationId(crypto.randomUUID())
              setSaved(false)
              setDates([])
              setLineIds([])
            }}
          >
            Create another plan
          </Button>
        )}
      </div>
    </section>
  )
}
