'use client'

/**
 * Fiber check — the gate that runs before a rug or piece of upholstery is
 * cleaned. Tag photo if there is a tag; the three-bucket burn test if there is
 * not, which is most of them.
 */

import { useRef, useState } from 'react'
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Flame,
  Loader2,
  ShieldAlert,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { TechAppointment, TechFiberCheck } from '@/lib/tech/appointments'

const MAX_DIM = 1280

async function downscale(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.8)
}

type BurnBucket = 'melts' | 'burning_hair' | 'burns_like_paper'

const BURN_OPTIONS: Array<{
  value: BurnBucket
  label: string
  detail: string
}> = [
  {
    value: 'melts',
    label: 'Melted into a hard bead',
    detail: 'Synthetic — nylon, polyester, olefin',
  },
  {
    value: 'burning_hair',
    label: 'Smelled like burning hair',
    detail: 'Protein — wool, possibly silk',
  },
  {
    value: 'burns_like_paper',
    label: 'Burned like paper, soft ash',
    detail: 'Cellulose — viscose, cotton, jute',
  },
]

const VERDICT_STYLES: Record<
  string,
  { bg: string; border: string; text: string; label: string }
> = {
  go: {
    bg: 'bg-emerald-950/60',
    border: 'border-emerald-500/50',
    text: 'text-emerald-300',
    label: 'SAFE TO CLEAN',
  },
  low_moisture: {
    bg: 'bg-amber-950/60',
    border: 'border-amber-500/50',
    text: 'text-amber-300',
    label: 'LOW MOISTURE ONLY',
  },
  do_not_wet_clean: {
    bg: 'bg-red-950/70',
    border: 'border-red-500/60',
    text: 'text-red-300',
    label: 'DO NOT WET CLEAN',
  },
}

export function FiberCheckModal({
  isOpen,
  onClose,
  appointmentId,
  lineItemId,
  lineItemName,
  existingCheck,
  onAppointmentUpdate,
}: {
  isOpen: boolean
  onClose: () => void
  appointmentId: string
  lineItemId: string
  lineItemName: string
  existingCheck: TechFiberCheck | null
  onAppointmentUpdate: (appointment: TechAppointment) => void
}) {
  const [hasTag, setHasTag] = useState<boolean | null>(null)
  const [images, setImages] = useState<string[]>([])
  const [burnResult, setBurnResult] = useState<BurnBucket | null>(null)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<TechFiberCheck | null>(existingCheck)
  const [excluding, setExcluding] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  if (!isOpen) return null

  const addPhotos = async (files: FileList | null) => {
    if (!files) return
    try {
      const next = await Promise.all([...files].slice(0, 4).map(downscale))
      setImages((prev) => [...prev, ...next].slice(0, 4))
    } catch {
      setError('Could not read that photo')
    }
  }

  const submit = async () => {
    if (images.length === 0 && !burnResult) {
      setError('Add a photo or record a burn test result')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/tech/appointments/${appointmentId}/fiber-check`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lineItemId,
            itemLabel: lineItemName,
            hasTag: hasTag === true,
            images,
            burnResult,
            techNotes: notes || null,
          }),
        },
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Fiber check failed')
      setResult(data.check)
      if (data.appointment) onAppointmentUpdate(data.appointment)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fiber check failed')
    } finally {
      setBusy(false)
    }
  }

  const excludeItem = async () => {
    setExcluding(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/tech/appointments/${appointmentId}/exclude-line`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lineItemId,
            reason: `${result?.fiber ?? 'Fiber'} — cannot be safely wet cleaned`,
          }),
        },
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not remove the item')
      onAppointmentUpdate(data.appointment)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the item')
    } finally {
      setExcluding(false)
    }
  }

  const style = result ? VERDICT_STYLES[result.verdict] : null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-white/10 bg-slate-950 p-5 text-white sm:rounded-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Fiber check</h2>
            <p className="text-sm text-slate-400">{lineItemName}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-white/5"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {result && style ? (
          <div className="space-y-4">
            <div
              className={`rounded-xl border-2 ${style.border} ${style.bg} p-4`}
            >
              <div className={`flex items-center gap-2 ${style.text}`}>
                {result.verdict === 'go' ? (
                  <CheckCircle2 className="h-6 w-6" />
                ) : (
                  <ShieldAlert className="h-6 w-6" />
                )}
                <span className="text-lg font-bold tracking-wide">
                  {style.label}
                </span>
              </div>
              {result.fiber ? (
                <p className="mt-2 text-sm text-white">{result.fiber}</p>
              ) : null}
              {result.determinedBy === 'stop_list' ? (
                <p className="mt-1 text-xs uppercase tracking-wide text-slate-400">
                  Matched on the care tag — this verdict is not a judgment call
                </p>
              ) : null}
            </div>

            {result.warnings.length > 0 ? (
              <div className="space-y-2 rounded-xl border border-white/10 bg-slate-900/60 p-3">
                {result.warnings.map((warning, i) => (
                  <div key={i} className="flex gap-2 text-sm text-slate-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                    <span>{warning}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {result.recommendedMethod ? (
              <div className="rounded-xl border border-white/10 bg-slate-900/60 p-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Method
                </p>
                <p className="text-sm text-slate-200">
                  {result.recommendedMethod}
                </p>
              </div>
            ) : null}

            {result.verdict === 'do_not_wet_clean' ? (
              <Button
                onClick={() => void excludeItem()}
                disabled={excluding}
                className="w-full bg-red-600 hover:bg-red-700"
              >
                {excluding ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Remove this item from the invoice
              </Button>
            ) : null}

            <Button onClick={onClose} variant="outline" className="w-full">
              Done
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-sm font-medium text-slate-200">
                Does this item have a care tag?
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant={hasTag === true ? 'default' : 'outline'}
                  onClick={() => setHasTag(true)}
                >
                  Yes, there&apos;s a tag
                </Button>
                <Button
                  variant={hasTag === false ? 'default' : 'outline'}
                  onClick={() => setHasTag(false)}
                >
                  No tag
                </Button>
              </div>
            </div>

            {hasTag !== null ? (
              <div>
                <p className="mb-2 text-sm text-slate-300">
                  {hasTag
                    ? 'Photograph the tag so the fiber content is readable.'
                    : 'Photograph the pile up close, and the back if you can reach it.'}
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  hidden
                  onChange={(e) => void addPhotos(e.target.files)}
                />
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => fileRef.current?.click()}
                >
                  <Camera className="mr-2 h-4 w-4" />
                  {images.length === 0
                    ? 'Take photo'
                    : `${images.length} photo${images.length > 1 ? 's' : ''} — add another`}
                </Button>
              </div>
            ) : null}

            {hasTag === false ? (
              <div className="rounded-xl border border-white/10 bg-slate-900/60 p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-200">
                  <Flame className="h-4 w-4 text-amber-400" />
                  Burn test (optional but decisive)
                </div>
                <p className="mb-3 text-xs text-slate-400">
                  Snip a few fibers from the fringe end or the back edge — never
                  the face. Burn them over a hard surface. What happened?
                </p>
                <div className="space-y-2">
                  {BURN_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={() =>
                        setBurnResult(
                          burnResult === option.value ? null : option.value,
                        )
                      }
                      className={`w-full rounded-lg border p-2.5 text-left transition ${
                        burnResult === option.value
                          ? 'border-amber-400 bg-amber-950/40'
                          : 'border-white/10 bg-slate-950/60 hover:border-white/20'
                      }`}
                    >
                      <p className="text-sm font-medium text-white">
                        {option.label}
                      </p>
                      <p className="text-xs text-slate-400">{option.detail}</p>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {hasTag !== null ? (
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything you noticed — sheen, stiffness, backing (optional)"
                className="border-white/10 bg-slate-900 text-white"
                rows={2}
              />
            ) : null}

            {error ? (
              <p className="rounded-lg bg-red-950/60 p-2 text-sm text-red-300">
                {error}
              </p>
            ) : null}

            {hasTag !== null ? (
              <Button
                onClick={() => void submit()}
                disabled={busy || (images.length === 0 && !burnResult)}
                className="w-full"
              >
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Identify fiber
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
