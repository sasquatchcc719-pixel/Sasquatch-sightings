'use client'

import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Ban, Plus, Trash2, Loader2, ChevronUp } from 'lucide-react'

interface BlacklistEntry {
  id: string
  phone: string
  name: string | null
  reason: string | null
  created_at: string
}

function formatPhone(phone: string): string {
  return phone.replace(/^(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3')
}

function formatDate(ts: string): string {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function BlacklistPage() {
  const [entries, setEntries] = useState<BlacklistEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [form, setForm] = useState({ phone: '', name: '', reason: '' })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setPageError(null)
    try {
      const res = await fetch('/api/admin/blacklist')
      const data = (await res.json()) as {
        entries?: BlacklistEntry[]
        error?: string
      }
      if (!res.ok) throw new Error(data.error ?? 'Failed to load')
      setEntries(data.entries ?? [])
    } catch (e) {
      setPageError(e instanceof Error ? e.message : 'Failed to load blacklist')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    try {
      const res = await fetch('/api/admin/blacklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: form.phone,
          name: form.name.trim() || null,
          reason: form.reason.trim() || null,
        }),
      })
      const data = (await res.json()) as {
        entry?: BlacklistEntry
        error?: string
      }
      if (!res.ok) throw new Error(data.error ?? 'Failed to add')
      if (data.entry) setEntries((prev) => [data.entry!, ...prev])
      setForm({ phone: '', name: '', reason: '' })
      setShowForm(false)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to add entry')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/admin/blacklist/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const d = (await res.json()) as { error?: string }
        throw new Error(d.error ?? 'Failed to delete')
      }
      setEntries((prev) => prev.filter((x) => x.id !== id))
      setConfirmDelete(null)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/20">
            <Ban className="h-5 w-5 text-red-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Blacklist</h1>
            <p className="text-muted-foreground text-sm">
              {entries.length} blocked{' '}
              {entries.length === 1 ? 'number' : 'numbers'} · calls, texts, and
              web booking
            </p>
          </div>
        </div>
        <Button
          onClick={() => setShowForm((v) => !v)}
          className="gap-2 bg-red-700 hover:bg-red-800"
        >
          {showForm ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          {showForm ? 'Cancel' : 'Block Number'}
        </Button>
      </div>

      {/* Add form */}
      {showForm && (
        <Card className="border-red-500/30 p-5">
          <h2 className="mb-4 font-semibold">Block a Number</h2>
          <form onSubmit={handleAdd} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="bl-phone">Phone Number *</Label>
              <Input
                id="bl-phone"
                value={form.phone}
                onChange={(e) =>
                  setForm((f) => ({ ...f, phone: e.target.value }))
                }
                placeholder="(719) 555-1234"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bl-name">Name (optional)</Label>
              <Input
                id="bl-name"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="John Doe"
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="bl-reason">Reason (optional)</Label>
              <Input
                id="bl-reason"
                value={form.reason}
                onChange={(e) =>
                  setForm((f) => ({ ...f, reason: e.target.value }))
                }
                placeholder="Why are they blocked?"
              />
            </div>

            {formError && (
              <p className="text-destructive text-sm sm:col-span-2">
                {formError}
              </p>
            )}

            <div className="flex gap-2 sm:col-span-2">
              <Button
                type="submit"
                disabled={saving}
                className="bg-red-700 hover:bg-red-800"
              >
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Block Number
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowForm(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
        </div>
      )}

      {pageError && (
        <Card className="border-destructive/40 p-4">
          <p className="text-destructive text-sm">{pageError}</p>
        </Card>
      )}

      {/* Empty state */}
      {!loading && !pageError && entries.length === 0 && (
        <Card className="p-8 text-center">
          <Ban className="text-muted-foreground mx-auto mb-3 h-8 w-8" />
          <p className="text-muted-foreground text-sm">
            No blocked numbers. Add one above.
          </p>
        </Card>
      )}

      {/* Table */}
      {!loading && entries.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border/60 bg-muted/30 border-b">
                  <th className="px-4 py-3 text-left font-medium">Phone</th>
                  <th className="px-4 py-3 text-left font-medium">Name</th>
                  <th className="px-4 py-3 text-left font-medium">Reason</th>
                  <th className="px-4 py-3 text-left font-medium">
                    Blocked On
                  </th>
                  <th className="px-4 py-3 text-left font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-border/40 divide-y">
                {entries.map((entry) => (
                  <tr
                    key={entry.id}
                    className="transition-colors hover:bg-white/5"
                  >
                    <td className="px-4 py-3 font-mono font-medium text-red-400">
                      {formatPhone(entry.phone)}
                    </td>
                    <td className="text-muted-foreground px-4 py-3">
                      {entry.name ?? '—'}
                    </td>
                    <td className="text-muted-foreground max-w-[240px] truncate px-4 py-3">
                      {entry.reason ?? '—'}
                    </td>
                    <td className="text-muted-foreground px-4 py-3">
                      {formatDate(entry.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      {confirmDelete === entry.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleDelete(entry.id)}
                            disabled={deletingId === entry.id}
                            className="text-destructive text-xs font-semibold hover:underline disabled:opacity-40"
                          >
                            {deletingId === entry.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              'Remove?'
                            )}
                          </button>
                          <button
                            onClick={() => setConfirmDelete(null)}
                            className="text-muted-foreground text-xs hover:underline"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDelete(entry.id)}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                          title="Remove from blacklist"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
