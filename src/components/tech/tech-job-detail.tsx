'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import {
  CheckCircle2,
  DollarSign,
  ImagePlus,
  Loader2,
  MapPin,
  Navigation,
  Phone,
  ShieldAlert,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { TechAppointment } from '@/lib/tech/appointments'
import { SignatureModal } from '@/components/admin/ops/signature-modal'
import { formatSquareAmount } from '@/lib/payments/square'

function formatTime(value: string | null): string {
  if (!value) return 'Time TBD'
  const [hour, minute] = value.split(':')
  const date = new Date()
  date.setHours(Number(hour), Number(minute), 0, 0)
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function addressLine(appointment: TechAppointment): string {
  if (!appointment.address) return ''
  return [
    appointment.address.street1,
    appointment.address.street2,
    appointment.address.city,
    appointment.address.state,
    appointment.address.zipCode,
  ]
    .filter(Boolean)
    .join(', ')
}

function SquareLogoMark({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex items-center justify-center rounded-sm border-2 border-current ${className}`}
    >
      <span className="h-1.5 w-1.5 rounded-[1px] border border-current" />
    </span>
  )
}

export function TechJobDetail({
  initialAppointment,
}: {
  initialAppointment: TechAppointment
}) {
  const [appointment, setAppointment] = useState(initialAppointment)
  const [notes, setNotes] = useState(initialAppointment.internalNotes ?? '')
  const [loadingStatus, setLoadingStatus] = useState<string | null>(null)
  const [savingNotes, setSavingNotes] = useState(false)
  const [savingInvoice, setSavingInvoice] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [recordingPayment, setRecordingPayment] = useState<string | null>(null)
  const [sendingSquareLink, setSendingSquareLink] = useState(false)
  const [squareLinkFeedback, setSquareLinkFeedback] = useState<string | null>(
    null,
  )
  const [showSignatureModal, setShowSignatureModal] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const fullAddress = addressLine(appointment)
  const mapsHref = fullAddress
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`
    : null
  const payableTotal = appointment.hidePricing
    ? null
    : appointment.invoice?.total ?? appointment.quotedTotal
  const squareAmount = formatSquareAmount(payableTotal)

  async function updateJob(body: Record<string, unknown>) {
    setError(null)
    const response = await fetch(`/api/tech/appointments/${appointment.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const result = await response.json()
    if (!response.ok) {
      throw new Error(result.error || 'Update failed')
    }
    setAppointment(result.appointment)
    return result.appointment as TechAppointment
  }

  async function updateStatus(status: string) {
    setLoadingStatus(status)
    try {
      await updateJob({ status })
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setLoadingStatus(null)
    }
  }

  async function saveNotes() {
    setSavingNotes(true)
    try {
      await updateJob({ internal_notes: notes })
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save notes')
    } finally {
      setSavingNotes(false)
    }
  }

  async function saveInvoice() {
    setSavingInvoice(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/tech/appointments/${appointment.id}/invoice`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            line_items: appointment.lineItems.map((line) => ({
              id: line.id,
              name: line.name,
              quantity: line.quantity,
              unitPrice: line.unitPrice ?? 0,
              notes: line.notes,
            })),
          }),
        },
      )
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Could not save invoice')
      }
      setAppointment(result.appointment)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save invoice')
    } finally {
      setSavingInvoice(false)
    }
  }

  async function uploadPhoto(file: File) {
    setUploadingPhoto(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('image', file)
      formData.append('label', 'general')
      formData.append('watermark', 'true')
      const response = await fetch(
        `/api/tech/appointments/${appointment.id}/photos`,
        {
          method: 'POST',
          body: formData,
        },
      )
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Photo upload failed')
      }
      const refreshed = await fetch(`/api/tech/appointments/${appointment.id}`)
      const refreshedResult = await refreshed.json()
      if (refreshed.ok) setAppointment(refreshedResult.appointment)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Photo upload failed')
    } finally {
      setUploadingPhoto(false)
    }
  }

  async function deletePhoto(photoId: string) {
    setError(null)
    try {
      const response = await fetch(
        `/api/tech/appointments/${appointment.id}/photos?photoId=${photoId}`,
        { method: 'DELETE' },
      )
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(result.error || 'Photo delete failed')
      }
      setAppointment((current) => ({
        ...current,
        photos: current.photos.filter((photo) => photo.id !== photoId),
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Photo delete failed')
    }
  }

  async function saveSignature(signatureData: string, customerName: string) {
    const response = await fetch(
      `/api/tech/appointments/${appointment.id}/signature`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signatureData, customerName }),
      },
    )
    const result = await response.json()
    if (!response.ok) {
      throw new Error(result.error || 'Failed to save signature')
    }
    setAppointment((current) => ({
      ...current,
      invoice: current.invoice
        ? {
            ...current.invoice,
            signatureUrl: result.signatureUrl,
            signatureCapturedAt: new Date().toISOString(),
            signatureCustomerName: customerName,
          }
        : current.invoice,
    }))
  }

  async function recordPayment(method: string) {
    setRecordingPayment(method)
    setError(null)
    try {
      const response = await fetch(
        `/api/tech/appointments/${appointment.id}/payment`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method }),
        },
      )
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Could not record payment')
      }
      setAppointment(result.appointment)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record payment')
    } finally {
      setRecordingPayment(null)
    }
  }

  async function sendSquarePaymentLink() {
    setSendingSquareLink(true)
    setSquareLinkFeedback(null)
    setError(null)
    try {
      const response = await fetch(
        `/api/tech/appointments/${appointment.id}/square-link`,
        { method: 'POST' },
      )
      const result = (await response.json()) as {
        error?: string
        sms?: { sid?: string; to?: string }
      }
      if (!response.ok) {
        throw new Error(result.error || 'Could not send Square payment link')
      }
      setSquareLinkFeedback(
        `Square payment link sent to ${result.sms?.to || 'customer'}${result.sms?.sid ? ` (${result.sms.sid})` : ''}.`,
      )
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not send Square payment link',
      )
    } finally {
      setSendingSquareLink(false)
    }
  }

  return (
    <div className="space-y-5">
      {error ? (
        <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <section className="rounded-3xl border border-white/10 bg-white/[0.06] p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-emerald-300">
              {formatTime(appointment.startTime)}
              {appointment.endTime
                ? ` - ${formatTime(appointment.endTime)}`
                : ''}
            </p>
            <h1 className="mt-2 text-3xl font-bold">
              {appointment.businessName || appointment.customerName}
            </h1>
            {appointment.businessName ? (
              <p className="mt-1 text-slate-400">{appointment.customerName}</p>
            ) : null}
          </div>
          <span className="rounded-full bg-slate-800 px-3 py-1 text-sm text-slate-300 capitalize">
            {appointment.status.replaceAll('_', ' ')}
          </span>
        </div>

        <div className="mt-5 space-y-3 text-sm">
          <p className="flex items-start gap-2 text-slate-300">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
            {fullAddress || 'No address'}
          </p>
          {appointment.customerPhone ? (
            <a
              href={`tel:${appointment.customerPhone}`}
              className="flex items-center gap-2 text-emerald-300"
            >
              <Phone className="h-4 w-4" />
              {appointment.customerPhone}
            </a>
          ) : null}
          {appointment.address?.gateCode ? (
            <p className="rounded-xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-amber-100">
              Gate/access code: {appointment.address.gateCode}
            </p>
          ) : null}
          {appointment.address?.notes ? (
            <p className="rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-slate-300">
              Address notes: {appointment.address.notes}
            </p>
          ) : null}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2">
          {mapsHref ? (
            <Button
              asChild
              className="bg-emerald-500 text-slate-950 hover:bg-emerald-400"
            >
              <a href={mapsHref} target="_blank" rel="noopener noreferrer">
                <Navigation className="h-4 w-4" />
                Directions
              </a>
            </Button>
          ) : null}
          {appointment.customerPhone ? (
            <Button
              asChild
              variant="outline"
              className="border-white/20 bg-white/5 text-white"
            >
              <a href={`sms:${appointment.customerPhone}`}>Text Customer</a>
            </Button>
          ) : null}
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
        <h2 className="mb-3 font-semibold">Job Actions</h2>
        <div className="grid grid-cols-2 gap-2">
          {[
            ['on_my_way', 'On My Way'],
            ['in_progress', 'Start Job'],
            ['completed', 'Complete'],
          ].map(([status, label]) => (
            <Button
              key={status}
              variant={status === 'completed' ? 'default' : 'outline'}
              className={
                status === 'completed'
                  ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                  : 'border-white/20 bg-white/5 text-white'
              }
              disabled={loadingStatus !== null}
              onClick={() => void updateStatus(status)}
            >
              {loadingStatus === status ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : status === 'completed' ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : null}
              {label}
            </Button>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Invoice</h2>
          {appointment.hidePricing ? (
            <span className="flex items-center gap-1.5 rounded-full bg-amber-300/10 px-2.5 py-1 text-xs text-amber-200">
              <ShieldAlert className="h-3.5 w-3.5" />
              Price hidden
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-lg font-bold text-emerald-300">
              <DollarSign className="h-5 w-5" />
              {Number(payableTotal ?? 0).toFixed(2)}
            </span>
          )}
        </div>

        <div className="space-y-2">
          {appointment.lineItems.map((line, index) => (
            <div
              key={line.id}
              className="rounded-xl border border-white/10 bg-slate-950/50 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  {appointment.hidePricing ? (
                    <>
                      <p className="font-medium">{line.name}</p>
                      <p className="text-sm text-slate-400">
                        Qty {line.quantity}
                      </p>
                    </>
                  ) : (
                    <div className="space-y-2">
                      <Input
                        value={line.name}
                        onChange={(event) =>
                          setAppointment((current) => ({
                            ...current,
                            lineItems: current.lineItems.map(
                              (item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, name: event.target.value }
                                  : item,
                            ),
                          }))
                        }
                        className="border-white/10 bg-slate-900 text-white"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <Input
                          type="number"
                          min="1"
                          value={line.quantity}
                          onChange={(event) =>
                            setAppointment((current) => ({
                              ...current,
                              lineItems: current.lineItems.map(
                                (item, itemIndex) => {
                                  if (itemIndex !== index) return item
                                  const quantity = Number(
                                    event.target.value || 1,
                                  )
                                  return {
                                    ...item,
                                    quantity,
                                    lineTotal:
                                      item.unitPrice == null
                                        ? null
                                        : Number(
                                            (quantity * item.unitPrice).toFixed(
                                              2,
                                            ),
                                          ),
                                  }
                                },
                              ),
                            }))
                          }
                          className="border-white/10 bg-slate-900 text-white"
                        />
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.unitPrice ?? 0}
                          onChange={(event) =>
                            setAppointment((current) => ({
                              ...current,
                              lineItems: current.lineItems.map(
                                (item, itemIndex) => {
                                  if (itemIndex !== index) return item
                                  const unitPrice = Number(
                                    event.target.value || 0,
                                  )
                                  return {
                                    ...item,
                                    unitPrice,
                                    lineTotal: Number(
                                      (unitPrice * item.quantity).toFixed(2),
                                    ),
                                  }
                                },
                              ),
                            }))
                          }
                          className="border-white/10 bg-slate-900 text-white"
                        />
                      </div>
                    </div>
                  )}
                </div>
                {appointment.hidePricing ? null : (
                  <p className="font-mono text-sm text-slate-200">
                    ${Number(line.lineTotal ?? 0).toFixed(2)}
                  </p>
                )}
              </div>
              {line.notes ? (
                <p className="mt-2 text-sm text-slate-400">{line.notes}</p>
              ) : null}
            </div>
          ))}
        </div>

        {appointment.hidePricing ? (
          <p className="mt-3 text-sm text-amber-100">
            Recovery Village pricing and payment collection stay out of the tech
            view.
          </p>
        ) : (
          <div className="mt-4 space-y-2">
            <Button
              className="w-full"
              disabled={savingInvoice}
              onClick={() => void saveInvoice()}
            >
              {savingInvoice ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Save Invoice Changes
            </Button>
            {squareAmount ? (
              <Button
                className="w-full bg-black text-white hover:bg-neutral-800"
                disabled={sendingSquareLink || recordingPayment !== null}
                onClick={() => void sendSquarePaymentLink()}
              >
                {sendingSquareLink ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <SquareLogoMark className="h-4 w-4" />
                )}
                {sendingSquareLink
                  ? 'Sending Square Link...'
                  : `Text Square Pay Link · ${squareAmount}`}
              </Button>
            ) : null}
            {squareAmount ? (
              <p className="text-center text-xs text-slate-400">
                Customer pays online by card, then mark this invoice paid below.
              </p>
            ) : null}
            {squareLinkFeedback ? (
              <p className="text-center text-xs text-emerald-300">
                {squareLinkFeedback}
              </p>
            ) : null}
            <Button
              variant="outline"
              className="w-full border-neutral-400/40 bg-black/40 text-white"
              disabled={recordingPayment !== null}
              onClick={() => void recordPayment('square')}
            >
              {recordingPayment === 'square' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Mark Square Paid
            </Button>
            <Button
              variant="outline"
              className="w-full border-white/20 bg-white/5 text-white"
              disabled={recordingPayment !== null}
              onClick={() => void recordPayment('venmo')}
            >
              {recordingPayment === 'venmo' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Mark Venmo Paid
            </Button>
            {!appointment.invoice?.signatureUrl ? (
              <Button
                variant="outline"
                className="w-full border-white/20 bg-white/5 text-white"
                onClick={() => setShowSignatureModal(true)}
              >
                Get Customer Signature
              </Button>
            ) : (
              <p className="text-center text-sm text-emerald-300">
                Signed by {appointment.invoice.signatureCustomerName}
              </p>
            )}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Photos</h2>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-emerald-500 px-3 py-2 text-sm font-medium text-slate-950">
            {uploadingPhoto ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ImagePlus className="h-4 w-4" />
            )}
            Add
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              disabled={uploadingPhoto}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void uploadPhoto(file)
                event.currentTarget.value = ''
              }}
            />
          </label>
        </div>

        {appointment.photos.length === 0 ? (
          <p className="text-sm text-slate-400">No job photos yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {appointment.photos.map((photo) => (
              <div
                key={photo.id}
                className="relative overflow-hidden rounded-xl"
              >
                <Image
                  src={photo.publicUrl}
                  alt="Job photo"
                  width={400}
                  height={400}
                  className="aspect-square w-full object-cover"
                />
                <button
                  type="button"
                  className="absolute top-2 right-2 rounded-full bg-slate-950/80 p-2 text-white"
                  onClick={() => void deletePhoto(photo.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
        <h2 className="mb-3 font-semibold">Internal Notes</h2>
        <Textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          className="min-h-28 border-white/10 bg-slate-950/70 text-white"
          placeholder="Add job notes..."
        />
        <Button
          className="mt-3 w-full"
          disabled={savingNotes}
          onClick={() => void saveNotes()}
        >
          {savingNotes ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save Notes
        </Button>
      </section>

      {!appointment.hidePricing && appointment.invoice ? (
        <SignatureModal
          isOpen={showSignatureModal}
          onClose={() => setShowSignatureModal(false)}
          onSave={saveSignature}
          totalAmount={Number(payableTotal ?? 0)}
          customerName={appointment.customerName}
        />
      ) : null}
    </div>
  )
}
