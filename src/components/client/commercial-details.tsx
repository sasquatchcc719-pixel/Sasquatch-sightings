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
  CalendarDays,
  ChevronDown,
  Check,
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
  schedule,
  onViewSchedule,
  onRequestService,
}: {
  initialData?: CommercialData
  readOnly?: boolean
  canSign?: boolean
  schedule?: ClientPortalData
  onViewSchedule?: () => void
  onRequestService?: (service: string) => void
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
        icon: /tile|grout|floor/i.test(line.name)
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
            <Image src="/proudsquatch.png" width={35} height={43} alt="" />
            <div>
              <strong>SASQUATCH</strong>
              <p className={styles.eyebrow}>Commercial care · Colorado</p>
            </div>
          </div>
          <span className={styles.private}>
            <LockKeyhole size={12} /> Your private workspace
          </span>
        </div>
        <div className={styles.heroGrid}>
          <div>
            <p className={`${styles.eyebrow} ${styles.kicker}`}>
              A better place to do business
            </p>
            <h1 className={styles.title}>{data.businessName}</h1>
            <p className={styles.heroCopy}>
              Exceptional care for your space.
              <br />
              Every service, every detail, all in one place.
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
              <span className={styles.eyebrow}>Next on the calendar</span>
              <CalendarDays size={19} strokeWidth={1.4} />
            </div>
            <h2 className={styles.visitTitle}>
              {nextVisit
                ? commercialDate(nextVisit.appointment_date)
                : 'Your next clean starts here.'}
            </h2>
            <p className={styles.visitSub}>
              {nextVisit
                ? `${formatTime(nextVisit.start_time)} – ${formatTime(nextVisit.end_time)}`
                : 'No service visit is scheduled yet. We’ll confirm your scope and find the right time.'}
            </p>
            {nextVisit && (
              <p className={styles.visitSub}>
                {nextVisit.template_label ||
                  nextVisit.line_items.map((l) => l.name_snapshot).join(', ') ||
                  'Scheduled service'}
              </p>
            )}
            {onViewSchedule ? (
              <button className={styles.visitLink} onClick={onViewSchedule}>
                View schedule & requests <ArrowUpRight size={15} />
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
          <Layers3 size={14} /> Your care plan
        </a>
        <a href="#commercial-agreements">
          <FileCheck2 size={14} /> Agreements
        </a>
        <a href="#commercial-profile">
          <SlidersHorizontal size={14} /> Business details
        </a>
      </nav>
      <div className={styles.body}>
        {error && (
          <p role="alert" className="text-red-300">
            {error}
          </p>
        )}
        <div className={styles.steps} aria-label="Your service journey">
          {[
            [
              '01',
              'Your agreement',
              currentAgreement?.status === 'signed'
                ? 'Signed and on file'
                : currentAgreement
                  ? 'Ready for your review'
                  : 'Being prepared',
              currentAgreement?.status === 'signed',
            ],
            [
              '02',
              'Your schedule',
              nextVisit
                ? `${upcoming.length} upcoming visit${upcoming.length === 1 ? '' : 's'}`
                : 'Set around your business',
              !!nextVisit,
            ],
            ['03', 'Your space', 'Care that keeps you moving', false],
          ].map(([n, title, detail, complete]) => (
            <div key={String(n)} className={styles.step}>
              <span className={styles.stepNumber}>
                {complete ? <Check size={15} /> : n}
              </span>
              <div>
                <strong>{title}</strong>
                <span>{detail}</span>
              </div>
            </div>
          ))}
        </div>
        <section id="commercial-care">
          <div className={styles.intro}>
            <div>
              <p className={`${styles.eyebrow} ${styles.overline}`}>
                01 / The care of your space
              </p>
              <h2 className={styles.sectionTitle}>
                {currentAgreement
                  ? 'Your service collection.'
                  : 'Big care. Every square foot.'}
              </h2>
              <p className={styles.sub}>
                {currentAgreement
                  ? 'Your service scope and available options. Each service has its own price and frequency.'
                  : 'Explore our commercial services. Your tailored scope and pricing will appear once your agreement is ready.'}
              </p>
            </div>
          </div>
          <div className={styles.serviceGrid}>
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
                  {onRequestService && !readOnly ? (
                    <button
                      className={styles.serviceAction}
                      onClick={() => onRequestService(service.name)}
                    >
                      Request this service <ArrowUpRight size={15} />
                    </button>
                  ) : (
                    <a
                      className={styles.serviceAction}
                      href="#commercial-agreements"
                    >
                      {currentAgreement
                        ? 'View agreement details'
                        : 'About your agreement'}
                      <ArrowUpRight size={15} />
                    </a>
                  )}
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
                <h2 className={styles.sectionTitle}>
                  A handshake. In writing.
                </h2>
                <p className={styles.sub}>
                  Your scope, pricing, and service terms—always within reach.
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
                  <h3>A plan made for your business.</h3>
                  <p className={styles.sub}>
                    We’re preparing your service agreement. Once published, you
                    can review the full scope, download a copy, and sign
                    securely right here.
                  </p>
                </div>
              </div>
            )}
            {agreements.map((a) => (
              <details key={a.id} className={styles.agreement}>
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
                        ? 'Ready to review & sign'
                        : a.status === 'signed'
                          ? 'Signed agreement'
                          : 'Withdrawn · For your records'}
                    </small>
                  </div>
                  <ChevronDown size={17} className={styles.chevron} />
                </summary>
                <div className={styles.document}>
                  <AgreementView agreement={a} />
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
            <h2 className={styles.sectionTitle}>
              Room in your day. Care in ours.
            </h2>
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
              <strong>The details that make a visit seamless.</strong>
              <small>
                Billing contacts, access instructions, and preferences for your
                team.
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
