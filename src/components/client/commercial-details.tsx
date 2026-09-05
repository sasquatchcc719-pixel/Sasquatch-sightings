'use client'
import { useEffect, useState } from 'react'
import Image from 'next/image'
import styles from './commercial-experience.module.css'
import {
  Building2,
  FileCheck2,
  Download,
  Printer,
  ShieldCheck,
  ArrowUpRight,
  ChevronDown,
  Layers3,
  Grid2X2,
  Armchair,
  MapPin,
  LockKeyhole,
  ReceiptText,
  Leaf,
  SlidersHorizontal,
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
import {
  formatMoney,
  formatTime,
  type ClientPortalData,
} from '@/lib/ops/client-portal'

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
  schedule,
  onViewSchedule,
}: {
  initialData?: CommercialData
  readOnly?: boolean
  canSign?: boolean
  schedule?: ClientPortalData
  onViewSchedule?: () => void
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
  const agreements = data.agreements.filter((a) => a.status !== 'draft')
  const currentAgreement =
    agreements.find((a) => a.status === 'published') ||
    agreements.find((a) => a.status === 'signed')
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Denver',
  }).format(new Date())
  const upcoming = (schedule?.appointments || [])
    .filter(
      (a) =>
        a.appointment_date >= today &&
        !['completed', 'cancelled'].includes(a.status),
    )
    .sort((a, b) =>
      `${a.appointment_date} ${a.start_time}`.localeCompare(
        `${b.appointment_date} ${b.start_time}`,
      ),
    )
  const nextVisit = upcoming[0]
  const needsReview = currentAgreement?.status === 'published'
  const needsContact =
    !data.profile.billing_contact.trim() || !data.profile.billing_email.trim()
  const nextStep = needsReview
    ? {
        title: 'Your agreement is ready.',
        description:
          'Open your agreement to review the services, prices, and terms. Send Charles a note if needed, or sign at the bottom when everything looks right.',
        label:
          (data.canSign ?? canSign) && !readOnly
            ? 'Review & sign agreement'
            : 'Review your agreement',
        target: `commercial-agreement-${currentAgreement.id}`,
      }
    : needsContact
      ? {
          title: 'Start with your business details.',
          description:
            'Add your billing contact and email, then tell us how to access your building. Save your details when you’re finished.',
          label: readOnly ? 'View business details' : 'Add business details',
          target: 'commercial-profile',
        }
      : !currentAgreement
        ? {
            title: 'We’re preparing your agreement.',
            description:
              'Your billing contact is on file. There’s nothing to sign yet. We’ll publish your scope and pricing here when it is ready.',
            label: 'View agreement status',
            target: 'commercial-agreements',
          }
        : {
            title: nextVisit
              ? 'Your next visit is scheduled.'
              : 'Your agreement is on file.',
            description: nextVisit
              ? 'Check your upcoming visits below. Call or text Sasquatch if the schedule needs to change.'
              : 'There are no upcoming visits yet. Call or text Sasquatch when you are ready to schedule.',
            label: nextVisit ? 'View appointments' : 'View agreement',
            target: nextVisit
              ? 'commercial-visits'
              : `commercial-agreement-${currentAgreement.id}`,
          }
  const goToSection = (id: string) => {
    if (id === 'commercial-visits' && onViewSchedule) {
      onViewSchedule()
      return
    }
    const section = document.getElementById(id)
    if (!section) return
    if (section instanceof HTMLDetailsElement) section.open = true
    const focusTarget = section.querySelector<HTMLElement>('summary, h2')
    if (focusTarget) {
      if (focusTarget.tagName !== 'SUMMARY') focusTarget.tabIndex = -1
      focusTarget.focus({ preventScroll: true })
    }
    section.scrollIntoView({ block: 'start', behavior: 'instant' })
  }
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
        <div className={styles.heroGrid}>
          <div>
            <p className={`${styles.eyebrow} ${styles.kicker}`}>
              Your commercial service account
            </p>
            <h1 className={styles.title}>{data.businessName}</h1>
            <p className={styles.heroCopy}>
              Review and sign your agreement, update business details, and check
              confirmed appointments—all right here.
            </p>
            {address && (
              <p className={styles.address}>
                <MapPin size={13} />
                {address.street_1} · {address.city}, {address.state}
              </p>
            )}
          </div>
          <div className={styles.visitCard}>
            <div className={styles.visitTop}>
              <span className={styles.eyebrow}>
                Start here · Your next step
              </span>
              <ArrowUpRight size={19} strokeWidth={1.4} />
            </div>
            <h2 className={styles.visitTitle}>{nextStep.title}</h2>
            <p className={styles.visitSub}>{nextStep.description}</p>
            <button
              type="button"
              className={styles.nextAction}
              onClick={() => goToSection(nextStep.target)}
            >
              {nextStep.label} <ArrowUpRight size={17} />
            </button>
            {readOnly && (
              <p className={styles.previewHint}>
                Staff preview: you can explore, but only the customer can save
                details, send agreement notes, or sign here.
              </p>
            )}
            {nextVisit && (
              <p className={styles.visitSub}>
                Next visit: {commercialDate(nextVisit.appointment_date)}
                <br />
                <span>
                  {formatTime(nextVisit.start_time)} –{' '}
                  {formatTime(nextVisit.end_time)}
                </span>
              </p>
            )}
            {onViewSchedule ? (
              <button className={styles.visitLink} onClick={onViewSchedule}>
                View schedule <ArrowUpRight size={15} />
              </button>
            ) : (
              <a className={styles.visitLink} href="#commercial-visits">
                View service schedule <ArrowUpRight size={15} />
              </a>
            )}
          </div>
        </div>
      </header>
      <nav className={styles.nav} aria-label="Account overview">
        <a href="#commercial-care">
          <Layers3 size={14} /> Services
        </a>
        <a href="#commercial-agreements">
          <FileCheck2 size={14} /> Agreements
        </a>
        <a
          href="#commercial-profile"
          onClick={(event) => {
            event.preventDefault()
            goToSection('commercial-profile')
          }}
        >
          <SlidersHorizontal size={14} /> Business details
        </a>
      </nav>
      <div className={styles.body}>
        {error && (
          <p role="alert" className="text-red-300">
            {error}
          </p>
        )}
        <div className={styles.steps} aria-label="How to use your account">
          {[
            [
              '01',
              'Review your agreement',
              currentAgreement?.status === 'signed'
                ? 'Signed · View your saved terms'
                : needsReview
                  ? 'Ready · Review, send a note, or sign'
                  : 'Being prepared · Nothing to sign yet',
              currentAgreement
                ? `commercial-agreement-${currentAgreement.id}`
                : 'commercial-agreements',
            ],
            [
              '02',
              'Review your services',
              'See the scope and pricing currently on file',
              'commercial-agreements',
            ],
            [
              '03',
              'Check your appointments',
              'See your confirmed service dates',
              'commercial-visits',
            ],
          ].map(([n, title, detail, target]) => (
            <button
              type="button"
              key={n}
              className={styles.step}
              onClick={() => goToSection(target)}
            >
              <span className={styles.stepNumber}>{n}</span>
              <div>
                <strong>{title}</strong>
                <span>{detail}</span>
              </div>
            </button>
          ))}
        </div>
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
                  <a
                    className={styles.serviceAction}
                    href="#commercial-agreements"
                  >
                    {currentAgreement
                      ? 'View agreement details'
                      : 'About your agreement'}
                    <ArrowUpRight size={15} />
                  </a>
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
                <h2 className={styles.sectionTitle}>Your service agreement.</h2>
                <p className={styles.sub}>
                  Open your agreement and review the services, prices, and
                  terms. Have a question or want something changed? Send Charles
                  a note inside the agreement. Only sign when everything looks
                  right.
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
                  <h3>No agreement to sign yet.</h3>
                  <p className={styles.sub}>
                    We’re preparing your service agreement. Once published, you
                    can review the full scope, send Charles a note, download a
                    copy, and sign when everything looks right.
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
                        ? 'Review · Send a note · Sign'
                        : a.status === 'signed'
                          ? 'Signed agreement'
                          : 'Withdrawn · For your records'}
                    </small>
                  </div>
                  <ChevronDown size={17} className={styles.chevron} />
                </summary>
                <div className={styles.document}>
                  <AgreementView agreement={a} />
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
                        An authorized signer for your business can accept this
                        agreement. Contact Sasquatch to update signing access.
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
        {!onViewSchedule && (
          <section id="commercial-visits" className={styles.schedule}>
            <p className={`${styles.eyebrow} ${styles.overline}`}>
              03 / On the calendar
            </p>
            <h2 className={styles.sectionTitle}>Your upcoming appointments.</h2>
            {upcoming.length ? (
              upcoming.map((a) => (
                <div key={a.id} className={styles.visitRow}>
                  <div className={styles.dateBlock}>
                    <span>{commercialDate(a.appointment_date, 'month')}</span>
                    <strong>{a.appointment_date.slice(8)}</strong>
                  </div>
                  <div>
                    <h3>
                      {a.template_label ||
                        a.line_items.map((l) => l.name_snapshot).join(', ') ||
                        'Service visit'}
                    </h3>
                    <p>
                      {commercialDate(a.appointment_date)} ·{' '}
                      {formatTime(a.start_time)} ·{' '}
                      {a.status.replaceAll('_', ' ')}
                    </p>
                    {a.client_note && <p>{a.client_note}</p>}
                  </div>
                </div>
              ))
            ) : (
              <p className={styles.sub}>
                No upcoming service visits. Your confirmed appointments will
                appear here.
              </p>
            )}
          </section>
        )}
        <details id="commercial-profile" className={styles.profile}>
          <summary>
            <Building2 size={24} strokeWidth={1.4} />
            <div>
              <strong>Business details & access instructions</strong>
              <small>
                Click to open. Add your billing contact, building access, and
                preferred service times, then save.
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
            }}
          />
        </details>
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

function commercialDate(date: string, part?: 'month') {
  return new Intl.DateTimeFormat(
    'en-US',
    part
      ? { month: 'short', timeZone: 'UTC' }
      : { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' },
  ).format(new Date(`${date}T12:00:00Z`))
}
