'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Loader2, Send, Save, ExternalLink } from 'lucide-react'

export type AdminReceipt = {
  id: string
  public_url: string
  submitted_by_name: string | null
  amount: number | null
  note: string | null
  category: string
  status: string
  error_message: string | null
  created_at: string
}

function statusPill(status: string): { text: string; className: string } {
  switch (status) {
    case 'sent':
      return {
        text: 'Sent to QuickBooks',
        className: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
      }
    case 'failed':
      return {
        text: 'Send failed',
        className: 'bg-red-500/15 text-red-600 dark:text-red-300',
      }
    case 'no_destination':
      return {
        text: 'Saved — QB not set up',
        className: 'bg-amber-500/15 text-amber-600 dark:text-amber-300',
      }
    default:
      return {
        text: 'Pending',
        className: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
      }
  }
}

export function ReceiptsAdmin({
  initialEmail,
  fromEmail,
  receipts,
}: {
  initialEmail: string
  fromEmail: string
  receipts: AdminReceipt[]
}) {
  const [email, setEmail] = useState(initialEmail)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [notice, setNotice] = useState<{
    kind: 'success' | 'error'
    text: string
  } | null>(null)

  async function save() {
    setSaving(true)
    setNotice(null)
    try {
      const res = await fetch('/api/admin/ops/receipts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')
      setNotice({ kind: 'success', text: 'Saved.' })
    } catch (err) {
      setNotice({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Save failed',
      })
    } finally {
      setSaving(false)
    }
  }

  async function sendTest() {
    setTesting(true)
    setNotice(null)
    try {
      const res = await fetch('/api/admin/ops/receipts', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Test failed')
      setNotice({
        kind: 'success',
        text: `Test receipt emailed to ${data.to}. Check QuickBooks → Transactions → Receipts in a minute. If it does not appear, the sending address below is not yet authorized in QuickBooks.`,
      })
    } catch (err) {
      setNotice({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Test failed',
      })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="space-y-6">
      <section className="border-border/60 bg-card/80 space-y-4 rounded-2xl border p-5 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">QuickBooks receipt inbox</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            In QuickBooks go to{' '}
            <strong>Bookkeeping → Transactions → Receipts</strong>, set up a
            custom forwarding address (ends in <code>@qbodocs.com</code>), and
            paste it here. Receipts snapped in the tech portal get emailed there
            automatically.
          </p>
        </div>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">Forwarding address</span>
          <input
            type="email"
            placeholder="sasquatch-xxxx@qbodocs.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border-border bg-background w-full max-w-md rounded-lg border px-3 py-2 outline-none"
          />
        </label>

        <div className="border-border/60 rounded-lg border bg-amber-500/5 p-3 text-sm">
          <p className="font-medium text-amber-700 dark:text-amber-300">
            Important: authorize the sender in QuickBooks
          </p>
          <p className="text-muted-foreground mt-1">
            QuickBooks only accepts forwarded receipts from sender addresses you
            have authorized. Receipts are sent <em>from</em>:
          </p>
          <p className="mt-1 font-mono text-xs break-all">{fromEmail}</p>
          <p className="text-muted-foreground mt-1">
            Add that address under <strong>Manage forwarding email</strong> on
            the same Receipts screen, or QuickBooks will silently ignore the
            emails. Use the test button below to confirm it works end to end.
          </p>
        </div>

        {notice && (
          <p
            className={`rounded-lg px-3 py-2 text-sm ${
              notice.kind === 'success'
                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'bg-red-500/10 text-red-700 dark:text-red-300'
            }`}
          >
            {notice.text}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save
          </button>
          <button
            type="button"
            onClick={sendTest}
            disabled={testing || !email.trim()}
            className="border-border inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {testing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Send test receipt
          </button>
        </div>
      </section>

      <section className="border-border/60 bg-card/80 rounded-2xl border p-5 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">Submitted receipts</h2>
        {receipts.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No receipts submitted yet.
          </p>
        ) : (
          <ul className="divide-border/60 divide-y">
            {receipts.map((r) => {
              const pill = statusPill(r.status)
              return (
                <li key={r.id} className="flex items-center gap-4 py-3">
                  <a
                    href={r.public_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border"
                  >
                    <Image
                      src={r.public_url}
                      alt="Receipt"
                      fill
                      sizes="64px"
                      className="object-cover"
                    />
                  </a>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">
                        {r.amount != null ? `$${r.amount.toFixed(2)}` : '—'}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${pill.className}`}
                      >
                        {pill.text}
                      </span>
                    </div>
                    <p className="text-muted-foreground truncate text-sm">
                      {[
                        r.submitted_by_name,
                        r.category.charAt(0).toUpperCase() +
                          r.category.slice(1),
                        r.note,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    {r.error_message && (
                      <p className="truncate text-xs text-red-600 dark:text-red-400">
                        {r.error_message}
                      </p>
                    )}
                  </div>
                  <div className="text-muted-foreground shrink-0 text-right text-xs">
                    <div>
                      {new Date(r.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </div>
                    <a
                      href={r.public_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 hover:underline"
                    >
                      View <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
