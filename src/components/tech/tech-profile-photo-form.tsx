'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import {
  CalendarDays,
  Camera,
  Clock3,
  Coffee,
  KeyRound,
  Loader2,
  User,
} from 'lucide-react'

type PayPeriodEntry = {
  id: string
  workDate: string
  startedAt: string
  endedAt: string
  breakMinutes: number
  payableMinutes: number
  workType: string
  status: string
}

type ActiveShiftSummary = {
  id: string
  startedAt: string
  breakStartedAt: string | null
  breakMinutes: number
}

type PayPeriodSummary = {
  startDate: string
  endDate: string
  label: string
  entries: PayPeriodEntry[]
  activeShift: ActiveShiftSummary | null
}

type TechProfilePhotoFormProps = {
  displayName: string
  role: string
  initialImageUrl: string | null
  payPeriod: PayPeriodSummary
}

function formatDate(value: string): string {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatHours(minutes: number): string {
  const safeMinutes = Math.max(0, Math.round(minutes))
  const hours = safeMinutes / 60
  return `${hours.toFixed(2)} hr`
}

function activeShiftMinutes(
  activeShift: ActiveShiftSummary | null,
  nowMs: number,
): { grossMinutes: number; breakMinutes: number; payableMinutes: number } {
  if (!activeShift) {
    return { grossMinutes: 0, breakMinutes: 0, payableMinutes: 0 }
  }

  const startMs = new Date(activeShift.startedAt).getTime()
  const breakStartMs = activeShift.breakStartedAt
    ? new Date(activeShift.breakStartedAt).getTime()
    : null
  const grossMinutes = Number.isFinite(startMs)
    ? Math.max(0, Math.round((nowMs - startMs) / 60000))
    : 0
  const activeBreakMinutes =
    breakStartMs != null && Number.isFinite(breakStartMs)
      ? Math.max(0, Math.round((nowMs - breakStartMs) / 60000))
      : 0
  const breakMinutes =
    Math.max(0, activeShift.breakMinutes) + activeBreakMinutes
  return {
    grossMinutes,
    breakMinutes,
    payableMinutes: Math.max(0, grossMinutes - breakMinutes),
  }
}

export function TechProfilePhotoForm({
  displayName,
  role,
  initialImageUrl,
  payPeriod,
}: TechProfilePhotoFormProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [imageUrl, setImageUrl] = useState(initialImageUrl)
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const loggedMinutes = payPeriod.entries.reduce(
    (sum, entry) => sum + entry.payableMinutes,
    0,
  )
  const loggedBreakMinutes = payPeriod.entries.reduce(
    (sum, entry) => sum + entry.breakMinutes,
    0,
  )
  const activeMinutes = activeShiftMinutes(payPeriod.activeShift, nowMs)
  const totalMinutes = loggedMinutes + activeMinutes.payableMinutes

  useEffect(() => {
    if (!payPeriod.activeShift) return
    const interval = setInterval(() => setNowMs(Date.now()), 60_000)
    return () => clearInterval(interval)
  }, [payPeriod.activeShift])

  async function uploadPhoto(file: File) {
    setIsUploading(true)
    setError(null)
    setSuccess(null)

    try {
      const form = new FormData()
      form.append('file', file)

      const response = await fetch('/api/tech/profile/photo', {
        method: 'POST',
        body: form,
      })
      const result = (await response.json()) as {
        url?: string
        error?: string
      }

      if (!response.ok) {
        throw new Error(result.error || 'Photo upload failed')
      }

      setImageUrl(result.url ? `${result.url}?t=${Date.now()}` : null)
      setSuccess('Profile photo updated.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Photo upload failed')
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-emerald-400/20 bg-gradient-to-br from-emerald-500/15 to-cyan-500/10 p-5 shadow-2xl shadow-emerald-950/30">
        <p className="text-sm font-medium text-emerald-200">
          Technician Profile
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          {displayName}
        </h1>
        <p className="mt-1 text-sm text-slate-300 capitalize">{role}</p>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.06] p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-400/15">
            <Clock3 className="h-5 w-5 text-emerald-300" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">Current Pay Period</h2>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-slate-400">
              <CalendarDays className="h-3.5 w-3.5" />
              {formatDate(payPeriod.startDate)} -{' '}
              {formatDate(payPeriod.endDate)}
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
            <p className="text-xs font-semibold tracking-widest text-emerald-200 uppercase">
              Total Hours
            </p>
            <p className="mt-2 text-3xl font-bold text-white">
              {formatHours(totalMinutes)}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {payPeriod.activeShift
                ? 'Includes active shift estimate'
                : 'Logged payable time'}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
            <p className="text-xs font-semibold tracking-widest text-slate-400 uppercase">
              Break Time
            </p>
            <p className="mt-2 text-3xl font-bold text-white">
              {Math.round(loggedBreakMinutes + activeMinutes.breakMinutes)}m
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Subtracted from payable hours
            </p>
          </div>
        </div>

        {payPeriod.activeShift ? (
          <div className="mt-3 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-amber-100">
                  Currently clocked in
                </p>
                <p className="mt-1 text-xs text-amber-100/70">
                  Started at {formatTime(payPeriod.activeShift.startedAt)}
                </p>
              </div>
              <p className="font-mono text-sm font-semibold text-amber-100">
                +{formatHours(activeMinutes.payableMinutes)}
              </p>
            </div>
            {payPeriod.activeShift.breakStartedAt ? (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-amber-100/80">
                <Coffee className="h-3.5 w-3.5" />
                Break is active
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 space-y-2">
          {payPeriod.entries.length > 0 ? (
            payPeriod.entries.slice(0, 6).map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-100">
                    {formatDate(entry.workDate)}
                  </p>
                  <p className="text-xs text-slate-500 capitalize">
                    {entry.workType} · {entry.status}
                  </p>
                </div>
                <p className="font-mono text-sm font-semibold text-slate-100">
                  {formatHours(entry.payableMinutes)}
                </p>
              </div>
            ))
          ) : (
            <p className="rounded-xl border border-white/10 bg-slate-950/40 px-3 py-3 text-sm text-slate-400">
              No completed time entries in this pay period yet.
            </p>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.06] p-5">
        <div className="flex items-center gap-4">
          <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-full border border-white/15 bg-slate-900">
            {imageUrl ? (
              <Image
                key={imageUrl}
                src={imageUrl}
                alt={displayName}
                fill
                className="object-cover"
                unoptimized
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <User className="h-10 w-10 text-slate-500" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">Profile Photo</h2>
            <p className="mt-1 text-sm text-slate-400">
              This photo can be used in customer messages and technician-facing
              tools.
            </p>
          </div>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void uploadPhoto(file)
            event.currentTarget.value = ''
          }}
        />

        <button
          type="button"
          disabled={isUploading}
          onClick={() => inputRef.current?.click()}
          className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isUploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Camera className="h-4 w-4" />
          )}
          {imageUrl ? 'Replace photo' : 'Upload photo'}
        </button>

        {success ? (
          <p className="mt-3 text-sm text-emerald-300">{success}</p>
        ) : null}
        {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.06] p-5">
        <h2 className="font-semibold">Account</h2>
        <p className="mt-1 text-sm text-slate-400">
          Update your password any time from here.
        </p>
        <Link
          href="/auth/update-password"
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-semibold text-slate-100 transition hover:border-emerald-400/40 hover:bg-emerald-400/10"
        >
          <KeyRound className="h-4 w-4" />
          Change password
        </Link>
      </section>
    </div>
  )
}
