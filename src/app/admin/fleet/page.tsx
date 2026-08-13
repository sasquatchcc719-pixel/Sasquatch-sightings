'use client'

/**
 * Fleet & Maintenance — one card per machine, every one of its maintenance
 * tasks grouped underneath by timeframe (Daily / Weekly / Monthly / Yearly /
 * every-N-hours or -miles), so a real factory schedule with dozens of items
 * reads as an organized list instead of one flat pile. Techs log meters at
 * /field/checkin; the daily cron turns overdue intervals into tasks that
 * show up here (and alert on Telegram) until completed or dismissed.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Truck,
  Plus,
  Trash2,
  Check,
  X,
  Loader2,
  Wrench,
  Camera,
} from 'lucide-react'

type Asset = {
  id: string
  name: string
  asset_type: string
  meter_type: 'miles' | 'hours' | 'none'
  current_meter: number | null
  active: boolean
  notes: string | null
  image_url: string | null
}
type Rule = {
  id: string
  asset_id: string
  task_name: string
  interval_value: number
  interval_unit: 'miles' | 'hours' | 'days'
  last_done_meter: number | null
  last_done_at: string | null
  active: boolean
}
type MTask = {
  id: string
  asset_id: string
  title: string
  status: string
  triggered_at: string
  meter_at_trigger: number | null
}

const ASSET_TYPES = [
  'van',
  'truck',
  'truckmount',
  'portable',
  'tractor',
  'tool',
  'other',
]

// Quick-add tiers for the calendar-based cadences every machine has,
// regardless of whether it even has a meter.
const DAY_TIERS: { key: string; label: string; days: number }[] = [
  { key: 'daily', label: 'Daily', days: 1 },
  { key: 'weekly', label: 'Weekly', days: 7 },
  { key: 'monthly', label: 'Monthly', days: 30 },
  { key: 'yearly', label: 'Yearly', days: 365 },
]

function tierLabel(unit: string, value: number): string {
  if (unit === 'days') {
    const match = DAY_TIERS.find((t) => t.days === value)
    if (match) return match.label
    return `Every ${value} days`
  }
  return `Every ${value} ${unit}`
}

function tierSortKey(unit: string, value: number): number {
  if (unit === 'days') {
    const idx = DAY_TIERS.findIndex((t) => t.days === value)
    if (idx !== -1) return idx
    return 4 + value / 1e6
  }
  return 10 + value / 1e6
}

type RuleFormState = {
  mode: string // 'daily' | 'weekly' | 'monthly' | 'yearly' | 'meter'
  meterValue: string
  task_name: string
}

function defaultForm(): RuleFormState {
  return { mode: 'daily', meterValue: '', task_name: '' }
}

export default function FleetPage() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [rules, setRules] = useState<Rule[]>([])
  const [tasks, setTasks] = useState<MTask[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [newAsset, setNewAsset] = useState({
    name: '',
    asset_type: 'van',
    meter_type: 'miles',
    current_meter: '',
  })
  const [ruleForms, setRuleForms] = useState<Record<string, RuleFormState>>({})
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({})
  const taskNameInputs = useRef<Record<string, HTMLInputElement | null>>({})

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/fleet', { cache: 'no-store' })
    const data = await res.json()
    setAssets(data.assets ?? [])
    setRules(data.rules ?? [])
    setTasks(data.tasks ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const api = async (method: string, body?: unknown, query = '') => {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/fleet${query}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      if (res.ok) await load()
    } finally {
      setBusy(false)
    }
  }

  const openTasks = tasks.filter(
    (t) => t.status === 'unassigned' || t.status === 'scheduled',
  )

  const uploadPhoto = async (assetId: string, file: File) => {
    setUploadingId(assetId)
    try {
      const form = new FormData()
      form.append('assetId', assetId)
      form.append('file', file)
      const res = await fetch('/api/admin/fleet/photo', {
        method: 'POST',
        body: form,
      })
      const data = await res.json()
      if (res.ok && data.url) {
        setAssets((prev) =>
          prev.map((a) =>
            a.id === assetId ? { ...a, image_url: data.url } : a,
          ),
        )
      }
    } finally {
      setUploadingId(null)
    }
  }

  const addRule = async (asset: Asset, form: RuleFormState) => {
    if (!form.task_name.trim() || busy) return
    const dayTier = DAY_TIERS.find((t) => t.key === form.mode)
    const interval_unit = dayTier ? 'days' : asset.meter_type
    const interval_value = dayTier ? dayTier.days : Number(form.meterValue)
    if (!dayTier && (!form.meterValue.trim() || !(interval_value > 0))) return

    await api('POST', {
      resource: 'rule',
      asset_id: asset.id,
      task_name: form.task_name,
      interval_value,
      interval_unit,
    })
    // Keep the same tier selected so many tasks can be punched in back to
    // back — only the task name resets, and focus returns immediately.
    setRuleForms((prev) => ({
      ...prev,
      [asset.id]: { ...form, task_name: '' },
    }))
    taskNameInputs.current[asset.id]?.focus()
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <h1 className="flex items-center gap-2 text-xl font-semibold">
        <Truck className="h-5 w-5" /> Fleet &amp; Maintenance
      </h1>

      {openTasks.length > 0 ? (
        <div className="space-y-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <Wrench className="h-4 w-4" /> Maintenance due ({openTasks.length})
          </h2>
          {openTasks.map((t) => (
            <Card
              key={t.id}
              className="flex items-center gap-3 border-amber-500/40 p-3 text-sm"
            >
              <span className="flex-1 font-medium">{t.title}</span>
              <span className="text-muted-foreground text-xs">
                {new Date(t.triggered_at).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })}
                {t.meter_at_trigger != null ? ` @ ${t.meter_at_trigger}` : ''}
              </span>
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  api('PATCH', {
                    resource: 'task',
                    id: t.id,
                    status: 'completed',
                  })
                }
              >
                <Check className="mr-1 h-4 w-4" /> Done
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  api('PATCH', {
                    resource: 'task',
                    id: t.id,
                    status: 'dismissed',
                  })
                }
              >
                <X className="h-4 w-4" />
              </Button>
            </Card>
          ))}
        </div>
      ) : null}

      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold">Add asset</h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder="Name (e.g. Blue Van, Truckmount)"
            value={newAsset.name}
            onChange={(e) => setNewAsset({ ...newAsset, name: e.target.value })}
          />
          <select
            className="border-input bg-background rounded-md border px-3 py-2 text-sm"
            value={newAsset.asset_type}
            onChange={(e) =>
              setNewAsset({ ...newAsset, asset_type: e.target.value })
            }
          >
            {ASSET_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            className="border-input bg-background rounded-md border px-3 py-2 text-sm"
            value={newAsset.meter_type}
            onChange={(e) =>
              setNewAsset({ ...newAsset, meter_type: e.target.value })
            }
          >
            <option value="miles">miles</option>
            <option value="hours">engine hours</option>
            <option value="none">no meter</option>
          </select>
          <Input
            placeholder="Current reading"
            inputMode="decimal"
            className="sm:w-36"
            value={newAsset.current_meter}
            onChange={(e) =>
              setNewAsset({ ...newAsset, current_meter: e.target.value })
            }
          />
          <Button
            disabled={busy || !newAsset.name.trim()}
            onClick={async () => {
              await api('POST', {
                resource: 'asset',
                ...newAsset,
                current_meter: newAsset.current_meter.trim()
                  ? Number(newAsset.current_meter)
                  : null,
              })
              setNewAsset({
                name: '',
                asset_type: 'van',
                meter_type: 'miles',
                current_meter: '',
              })
            }}
          >
            <Plus className="mr-1 h-4 w-4" /> Add
          </Button>
        </div>
      </Card>

      {loading ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : (
        assets.map((a) => {
          const assetRules = rules.filter((r) => r.asset_id === a.id)
          const form = ruleForms[a.id] ?? defaultForm()

          // Group this machine's tasks by timeframe so dozens of items read
          // as an organized schedule instead of one flat pile.
          const groups = new Map<string, Rule[]>()
          for (const r of assetRules) {
            const label = tierLabel(r.interval_unit, r.interval_value)
            groups.set(label, [...(groups.get(label) ?? []), r])
          }
          const sortedGroupLabels = [...groups.keys()].sort((x, y) => {
            const rx = groups.get(x)![0]
            const ry = groups.get(y)![0]
            return (
              tierSortKey(rx.interval_unit, rx.interval_value) -
              tierSortKey(ry.interval_unit, ry.interval_value)
            )
          })

          const dayTier = DAY_TIERS.find((t) => t.key === form.mode)

          return (
            <Card key={a.id} className="space-y-4 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={(el) => {
                    fileInputs.current[a.id] = el
                  }}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void uploadPhoto(a.id, file)
                    e.target.value = ''
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputs.current[a.id]?.click()}
                  disabled={uploadingId === a.id}
                  className="bg-muted relative h-10 w-10 shrink-0 overflow-hidden rounded-lg"
                  title="Set reference photo"
                >
                  {a.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={a.image_url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Camera className="text-muted-foreground m-auto h-4 w-4" />
                  )}
                  {uploadingId === a.id ? (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                      <Loader2 className="h-4 w-4 animate-spin text-white" />
                    </span>
                  ) : null}
                </button>
                <span className="font-medium">{a.name}</span>
                <Badge variant="outline" className="capitalize">
                  {a.asset_type}
                </Badge>
                {a.meter_type !== 'none' ? (
                  <span className="text-muted-foreground text-sm">
                    {a.current_meter != null
                      ? `${a.current_meter} ${a.meter_type}`
                      : 'no reading yet'}
                  </span>
                ) : null}
                <Badge variant="outline">
                  {assetRules.length} task{assetRules.length === 1 ? '' : 's'}
                </Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto text-red-500"
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`Delete ${a.name} and all its rules/history?`))
                      api('DELETE', undefined, `?resource=asset&id=${a.id}`)
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              {sortedGroupLabels.length > 0 ? (
                <div className="space-y-3">
                  {sortedGroupLabels.map((label) => (
                    <div key={label}>
                      <h3 className="text-muted-foreground mb-1 text-xs font-semibold tracking-wide uppercase">
                        {label} ({groups.get(label)!.length})
                      </h3>
                      <div className="space-y-1.5">
                        {groups.get(label)!.map((r) => (
                          <div
                            key={r.id}
                            className="text-muted-foreground flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
                          >
                            <span className="text-foreground flex-1">
                              {r.task_name}
                            </span>
                            <span className="text-xs">
                              {r.interval_unit === 'days'
                                ? r.last_done_at
                                  ? `last: ${new Date(
                                      r.last_done_at,
                                    ).toLocaleDateString('en-US', {
                                      month: 'short',
                                      day: 'numeric',
                                    })}`
                                  : ''
                                : r.last_done_meter != null
                                  ? `last @ ${r.last_done_meter}`
                                  : ''}
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-red-500"
                              disabled={busy}
                              onClick={() =>
                                api(
                                  'DELETE',
                                  undefined,
                                  `?resource=rule&id=${r.id}`,
                                )
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">
                  No maintenance tasks yet — add the schedule below.
                </p>
              )}

              <div className="space-y-2 border-t pt-3">
                <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                  Add to schedule
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {DAY_TIERS.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() =>
                        setRuleForms({
                          ...ruleForms,
                          [a.id]: { ...form, mode: t.key },
                        })
                      }
                      className={`rounded-full px-3 py-1 text-xs font-medium ${
                        form.mode === t.key
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                  {a.meter_type !== 'none' ? (
                    <button
                      type="button"
                      onClick={() =>
                        setRuleForms({
                          ...ruleForms,
                          [a.id]: { ...form, mode: 'meter' },
                        })
                      }
                      className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${
                        form.mode === 'meter'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      Every
                      <input
                        type="number"
                        inputMode="decimal"
                        value={form.meterValue}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          setRuleForms({
                            ...ruleForms,
                            [a.id]: {
                              ...form,
                              mode: 'meter',
                              meterValue: e.target.value,
                            },
                          })
                        }
                        placeholder="100"
                        className="w-14 rounded bg-white/20 px-1 text-center text-black"
                      />
                      {a.meter_type}
                    </button>
                  ) : null}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    ref={(el) => {
                      taskNameInputs.current[a.id] = el
                    }}
                    placeholder={
                      dayTier
                        ? `${dayTier.label} task (e.g. Check oil level)`
                        : `Task every ${form.meterValue || 'N'} ${a.meter_type} (e.g. Oil change)`
                    }
                    value={form.task_name}
                    onChange={(e) =>
                      setRuleForms({
                        ...ruleForms,
                        [a.id]: { ...form, task_name: e.target.value },
                      })
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void addRule(a, { ...form })
                      }
                    }}
                  />
                  <Button
                    variant="outline"
                    disabled={busy || !form.task_name.trim()}
                    onClick={() => void addRule(a, form)}
                  >
                    <Plus className="mr-1 h-4 w-4" /> Add task
                  </Button>
                </div>
                <p className="text-muted-foreground text-xs">
                  Pick a timeframe once, then keep typing task names and hitting
                  Enter to add several at that cadence in a row.
                </p>
              </div>
            </Card>
          )
        })
      )}
    </div>
  )
}
