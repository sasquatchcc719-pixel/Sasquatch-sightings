'use client'
import { useEffect, useState } from 'react'
import {
  Building2,
  FileCheck2,
  Download,
  Printer,
  ShieldCheck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  type CommercialData,
  type CommercialAgreement,
  type CommercialProfile,
  SIGNATURE_CONSENT,
  lineAmount,
  commercialUnit,
} from '@/lib/ops/commercial'
import { formatMoney } from '@/lib/ops/client-portal'

export const panelClass =
  'rounded-2xl border border-white/10 bg-slate-900/80 p-5 text-slate-100 shadow-sm'
export const fieldClass = 'border-white/15 bg-slate-950/60 text-slate-100'
export function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="text-slate-400">{label}</span>
      {children}
    </label>
  )
}
export async function commercialFetch(
  url: string,
  method = 'GET',
  body?: unknown,
) {
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json()
  if (!response.ok)
    throw new Error(data.error || 'Request failed. Please try again.')
  return data
}
const PROFILE_LABELS: Record<keyof CommercialProfile, string> = {
  legal_name: 'Legal business name',
  billing_contact: 'Billing contact',
  billing_email: 'Billing email',
  purchase_order: 'Purchase order / vendor reference',
  access_instructions: 'Access and preparation instructions',
  service_windows: 'Preferred service windows',
  site_notes: 'Site details and floor care notes',
}
export function ProfileForm({
  profile,
  onSave,
  admin = false,
  readOnly = false,
}: {
  profile: CommercialProfile
  onSave: (p: CommercialProfile) => Promise<void>
  admin?: boolean
  readOnly?: boolean
}) {
  const [value, setValue] = useState(profile)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  return (
    <form
      className={panelClass}
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setMessage('')
        try {
          await onSave(value)
          setMessage('Business details saved.')
        } catch (err) {
          setMessage(err instanceof Error ? err.message : 'Save failed')
        } finally {
          setBusy(false)
        }
      }}
    >
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
        <Building2 className="h-5 w-5 text-cyan-400" />
        Business profile
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {(Object.keys(PROFILE_LABELS) as (keyof CommercialProfile)[]).map(
          (key) => (
            <Field key={key} label={PROFILE_LABELS[key]}>
              {[
                'access_instructions',
                'service_windows',
                'site_notes',
              ].includes(key) ? (
                <Textarea
                  className={fieldClass}
                  disabled={readOnly}
                  value={value[key]}
                  onChange={(e) =>
                    setValue({ ...value, [key]: e.target.value })
                  }
                />
              ) : (
                <Input
                  type={key === 'billing_email' ? 'email' : 'text'}
                  className={fieldClass}
                  disabled={readOnly || (key === 'legal_name' && !admin)}
                  value={value[key]}
                  onChange={(e) =>
                    setValue({ ...value, [key]: e.target.value })
                  }
                />
              )}
            </Field>
          ),
        )}
      </div>
      <p className="mt-3 text-xs text-slate-400">
        Preferences help us plan your visits. Changes to signed pricing, scope,
        or dates require confirmation.
      </p>
      {!readOnly && (
        <Button className="mt-4" disabled={busy}>
          {busy ? 'Saving…' : 'Save business details'}
        </Button>
      )}
      {message && (
        <p role="status" className="mt-3 text-sm text-cyan-300">
          {message}
        </p>
      )}
    </form>
  )
}
export function AgreementView({
  agreement,
  showExport = true,
}: {
  agreement: CommercialAgreement
  showExport?: boolean
}) {
  const c = agreement.content
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-widest text-cyan-400 uppercase">
            Version {agreement.version} · {agreement.status}
          </p>
          <h3 className="mt-1 text-xl font-bold">{c.title}</h3>
          <p className="text-slate-300">{c.business_name}</p>
          <p className="text-sm text-slate-400">{c.service_address}</p>
        </div>
        {showExport && (
          <div className="flex gap-2">
            <a
              className="rounded-lg border border-white/15 p-2 text-sm"
              href={`/api/commercial/agreements/${agreement.id}/document`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Printer className="mr-1 inline h-4 w-4" />
              Print / PDF
            </a>
            <a
              className="rounded-lg border border-white/15 p-2 text-sm"
              href={`/api/commercial/agreements/${agreement.id}/document?download=1`}
            >
              <Download className="mr-1 inline h-4 w-4" />
              Download
            </a>
          </div>
        )}
      </div>
      <p className="text-sm text-slate-400">
        Effective {c.effective_from || 'Not set'}
        {c.effective_until
          ? ` through ${c.effective_until}`
          : ' · No fixed end date'}{' '}
        · Sasquatch representative: {c.provider_name || 'Not yet approved'}
      </p>
      <p className="text-xs text-slate-400">
        Each service has its own frequency and price. Optional services require
        a separate request; the prices below are not an annual commitment.
      </p>
      {c.lines.map((line) => (
        <div
          key={line.id}
          className="rounded-xl border border-white/10 bg-black/20 p-4"
        >
          <div className="flex justify-between gap-3">
            <div>
              <span className="text-xs text-cyan-400 uppercase">
                {line.phase}
              </span>
              <h4 className="font-semibold">{line.name}</h4>
              <p className="text-sm text-slate-400">{line.area}</p>
            </div>
            <div className="text-right">
              <p className="font-semibold text-emerald-300">
                {formatMoney(lineAmount(line))}
              </p>
              <p className="text-xs text-slate-400">
                {line.quantity.toLocaleString()} {commercialUnit(line.unit)} ×{' '}
                {formatMoney(line.unit_price)}
              </p>
            </div>
          </div>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
            <p>
              <span className="block text-xs text-slate-500">Method</span>
              {line.method || 'To be confirmed'}
            </p>
            <p>
              <span className="block text-xs text-slate-500">Frequency</span>
              {line.frequency || 'To be confirmed'}
            </p>
            <p>
              <span className="block text-xs text-slate-500">
                Service window
              </span>
              {line.service_window || 'By confirmed appointment'}
            </p>
          </div>
          {line.area_segments?.length ? (
            <p className="mt-2 text-xs text-slate-400">
              Measured sections:{' '}
              {line.area_segments
                .map((s) => `${s.length} × ${s.width}`)
                .join(' + ')}
            </p>
          ) : null}
          {line.notes && (
            <p className="mt-3 text-sm whitespace-pre-wrap text-slate-300">
              {line.notes}
            </p>
          )}
        </div>
      ))}
      {[
        ['Payment terms', c.payment_terms],
        ['Cancellation and rescheduling', c.cancellation_terms],
        ['Access and preparation', c.access_terms],
        ['Quality and inspection', c.quality_standards],
        ['Exclusions and scope changes', c.exclusions],
        ['Additional terms', c.additional_terms],
      ].map(([label, value]) => (
        <section key={label}>
          <h4 className="font-semibold">{label}</h4>
          <p className="mt-1 text-sm whitespace-pre-wrap text-slate-300">
            {value || 'Not specified — draft requires review'}
          </p>
        </section>
      ))}
      {agreement.signed_at && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <h4 className="flex items-center gap-2 font-semibold text-emerald-300">
            <ShieldCheck className="h-5 w-5" />
            Signed by {agreement.signed_name}
          </h4>
          <p className="mt-1 text-sm">
            {agreement.signed_title} · {agreement.signed_email}
          </p>
          <p className="text-xs text-slate-400">
            {new Date(agreement.signed_at).toLocaleString()} ·{' '}
            {agreement.signature_consent}
          </p>
        </div>
      )}
      {agreement.content_hash && (
        <p className="text-xs break-all text-slate-500">
          Agreement {agreement.id} · SHA-256 {agreement.content_hash}
        </p>
      )}
    </div>
  )
}
function SignatureForm({
  agreement,
  onSigned,
}: {
  agreement: CommercialAgreement
  onSigned: () => void
}) {
  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [password, setPassword] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <form
      className="mt-6 space-y-4 rounded-xl border border-cyan-400/30 bg-cyan-500/5 p-5"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setError('')
        try {
          await commercialFetch(
            `/api/client/commercial/agreements/${agreement.id}/sign`,
            'POST',
            {
              name,
              title,
              password,
              consent,
              content_hash: agreement.content_hash,
            },
          )
          setPassword('')
          onSigned()
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Signing failed')
        } finally {
          setPassword('')
          setBusy(false)
        }
      }}
    >
      <h4 className="font-semibold">Sign this agreement</h4>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Your full legal name">
          <Input
            required
            minLength={2}
            className={fieldClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Your title / authority at the business">
          <Input
            required
            minLength={2}
            className={fieldClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Confirm your portal password">
        <Input
          required
          type="password"
          autoComplete="current-password"
          className={fieldClass}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <label className="flex items-start gap-3 text-sm text-slate-300">
        <input
          required
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-1"
        />
        {SIGNATURE_CONSENT}
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      <Button disabled={busy || !consent}>
        {busy ? 'Verifying and signing…' : 'Sign and accept agreement'}
      </Button>
    </form>
  )
}
export function ClientCommercialDetails({
  initialData,
  readOnly = false,
  canSign = false,
}: {
  initialData?: CommercialData
  readOnly?: boolean
  canSign?: boolean
}) {
  const [data, setData] = useState<
    (CommercialData & { canSign?: boolean }) | null
  >(initialData || null)
  const [error, setError] = useState('')
  const refresh = () =>
    commercialFetch('/api/client/commercial')
      .then(setData)
      .catch((e) => setError(e.message))
  useEffect(() => {
    if (!initialData) void refresh()
  }, [initialData])
  if (!data)
    return (
      <div className={panelClass}>
        {error || 'Loading your business details…'}
      </div>
    )
  return (
    <div className="space-y-5">
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
      <ProfileForm
        profile={data.profile}
        readOnly={readOnly}
        onSave={async (p) => {
          await commercialFetch('/api/client/commercial', 'PATCH', p)
          await refresh()
        }}
      />
      <div className="flex items-center gap-2">
        <FileCheck2 className="h-5 w-5 text-cyan-400" />
        <h2 className="text-xl font-bold">Service agreements</h2>
      </div>
      {data.agreements.length === 0 && (
        <p className={panelClass}>
          Your service agreement will appear here when Sasquatch publishes it
          for review.
        </p>
      )}
      {data.agreements.map((a) => (
        <details
          key={a.id}
          className={panelClass}
          open={a.status === 'published'}
        >
          <summary className="cursor-pointer font-semibold">
            {a.content.title} · Version {a.version} · {a.status}
          </summary>
          <div className="mt-5">
            <AgreementView agreement={a} />
            {a.status === 'published' &&
              !readOnly &&
              ((data.canSign ?? canSign) ? (
                <SignatureForm agreement={a} onSigned={() => void refresh()} />
              ) : (
                <p className="mt-5 text-sm text-amber-300">
                  An authorized signer for your business can accept this
                  agreement. Contact Sasquatch to update signing access.
                </p>
              ))}
          </div>
        </details>
      ))}
    </div>
  )
}
