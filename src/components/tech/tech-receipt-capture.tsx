'use client'

import { useRef, useState } from 'react'
import Image from 'next/image'
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock,
  Loader2,
  Receipt,
} from 'lucide-react'

export type TechReceipt = {
  id: string
  public_url: string
  amount: number | null
  note: string | null
  category: string
  status: string
  error_message: string | null
  created_at: string
}

const CATEGORIES = [
  { value: 'gas', label: 'Gas' },
  { value: 'supplies', label: 'Supplies' },
  { value: 'other', label: 'Other' },
]

function StatusBadge({ status }: { status: string }) {
  if (status === 'sent') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-2 py-0.5 text-xs font-medium text-emerald-200">
        <CheckCircle2 className="h-3 w-3" /> Sent to QuickBooks
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-400/15 px-2 py-0.5 text-xs font-medium text-red-200">
        <AlertTriangle className="h-3 w-3" /> Send failed
      </span>
    )
  }
  if (status === 'no_destination') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-medium text-amber-200">
        <Clock className="h-3 w-3" /> Saved — QB not set up
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-400/15 px-2 py-0.5 text-xs font-medium text-slate-300">
      <Clock className="h-3 w-3" /> Pending
    </span>
  )
}

function formatWhen(value: string): string {
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function TechReceiptCapture({
  initialReceipts,
}: {
  initialReceipts: TechReceipt[]
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('gas')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{
    kind: 'success' | 'error'
    text: string
  } | null>(null)
  const [receipts, setReceipts] = useState<TechReceipt[]>(initialReceipts)

  function pickFile(selected: File | null) {
    setFile(selected)
    setMessage(null)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(selected ? URL.createObjectURL(selected) : null)
  }

  function reset() {
    pickFile(null)
    setAmount('')
    setCategory('gas')
    setNote('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function submit() {
    if (!file || submitting) return
    setSubmitting(true)
    setMessage(null)
    try {
      const formData = new FormData()
      formData.append('image', file)
      formData.append('category', category)
      if (amount.trim()) formData.append('amount', amount.trim())
      if (note.trim()) formData.append('note', note.trim())

      const response = await fetch('/api/tech/receipts', {
        method: 'POST',
        body: formData,
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Upload failed')

      setReceipts((prev) => [result.receipt as TechReceipt, ...prev])
      reset()
      if (result.forwarded) {
        setMessage({ kind: 'success', text: 'Receipt sent to QuickBooks.' })
      } else if (result.warning) {
        setMessage({
          kind: 'success',
          text: 'Receipt saved. QuickBooks inbox not set up yet — Charles will be able to forward it once configured.',
        })
      } else {
        setMessage({
          kind: 'error',
          text: `Receipt saved but forwarding failed: ${result.error ?? 'unknown error'}`,
        })
      }
    } catch (err) {
      setMessage({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Something went wrong',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-emerald-400/20 bg-gradient-to-br from-emerald-500/15 to-cyan-500/10 p-5 shadow-2xl shadow-emerald-950/30">
        <p className="flex items-center gap-2 text-sm font-medium text-emerald-200">
          <Receipt className="h-4 w-4" />
          Expense receipts
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          Add a Receipt
        </h1>
        <p className="mt-1 text-sm text-slate-300">
          Photograph a gas or supply receipt and it goes straight to QuickBooks.
        </p>
      </section>

      <section className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-5">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => pickFile(event.target.files?.[0] ?? null)}
        />

        {previewUrl ? (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="relative block w-full overflow-hidden rounded-xl border border-white/10"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="Receipt preview"
              className="max-h-72 w-full bg-slate-900 object-contain"
            />
            <span className="absolute right-2 bottom-2 rounded-lg bg-black/60 px-2 py-1 text-xs">
              Tap to retake
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-white/15 bg-white/5 py-12 text-slate-300"
          >
            <Camera className="h-8 w-8" />
            <span className="font-medium">Take a photo</span>
            <span className="text-xs text-slate-400">
              or choose from library
            </span>
          </button>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-slate-300">Amount</span>
            <div className="flex items-center rounded-xl border border-white/10 bg-white/5 px-3">
              <span className="text-slate-400">$</span>
              <input
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="w-full bg-transparent py-2.5 pl-1 outline-none"
              />
            </div>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-300">Category</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 outline-none"
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value} className="bg-slate-900">
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block text-sm">
          <span className="mb-1 block text-slate-300">Note (optional)</span>
          <input
            type="text"
            placeholder="e.g. Shell, Hwy 24"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 outline-none"
          />
        </label>

        {message && (
          <p
            className={`rounded-xl px-3 py-2 text-sm ${
              message.kind === 'success'
                ? 'bg-emerald-400/10 text-emerald-200'
                : 'bg-red-400/10 text-red-200'
            }`}
          >
            {message.text}
          </p>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={!file || submitting}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3 font-semibold text-emerald-950 transition disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Submitting…
            </>
          ) : (
            <>
              <Receipt className="h-4 w-4" /> Submit receipt
            </>
          )}
        </button>
      </section>

      <section className="space-y-3">
        <h2 className="px-1 text-sm font-semibold text-slate-300">
          Recent receipts
        </h2>
        {receipts.length === 0 ? (
          <p className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center text-sm text-slate-400">
            No receipts yet. Your submitted receipts will show up here.
          </p>
        ) : (
          <ul className="space-y-2">
            {receipts.map((receipt) => (
              <li
                key={receipt.id}
                className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3"
              >
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-white/10">
                  <Image
                    src={receipt.public_url}
                    alt="Receipt"
                    fill
                    sizes="56px"
                    className="object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">
                      {receipt.amount != null
                        ? `$${receipt.amount.toFixed(2)}`
                        : '—'}
                    </span>
                    <span className="text-xs text-slate-400">
                      {formatWhen(receipt.created_at)}
                    </span>
                  </div>
                  <p className="truncate text-xs text-slate-400">
                    {[
                      receipt.category.charAt(0).toUpperCase() +
                        receipt.category.slice(1),
                      receipt.note,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  <div className="mt-1">
                    <StatusBadge status={receipt.status} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
