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
  ChevronUp,
  Pencil,
  Check,
  X,
} from 'lucide-react'

interface PromoCode {
  id: string
  code: string
  discount_type: 'flat' | 'percent' | 'tiered'
  discount_amount: number
  description: string | null
  active: boolean
  expires_at: string | null
  max_uses: number | null
  use_count: number
  created_at: string
}

interface EditState {
  discount_type: 'flat' | 'percent'
  discount_amount: string
  description: string
  expires_at: string
  max_uses: string
}

function formatDiscount(type: 'flat' | 'percent' | 'tiered', amount: number) {
  if (type === 'tiered') return 'Tiered — see description'
  return type === 'flat' ? `$${amount.toFixed(2)} off` : `${amount}% off`
}

function isExpired(expiresAt: string | null) {
  if (!expiresAt) return false
  return new Date(expiresAt) < new Date()
}

function expiryLabel(expiresAt: string | null) {
  if (!expiresAt) return 'Never'
  const d = new Date(expiresAt)
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// Convert a TIMESTAMPTZ string to the YYYY-MM-DD format needed by <input type="date">
function toDateInputValue(ts: string | null): string {
  if (!ts) return ''
  return ts.slice(0, 10)
}

const SELECT_CLASS =
  'border-input bg-background ring-offset-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none'

export default function PromoCodesPage() {
  const [codes, setCodes] = useState<PromoCode[]>([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)

  // Per-row state
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editState, setEditState] = useState<EditState | null>(null)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Create form
  const [createForm, setCreateForm] = useState({
    code: '',
    discount_type: 'flat' as 'flat' | 'percent',
    discount_amount: '',
    description: '',
    expires_at: '',
    max_uses: '',
  })
  const [createSaving, setCreateSaving] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setPageError(null)
    try {
      const res = await fetch('/api/admin/promo-codes')
      const data = (await res.json()) as {
        promo_codes?: PromoCode[]
        error?: string
      }
      if (!res.ok) throw new Error(data.error ?? 'Failed to load')
      setCodes(data.promo_codes ?? [])
    } catch (e) {
      setPageError(
        e instanceof Error ? e.message : 'Failed to load promo codes',
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  // ── Toggle active ────────────────────────────────────────────────────────────
  async function handleToggle(c: PromoCode) {
    setTogglingId(c.id)
    try {
      const res = await fetch(`/api/admin/promo-codes/${c.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !c.active }),
      })
      if (!res.ok) {
        const d = (await res.json()) as { error?: string }
        throw new Error(d.error ?? 'Failed')
      }
      setCodes((prev) =>
        prev.map((x) => (x.id === c.id ? { ...x, active: !x.active } : x)),
      )
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to update')
    } finally {
      setTogglingId(null)
    }
  }

  // ── Delete ───────────────────────────────────────────────────────────────────
  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/admin/promo-codes/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const d = (await res.json()) as { error?: string }
        throw new Error(d.error ?? 'Failed')
      }
      setCodes((prev) => prev.filter((x) => x.id !== id))
      setConfirmDelete(null)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete')
    } finally {
      setDeletingId(null)
    }
  }

  // ── Start editing ────────────────────────────────────────────────────────────
  // Tiered codes have no editor here (amount lives in promo_code_tiers) —
  // callers must not invoke this for them; guarded again below for safety.
  function startEdit(c: PromoCode) {
    if (c.discount_type === 'tiered') return
    setEditingId(c.id)
    setEditError(null)
    setEditState({
      discount_type: c.discount_type,
      discount_amount: String(c.discount_amount),
      description: c.description ?? '',
      expires_at: toDateInputValue(c.expires_at),
      max_uses: c.max_uses !== null ? String(c.max_uses) : '',
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setEditState(null)
    setEditError(null)
  }

  // ── Save edit ────────────────────────────────────────────────────────────────
  async function handleSaveEdit(id: string) {
    if (!editState) return
    setEditSaving(true)
    setEditError(null)
    try {
      const payload = {
        discount_type: editState.discount_type,
        discount_amount: Number(editState.discount_amount),
        description: editState.description.trim() || null,
        expires_at: editState.expires_at
          ? new Date(editState.expires_at + 'T23:59:59').toISOString()
          : null,
        max_uses: editState.max_uses !== '' ? Number(editState.max_uses) : null,
      }
      const res = await fetch(`/api/admin/promo-codes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = (await res.json()) as {
        promo_code?: PromoCode
        error?: string
      }
      if (!res.ok) throw new Error(data.error ?? 'Failed to save')
      setCodes((prev) =>
        prev.map((x) => (x.id === id ? (data.promo_code ?? x) : x)),
      )
      cancelEdit()
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setEditSaving(false)
    }
  }

  // ── Create ───────────────────────────────────────────────────────────────────
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreateSaving(true)
    setCreateError(null)
    try {
      const payload = {
        code: createForm.code,
        discount_type: createForm.discount_type,
        discount_amount: Number(createForm.discount_amount),
        description: createForm.description.trim() || null,
        expires_at: createForm.expires_at
          ? new Date(createForm.expires_at + 'T23:59:59').toISOString()
          : null,
        max_uses:
          createForm.max_uses !== '' ? Number(createForm.max_uses) : null,
      }
      const res = await fetch('/api/admin/promo-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = (await res.json()) as {
        promo_code?: PromoCode
        error?: string
      }
      if (!res.ok) throw new Error(data.error ?? 'Failed to create')
      if (data.promo_code) setCodes((prev) => [data.promo_code!, ...prev])
      setCreateForm({
        code: '',
        discount_type: 'flat',
        discount_amount: '',
        description: '',
        expires_at: '',
        max_uses: '',
      })
      setShowCreateForm(false)
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create code')
    } finally {
      setCreateSaving(false)
    }
  }

  const active = codes.filter((c) => c.active)
  const inactive = codes.filter((c) => !c.active)

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* ── Header ── */}
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
          onClick={() => setShowCreateForm((v) => !v)}
          className="gap-2 bg-emerald-600 hover:bg-emerald-700"
        >
          {showCreateForm ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          {showCreateForm ? 'Cancel' : 'New Code'}
        </Button>
      </div>

      {/* ── Create form ── */}
      {showCreateForm && (
        <Card className="border-emerald-500/30 p-5">
          <h2 className="mb-4 font-semibold">Create New Promo Code</h2>
          <form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="c-code">Code *</Label>
              <Input
                id="c-code"
                value={createForm.code}
                onChange={(e) =>
                  setCreateForm((f) => ({
                    ...f,
                    code: e.target.value.toUpperCase(),
                  }))
                }
                placeholder="SPRING40"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="c-type">Discount Type *</Label>
              <select
                id="c-type"
                value={createForm.discount_type}
                onChange={(e) =>
                  setCreateForm((f) => ({
                    ...f,
                    discount_type: e.target.value as 'flat' | 'percent',
                  }))
                }
                className={SELECT_CLASS}
              >
                <option value="flat">Flat $ amount</option>
                <option value="percent">Percent %</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="c-amount">
                Amount * {createForm.discount_type === 'flat' ? '($)' : '(%)'}
              </Label>
              <Input
                id="c-amount"
                type="number"
                min="0.01"
                max={createForm.discount_type === 'percent' ? '100' : undefined}
                step="0.01"
                value={createForm.discount_amount}
                onChange={(e) =>
                  setCreateForm((f) => ({
                    ...f,
                    discount_amount: e.target.value,
                  }))
                }
                placeholder={
                  createForm.discount_type === 'flat' ? '20.00' : '10'
                }
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="c-expires">Expiry Date (optional)</Label>
              <Input
                id="c-expires"
                type="date"
                value={createForm.expires_at}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, expires_at: e.target.value }))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="c-max">Max Uses (optional)</Label>
              <Input
                id="c-max"
                type="number"
                min="1"
                step="1"
                value={createForm.max_uses}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, max_uses: e.target.value }))
                }
                placeholder="Unlimited"
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="c-desc">Description (shown to AI agents)</Label>
              <Input
                id="c-desc"
                value={createForm.description}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="$40 off jobs over $300 — Nextdoor Spring Special"
              />
            </div>

            {createError && (
              <p className="text-destructive text-sm sm:col-span-2">
                {createError}
              </p>
            )}

            <div className="flex gap-2 sm:col-span-2">
              <Button
                type="submit"
                disabled={createSaving}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {createSaving && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Create Code
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowCreateForm(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* ── Loading ── */}
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

      {/* ── Empty state ── */}
      {!loading && !pageError && codes.length === 0 && (
        <Card className="p-8 text-center">
          <Tag className="text-muted-foreground mx-auto mb-3 h-8 w-8" />
          <p className="text-muted-foreground text-sm">
            No promo codes yet. Create one above.
          </p>
        </Card>
      )}

      {/* ── Table ── */}
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
                  const isEditing = editingId === c.id
                  const expired = isExpired(c.expires_at)

                  if (isEditing && editState) {
                    // ── Edit row ──────────────────────────────────────────────
                    return (
                      <tr key={c.id} className="bg-muted/20">
                        {/* Code (read-only in edit) */}
                        <td className="px-4 py-3">
                          <span className="bg-muted rounded px-2 py-0.5 font-mono font-semibold tracking-wide">
                            {c.code}
                          </span>
                        </td>

                        {/* Discount type + amount */}
                        <td className="px-4 py-2">
                          <div className="flex gap-1.5">
                            <select
                              value={editState.discount_type}
                              onChange={(e) =>
                                setEditState((s) =>
                                  s
                                    ? {
                                        ...s,
                                        discount_type: e.target.value as
                                          | 'flat'
                                          | 'percent',
                                      }
                                    : s,
                                )
                              }
                              className={SELECT_CLASS + ' w-28'}
                            >
                              <option value="flat">$ flat</option>
                              <option value="percent">% off</option>
                            </select>
                            <Input
                              type="number"
                              min="0.01"
                              max={
                                editState.discount_type === 'percent'
                                  ? '100'
                                  : undefined
                              }
                              step="0.01"
                              value={editState.discount_amount}
                              onChange={(e) =>
                                setEditState((s) =>
                                  s
                                    ? { ...s, discount_amount: e.target.value }
                                    : s,
                                )
                              }
                              className="w-20"
                            />
                          </div>
                        </td>

                        {/* Description */}
                        <td className="px-4 py-2">
                          <Input
                            value={editState.description}
                            onChange={(e) =>
                              setEditState((s) =>
                                s ? { ...s, description: e.target.value } : s,
                              )
                            }
                            placeholder="Description for AI agents"
                            className="min-w-[180px]"
                          />
                        </td>

                        {/* Expiry date */}
                        <td className="px-4 py-2">
                          <Input
                            type="date"
                            value={editState.expires_at}
                            onChange={(e) =>
                              setEditState((s) =>
                                s ? { ...s, expires_at: e.target.value } : s,
                              )
                            }
                            className="w-36"
                          />
                          {editState.expires_at && (
                            <button
                              type="button"
                              onClick={() =>
                                setEditState((s) =>
                                  s ? { ...s, expires_at: '' } : s,
                                )
                              }
                              className="text-muted-foreground mt-1 text-xs hover:underline"
                            >
                              Clear (no expiry)
                            </button>
                          )}
                        </td>

                        {/* Max uses */}
                        <td className="px-4 py-2">
                          <Input
                            type="number"
                            min="1"
                            step="1"
                            value={editState.max_uses}
                            onChange={(e) =>
                              setEditState((s) =>
                                s ? { ...s, max_uses: e.target.value } : s,
                              )
                            }
                            placeholder="∞"
                            className="w-20"
                          />
                        </td>

                        {/* Active — keep as toggle */}
                        <td className="text-muted-foreground px-4 py-2 text-xs">
                          —
                        </td>

                        {/* Save / Cancel */}
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-1">
                            {editError && (
                              <span className="text-destructive mr-2 text-xs">
                                {editError}
                              </span>
                            )}
                            <button
                              onClick={() => handleSaveEdit(c.id)}
                              disabled={editSaving}
                              className="flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                            >
                              {editSaving ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Check className="h-3 w-3" />
                              )}
                              Save
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="text-muted-foreground hover:text-foreground rounded px-2 py-1 text-xs"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  }

                  // ── Read row ────────────────────────────────────────────────
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
                        {c.description ?? '—'}
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
                          {expiryLabel(c.expires_at)}
                          {expired && ' ⚠️'}
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

                      {/* Toggle active */}
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

                      {/* Edit + Delete */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {/* Edit (tiered codes have no editor UI yet — the
                              amount lives in promo_code_tiers, not this
                              form; editing would silently overwrite
                              discount_type and break the tier lookup) */}
                          <button
                            onClick={() =>
                              c.discount_type !== 'tiered' && startEdit(c)
                            }
                            disabled={c.discount_type === 'tiered'}
                            className="text-muted-foreground hover:text-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-30"
                            title={
                              c.discount_type === 'tiered'
                                ? 'Tiered codes are edited via database migration'
                                : 'Edit code'
                            }
                          >
                            <Pencil className="h-4 w-4" />
                          </button>

                          {/* Delete */}
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
                                  'Delete?'
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
                              onClick={() => setConfirmDelete(c.id)}
                              className="text-muted-foreground hover:text-destructive transition-colors"
                              title="Delete code"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
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
