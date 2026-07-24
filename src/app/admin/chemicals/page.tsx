'use client'

/**
 * Chemical Inventory (Foreman module).
 * Add truck chemicals by name/brand — a background agent researches the
 * manufacturer label + SDS and drafts dilutions, pH, and usage scenarios.
 * Drafts must be reviewed & approved before the field AI assistant will
 * recommend the product. Out-of-stock products are never recommended.
 */

import { useCallback, useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  FlaskConical,
  Plus,
  Loader2,
  Trash2,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  ShieldAlert,
  Upload,
  X,
} from 'lucide-react'
import type { ChemicalProduct } from '@/lib/foreman/types'

const STATUS_META: Record<
  ChemicalProduct['scrape_status'],
  { label: string; className: string }
> = {
  pending: { label: 'Researching…', className: 'bg-slate-600 text-white' },
  scraped: {
    label: 'Draft — needs review',
    className: 'bg-amber-500 text-black',
  },
  reviewed: { label: 'Approved', className: 'bg-green-600 text-white' },
  failed: { label: 'Research failed', className: 'bg-red-600 text-white' },
}

type EditState = {
  image_url: string
  quantity_on_hand: string
  quantity_unit: string
  reorder_threshold: string
  ph_range: string
  dilution_hydroforce: string
  dilution_pump_sprayer: string
  label_instructions: string
  sds_warnings: string
  sds_url: string
  scenarios: string
  incompatible_with: string
  notes: string
}

function toEditState(p: ChemicalProduct): EditState {
  return {
    image_url: p.image_url ?? '',
    quantity_on_hand:
      p.quantity_on_hand != null ? String(p.quantity_on_hand) : '',
    quantity_unit: p.quantity_unit ?? 'jugs',
    reorder_threshold:
      p.reorder_threshold != null ? String(p.reorder_threshold) : '',
    ph_range: p.ph_range ?? '',
    dilution_hydroforce: p.dilution_hydroforce ?? '',
    dilution_pump_sprayer: p.dilution_pump_sprayer ?? '',
    label_instructions: p.label_instructions ?? '',
    sds_warnings: p.sds_warnings ?? '',
    sds_url: p.sds_url ?? '',
    scenarios: p.scenarios.join(', '),
    incompatible_with: p.incompatible_with.join(', '),
    notes: p.notes ?? '',
  }
}

function fromEditState(e: EditState) {
  const list = (s: string) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
  const num = (s: string) => {
    const n = Number(s.trim())
    return s.trim() !== '' && Number.isFinite(n) ? n : null
  }
  return {
    image_url: e.image_url.trim() || null,
    quantity_on_hand: num(e.quantity_on_hand),
    quantity_unit: e.quantity_unit.trim() || 'jugs',
    reorder_threshold: num(e.reorder_threshold),
    ph_range: e.ph_range.trim() || null,
    dilution_hydroforce: e.dilution_hydroforce.trim() || null,
    dilution_pump_sprayer: e.dilution_pump_sprayer.trim() || null,
    label_instructions: e.label_instructions.trim() || null,
    sds_warnings: e.sds_warnings.trim() || null,
    sds_url: e.sds_url.trim() || null,
    scenarios: list(e.scenarios),
    incompatible_with: list(e.incompatible_with),
    notes: e.notes.trim() || null,
  }
}

export default function ChemicalsPage() {
  const [products, setProducts] = useState<ChemicalProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [newBrand, setNewBrand] = useState('')
  const [adding, setAdding] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [edit, setEdit] = useState<EditState | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sdsUploadingId, setSdsUploadingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/chemicals', { cache: 'no-store' })
      const data = await res.json()
      setProducts(data.products ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const upsertLocal = (product: ChemicalProduct) =>
    setProducts((prev) => {
      const idx = prev.findIndex((p) => p.id === product.id)
      if (idx === -1)
        return [...prev, product].sort((a, b) => a.name.localeCompare(b.name))
      const next = [...prev]
      next[idx] = product
      return next
    })

  const addProduct = async () => {
    if (!newName.trim()) return
    setAdding(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/chemicals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), brand: newBrand.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Add failed')
      upsertLocal(data.product)
      setNewName('')
      setNewBrand('')
      setExpandedId(data.product.id)
      setEdit(toEditState(data.product))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Add failed')
    } finally {
      setAdding(false)
    }
  }

  const patchProduct = async (id: string, body: Record<string, unknown>) => {
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/admin/chemicals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Update failed')
      upsertLocal(data.product)
      return data.product as ChemicalProduct
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
      return null
    } finally {
      setBusyId(null)
    }
  }

  const rescrape = async (id: string) => {
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/admin/chemicals/${id}/scrape`, {
        method: 'POST',
      })
      const data = await res.json()
      if (data.product) {
        upsertLocal(data.product)
        if (expandedId === id) setEdit(toEditState(data.product))
      }
    } finally {
      setBusyId(null)
    }
  }

  const uploadSds = async (id: string, file: File) => {
    setSdsUploadingId(id)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/api/admin/chemicals/${id}/sds`, {
        method: 'POST',
        body: form,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'SDS upload failed')
      upsertLocal(data.product)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SDS upload failed')
    } finally {
      setSdsUploadingId(null)
    }
  }

  const removeSds = async (id: string) => {
    if (!confirm('Remove the uploaded SDS PDF?')) return
    setSdsUploadingId(id)
    try {
      const res = await fetch(`/api/admin/chemicals/${id}/sds`, {
        method: 'DELETE',
      })
      const data = await res.json()
      if (res.ok && data.product) upsertLocal(data.product)
    } finally {
      setSdsUploadingId(null)
    }
  }

  const removeProduct = async (id: string) => {
    if (!confirm('Delete this product from the inventory?')) return
    setBusyId(id)
    try {
      const res = await fetch(`/api/admin/chemicals/${id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        setProducts((prev) => prev.filter((p) => p.id !== id))
        if (expandedId === id) setExpandedId(null)
      }
    } finally {
      setBusyId(null)
    }
  }

  const toggleExpand = (p: ChemicalProduct) => {
    if (expandedId === p.id) {
      setExpandedId(null)
      setEdit(null)
    } else {
      setExpandedId(p.id)
      setEdit(toEditState(p))
    }
  }

  const inStockCount = products.filter((p) => p.in_stock).length
  const approvedCount = products.filter(
    (p) => p.scrape_status === 'reviewed',
  ).length

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <FlaskConical className="h-5 w-5" /> Chemical Inventory
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {products.length} products · {inStockCount} in stock ·{' '}
            {approvedCount} approved for the AI assistant
          </p>
          <p className="text-muted-foreground mt-1 max-w-xl text-xs">
            Add a product and the agent researches its label &amp; SDS. Review
            and approve the draft before the field assistant will recommend it.
            Out-of-stock products are never recommended.
          </p>
        </div>
      </div>

      <Card className="p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder="Product name (e.g. Ultrapac Extreme)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Input
            placeholder="Brand (e.g. Prochem)"
            value={newBrand}
            onChange={(e) => setNewBrand(e.target.value)}
          />
          <Button onClick={addProduct} disabled={adding || !newName.trim()}>
            {adding ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                Researching…
              </>
            ) : (
              <>
                <Plus className="mr-1 h-4 w-4" /> Add &amp; research
              </>
            )}
          </Button>
        </div>
        {error ? (
          <p className="mt-2 flex items-center gap-1 text-sm text-red-500">
            <AlertCircle className="h-4 w-4" /> {error}
          </p>
        ) : null}
      </Card>

      {loading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : products.length === 0 ? (
        <Card className="text-muted-foreground p-8 text-center text-sm">
          No chemicals yet. Add your first product above — name and brand is all
          it needs.
        </Card>
      ) : (
        <div className="space-y-2">
          {products.map((p) => {
            const status = STATUS_META[p.scrape_status]
            const expanded = expandedId === p.id
            const busy = busyId === p.id
            return (
              <Card key={p.id} className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => toggleExpand(p)}
                  >
                    {p.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.image_url}
                        alt=""
                        className="h-12 w-12 shrink-0 rounded-md bg-white object-contain p-0.5"
                      />
                    ) : null}
                    <span className="truncate text-sm font-medium">
                      {p.name}
                      {p.brand ? (
                        <span className="text-muted-foreground">
                          {' '}
                          · {p.brand}
                        </span>
                      ) : null}
                    </span>
                    {expanded ? (
                      <ChevronUp className="h-4 w-4 shrink-0" />
                    ) : (
                      <ChevronDown className="h-4 w-4 shrink-0" />
                    )}
                  </button>
                  {p.quantity_on_hand != null ? (
                    <Badge
                      variant="outline"
                      className={
                        p.reorder_threshold != null &&
                        p.quantity_on_hand <= p.reorder_threshold
                          ? 'border-amber-500 text-amber-500'
                          : ''
                      }
                    >
                      {p.quantity_on_hand} {p.quantity_unit}
                    </Badge>
                  ) : null}
                  {p.item_type !== 'chemical' ? (
                    <Badge variant="outline" className="capitalize">
                      {p.item_type}
                    </Badge>
                  ) : null}
                  {p.sds_file_url || p.sds_url ? (
                    <Badge
                      variant="outline"
                      className="border-amber-500/50 text-amber-600 dark:text-amber-400"
                    >
                      <ShieldAlert className="mr-0.5 h-3 w-3" /> SDS
                    </Badge>
                  ) : null}
                  <Badge className={status.className}>{status.label}</Badge>
                  <Button
                    size="sm"
                    variant={p.in_stock ? 'default' : 'outline'}
                    disabled={busy}
                    onClick={() =>
                      patchProduct(p.id, { in_stock: !p.in_stock })
                    }
                  >
                    {p.in_stock ? 'In stock' : 'Out of stock'}
                  </Button>
                </div>

                {p.scrape_status === 'failed' && p.scrape_error ? (
                  <p className="mt-2 text-xs text-red-500">{p.scrape_error}</p>
                ) : null}

                {expanded && edit ? (
                  <div className="mt-4 space-y-3 border-t pt-4">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <label className="text-xs">
                        <span className="text-muted-foreground">
                          Qty on hand
                        </span>
                        <Input
                          inputMode="decimal"
                          value={edit.quantity_on_hand}
                          onChange={(e) =>
                            setEdit({
                              ...edit,
                              quantity_on_hand: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="text-xs">
                        <span className="text-muted-foreground">
                          Unit (jugs, boxes, each…)
                        </span>
                        <Input
                          value={edit.quantity_unit}
                          onChange={(e) =>
                            setEdit({ ...edit, quantity_unit: e.target.value })
                          }
                        />
                      </label>
                      <label className="text-xs">
                        <span className="text-muted-foreground">
                          Reorder alert at
                        </span>
                        <Input
                          inputMode="decimal"
                          value={edit.reorder_threshold}
                          onChange={(e) =>
                            setEdit({
                              ...edit,
                              reorder_threshold: e.target.value,
                            })
                          }
                        />
                      </label>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <label className="text-xs">
                        <span className="text-muted-foreground">pH range</span>
                        <Input
                          value={edit.ph_range}
                          onChange={(e) =>
                            setEdit({ ...edit, ph_range: e.target.value })
                          }
                        />
                      </label>
                      <label className="text-xs">
                        <span className="text-muted-foreground">
                          Hydro-Force / metering tip
                        </span>
                        <Input
                          value={edit.dilution_hydroforce}
                          onChange={(e) =>
                            setEdit({
                              ...edit,
                              dilution_hydroforce: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="text-xs">
                        <span className="text-muted-foreground">
                          Pump sprayer (oz/gal)
                        </span>
                        <Input
                          value={edit.dilution_pump_sprayer}
                          onChange={(e) =>
                            setEdit({
                              ...edit,
                              dilution_pump_sprayer: e.target.value,
                            })
                          }
                        />
                      </label>
                    </div>
                    <label className="block text-xs">
                      <span className="text-muted-foreground">
                        Label instructions
                      </span>
                      <textarea
                        className="border-input bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm"
                        rows={3}
                        value={edit.label_instructions}
                        onChange={(e) =>
                          setEdit({
                            ...edit,
                            label_instructions: e.target.value,
                          })
                        }
                      />
                    </label>
                    <label className="block text-xs">
                      <span className="text-muted-foreground">
                        SDS warnings
                      </span>
                      <textarea
                        className="border-input bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm"
                        rows={2}
                        value={edit.sds_warnings}
                        onChange={(e) =>
                          setEdit({ ...edit, sds_warnings: e.target.value })
                        }
                      />
                    </label>

                    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                      <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                        <ShieldAlert className="h-4 w-4" /> Safety Data Sheet
                        (SDS)
                      </p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        The real manufacturer sheet techs open in the field.
                        Link the official SDS and/or upload a PDF copy — never a
                        generated one.
                      </p>
                      <label className="mt-2 block text-xs">
                        <span className="text-muted-foreground">
                          Manufacturer SDS link
                        </span>
                        <Input
                          placeholder="https://…/sds.pdf"
                          value={edit.sds_url}
                          onChange={(e) =>
                            setEdit({ ...edit, sds_url: e.target.value })
                          }
                        />
                      </label>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <label className="border-input hover:bg-accent inline-flex cursor-pointer items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium">
                          {sdsUploadingId === p.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Upload className="h-3.5 w-3.5" />
                          )}
                          {p.sds_file_url ? 'Replace PDF' : 'Upload PDF'}
                          <input
                            type="file"
                            accept="application/pdf"
                            className="hidden"
                            disabled={sdsUploadingId === p.id}
                            onChange={(e) => {
                              const f = e.target.files?.[0]
                              if (f) uploadSds(p.id, f)
                              e.target.value = ''
                            }}
                          />
                        </label>
                        {p.sds_file_url ? (
                          <>
                            <a
                              href={p.sds_file_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-0.5 text-xs text-blue-500 hover:underline"
                            >
                              View uploaded PDF
                              <ExternalLink className="h-3 w-3" />
                            </a>
                            <button
                              type="button"
                              className="text-muted-foreground inline-flex items-center gap-0.5 text-xs hover:text-red-500"
                              onClick={() => removeSds(p.id)}
                            >
                              <X className="h-3 w-3" /> Remove
                            </button>
                          </>
                        ) : null}
                        {edit.sds_url.trim() ? (
                          <a
                            href={edit.sds_url.trim()}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 text-xs text-blue-500 hover:underline"
                          >
                            Open link
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : null}
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-xs">
                        <span className="text-muted-foreground">
                          Scenarios (comma-separated)
                        </span>
                        <Input
                          value={edit.scenarios}
                          onChange={(e) =>
                            setEdit({ ...edit, scenarios: e.target.value })
                          }
                        />
                      </label>
                      <label className="text-xs">
                        <span className="text-muted-foreground">
                          Incompatible with (comma-separated)
                        </span>
                        <Input
                          value={edit.incompatible_with}
                          onChange={(e) =>
                            setEdit({
                              ...edit,
                              incompatible_with: e.target.value,
                            })
                          }
                        />
                      </label>
                    </div>
                    <label className="block text-xs">
                      <span className="text-muted-foreground">
                        Image URL (product photo for bottle matching)
                      </span>
                      <Input
                        value={edit.image_url}
                        onChange={(e) =>
                          setEdit({ ...edit, image_url: e.target.value })
                        }
                      />
                    </label>
                    <label className="block text-xs">
                      <span className="text-muted-foreground">
                        Notes (your own — e.g. which truck, metering tip color)
                      </span>
                      <Input
                        value={edit.notes}
                        onChange={(e) =>
                          setEdit({ ...edit, notes: e.target.value })
                        }
                      />
                    </label>

                    {p.source_urls.length > 0 ? (
                      <div className="text-xs">
                        <span className="text-muted-foreground">Sources: </span>
                        {p.source_urls.map((url) => (
                          <a
                            key={url}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mr-2 inline-flex items-center gap-0.5 text-blue-500 hover:underline"
                          >
                            {new URL(url).hostname}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ))}
                      </div>
                    ) : null}

                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => patchProduct(p.id, fromEditState(edit))}
                      >
                        Save
                      </Button>
                      {p.scrape_status !== 'reviewed' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={async () => {
                            const saved = await patchProduct(p.id, {
                              ...fromEditState(edit),
                              action: 'approve',
                            })
                            if (saved) setEdit(toEditState(saved))
                          }}
                        >
                          <CheckCircle className="mr-1 h-4 w-4" /> Save &amp;
                          approve
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => rescrape(p.id)}
                      >
                        {busy ? (
                          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="mr-1 h-4 w-4" />
                        )}
                        Re-research
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        className="text-red-500"
                        onClick={() => removeProduct(p.id)}
                      >
                        <Trash2 className="mr-1 h-4 w-4" /> Delete
                      </Button>
                    </div>
                  </div>
                ) : null}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
