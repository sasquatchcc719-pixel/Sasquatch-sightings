'use client'
import { useEffect, useState } from 'react'
import Image from 'next/image'
import styles from './commercial-experience.module.css'
import {
  Building2,
  FileCheck2,
  FileText,
  Download,
  ExternalLink,
  Printer,
  ShieldCheck,
  ChevronDown,
  Layers3,
  Grid2X2,
  Armchair,
  MapPin,
  LockKeyhole,
  ReceiptText,
  Leaf,
  MessageSquareText,
  Landmark,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  type CommercialData,
  type CommercialAgreement,
  type CommercialProfile,
  type CommercialSmsPreferences,
  type CommercialAchInstructions,
  emptyCommercialSmsPreferences,
  SCHEDULING_SMS_CONSENT,
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
  payment_process: 'Payment method and terms (if not paying by ACH)',
  invoice_submission: 'Invoice submission / vendor portal instructions',
  purchase_order: 'Purchase order / vendor reference',
  access_instructions: 'Access and preparation instructions',
  service_windows: 'Preferred service windows',
  site_notes: 'Site details and floor care notes',
}
export function ProfileForm({
  profile,
  onSave,
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
                'payment_process',
                'invoice_submission',
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
                  disabled={readOnly}
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
        These details update your business profile, not a service summary that
        was already published. If the business name, service scope, or terms
        need changing, send Charles a note before approving or scheduling work.
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
export function PaymentOptions({
  readOnly = false,
  previewWorkflow = false,
  previewBusinessName = 'This customer',
}: {
  readOnly?: boolean
  previewWorkflow?: boolean
  previewBusinessName?: string
}) {
  const [instructions, setInstructions] =
    useState<CommercialAchInstructions | null>(null)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [requestStatus, setRequestStatus] = useState<
    'idle' | 'pending' | 'denied' | 'expired' | 'failed'
  >('idle')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [previewStatus, setPreviewStatus] = useState<
    'idle' | 'pending' | 'approved' | 'denied'
  >('idle')

  useEffect(() => {
    if (!requestId || requestStatus !== 'pending' || instructions) return
    let active = true
    const checkApproval = async () => {
      try {
        const response = await fetch(
          `/api/client/commercial/payment-instructions?request_id=${encodeURIComponent(requestId)}`,
          { cache: 'no-store' },
        )
        const result = await response.json()
        if (!active) return
        if (response.ok && result.instructions) {
          setInstructions(result.instructions)
          setRequestStatus('idle')
          setError('')
          return
        }
        if (response.status === 202) return
        if (result.status === 'denied') setRequestStatus('denied')
        else if (result.status === 'expired' || result.status === 'revealed')
          setRequestStatus('expired')
        else setRequestStatus('failed')
        setError(result.error || 'Unable to check ACH approval.')
      } catch {
        if (active) {
          setRequestStatus('failed')
          setError('Unable to check ACH approval. Please try again.')
        }
      }
    }
    void checkApproval()
    const timer = window.setInterval(checkApproval, 3000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [instructions, requestId, requestStatus])

  const fields: { label: string; value: string }[] = instructions
    ? [
        { label: 'Beneficiary', value: instructions.beneficiaryName },
        { label: 'Bank', value: instructions.bankName },
        { label: 'Routing number', value: instructions.routingNumber },
        { label: 'Account number', value: instructions.accountNumber },
        { label: 'Account type', value: instructions.accountType },
        { label: 'Remittance email', value: instructions.remittanceEmail },
      ]
    : []

  return (
    <section className={panelClass} aria-labelledby="payment-options-title">
      <h2
        id="payment-options-title"
        className="flex items-center gap-2 text-lg font-semibold"
      >
        <Landmark className="h-5 w-5 text-cyan-400" />
        Payment options
      </h2>
      <p className="mt-2 text-sm text-slate-300">
        ACH is preferred for commercial invoices. Your accounts-payable team can
        request the secure banking details here whenever needed. Charles reviews
        each request in Telegram before the details can be revealed. If your
        company must pay by check or another method, specify it in Payment
        method and terms above.
      </p>
      {readOnly && previewWorkflow ? (
        <div className="mt-4 space-y-3 rounded-xl border border-amber-300/25 bg-amber-300/10 p-4 text-sm">
          <div>
            <strong className="text-amber-100">Admin workflow preview</strong>
            <p className="mt-1 text-slate-300">
              This walkthrough is simulated. It does not send Telegram messages,
              create an access request, or reveal the real banking details.
            </p>
          </div>
          {previewStatus === 'idle' && (
            <Button type="button" onClick={() => setPreviewStatus('pending')}>
              Preview customer ACH request
            </Button>
          )}
          {previewStatus === 'pending' && (
            <div className="space-y-3">
              <div className="rounded-lg border border-cyan-400/25 bg-cyan-400/10 p-3 text-cyan-100">
                Request sent to Charles in Telegram. The customer keeps this
                page open while it checks for approval automatically.
              </div>
              <div className="rounded-lg border border-white/10 bg-slate-950/60 p-3">
                <p className="text-xs tracking-wide text-slate-400 uppercase">
                  Telegram approval card preview
                </p>
                <p className="mt-2 text-slate-100">
                  {previewBusinessName} requested ACH payment details.
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  The real card identifies the signed-in requester by name and
                  email and records the request time.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={() => setPreviewStatus('approved')}
                  >
                    Approve for 15 minutes
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setPreviewStatus('denied')}
                  >
                    Deny
                  </Button>
                </div>
              </div>
            </div>
          )}
          {previewStatus === 'approved' && (
            <div className="space-y-3">
              <div className="rounded-lg border border-emerald-400/25 bg-emerald-400/10 p-3 text-emerald-100">
                Approved. The signed-in customer receives one-time access for 15
                minutes and the approval is recorded.
              </div>
              <dl className="grid gap-3 rounded-lg border border-white/10 bg-slate-950/60 p-3 sm:grid-cols-2">
                {[
                  ['Beneficiary', 'Sasquatch Carpet Cleaning'],
                  ['Bank', 'Shown after real approval'],
                  ['Routing number', '•••••••••'],
                  ['Account number', '••••••••••'],
                  ['Account type', 'Business checking'],
                  ['Remittance email', 'Shown after real approval'],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs tracking-wide text-slate-500 uppercase">
                      {label}
                    </dt>
                    <dd className="mt-1 font-mono text-sm text-slate-100">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPreviewStatus('idle')}
              >
                Restart preview
              </Button>
            </div>
          )}
          {previewStatus === 'denied' && (
            <div className="space-y-3">
              <p className="rounded-lg border border-red-400/25 bg-red-400/10 p-3 text-red-100">
                Request denied. No banking details are revealed, and the
                customer can submit a new request if needed.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPreviewStatus('idle')}
              >
                Restart preview
              </Button>
            </div>
          )}
        </div>
      ) : readOnly ? (
        <p className="mt-4 rounded-xl border border-white/10 bg-slate-950/50 p-4 text-sm text-slate-400">
          ACH banking details are available only after the customer signs in and
          Charles approves that user’s request in Telegram.
        </p>
      ) : instructions ? (
        <>
          <dl className="mt-4 grid gap-3 rounded-xl border border-white/10 bg-slate-950/50 p-4 sm:grid-cols-2">
            {fields.map((field) => (
              <div key={field.label}>
                <dt className="text-xs tracking-wide text-slate-500 uppercase">
                  {field.label}
                </dt>
                <dd className="mt-1 font-mono text-sm break-all text-slate-100">
                  {field.value}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-amber-200">
            Before the first transfer, or if these instructions ever appear to
            change, verify them with Sasquatch Carpet Cleaning at (719)
            249-8791.
          </p>
        </>
      ) : requestStatus === 'pending' ? (
        <div
          role="status"
          className="mt-4 rounded-xl border border-cyan-400/25 bg-cyan-400/10 p-4 text-sm text-cyan-100"
        >
          Request sent to Charles in Telegram. Keep this page open—your approved
          one-time access will appear here automatically and will be valid for
          15 minutes.
        </div>
      ) : (
        <div>
          <Button
            type="button"
            className="mt-4"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError('')
              try {
                const result = await commercialFetch(
                  '/api/client/commercial/payment-instructions',
                  'POST',
                )
                setRequestId(result.request_id)
                setRequestStatus('pending')
              } catch (caught) {
                setRequestStatus('failed')
                setError(
                  caught instanceof Error
                    ? caught.message
                    : 'Unable to request ACH access.',
                )
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy
              ? 'Sending request…'
              : requestStatus === 'idle'
                ? 'Request ACH payment details'
                : 'Request ACH access again'}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-300">
          {error}
        </p>
      )}
    </section>
  )
}
export function SmsReminderForm({
  preferences,
  onSave,
  readOnly = false,
}: {
  preferences: CommercialSmsPreferences
  onSave: (preferences: {
    phone: string
    enabled: boolean
    consentAcknowledged: boolean
  }) => Promise<void>
  readOnly?: boolean
}) {
  const [phone, setPhone] = useState(preferences.phone)
  const [enabled, setEnabled] = useState(preferences.enabled)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  return (
    <form
      className={panelClass}
      onSubmit={async (event) => {
        event.preventDefault()
        setBusy(true)
        setMessage('')
        try {
          await onSave({
            phone,
            enabled,
            consentAcknowledged: enabled,
          })
          setMessage(
            enabled
              ? 'Scheduling text reminders are on.'
              : 'Scheduling text reminders are off.',
          )
        } catch (error) {
          setMessage(error instanceof Error ? error.message : 'Save failed')
        } finally {
          setBusy(false)
        }
      }}
    >
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <MessageSquareText className="h-5 w-5 text-cyan-400" />
        Scheduling text reminders
      </h2>
      <p className="mt-2 text-sm text-slate-300">
        Add the mobile number that should receive appointment confirmations,
        date or service changes, day-before reminders, and on-the-way updates.
        Messages can include the scheduled date and the services planned for
        that visit.
      </p>
      <div className="mt-4 max-w-xl">
        <Field label="Mobile number for scheduling texts">
          <Input
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            className={fieldClass}
            disabled={readOnly}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="(719) 555-0123"
            required={enabled}
          />
        </Field>
      </div>
      <label className="mt-4 flex items-start gap-3 rounded-xl border border-cyan-300/20 bg-cyan-400/5 p-4 text-sm text-slate-200">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 accent-cyan-400"
          disabled={readOnly}
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        <span>
          <strong className="block text-slate-100">
            Authorize scheduling text messages
          </strong>
          <span className="mt-1 block text-xs leading-5 text-slate-400">
            {SCHEDULING_SMS_CONSENT}
          </span>
        </span>
      </label>
      {!readOnly && (
        <Button className="mt-4" disabled={busy}>
          {busy ? 'Saving…' : 'Save text preferences'}
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
        separate approval; the prices below are not an annual commitment.
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
function AgreementFeedback({
  agreement,
  readOnly,
}: {
  agreement: CommercialAgreement
  readOnly: boolean
}) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [telegramSent, setTelegramSent] = useState(false)
  const [error, setError] = useState('')
  return (
    <section className={styles.feedback} aria-label="Send an agreement note">
      <h4>Have a question or want something changed?</h4>
      <p>
        Send Charles a note about services, frequency, pricing, or terms. He’ll
        receive it immediately and publish an updated version if anything needs
        to change.
      </p>
      <p>
        A note does not accept this agreement. Wait to sign until your questions
        are resolved and everything looks right.
      </p>
      {sent ? (
        <div role="status">
          <strong>Note sent for version {agreement.version}.</strong>
          <p>
            {telegramSent
              ? 'Charles was alerted in Telegram.'
              : 'Your note was saved, but the Telegram alert could not be confirmed. Please call or text Sasquatch if it is urgent.'}
          </p>
        </div>
      ) : open ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            if (!message.trim() || busy) return
            setBusy(true)
            setError('')
            try {
              const result = await commercialFetch(
                '/api/client/requests',
                'POST',
                {
                  request_type: 'scope_change',
                  agreement_id: agreement.id,
                  message: message.trim(),
                },
              )
              setTelegramSent(result.telegram_sent === true)
              setSent(true)
            } catch (err) {
              setError(
                err instanceof Error
                  ? err.message
                  : 'Unable to send your request. Please try again.',
              )
            } finally {
              setBusy(false)
            }
          }}
        >
          <Field label={`Note about version ${agreement.version}`}>
            <Textarea
              autoFocus
              required
              maxLength={2000}
              value={message}
              disabled={busy}
              onChange={(event) => setMessage(event.target.value)}
              className={fieldClass}
              placeholder="For example: Please change carpet cleaning to quarterly, or call me about the upholstery price."
            />
          </Field>
          {error && <p role="alert">{error}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button disabled={busy || !message.trim()}>
              {busy ? 'Sending note…' : 'Send note to Charles'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button type="button" disabled={readOnly} onClick={() => setOpen(true)}>
          Send a note or request changes
        </Button>
      )}
      {readOnly && (
        <p>
          Read-only staff preview. Customers can use this button in their
          account.
        </p>
      )}
    </section>
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
      <p className="text-sm text-slate-300">
        Everything looks right? Sign below. If you have a question or want
        changes, send Charles a note above instead.
      </p>
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
  previewAchWorkflow = false,
}: {
  initialData?: CommercialData
  readOnly?: boolean
  canSign?: boolean
  previewAchWorkflow?: boolean
}) {
  const [data, setData] = useState<
    (CommercialData & { canSign?: boolean }) | null
  >(initialData || null)
  const [error, setError] = useState('')
  const [profileOpen, setProfileOpen] = useState(
    !initialData?.profile.legal_name ||
      !initialData?.profile.billing_contact ||
      !initialData?.profile.access_instructions,
  )
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
  const agreements = data.agreements.filter((a) => a.status !== 'draft')
  const currentAgreement =
    agreements.find((a) => a.status === 'published') ||
    agreements.find((a) => a.status === 'signed')
  const address = data.addresses[0]
  const serviceCards = currentAgreement
    ? currentAgreement.content.lines.map((line) => ({
        id: line.id,
        name: line.name,
        description:
          line.method ||
          line.notes ||
          'Service details are included in your agreement.',
        label:
          line.phase === 'optional'
            ? 'Optional service'
            : line.phase === 'recurring'
              ? 'Maintenance'
              : 'Initial service',
        meta: `${formatMoney(lineAmount(line))} · ${line.quantity.toLocaleString('en-US')} ${commercialUnit(line.unit)}`,
        frequency: line.frequency,
        icon: /tile|grout|floor|scrub/i.test(line.name)
          ? Grid2X2
          : /chair|upholstery|furniture/i.test(line.name)
            ? Armchair
            : Layers3,
      }))
    : [
        {
          id: 'carpet',
          name: 'Carpet care',
          label: 'Clean. Restore. Maintain.',
          description:
            'Deep hot water extraction and low-moisture maintenance for the spaces that work hardest.',
          meta: 'Tailored to your space',
          frequency: '',
          icon: Layers3,
        },
        {
          id: 'tile',
          name: 'Tile & grout',
          label: 'A fresh foundation',
          description:
            'Detail-focused cleaning for hard surfaces, grout lines, and high-traffic areas.',
          meta: 'Scope confirmed before service',
          frequency: '',
          icon: Grid2X2,
        },
        {
          id: 'upholstery',
          name: 'Upholstery care',
          label: 'Every seat matters',
          description:
            'Care for the chairs and upholstered furnishings your guests and team use every day.',
          meta: 'Material-appropriate cleaning',
          frequency: '',
          icon: Armchair,
        },
      ]
  for (const extra of [
    {
      id: 'tile',
      name: 'Tile & grout',
      match: /tile|grout/i,
      icon: Grid2X2,
      description:
        'Cleaning for tile, grout lines, and high-traffic commercial areas.',
    },
    {
      id: 'upholstery',
      name: 'Upholstery care',
      match: /upholstery|upholstered|(?:chair|sofa|seat).*clean/i,
      icon: Armchair,
      description:
        'Cleaning for upholstered chairs, booths, sofas, and other furnishings.',
    },
  ]) {
    if (!serviceCards.some((service) => extra.match.test(service.name))) {
      serviceCards.push({
        id: extra.id,
        name: extra.name,
        description: extra.description,
        icon: extra.icon,
        label: 'Available separately',
        meta: 'Contact Sasquatch for a quote',
        frequency: '',
      })
    }
  }
  if (!serviceCards.some((service) => /auto[\s-]*scrub/i.test(service.name))) {
    serviceCards.push({
      id: 'auto-scrubbing',
      name: 'Hard-surface auto scrubbing',
      label: currentAgreement
        ? 'Available separately'
        : 'Machine-scrubbed floor care',
      description:
        'Machine scrubbing for hard-surface floors and high-traffic commercial areas. We’ll confirm the floor material, area, and cleaning needs before service.',
      meta: 'Contact Sasquatch for a quote',
      frequency: '',
      icon: Grid2X2,
    })
  }
  return (
    <div className={styles.portal}>
      <header className={styles.hero}>
        <Image
          src="/hero-layer-forest.png"
          alt=""
          fill
          sizes="(max-width: 760px) 100vw, 1200px"
          className={styles.mountains}
          priority
        />
        <div className={styles.brandRow}>
          <div className={styles.brand}>
            <Image
              src="/sasquatch-website-logo.png"
              width={2723}
              height={1155}
              sizes="(max-width: 760px) 210px, 260px"
              alt="Sasquatch Carpet Cleaning"
              priority
            />
          </div>
          <span className={styles.private}>
            <LockKeyhole size={12} /> Your private workspace
          </span>
        </div>
        <div>
          <div>
            <p className={`${styles.eyebrow} ${styles.kicker}`}>
              Your commercial service account
            </p>
            <h1 className={styles.title}>{data.businessName}</h1>
            <p className={styles.heroCopy}>
              See every confirmed appointment and the services planned for each
              visit. Return anytime to review your current scope and pricing,
              update vendor or payment details, and download account documents.
            </p>
            {address && (
              <p className={styles.address}>
                <MapPin size={13} />
                {address.street_1} · {address.city}, {address.state}
              </p>
            )}
          </div>
        </div>
      </header>
      <div className={styles.body}>
        {error && (
          <p role="alert" className="text-red-300">
            {error}
          </p>
        )}
        <details
          id="commercial-profile"
          className={styles.profile}
          open={profileOpen}
          onToggle={(event) => setProfileOpen(event.currentTarget.open)}
        >
          <summary>
            <Building2 size={24} strokeWidth={1.4} />
            <div>
              <strong>Business details & access instructions</strong>
              <small>
                Start here: confirm how invoices and payment should be handled,
                plus building access and service expectations. Leave anything
                that does not apply blank.
              </small>
            </div>
            <ChevronDown size={18} className={styles.chevron} />
          </summary>
          <ProfileForm
            profile={data.profile}
            readOnly={readOnly}
            onSave={async (p) => {
              await commercialFetch('/api/client/commercial', 'PATCH', p)
              await refresh()
              setProfileOpen(false)
              const document = window.document.getElementById(
                `commercial-agreement-${currentAgreement?.id}`,
              )
              if (document instanceof HTMLDetailsElement) document.open = true
              document?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
          />
        </details>
        <PaymentOptions
          readOnly={readOnly}
          previewWorkflow={previewAchWorkflow}
          previewBusinessName={data.businessName}
        />
        <SmsReminderForm
          preferences={data.smsPreferences || emptyCommercialSmsPreferences}
          readOnly={readOnly}
          onSave={async (preferences) => {
            await commercialFetch(
              '/api/client/commercial/sms-preferences',
              'PATCH',
              preferences,
            )
            await refresh()
          }}
        />
        {data.documents.length > 0 && (
          <section
            className={styles.documents}
            aria-labelledby="portal-documents-title"
          >
            <div>
              <p className={`${styles.eyebrow} ${styles.overline}`}>
                Vendor paperwork
              </p>
              <h2 id="portal-documents-title">Documents for your records.</h2>
              <p>
                These stay in your secure portal so your accounts-payable team
                can view or download them whenever needed.
              </p>
            </div>
            <div className={styles.documentList}>
              {data.documents.map((document) => (
                <article key={document.id} className={styles.documentCard}>
                  <FileText size={25} strokeWidth={1.5} />
                  <div>
                    <strong>{document.title}</strong>
                    <small>{document.description}</small>
                  </div>
                  <div className={styles.documentActions}>
                    <a
                      href={`/api/client/commercial/documents/${document.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink size={15} /> View
                    </a>
                    <a
                      href={`/api/client/commercial/documents/${document.id}?download=1`}
                    >
                      <Download size={15} /> Download
                    </a>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
        <section id="commercial-care">
          <div className={styles.intro}>
            <div>
              <p className={`${styles.eyebrow} ${styles.overline}`}>
                01 / The care of your space
              </p>
              <h2 className={styles.sectionTitle}>Commercial services.</h2>
              <p className={styles.sub}>
                {currentAgreement
                  ? 'Your agreement controls the services, frequency, and pricing currently approved for your business. Other capabilities are shown for reference.'
                  : 'Explore our commercial services. Your tailored scope and pricing will appear once your agreement is ready.'}
              </p>
              <p className={styles.instructions}>
                Call or text Sasquatch for additional work or schedule changes.
                We’ll send updated scope and pricing here for review and
                signature when needed.
              </p>
            </div>
          </div>
          <div
            className={`${styles.serviceGrid} ${serviceCards.length === 4 ? styles.fourServices : ''}`}
          >
            {serviceCards.map((service, i) => {
              const Icon = service.icon
              return (
                <article key={service.id} className={styles.service}>
                  <div className={styles.serviceArt} aria-hidden="true">
                    <span className={styles.serviceNumber}>
                      S / {String(i + 1).padStart(2, '0')}
                    </span>
                    <Icon />
                  </div>
                  <div className={styles.serviceBody}>
                    <span className={`${styles.eyebrow} ${styles.overline}`}>
                      {service.label}
                    </span>
                    <h3>{service.name}</h3>
                    <p>{service.description}</p>
                    <div className={styles.serviceMeta}>
                      <span>{service.meta}</span>
                      {service.frequency && <span>{service.frequency}</span>}
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        </section>
        <div className={styles.columns}>
          <section id="commercial-agreements">
            <div className={styles.intro}>
              <div>
                <p className={`${styles.eyebrow} ${styles.overline}`}>
                  02 / Clear from the start
                </p>
                <h2 className={styles.sectionTitle}>Service scope & terms.</h2>
                <p className={styles.sub}>
                  Review the services, areas, prices, payment terms, and site
                  expectations currently on file. Send Charles a note if
                  anything is missing or needs to change. This summary does not
                  commit you to future work or schedule a visit.
                </p>
              </div>
            </div>
            {agreements.length === 0 && (
              <div className={styles.agreementEmpty}>
                <FileCheck2
                  className={styles.agreementIcon}
                  size={49}
                  strokeWidth={1.4}
                />
                <div>
                  <span className={styles.tag}>Preparation in progress</span>
                  <h3>No service summary yet.</h3>
                  <p className={styles.sub}>
                    We’re preparing your service scope and terms. Once
                    published, you can review the full scope, send Charles a
                    note, and download a copy for your records.
                  </p>
                </div>
              </div>
            )}
            {agreements.map((a) => (
              <details
                key={a.id}
                id={`commercial-agreement-${a.id}`}
                className={styles.agreement}
              >
                <summary>
                  <FileCheck2
                    size={24}
                    strokeWidth={1.4}
                    className="shrink-0"
                  />
                  <div>
                    <strong>{a.content.title}</strong>
                    <small>
                      Version {a.version} ·{' '}
                      {a.status === 'published'
                        ? 'Review · Send a note · Sign only if requested'
                        : a.status === 'signed'
                          ? 'Signed agreement'
                          : 'Withdrawn · For your records'}
                    </small>
                  </div>
                  <ChevronDown size={17} className={styles.chevron} />
                </summary>
                <div className={styles.document}>
                  <AgreementView agreement={a} />
                  {a.status === 'signed' && (
                    <p
                      role="status"
                      className="mt-5 rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-4 text-sm text-emerald-200"
                    >
                      Your signature is recorded. Charles will confirm service
                      dates with you; scheduled visits will appear in
                      Appointments. Optional services still require separate
                      approval before being added to a recurring plan.
                    </p>
                  )}
                  {a.status === 'published' && (
                    <AgreementFeedback agreement={a} readOnly={readOnly} />
                  )}
                  {a.status === 'published' &&
                    !readOnly &&
                    ((data.canSign ?? canSign) ? (
                      <SignatureForm
                        agreement={a}
                        onSigned={() => void refresh()}
                      />
                    ) : (
                      <p className="mt-5 text-sm text-amber-300">
                        No portal signature is required to complete vendor
                        setup. Review the scope and send a note with any changes
                        or missing payment instructions.
                      </p>
                    ))}
                </div>
              </details>
            ))}
          </section>
          <aside className={styles.note}>
            <ReceiptText size={27} strokeWidth={1.25} />
            <h3>
              Multiple visits.
              <br />
              One monthly invoice.
            </h3>
            <p>
              Our standard commercial arrangement is monthly invoicing for
              completed work. Your service agreement confirms the billing terms
              for your business.
            </p>
            <div className={styles.noteBottom}>
              <Leaf size={15} /> Service details follow your agreement.
            </div>
          </aside>
        </div>
      </div>
      <footer className={styles.footer}>
        <strong>
          SASQUATCH <span className="font-normal">/ Commercial care</span>
        </strong>
        <span>Colorado roots. A higher standard of clean.</span>
      </footer>
    </div>
  )
}
