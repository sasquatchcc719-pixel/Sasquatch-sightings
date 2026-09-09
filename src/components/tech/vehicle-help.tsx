'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  Check,
  Copy,
  LocateFixed,
  MapPin,
  Phone,
  Share2,
  ShieldAlert,
  Truck,
  Wrench,
} from 'lucide-react'
import {
  BOX_TRUCK,
  DRIVER_INTRODUCTION,
  VEHICLE_CONTACTS,
  REPAIR_ADDRESS,
  REPAIR_APPLE_MAP,
  buildVehicleHelpMessage,
  formatCaptureTime,
  pickupMapUrl,
  type PickupLocation,
  type VehicleHelpKind,
  type VehicleKind,
} from '@/lib/tech/vehicle-help'

const panel = 'rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:p-5'
const field =
  'mt-2 w-full rounded-xl border border-white/15 bg-slate-950 p-3 text-base text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-400'
const button =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40'
const choices = [
  { value: 'roadside', label: 'Roadside help', icon: Wrench },
  { value: 'tow', label: 'Need a tow', icon: Truck },
  { value: 'repair', label: 'Repair shop', icon: MapPin },
] as const

function ContactCard({ kind }: { kind: VehicleHelpKind }) {
  const contact = VEHICLE_CONTACTS[kind]
  return (
    <div className="rounded-xl border border-emerald-300/20 bg-emerald-400/[0.06] p-4">
      <p className="text-xs font-semibold tracking-wider text-emerald-300 uppercase">
        {contact.person} ·{' '}
        {kind === 'tow'
          ? 'Towing'
          : kind === 'repair'
            ? 'Trusted mechanic'
            : 'Trusted roadside help'}
      </p>
      <h3 className="mt-2 text-xl font-bold">{contact.name}</h3>
      <a
        href={contact.href}
        className="mt-4 flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-400 px-3 py-3 text-base font-bold text-slate-950 hover:bg-emerald-300"
      >
        <Phone className="h-4 w-4" /> Call{' '}
        {contact.person === 'Dispatch' ? 'Randy’s' : contact.person} ·{' '}
        {contact.phone}
      </a>
      <p className="mt-3 text-sm text-slate-300">{contact.role}</p>
      <p className="mt-3 text-sm leading-relaxed text-slate-300">
        {contact.relationship}
      </p>
      {kind === 'repair' ? (
        <div className="mt-4">
          <p className="text-sm text-slate-300">{REPAIR_ADDRESS}</p>
          <a
            href={REPAIR_APPLE_MAP}
            target="_blank"
            rel="noopener noreferrer"
            className={`${button} mt-3 w-full border-emerald-300/30 text-emerald-200`}
          >
            <MapPin className="h-4 w-4 shrink-0" /> Navigate in Apple Maps
          </a>
        </div>
      ) : null}
    </div>
  )
}

export function VehicleHelp() {
  const [kind, setKind] = useState<VehicleHelpKind>('roadside')
  const [vehicle, setVehicle] = useState<VehicleKind>('box-truck')
  const [otherVehicle, setOtherVehicle] = useState('')
  const [issue, setIssue] = useState('')
  const [callback, setCallback] = useState('')
  const [landmarks, setLandmarks] = useState('')
  const [location, setLocation] = useState<PickupLocation | null>(null)
  const [manual, setManual] = useState(false)
  const [manualLocation, setManualLocation] = useState('')
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState('')
  const [shareStatus, setShareStatus] = useState('')
  const [now, setNow] = useState(0)
  const requestId = useRef(0)
  const preview = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!location) return
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [location])

  const activeLocation = manual ? null : location
  const stale = !!activeLocation && now - activeLocation.capturedAt > 5 * 60_000
  const canShare = manual
    ? !!manualLocation.trim()
    : !!activeLocation && !stale && !locating
  const message =
    kind === 'repair'
      ? ''
      : buildVehicleHelpMessage({
          kind,
          vehicle,
          otherVehicle,
          callback,
          issue,
          location: activeLocation,
          manualLocation: manual ? manualLocation : '',
          landmarks,
        })

  function getLocation() {
    const currentRequest = ++requestId.current
    setManual(false)
    setLocation(null)
    setLocationError('')
    setShareStatus('')
    if (!navigator.geolocation) {
      setLocationError(
        'GPS is unavailable in this browser. Enter your map pin or pickup location below.',
      )
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (requestId.current !== currentRequest) return
        setLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          capturedAt: position.timestamp,
        })
        setNow(Date.now())
        setLocating(false)
      },
      (error) => {
        if (requestId.current !== currentRequest) return
        setLocating(false)
        setLocationError(
          error.code === 1
            ? 'Location permission was denied. Allow location in your browser settings, or enter your map pin or pickup location below.'
            : 'Could not get a GPS fix. Try again, or enter your map pin or pickup location below.',
        )
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    )
  }

  function enterManually() {
    ++requestId.current
    setManual(true)
    setLocation(null)
    setLocating(false)
    setLocationError('')
    setShareStatus('')
  }

  function readyToShare() {
    // Phone timers may pause while Maps or the dialer is open.
    if (activeLocation && Date.now() - activeLocation.capturedAt > 5 * 60_000) {
      setNow(Date.now())
      setShareStatus('Refresh GPS before sharing this old location.')
      return false
    }
    return canShare
  }

  async function copyMessage() {
    if (!readyToShare()) return
    try {
      await navigator.clipboard.writeText(message)
      setShareStatus(
        'Message copied. Paste it into a text to the number dispatch confirmed.',
      )
    } catch {
      preview.current?.focus()
      preview.current?.select()
      setShareStatus(
        'Copy is unavailable. Select and copy the message below, or read it to dispatch by phone.',
      )
    }
  }

  async function shareMessage() {
    if (!readyToShare()) return
    if (!navigator.share) return copyMessage()
    try {
      await navigator.share({
        title: 'Sasquatch vehicle assistance',
        text: message,
      })
      setShareStatus(
        'Check your messaging app, then ask dispatch to confirm they received the location.',
      )
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'name' in error &&
        error.name === 'AbortError'
      ) {
        setShareStatus(
          'Sharing canceled. You can still copy the message or read the location by phone.',
        )
      } else {
        setShareStatus(
          'Sharing is unavailable. Use Copy message below, or read the location by phone.',
        )
      }
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-emerald-400/20 bg-gradient-to-br from-emerald-500/15 to-cyan-500/10 p-5">
        <h1 className="text-3xl font-bold tracking-tight">Vehicle help</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          Roadside help, towing, and repairs.
        </p>
        <p className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-sm leading-relaxed text-amber-100">
          <ShieldAlert className="mr-2 inline h-4 w-4" />
          Get safely out of traffic if possible and turn on your hazards. For
          injury, fire, or immediate danger,{' '}
          <a href="tel:911" className="font-bold underline">
            call 911
          </a>{' '}
          first. Use this page once safely stopped.
        </p>
      </section>

      <section className={panel} aria-labelledby="help-heading">
        <h2 id="help-heading" className="text-lg font-semibold">
          1. Choose the help you need
        </h2>
        <div
          className="mt-4 grid grid-cols-3 gap-2"
          aria-label="Type of vehicle help"
        >
          {choices.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              aria-pressed={kind === value}
              onClick={() => {
                setKind(value)
                setShareStatus('')
              }}
              className={`flex min-h-20 flex-col items-center justify-center gap-2 rounded-xl border px-2 py-3 text-center text-xs font-semibold sm:text-sm ${kind === value ? 'border-emerald-300/60 bg-emerald-300/15 text-emerald-100' : 'border-white/10 bg-slate-950/60 text-slate-300 hover:bg-white/10'}`}
            >
              <Icon className="h-5 w-5" />
              {label}
            </button>
          ))}
        </div>
        <label className="mt-4 block text-sm font-medium">
          Vehicle
          <select
            className={field}
            value={vehicle}
            onChange={(event) => setVehicle(event.target.value as VehicleKind)}
          >
            <option value="box-truck">
              2007 E-350 box truck · former Penske
            </option>
            <option value="other">Another company vehicle</option>
          </select>
        </label>
        {vehicle === 'other' ? (
          <label className="mt-3 block text-sm font-medium">
            Vehicle description
            <input
              value={otherVehicle}
              onChange={(event) => setOtherVehicle(event.target.value)}
              className={field}
              placeholder="Year, make, model, color"
              maxLength={180}
            />
          </label>
        ) : null}
        <div className="mt-4">
          <ContactCard kind={kind} />
        </div>
        <p className="mt-3 text-sm leading-relaxed text-slate-300">
          Introduce yourself: “{DRIVER_INTRODUCTION}”
        </p>
        {kind === 'roadside' ? (
          <p className="mt-3 text-sm leading-relaxed text-slate-300">
            Tell Jeff what happened and which truck you have. If it needs
            towing, switch to Need a tow.
          </p>
        ) : null}
        {kind === 'tow' ? (
          <div className="mt-4 space-y-4">
            <div className="rounded-xl border border-amber-300/25 bg-amber-300/5 p-4 text-sm leading-relaxed text-amber-100">
              <p className="font-bold">
                {vehicle === 'box-truck'
                  ? 'Confirm a truck large enough before dispatch.'
                  : 'Confirm suitable towing equipment before dispatch.'}
              </p>
              <p className="mt-2">
                {vehicle === 'box-truck'
                  ? `Tell Randy’s: “It’s Charles Sewell’s ${BOX_TRUCK}. You’ve towed it before.” Confirm they can handle its size and loaded weight. Height and weight are not saved here; check the vehicle labels/specifications if asked. Do not guess.`
                  : 'Describe the vehicle and ask dispatch to confirm the tow equipment they will send.'}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 p-4 text-sm leading-relaxed text-slate-300">
              <p className="font-semibold text-slate-100">
                Tow destination: Mountain Motorsport
              </p>
              <p className="mt-1">{REPAIR_ADDRESS}</p>
              <p className="mt-2">
                Confirm drop-off with Matt before dispatch. This is the
                destination; the GPS pin below is where Randy’s picks you up.
              </p>
              <button
                type="button"
                className={`${button} mt-3`}
                onClick={() => {
                  setKind('repair')
                  setShareStatus('')
                }}
              >
                Repair shop details & directions
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {kind === 'repair' ? (
        <section className={panel} aria-labelledby="repair-heading">
          <h2 id="repair-heading" className="text-lg font-semibold">
            2. Arrange repairs and drop-off
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">
            Call Matt and explain what happened to Charles’s truck. Mountain
            Motorsport handles repairs at the shop; bring or tow the truck
            there.
          </p>
          <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-relaxed text-slate-200">
            <li>
              Confirm Matt can receive the truck and tell him whether it will
              arrive by tow.
            </li>
            <li>
              Confirm the entrance, where to park, and how to leave the keys if
              the shop is closed.
            </li>
            <li>
              Use Navigate in Apple Maps above for driving directions to the
              shop. If the truck cannot be driven safely, arrange a tow with
              Randy’s.
            </li>
          </ol>
          <button
            type="button"
            className={`${button} mt-4`}
            onClick={() => {
              setKind('tow')
              setShareStatus('')
            }}
          >
            Arrange a tow with Randy’s
          </button>
          <p className="mt-4 text-sm leading-relaxed text-slate-300">
            Update Charles and the office with the repair plan and any jobs
            affected. Keep repair receipts in{' '}
            <Link
              href="/tech/receipts"
              className="text-emerald-200 underline underline-offset-4"
            >
              Receipts
            </Link>
            .
          </p>
        </section>
      ) : (
        <>
          <section className={panel} aria-labelledby="location-heading">
            <h2 id="location-heading" className="text-lg font-semibold">
              2. Pin down your pickup location
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              Give {kind === 'tow' ? 'Randy’s' : 'Jeff'} your exact pickup
              location. Capture your phone’s location while you are at the
              stopped truck. Check the map pin before sharing it. Location is
              requested only when you tap the button.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={getLocation}
                disabled={locating}
                className={`${button} border-emerald-300/30 text-emerald-200`}
              >
                <LocateFixed
                  className={`h-4 w-4 ${locating ? 'animate-pulse' : ''}`}
                />
                {locating
                  ? 'Getting GPS…'
                  : location
                    ? 'Refresh GPS location'
                    : 'Get my GPS location'}
              </button>
              <button type="button" onClick={enterManually} className={button}>
                Enter location manually
              </button>
            </div>
            {locationError ? (
              <p role="alert" className="mt-3 text-sm text-amber-200">
                {locationError}
              </p>
            ) : null}
            {activeLocation ? (
              <div className="mt-4 rounded-xl border border-cyan-300/20 bg-cyan-300/5 p-4">
                <p className="font-mono text-base text-cyan-100">
                  {activeLocation.latitude.toFixed(6)},{' '}
                  {activeLocation.longitude.toFixed(6)}
                </p>
                <p className="mt-2 text-xs text-slate-300">
                  Captured {formatCaptureTime(activeLocation.capturedAt)} ·
                  accuracy ±{Math.ceil(activeLocation.accuracy)} m
                </p>
                {stale ? (
                  <p role="alert" className="mt-2 text-sm text-amber-200">
                    This location is over 5 minutes old. Refresh GPS before
                    sharing.
                  </p>
                ) : null}
                {activeLocation.accuracy > 100 ? (
                  <p className="mt-2 text-sm text-amber-200">
                    GPS accuracy is low. Check the map carefully; add a precise
                    landmark or enter a corrected map pin manually.
                  </p>
                ) : null}
                <a
                  href={pickupMapUrl(activeLocation)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-cyan-200 underline underline-offset-4"
                >
                  Check pickup pin in Maps <ArrowUpRight className="h-4 w-4" />
                </a>
              </div>
            ) : null}
            {manual ? (
              <label className="mt-4 block text-sm font-medium">
                Map pin, GPS coordinates, or pickup address
                <textarea
                  rows={3}
                  className={field}
                  value={manualLocation}
                  onChange={(event) => setManualLocation(event.target.value)}
                  placeholder="Paste a dropped-pin link, coordinates, or an exact pickup location"
                  maxLength={1000}
                />
              </label>
            ) : null}
            <label className="mt-4 block text-sm font-medium">
              Road, direction of travel, and nearest exit or landmark
              <textarea
                rows={2}
                className={field}
                value={landmarks}
                onChange={(event) => setLandmarks(event.target.value)}
                placeholder="For example: I-25 northbound, right shoulder, just past exit …"
                maxLength={500}
              />
            </label>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium">
                What happened?
                <input
                  className={field}
                  value={issue}
                  onChange={(event) => setIssue(event.target.value)}
                  placeholder="Flat rear tire, engine won’t start…"
                  maxLength={500}
                />
              </label>
              <label className="block text-sm font-medium">
                Your callback number
                <input
                  type="tel"
                  autoComplete="tel"
                  className={field}
                  value={callback}
                  onChange={(event) => setCallback(event.target.value)}
                  placeholder="Number dispatch can reach you on"
                  maxLength={40}
                />
              </label>
            </div>
            <details className="mt-4 rounded-xl border border-white/10 p-3 text-sm text-slate-300">
              <summary className="cursor-pointer font-semibold text-slate-100">
                Need to send a map screenshot instead?
              </summary>
              <p className="mt-3 leading-relaxed">
                Open your phone’s Maps app and center it on your current
                location. Include the blue dot or dropped pin and nearby road
                names in a screenshot. Ask dispatch which mobile number can
                receive it, attach the screenshot in your texting app, and
                confirm they received it. If they cannot receive texts, read the
                coordinates, road, direction, and landmark aloud.
              </p>
            </details>
          </section>

          <section className={panel} aria-labelledby="share-heading">
            <h2 id="share-heading" className="text-lg font-semibold">
              3. Share, then confirm with {kind === 'tow' ? 'Randy’s' : 'Jeff'}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              <strong className="text-slate-100">
                Call first and ask which number accepts texts.
              </strong>{' '}
              {kind === 'tow'
                ? 'Randy’s office number may not receive them.'
                : 'Ask Jeff where to send your pickup location.'}{' '}
              Sharing opens your phone’s sharing options; you choose the
              recipient and send.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={shareMessage}
                disabled={!canShare}
                className={`${button} border-emerald-300/30 text-emerald-200`}
              >
                <Share2 className="h-4 w-4" />
                Share location message
              </button>
              <button
                type="button"
                onClick={copyMessage}
                disabled={!canShare}
                className={button}
              >
                <Copy className="h-4 w-4" />
                Copy message
              </button>
            </div>
            {!canShare ? (
              <p className="mt-3 text-sm text-amber-200">
                {stale
                  ? 'Refresh the old GPS fix above to enable sharing.'
                  : 'Get GPS or enter a pickup location above to enable sharing.'}
              </p>
            ) : null}
            <p
              role="status"
              aria-live="polite"
              className="mt-3 text-sm text-emerald-200"
            >
              {shareStatus}
            </p>
            <label className="mt-2 block text-sm font-medium">
              Message to share or read by phone
              <textarea
                ref={preview}
                readOnly
                rows={9}
                value={message}
                className={`${field} text-sm leading-relaxed`}
              />
            </label>
            <div className="mt-5 space-y-3 rounded-xl border border-amber-300/20 bg-amber-300/5 p-4">
              <h3 className="font-semibold text-amber-100">
                Before you hang up
              </h3>
              {[
                'Have dispatch repeat the exact pickup location, road direction, and side of the road back to you. Do not settle for a guessed location.',
                ...(kind === 'tow'
                  ? [
                      'Confirm the dispatched truck can handle this vehicle and that Mountain Motorsport has given drop-off instructions.',
                    ]
                  : []),
                'Confirm they received your map link or screenshot, or understood the coordinates you read aloud.',
                'Get an ETA and callback number. If help does not arrive, call back with the same exact location.',
              ].map((item) => (
                <p
                  key={item}
                  className="flex items-start gap-2 text-sm leading-relaxed text-slate-200"
                >
                  <Check className="mt-1 h-4 w-4 shrink-0 text-amber-200" />
                  {item}
                </p>
              ))}
            </div>
            <p className="mt-4 text-sm leading-relaxed text-slate-300">
              Once help is arranged, update Charles and the office with what
              happened, your location, the ETA, and any jobs affected. Keep
              repair and towing receipts in{' '}
              <Link
                href="/tech/receipts"
                className="text-emerald-200 underline underline-offset-4"
              >
                Receipts
              </Link>
              .
            </p>
          </section>
        </>
      )}

      <details className={`${panel} text-sm`}>
        <summary className="cursor-pointer font-semibold">
          All three contacts
        </summary>
        <div className="mt-4 space-y-4">
          {choices.map(({ value }) => (
            <div key={value}>
              <a
                className="font-semibold text-emerald-200 underline underline-offset-4"
                href={VEHICLE_CONTACTS[value].href}
              >
                {VEHICLE_CONTACTS[value].name} · {VEHICLE_CONTACTS[value].phone}
              </a>
              <p className="mt-1 text-slate-300">
                {VEHICLE_CONTACTS[value].role}
              </p>
              <a
                href={VEHICLE_CONTACTS[value].website}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block text-xs text-slate-400 underline"
              >
                Provider website
              </a>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-slate-400">
          Contacts supplied by Charles; phone numbers checked September 9, 2026.
          Call to confirm availability.
        </p>
      </details>
    </div>
  )
}
