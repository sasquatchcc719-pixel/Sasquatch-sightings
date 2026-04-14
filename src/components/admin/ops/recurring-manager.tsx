'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Calendar,
  ChevronLeft,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Receipt,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'

// ─── Types ──────────────────────────────────────────────────────────────

type CustomerAddress = {
  id: string
  label: string | null
  street_1: string
  city: string
  state: string
  zip_code: string
}

type CustomerResult = {
  id: string
  full_name: string
  business_name: string | null
  phone: string
  email: string | null
  ops_service_addresses: CustomerAddress[]
}

type ServiceCatalogItem = {
  id: string
  name: string
  category: string
  base_price: number | null
  default_duration_minutes: number | null
}

type LineItemForm = {
  service_catalog_item_id: string
  name_snapshot: string
  notes: string
  quantity: string
  unit_price: string
  duration_minutes: string
}

type RuleForm = {
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'custom'
  day_of_week: string
  week_of_month: string
  day_of_month: string
  interval_days: string
  effective_from: string
  effective_until: string
  override_start_time: string
}

type Template = {
  id: string
  label: string
  is_active: boolean
  invoice_mode: string
  start_time: string
  scheduled_duration_minutes: number
  discount_amount: number
  internal_notes: string | null
  service_address_id: string | null
  line_items: Array<{
    name_snapshot: string
    quantity: number
    unit_price: number
    duration_minutes: number
    service_catalog_item_id?: string | null
    notes?: string | null
  }>
  generated_count: number
  next_date: string | null
  ops_customers: CustomerResult | CustomerResult[] | null
  ops_service_addresses: CustomerAddress | CustomerAddress[] | null
  ops_recurrence_rules: RuleForm[] | null
}

type TemplateDetail = Template & {
  appointments: Array<{
    id: string
    appointment_date: string
    start_time: string
    status: string
    quoted_total: number
  }>
  batch_invoices: Array<{
    id: string
    month: string
    status: string
    total: number
  }>
}

const DAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]
const FREQUENCIES = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 Weeks' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'custom', label: 'Custom Interval' },
]

function unwrap<T>(val: T | T[] | null | undefined): T | null {
  if (!val) return null
  return Array.isArray(val) ? val[0] || null : val
}

function formatCurrency(n: number): string {
  return `$${n.toFixed(2)}`
}

function formatFrequency(rule: RuleForm): string {
  const freq =
    FREQUENCIES.find((f) => f.value === rule.frequency)?.label || rule.frequency
  if (rule.frequency === 'monthly') {
    if (rule.day_of_month)
      return `${freq} on the ${ordinal(Number(rule.day_of_month))}`
    if (rule.day_of_week && rule.week_of_month) {
      return `${ordinal(Number(rule.week_of_month))} ${DAYS[Number(rule.day_of_week)]} of each month`
    }
  }
  if (
    (rule.frequency === 'weekly' || rule.frequency === 'biweekly') &&
    rule.day_of_week
  ) {
    return `${freq} on ${DAYS[Number(rule.day_of_week)]}`
  }
  if (rule.frequency === 'custom' && rule.interval_days) {
    return `Every ${rule.interval_days} days`
  }
  return freq
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

// ─── Component ──────────────────────────────────────────────────────────

export function RecurringManager() {
  const [view, setView] = useState<'list' | 'create' | 'edit' | 'detail'>(
    'list',
  )
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<TemplateDetail | null>(null)

  const loadTemplates = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/ops/recurring')
      const data = await res.json()
      setTemplates(data.templates || [])
    } catch {
      console.error('Failed to load templates')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTemplates()
  }, [loadTemplates])

  const loadDetail = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/admin/ops/recurring/${id}`)
      const data = await res.json()
      setDetail({
        ...data.template,
        appointments: data.appointments,
        batch_invoices: data.batch_invoices,
      })
    } catch {
      console.error('Failed to load detail')
    }
  }, [])

  const handleOpenDetail = (id: string) => {
    setSelectedId(id)
    setView('detail')
    loadDetail(id)
  }

  const handleBackToList = () => {
    setView('list')
    setDetail(null)
    setSelectedId(null)
    loadTemplates()
  }

  if (view === 'create') {
    return <CreateTemplateForm onBack={handleBackToList} />
  }

  if (view === 'edit' && detail) {
    return (
      <CreateTemplateForm
        initialData={detail}
        onBack={() => {
          setView('detail')
          if (selectedId) loadDetail(selectedId)
        }}
      />
    )
  }

  if (view === 'detail' && detail) {
    return (
      <TemplateDetailView
        template={detail}
        onBack={handleBackToList}
        onRefresh={() => selectedId && loadDetail(selectedId)}
        onEdit={() => setView('edit')}
      />
    )
  }

  return (
    <div className="space-y-6">
      <Card className="border-border/60 bg-card/80 p-6 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold">Recurring Jobs</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Manage recurring job templates. Jobs auto-populate on the schedule
              for the full year.
            </p>
          </div>
          <Button onClick={() => setView('create')} className="gap-2">
            <Plus className="h-4 w-4" />
            New Recurring Job
          </Button>
        </div>
      </Card>

      {loading ? (
        <Card className="border-border/60 bg-card/80 flex items-center justify-center p-12 shadow-sm backdrop-blur">
          <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
        </Card>
      ) : templates.length === 0 ? (
        <Card className="border-border/60 bg-card/80 p-12 text-center shadow-sm backdrop-blur">
          <Calendar className="text-muted-foreground mx-auto mb-3 h-10 w-10" />
          <p className="text-muted-foreground">No recurring templates yet.</p>
          <Button
            onClick={() => setView('create')}
            variant="outline"
            className="mt-4 gap-2"
          >
            <Plus className="h-4 w-4" />
            Create Your First Template
          </Button>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {templates.map((tpl) => {
            const customer = unwrap(tpl.ops_customers)
            const rules = tpl.ops_recurrence_rules || []
            const subtotal = (tpl.line_items || []).reduce(
              (s, l) => s + l.unit_price * l.quantity,
              0,
            )

            return (
              <Card
                key={tpl.id}
                className="border-border/60 bg-card/80 cursor-pointer p-5 shadow-sm backdrop-blur transition-shadow hover:shadow-md"
                onClick={() => handleOpenDetail(tpl.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-semibold">{tpl.label}</h3>
                    {customer && (
                      <p className="text-muted-foreground truncate text-sm">
                        {customer.full_name}
                        {customer.business_name
                          ? ` (${customer.business_name})`
                          : ''}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Badge variant={tpl.is_active ? 'default' : 'secondary'}>
                      {tpl.is_active ? 'Active' : 'Paused'}
                    </Badge>
                    {tpl.invoice_mode === 'batch_monthly' && (
                      <Badge variant="outline">Batch Monthly</Badge>
                    )}
                  </div>
                </div>

                <div className="text-muted-foreground mt-3 space-y-1 text-sm">
                  {rules.map((r, i) => (
                    <p key={i}>{formatFrequency(r)}</p>
                  ))}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                  <span className="font-semibold">
                    {formatCurrency(subtotal)}
                  </span>
                  <span className="text-muted-foreground">per visit</span>
                  <span className="text-muted-foreground">
                    {tpl.generated_count} generated
                  </span>
                  {tpl.next_date && (
                    <span className="text-muted-foreground">
                      Next: {tpl.next_date}
                    </span>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Create / Edit Form ─────────────────────────────────────────────────

function CreateTemplateForm({
  onBack,
  initialData,
}: {
  onBack: () => void
  initialData?: TemplateDetail
}) {
  const isEditing = !!initialData

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [catalog, setCatalog] = useState<ServiceCatalogItem[]>([])
  const [catalogCategories, setCatalogCategories] = useState<string[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string>('')

  const [customerQuery, setCustomerQuery] = useState('')
  const [customerResults, setCustomerResults] = useState<CustomerResult[]>([])
  const [searching, setSearching] = useState(false)

  // When editing, pre-populate the selected customer from initialData
  const [selectedCustomer, setSelectedCustomer] =
    useState<CustomerResult | null>(
      initialData
        ? (() => {
            const c = unwrap(initialData.ops_customers)
            return c
              ? ({
                  id: c.id,
                  full_name: c.full_name,
                  business_name: c.business_name ?? null,
                  phone: c.phone ?? '',
                  email: c.email ?? null,
                  ops_service_addresses: initialData.ops_service_addresses
                    ? Array.isArray(initialData.ops_service_addresses)
                      ? (initialData.ops_service_addresses as CustomerAddress[])
                      : [initialData.ops_service_addresses as CustomerAddress]
                    : [],
                } as CustomerResult)
              : null
          })()
        : null,
    )
  const [selectedAddressId, setSelectedAddressId] = useState<string>(
    initialData?.service_address_id ?? '',
  )

  const [label, setLabel] = useState(initialData?.label ?? '')
  const [startTime, setStartTime] = useState(
    initialData?.start_time?.slice(0, 5) ?? '09:00',
  )
  const [scheduledDuration, setScheduledDuration] = useState(
    String(initialData?.scheduled_duration_minutes ?? 120),
  )
  const [discountAmount, setDiscountAmount] = useState(
    String(initialData?.discount_amount ?? 0),
  )
  const [internalNotes, setInternalNotes] = useState(
    initialData?.internal_notes ?? '',
  )
  const [invoiceMode, setInvoiceMode] = useState<'per_visit' | 'batch_monthly'>(
    (initialData?.invoice_mode as 'per_visit' | 'batch_monthly') ?? 'per_visit',
  )

  const [lineItems, setLineItems] = useState<LineItemForm[]>(
    initialData?.line_items?.length
      ? initialData.line_items.map((l) => ({
          service_catalog_item_id: l.service_catalog_item_id ?? '',
          name_snapshot: l.name_snapshot,
          notes: (l as { notes?: string }).notes ?? '',
          quantity: String(l.quantity),
          unit_price: String(l.unit_price),
          duration_minutes: String(l.duration_minutes),
        }))
      : [
          {
            service_catalog_item_id: '',
            name_snapshot: '',
            notes: '',
            quantity: '1',
            unit_price: '',
            duration_minutes: '60',
          },
        ],
  )

  const [rules, setRules] = useState<RuleForm[]>(
    initialData?.ops_recurrence_rules?.length
      ? initialData.ops_recurrence_rules.map((r) => ({
          frequency: r.frequency as RuleForm['frequency'],
          day_of_week: r.day_of_week != null ? String(r.day_of_week) : '',
          week_of_month: r.week_of_month != null ? String(r.week_of_month) : '',
          day_of_month: r.day_of_month != null ? String(r.day_of_month) : '',
          interval_days: r.interval_days != null ? String(r.interval_days) : '',
          effective_from:
            r.effective_from ?? new Date().toISOString().slice(0, 10),
          effective_until: r.effective_until ?? '',
          override_start_time: r.override_start_time ?? '',
        }))
      : [
          {
            frequency: 'monthly',
            day_of_week: '',
            week_of_month: '',
            day_of_month: '',
            interval_days: '',
            effective_from: new Date().toISOString().slice(0, 10),
            effective_until: '',
            override_start_time: '',
          },
        ],
  )

  const [previewDates, setPreviewDates] = useState<string[]>([])
  const [loadingPreview, setLoadingPreview] = useState(false)

  useEffect(() => {
    fetch('/api/admin/ops/services')
      .then((r) => r.json())
      .then((data) => {
        const items: ServiceCatalogItem[] = data.services || []
        setCatalog(items)
        const cats = [...new Set(items.map((s) => s.category).filter(Boolean))]
        setCatalogCategories(cats)
        if (cats.length > 0) setSelectedCategory(cats[0])
      })
      .catch(() => {
        /* silent */
      })
  }, [])

  const filteredCatalog = selectedCategory
    ? catalog.filter((s) => s.category === selectedCategory)
    : catalog

  useEffect(() => {
    if (!customerQuery.trim() || customerQuery.length < 2) {
      setCustomerResults([])
      return
    }
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(
          `/api/admin/ops/customers?q=${encodeURIComponent(customerQuery)}`,
        )
        const data = await res.json()
        setCustomerResults(data.customers || [])
      } catch {
        /* ignore */
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [customerQuery])

  const handleSelectCustomer = (c: CustomerResult) => {
    setSelectedCustomer(c)
    setCustomerQuery('')
    setCustomerResults([])
    if (c.ops_service_addresses?.length > 0) {
      setSelectedAddressId(c.ops_service_addresses[0].id)
    }
    if (!label && c.business_name) {
      setLabel(c.business_name)
    }
  }

  const handleLineItemChange = (
    idx: number,
    field: keyof LineItemForm,
    value: string,
  ) => {
    setLineItems((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item)),
    )
  }

  const handleServiceSelect = (idx: number, serviceId: string) => {
    const service = catalog.find((s) => s.id === serviceId)
    setLineItems((prev) =>
      prev.map((item, i) =>
        i !== idx
          ? item
          : {
              ...item,
              service_catalog_item_id: serviceId,
              name_snapshot: service?.name || item.name_snapshot,
              unit_price:
                service?.base_price != null
                  ? String(service.base_price)
                  : item.unit_price,
              duration_minutes:
                service?.default_duration_minutes != null
                  ? String(service.default_duration_minutes)
                  : item.duration_minutes,
            },
      ),
    )
  }

  const loadPreview = async () => {
    setLoadingPreview(true)
    try {
      const rulesPayload = rules.map((r) => ({
        frequency: r.frequency,
        day_of_week: r.day_of_week ? Number(r.day_of_week) : null,
        week_of_month: r.week_of_month ? Number(r.week_of_month) : null,
        day_of_month: r.day_of_month ? Number(r.day_of_month) : null,
        interval_days: r.interval_days ? Number(r.interval_days) : null,
        effective_from:
          r.effective_from || new Date().toISOString().slice(0, 10),
        effective_until: r.effective_until || null,
        override_start_time: r.override_start_time || null,
      }))

      const res = await fetch('/api/admin/ops/recurring', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preview_only: true, rules: rulesPayload }),
      })
      const data = await res.json()
      setPreviewDates(data.preview_dates || [])
    } catch {
      /* ignore */
    } finally {
      setLoadingPreview(false)
    }
  }

  const handleRuleChange = (
    idx: number,
    field: keyof RuleForm,
    value: string,
  ) => {
    setRules((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)),
    )
  }

  const subtotal = lineItems.reduce(
    (s, l) => s + (Number(l.unit_price) || 0) * (Number(l.quantity) || 0),
    0,
  )

  const handleSave = async () => {
    if (!selectedCustomer || !selectedAddressId || !label.trim()) {
      setError('Customer, address, and label are required')
      return
    }
    if (lineItems.length === 0 || !lineItems[0].name_snapshot) {
      setError('At least one line item with a name is required')
      return
    }
    if (rules.length === 0) {
      setError('At least one recurrence rule is required')
      return
    }

    setSaving(true)
    setError(null)

    const templatePayload = {
      label: label.trim(),
      line_items: lineItems.map((l) => ({
        name_snapshot: l.name_snapshot,
        notes: l.notes || null,
        quantity: Number(l.quantity) || 1,
        unit_price: Number(l.unit_price) || 0,
        duration_minutes: Number(l.duration_minutes) || 60,
        service_catalog_item_id: l.service_catalog_item_id || null,
      })),
      start_time: startTime,
      scheduled_duration_minutes: Number(scheduledDuration) || 120,
      discount_amount: Number(discountAmount) || 0,
      internal_notes: internalNotes || null,
      invoice_mode: invoiceMode,
    }

    const rulesPayload = rules.map((r) => ({
      frequency: r.frequency,
      day_of_week: r.day_of_week ? Number(r.day_of_week) : null,
      week_of_month: r.week_of_month ? Number(r.week_of_month) : null,
      day_of_month: r.day_of_month ? Number(r.day_of_month) : null,
      interval_days: r.interval_days ? Number(r.interval_days) : null,
      effective_from: r.effective_from || new Date().toISOString().slice(0, 10),
      effective_until: r.effective_until || null,
      override_start_time: r.override_start_time || null,
    }))

    try {
      if (isEditing && initialData) {
        // Ask whether to cascade changes to existing future jobs
        const updateFuture = confirm(
          'Update all future unstarted jobs with the new schedule and pricing? Click OK to update them, Cancel to save the template only.',
        )

        const res = await fetch(`/api/admin/ops/recurring/${initialData.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            template: templatePayload,
            rules: rulesPayload,
            update_future: updateFuture,
          }),
        })

        if (!res.ok) {
          const data = await res.json()
          setError(data.error || 'Failed to save')
          return
        }

        onBack()
      } else {
        const res = await fetch('/api/admin/ops/recurring', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            template: {
              customer_id: selectedCustomer.id,
              service_address_id: selectedAddressId,
              ...templatePayload,
            },
            rules: rulesPayload,
            generate: true,
          }),
        })

        if (!res.ok) {
          const data = await res.json()
          setError(data.error || 'Failed to create')
          return
        }

        const data = await res.json()
        if (data.generation) {
          alert(
            `Template created! Generated ${data.generation.created} appointments (${data.generation.skipped} skipped).`,
          )
        }

        onBack()
      }
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card className="border-border/60 bg-card/80 p-6 shadow-sm backdrop-blur">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div>
            <h2 className="text-2xl font-semibold">
              {isEditing ? 'Edit Recurring Job' : 'New Recurring Job'}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {isEditing
                ? 'Update the template, schedule, and pricing. You can choose whether to apply changes to existing future jobs.'
                : 'Define the template, set the schedule, and generate the full year of appointments.'}
            </p>
          </div>
        </div>
      </Card>

      {error && (
        <Card className="border-destructive bg-destructive/10 p-4 shadow-sm">
          <p className="text-destructive text-sm font-medium">{error}</p>
        </Card>
      )}

      {/* Customer */}
      <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
        <h3 className="text-lg font-semibold">Customer</h3>
        {selectedCustomer ? (
          <div className="mt-3 flex items-center justify-between rounded-xl border p-3">
            <div>
              <p className="font-medium">{selectedCustomer.full_name}</p>
              {selectedCustomer.business_name && (
                <p className="text-muted-foreground text-sm">
                  {selectedCustomer.business_name}
                </p>
              )}
              <p className="text-muted-foreground text-sm">
                {selectedCustomer.phone}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setSelectedCustomer(null)
                setSelectedAddressId('')
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="relative mt-3">
            <Search className="text-muted-foreground absolute top-2.5 left-3 h-4 w-4" />
            <Input
              placeholder="Search customers by name or phone..."
              value={customerQuery}
              onChange={(e) => setCustomerQuery(e.target.value)}
              className="pl-9"
            />
            {searching && (
              <Loader2 className="absolute top-2.5 right-3 h-4 w-4 animate-spin" />
            )}
            {customerResults.length > 0 && (
              <div className="bg-popover absolute z-10 mt-1 w-full rounded-xl border p-1 shadow-lg">
                {customerResults.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="hover:bg-accent flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm"
                    onClick={() => handleSelectCustomer(c)}
                  >
                    <div>
                      <p className="font-medium">{c.full_name}</p>
                      {c.business_name && (
                        <p className="text-muted-foreground text-xs">
                          {c.business_name}
                        </p>
                      )}
                    </div>
                    <span className="text-muted-foreground ml-auto text-xs">
                      {c.phone}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {selectedCustomer &&
          selectedCustomer.ops_service_addresses?.length > 0 && (
            <div className="mt-3">
              <Label>Service Address</Label>
              <select
                className="border-input bg-background mt-1 h-10 w-full rounded-md border px-3 text-sm"
                value={selectedAddressId}
                onChange={(e) => setSelectedAddressId(e.target.value)}
              >
                {selectedCustomer.ops_service_addresses.map((addr) => (
                  <option key={addr.id} value={addr.id}>
                    {addr.street_1}, {addr.city}, {addr.state} {addr.zip_code}
                  </option>
                ))}
              </select>
            </div>
          )}
      </Card>

      {/* Template Info */}
      <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
        <h3 className="text-lg font-semibold">Template Details</h3>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <Label>Label *</Label>
            <Input
              placeholder="e.g., RV - A Building Common Areas"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label>Invoice Mode</Label>
            <select
              className="border-input bg-background mt-1 h-10 w-full rounded-md border px-3 text-sm"
              value={invoiceMode}
              onChange={(e) =>
                setInvoiceMode(e.target.value as 'per_visit' | 'batch_monthly')
              }
            >
              <option value="per_visit">
                Per Visit (individual invoice each job)
              </option>
              <option value="batch_monthly">
                Batch Monthly (one consolidated invoice)
              </option>
            </select>
          </div>
          <div>
            <Label>Default Start Time</Label>
            <Input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label>Scheduled Duration (minutes)</Label>
            <Input
              type="number"
              value={scheduledDuration}
              onChange={(e) => setScheduledDuration(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label>Discount ($)</Label>
            <Input
              type="number"
              step="0.01"
              value={discountAmount}
              onChange={(e) => setDiscountAmount(e.target.value)}
              className="mt-1"
            />
          </div>
        </div>
        <div className="mt-4">
          <Label>Internal Notes</Label>
          <textarea
            className="border-input bg-background mt-1 min-h-[60px] w-full rounded-md border px-3 py-2 text-sm"
            value={internalNotes}
            onChange={(e) => setInternalNotes(e.target.value)}
            placeholder="Notes visible only to staff..."
          />
        </div>
      </Card>

      {/* Line Items */}
      <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Line Items</h3>
            <p className="text-muted-foreground mt-0.5 text-sm">
              Pick from your service catalog. Price and duration auto-fill;
              override as needed.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setLineItems((prev) => [
                ...prev,
                {
                  service_catalog_item_id: '',
                  name_snapshot: '',
                  notes: '',
                  quantity: '1',
                  unit_price: '',
                  duration_minutes: '60',
                },
              ])
            }
          >
            <Plus className="mr-1 h-4 w-4" />
            Add Line
          </Button>
        </div>

        {/* Category filter */}
        {catalogCategories.length > 0 && (
          <div className="mt-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedCategory('')}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  selectedCategory === ''
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border hover:bg-accent'
                }`}
              >
                All
              </button>
              {catalogCategories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    selectedCategory === cat
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border hover:bg-accent'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 space-y-3">
          {lineItems.map((item, idx) => (
            <div key={idx} className="rounded-xl border p-4">
              {/* Service picker */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label>Service</Label>
                  <select
                    className="border-input bg-background mt-1 h-10 w-full rounded-md border px-3 text-sm"
                    value={item.service_catalog_item_id}
                    onChange={(e) => handleServiceSelect(idx, e.target.value)}
                  >
                    <option value="">— Pick from catalog —</option>
                    {filteredCatalog.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {s.base_price != null ? ` — $${s.base_price}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Editable fields (pre-filled from catalog, overridable) */}
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="sm:col-span-2">
                  <Label className="text-xs">
                    Display Name{' '}
                    <span className="text-muted-foreground">(override)</span>
                  </Label>
                  <Input
                    value={item.name_snapshot}
                    onChange={(e) =>
                      handleLineItemChange(idx, 'name_snapshot', e.target.value)
                    }
                    placeholder="Auto-filled from service — edit to add detail"
                    className="mt-1 text-sm"
                  />
                  <textarea
                    value={item.notes}
                    onChange={(e) =>
                      handleLineItemChange(idx, 'notes', e.target.value)
                    }
                    placeholder="Location / description notes (e.g. Building A, 2nd floor hallway)"
                    rows={2}
                    className="border-input bg-background placeholder:text-muted-foreground focus:ring-ring mt-1.5 w-full resize-none rounded-md border px-3 py-2 text-sm leading-snug focus:ring-2 focus:outline-none"
                  />
                </div>
                <div>
                  <Label className="text-xs">Qty</Label>
                  <Input
                    type="number"
                    value={item.quantity}
                    onChange={(e) =>
                      handleLineItemChange(idx, 'quantity', e.target.value)
                    }
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Unit Price ($)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={item.unit_price}
                    onChange={(e) =>
                      handleLineItemChange(idx, 'unit_price', e.target.value)
                    }
                    className="mt-1"
                  />
                </div>
              </div>

              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Label className="text-muted-foreground text-xs">
                    Duration (min):
                  </Label>
                  <Input
                    type="number"
                    value={item.duration_minutes}
                    onChange={(e) =>
                      handleLineItemChange(
                        idx,
                        'duration_minutes',
                        e.target.value,
                      )
                    }
                    className="h-7 w-20 text-xs"
                  />
                  {item.unit_price && item.quantity && (
                    <span className="text-muted-foreground text-xs">
                      Line total:{' '}
                      <span className="text-foreground font-semibold">
                        {formatCurrency(
                          (Number(item.unit_price) || 0) *
                            (Number(item.quantity) || 0),
                        )}
                      </span>
                    </span>
                  )}
                </div>
                {lineItems.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setLineItems((prev) => prev.filter((_, i) => i !== idx))
                    }
                  >
                    <Trash2 className="mr-1 h-4 w-4" />
                    Remove
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-xl border p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Subtotal per visit</span>
            <span className="text-lg font-bold">
              {formatCurrency(subtotal)}
            </span>
          </div>
          {Number(discountAmount) > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">After discount</span>
              <span className="font-semibold">
                {formatCurrency(Math.max(0, subtotal - Number(discountAmount)))}
              </span>
            </div>
          )}
        </div>
      </Card>

      {/* Recurrence Rules */}
      <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Schedule Rules</h3>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setRules((prev) => [
                ...prev,
                {
                  frequency: 'monthly',
                  day_of_week: '',
                  week_of_month: '',
                  day_of_month: '',
                  interval_days: '',
                  effective_from: new Date().toISOString().slice(0, 10),
                  effective_until: '',
                  override_start_time: '',
                },
              ])
            }
          >
            <Plus className="mr-1 h-4 w-4" />
            Add Rule
          </Button>
        </div>

        <div className="mt-4 space-y-4">
          {rules.map((rule, idx) => (
            <div key={idx} className="rounded-xl border p-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <Label>Frequency</Label>
                  <select
                    className="border-input bg-background mt-1 h-10 w-full rounded-md border px-3 text-sm"
                    value={rule.frequency}
                    onChange={(e) =>
                      handleRuleChange(idx, 'frequency', e.target.value)
                    }
                  >
                    {FREQUENCIES.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>

                {(rule.frequency === 'weekly' ||
                  rule.frequency === 'biweekly') && (
                  <div>
                    <Label>Day of Week</Label>
                    <select
                      className="border-input bg-background mt-1 h-10 w-full rounded-md border px-3 text-sm"
                      value={rule.day_of_week}
                      onChange={(e) =>
                        handleRuleChange(idx, 'day_of_week', e.target.value)
                      }
                    >
                      <option value="">Select day</option>
                      {DAYS.map((d, i) => (
                        <option key={i} value={String(i)}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {rule.frequency === 'monthly' && (
                  <>
                    <div>
                      <Label>Day of Week</Label>
                      <select
                        className="border-input bg-background mt-1 h-10 w-full rounded-md border px-3 text-sm"
                        value={rule.day_of_week}
                        onChange={(e) =>
                          handleRuleChange(idx, 'day_of_week', e.target.value)
                        }
                      >
                        <option value="">Use day of month instead</option>
                        {DAYS.map((d, i) => (
                          <option key={i} value={String(i)}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </div>
                    {rule.day_of_week ? (
                      <div>
                        <Label>Week of Month</Label>
                        <select
                          className="border-input bg-background mt-1 h-10 w-full rounded-md border px-3 text-sm"
                          value={rule.week_of_month}
                          onChange={(e) =>
                            handleRuleChange(
                              idx,
                              'week_of_month',
                              e.target.value,
                            )
                          }
                        >
                          <option value="">Select week</option>
                          {[1, 2, 3, 4, 5].map((w) => (
                            <option key={w} value={String(w)}>
                              {ordinal(w)} week
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div>
                        <Label>Day of Month</Label>
                        <Input
                          type="number"
                          min={1}
                          max={31}
                          value={rule.day_of_month}
                          onChange={(e) =>
                            handleRuleChange(
                              idx,
                              'day_of_month',
                              e.target.value,
                            )
                          }
                          className="mt-1"
                          placeholder="e.g., 15"
                        />
                      </div>
                    )}
                  </>
                )}

                {rule.frequency === 'custom' && (
                  <div>
                    <Label>Every N Days</Label>
                    <Input
                      type="number"
                      min={1}
                      value={rule.interval_days}
                      onChange={(e) =>
                        handleRuleChange(idx, 'interval_days', e.target.value)
                      }
                      className="mt-1"
                      placeholder="e.g., 14"
                    />
                  </div>
                )}

                <div>
                  <Label>Starts</Label>
                  <Input
                    type="date"
                    value={rule.effective_from}
                    onChange={(e) =>
                      handleRuleChange(idx, 'effective_from', e.target.value)
                    }
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Ends (optional)</Label>
                  <Input
                    type="date"
                    value={rule.effective_until}
                    onChange={(e) =>
                      handleRuleChange(idx, 'effective_until', e.target.value)
                    }
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Override Start Time</Label>
                  <Input
                    type="time"
                    value={rule.override_start_time}
                    onChange={(e) =>
                      handleRuleChange(
                        idx,
                        'override_start_time',
                        e.target.value,
                      )
                    }
                    className="mt-1"
                    placeholder="Use template default"
                  />
                </div>
              </div>

              {rules.length > 1 && (
                <div className="mt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setRules((prev) => prev.filter((_, i) => i !== idx))
                    }
                  >
                    <Trash2 className="mr-1 h-4 w-4" />
                    Remove Rule
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={loadPreview}
            disabled={loadingPreview}
          >
            {loadingPreview ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Calendar className="mr-2 h-4 w-4" />
            )}
            Preview Dates
          </Button>

          {previewDates.length > 0 && (
            <div className="mt-3 rounded-xl border p-3">
              <p className="text-sm font-medium">
                Next {previewDates.length} dates:
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {previewDates.map((d) => (
                  <Badge key={d} variant="outline">
                    {new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Save */}
      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={onBack}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isEditing ? 'Save Changes' : 'Create & Generate Jobs'}
        </Button>
      </div>
    </div>
  )
}

// ─── Detail View ────────────────────────────────────────────────────────

function TemplateDetailView({
  template,
  onBack,
  onRefresh,
  onEdit,
}: {
  template: TemplateDetail
  onBack: () => void
  onRefresh: () => void
  onEdit: () => void
}) {
  const [acting, setActing] = useState(false)
  const [batchMonth, setBatchMonth] = useState(
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`,
  )

  const customer = unwrap(template.ops_customers)
  const address = unwrap(template.ops_service_addresses)
  const rules = template.ops_recurrence_rules || []

  const subtotal = (template.line_items || []).reduce(
    (s, l) => s + l.unit_price * l.quantity,
    0,
  )

  const handleToggle = async () => {
    setActing(true)
    await fetch(`/api/admin/ops/recurring/${template.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template: { is_active: !template.is_active } }),
    })
    onRefresh()
    setActing(false)
  }

  const handleRegenerate = async () => {
    if (
      !confirm(
        'This will delete all future unstarted jobs and regenerate them. Continue?',
      )
    )
      return
    setActing(true)
    await fetch(`/api/admin/ops/recurring/${template.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'generate' }),
    })
    onRefresh()
    setActing(false)
  }

  const handleDelete = async () => {
    if (
      !confirm(
        'Delete this template? Existing appointments will remain on the calendar.',
      )
    )
      return
    setActing(true)
    await fetch(`/api/admin/ops/recurring/${template.id}`, { method: 'DELETE' })
    onBack()
  }

  const handleBatchInvoice = async () => {
    setActing(true)
    try {
      const res = await fetch(`/api/admin/ops/recurring/${template.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'batch-invoice', month: batchMonth }),
      })
      const data = await res.json()
      if (data.error) {
        alert(data.error)
      } else {
        alert(
          `Batch invoice created! ${data.result.appointmentCount} visits, total ${formatCurrency(data.result.total)}`,
        )
        onRefresh()
      }
    } catch {
      alert('Failed to create batch invoice')
    } finally {
      setActing(false)
    }
  }

  const today = new Date().toISOString().slice(0, 10)
  const pastAppts = template.appointments.filter(
    (a) => a.appointment_date < today,
  )
  const futureAppts = template.appointments.filter(
    (a) => a.appointment_date >= today,
  )

  return (
    <div className="space-y-6">
      <Card className="border-border/60 bg-card/80 p-6 shadow-sm backdrop-blur">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-semibold">{template.label}</h2>
            {customer && (
              <p className="text-muted-foreground text-sm">
                {customer.full_name}
                {customer.business_name ? ` (${customer.business_name})` : ''}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Badge variant={template.is_active ? 'default' : 'secondary'}>
              {template.is_active ? 'Active' : 'Paused'}
            </Badge>
            {template.invoice_mode === 'batch_monthly' && (
              <Badge variant="outline">Batch Monthly</Badge>
            )}
          </div>
        </div>
      </Card>

      {/* Info */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
          <h3 className="font-semibold">Schedule</h3>
          <div className="text-muted-foreground mt-2 space-y-1 text-sm">
            {rules.map((r, i) => (
              <p key={i}>{formatFrequency(r)}</p>
            ))}
            <p>Start time: {template.start_time?.slice(0, 5)}</p>
            <p>Duration: {template.scheduled_duration_minutes} min</p>
          </div>
        </Card>

        <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
          <h3 className="font-semibold">Pricing</h3>
          <div className="mt-2 space-y-1 text-sm">
            {(template.line_items || []).map((l, i) => (
              <div key={i} className="flex justify-between">
                <span className="text-muted-foreground truncate">
                  {l.name_snapshot}
                </span>
                <span className="shrink-0 font-medium">
                  {l.quantity} x {formatCurrency(l.unit_price)}
                </span>
              </div>
            ))}
            <div className="flex justify-between border-t pt-1 font-semibold">
              <span>Total per visit</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
          </div>
        </Card>
      </div>

      {address && (
        <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
          <h3 className="font-semibold">Address</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            {address.street_1}, {address.city}, {address.state}{' '}
            {address.zip_code}
          </p>
        </Card>
      )}

      {/* Actions */}
      <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
        <h3 className="font-semibold">Actions</h3>
        <div className="mt-3 flex flex-wrap gap-3">
          <Button onClick={onEdit} disabled={acting}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit Template
          </Button>
          <Button variant="outline" onClick={handleToggle} disabled={acting}>
            {template.is_active ? (
              <Pause className="mr-2 h-4 w-4" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            {template.is_active ? 'Pause' : 'Resume'}
          </Button>
          <Button
            variant="outline"
            onClick={handleRegenerate}
            disabled={acting}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Regenerate Future Jobs
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={acting}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete Template
          </Button>
        </div>

        {template.invoice_mode === 'batch_monthly' && (
          <div className="mt-4 rounded-xl border p-4">
            <h4 className="font-medium">Generate Monthly Invoice</h4>
            <p className="text-muted-foreground mt-1 text-sm">
              Consolidate all completed visits for a month into one invoice for
              QuickBooks.
            </p>
            <div className="mt-3 flex items-end gap-3">
              <div>
                <Label>Month</Label>
                <Input
                  type="month"
                  value={batchMonth.slice(0, 7)}
                  onChange={(e) => setBatchMonth(e.target.value + '-01')}
                  className="mt-1"
                />
              </div>
              <Button onClick={handleBatchInvoice} disabled={acting}>
                <Receipt className="mr-2 h-4 w-4" />
                Generate Invoice
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Batch invoices */}
      {template.batch_invoices.length > 0 && (
        <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
          <h3 className="font-semibold">Batch Invoices</h3>
          <div className="mt-3 space-y-2">
            {template.batch_invoices.map((bi) => (
              <div
                key={bi.id}
                className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
              >
                <span>
                  {new Date(bi.month + 'T12:00:00').toLocaleDateString(
                    'en-US',
                    { month: 'long', year: 'numeric' },
                  )}
                </span>
                <div className="flex items-center gap-3">
                  <Badge variant={bi.status === 'paid' ? 'default' : 'outline'}>
                    {bi.status}
                  </Badge>
                  <span className="font-semibold">
                    {formatCurrency(bi.total)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Appointments timeline */}
      <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
        <h3 className="font-semibold">
          Generated Appointments ({template.appointments.length})
        </h3>

        {futureAppts.length > 0 && (
          <div className="mt-3">
            <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wider uppercase">
              Upcoming
            </p>
            <div className="space-y-1">
              {futureAppts.slice(0, 20).map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
                >
                  <span>
                    {new Date(
                      a.appointment_date + 'T12:00:00',
                    ).toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}{' '}
                    {a.start_time?.slice(0, 5)}
                  </span>
                  <div className="flex items-center gap-3">
                    <Badge variant="outline">{a.status}</Badge>
                    <span className="font-medium">
                      {formatCurrency(a.quoted_total)}
                    </span>
                  </div>
                </div>
              ))}
              {futureAppts.length > 20 && (
                <p className="text-muted-foreground text-center text-xs">
                  + {futureAppts.length - 20} more
                </p>
              )}
            </div>
          </div>
        )}

        {pastAppts.length > 0 && (
          <div className="mt-4">
            <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wider uppercase">
              Past ({pastAppts.length})
            </p>
            <div className="space-y-1">
              {pastAppts.slice(-5).map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm opacity-60"
                >
                  <span>
                    {new Date(
                      a.appointment_date + 'T12:00:00',
                    ).toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                  <Badge variant="secondary">{a.status}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
