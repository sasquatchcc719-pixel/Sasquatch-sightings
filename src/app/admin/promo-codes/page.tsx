'use client'

import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Tag,
  Plus,
  Trash2,
  Loader2,
  ToggleLeft,
  ToggleRight,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'

interface PromoCode {
  id: string
  code: string
  discount_type: 'flat' | 'percent'
  discount_amount: number
  description: string | null
  active: boolean
  expires_at: string | null
  max_uses: number | null
  use_count: number
  created_at: string
}

function formatDiscount(type: 'flat' | 'percent', amount: number) {
  return type === 'flat' ? `$${amount.toFixed(2)} off` : `${amount}% off`
}

function formatExpiry(expiresAt: string | null) {
  if (!expiresAt) return 'Never'
  const d = new Date(expiresAt)
  const now = new Date()
  if (d < now)
    return { label: `Expired ${d.toLocaleDateString()}`, expired: true }
  return { label: d.toLocaleDateString(), expired: false }
}

export default function PromoCodesPage() {
  const [codes, setCodes] = useState<PromoCode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const [form, setForm] = useState({
    code: '',
    discount_type: 'flat' as 'flat' | 'percent',
    discount_amount: '',
    description: '',
    expires_at: '',
    max_uses: '',
  })

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/promo-codes')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      setCodes(data.promo_codes)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load promo codes')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function handleToggle(code: PromoCode) {
    setTogglingId(code.id)
    try {
      const res = await fetch(`/api/admin/promo-codes/${code.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !code.active }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Failed to update')
      }
      setCodes((prev) =>
        prev.map((c) => (c.id === code.id ? { ...c, active: !c.active } : c)),
      )
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to update code')
    } finally {
      setTogglingId(null)
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/admin/promo-codes/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Failed to delete')
      }
      setCodes((prev) => prev.filter((c) => c.id !== id))
      setConfirmDelete(null)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete code')
    } finally {
      setDeletingId(null)
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const body = {
        code: form.code,
        discount_type: form.discount_type,
        discount_amount: Number(form.discount_amount),
        description: form.description || null,
        expires_at: form.expires_at || null,
        max_uses: form.max_uses ? Number(form.max_uses) : null,
      }
      const res = await fetch('/api/admin/promo-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create')
      setCodes((prev) => [data.promo_code, ...prev])
      setForm({
        code: '',
        discount_type: 'flat',
        discount_amount: '',
        description: '',
        expires_at: '',
        max_uses: '',
      })
      setShowForm(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create code')
    } finally {
      setSaving(false)
    }
  }

  const active = codes.filter((c) => c.active)
  const inactive = codes.filter((c) => !c.active)

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20">
            <Tag className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Promo Codes</h1>
            <p className="text-muted-foreground text-sm">
              {active.length} active · {codes.length} total
            </p>
          </div>
        </div>
        <Button
          onClick={() => setShowForm((v) => !v)}
          className="gap-2 bg-emerald-600 hover:bg-emerald-700"
        >
          {showForm ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          {showForm ? 'Cancel' : 'New Code'}
        </Button>
      </div>

      {/* Create Form */}
      {showForm && (
        <Card className="border-emerald-500/30 p-5">
          <h2 className="mb-4 font-semibold">Create New Promo Code</h2>
          <form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="code">Code *</Label>
              <Input
                id="code"
                value={form.code}
                onChange={(e) =>
                  setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))
                }
                placeholder="SCC20"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="discount_type">Discount Type *</Label>
              <select
                id="discount_type"
                value={form.discount_type}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    discount_type: e.target.value as 'flat' | 'percent',
                  }))
                }
                className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                <option value="flat">Flat $ amount</option>
                <option value="percent">Percent %</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="discount_amount">
                Amount * {form.discount_type === 'flat' ? '($)' : '(%)'}
              </Label>
              <Input
                id="discount_amount"
                type="number"
                min="0.01"
                max={form.discount_type === 'percent' ? '100' : undefined}
                step="0.01"
                value={form.discount_amount}
                onChange={(e) =>
                  setForm((f) => ({ ...f, discount_amount: e.target.value }))
                }
                placeholder={form.discount_type === 'flat' ? '20.00' : '10'}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="expires_at">Expiry Date (optional)</Label>
              <Input
                id="expires_at"
                type="date"
                value={form.expires_at}
                onChange={(e) =>
                  setForm((f) => ({ ...f, expires_at: e.target.value }))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="max_uses">
                Max Uses (optional — leave blank for unlimited)
              </Label>
              <Input
                id="max_uses"
                type="number"
                min="1"
                step="1"
                value={form.max_uses}
                onChange={(e) =>
                  setForm((f) => ({ ...f, max_uses: e.target.value }))
                }
                placeholder="Unlimited"
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="description">
                Description (shown to AI agents)
              </Label>
              <Input
                id="description"
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="$20 off — NFC business card holders"
              />
            </div>

            {error && (
              <p className="text-destructive text-sm sm:col-span-2">{error}</p>
            )}

            <div className="flex gap-2 sm:col-span-2">
              <Button
                type="submit"
                disabled={saving}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Code
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

      {/* Code Table */}
      {!loading && codes.length === 0 && (
        <Card className="p-8 text-center">
          <Tag className="text-muted-foreground mx-auto mb-3 h-8 w-8" />
          <p className="text-muted-foreground text-sm">
            No promo codes yet. Create one above.
          </p>
        </Card>
      )}

      {!loading && codes.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border/60 bg-muted/30 border-b">
                  <th className="px-4 py-3 text-left font-medium">Code</th>
                  <th className="px-4 py-3 text-left font-medium">Discount</th>
                  <th className="px-4 py-3 text-left font-medium">
                    Description
                  </th>
                  <th className="px-4 py-3 text-left font-medium">Expires</th>
                  <th className="px-4 py-3 text-left font-medium">Uses</th>
                  <th className="px-4 py-3 text-left font-medium">Active</th>
                  <th className="px-4 py-3 text-left font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-border/40 divide-y">
                {codes.map((c) => {
                  const expiry = c.expires_at
                    ? formatExpiry(c.expires_at)
                    : null
                  const expired =
                    expiry && typeof expiry === 'object' && expiry.expired
                  const expiryLabel = expiry
                    ? typeof expiry === 'object'
                      ? expiry.label
                      : expiry
                    : 'Never'

                  return (
                    <tr
                      key={c.id}
                      className={`transition-colors hover:bg-white/5 ${!c.active ? 'opacity-50' : ''}`}
                    >
                      {/* Code */}
                      <td className="px-4 py-3">
                        <span className="bg-muted rounded px-2 py-0.5 font-mono font-semibold tracking-wide">
                          {c.code}
                        </span>
                      </td>

                      {/* Discount */}
                      <td className="px-4 py-3">
                        <Badge
                          variant="secondary"
                          className="font-semibold text-emerald-400"
                        >
                          {formatDiscount(c.discount_type, c.discount_amount)}
                        </Badge>
                      </td>

                      {/* Description */}
                      <td className="text-muted-foreground max-w-[200px] truncate px-4 py-3">
                        {c.description || '—'}
                      </td>

                      {/* Expires */}
                      <td className="px-4 py-3">
                        <span
                          className={
                            expired
                              ? 'text-destructive font-medium'
                              : 'text-muted-foreground'
                          }
                        >
                          {expiryLabel}
                        </span>
                      </td>

                      {/* Uses */}
                      <td className="px-4 py-3">
                        <span className="text-muted-foreground">
                          {c.use_count}
                          {c.max_uses !== null ? ` / ${c.max_uses}` : ''}
                        </span>
                        {c.max_uses !== null && c.use_count >= c.max_uses && (
                          <Badge variant="destructive" className="ml-2 text-xs">
                            Maxed
                          </Badge>
                        )}
                      </td>

                      {/* Toggle */}
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleToggle(c)}
                          disabled={togglingId === c.id}
                          className="flex items-center gap-1 transition-opacity disabled:opacity-40"
                          title={c.active ? 'Deactivate' : 'Activate'}
                        >
                          {togglingId === c.id ? (
                            <Loader2 className="h-5 w-5 animate-spin" />
                          ) : c.active ? (
                            <ToggleRight className="h-6 w-6 text-emerald-400" />
                          ) : (
                            <ToggleLeft className="text-muted-foreground h-6 w-6" />
                          )}
                        </button>
                      </td>

                      {/* Delete */}
                      <td className="px-4 py-3">
                        {confirmDelete === c.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleDelete(c.id)}
                              disabled={deletingId === c.id}
                              className="text-destructive text-xs font-semibold hover:underline disabled:opacity-40"
                            >
                              {deletingId === c.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                'Confirm'
                              )}
                            </button>
                            <button
                              onClick={() => setConfirmDelete(null)}
                              className="text-muted-foreground text-xs hover:underline"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDelete(c.id)}
                            className="text-muted-foreground hover:text-destructive transition-colors"
                            title="Delete code"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {inactive.length > 0 && (
            <div className="border-border/40 bg-muted/20 text-muted-foreground border-t px-4 py-2 text-xs">
              {inactive.length} inactive code{inactive.length !== 1 ? 's' : ''}{' '}
              shown above (dimmed)
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
