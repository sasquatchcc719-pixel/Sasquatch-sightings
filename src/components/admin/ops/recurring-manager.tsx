'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Calendar,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  Receipt,
  RefreshCw,
  Repeat,
  Search,
  Trash2,
  Truck,
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

type VisitLineItem = {
  id: string
  service_catalog_item_id?: string | null
  name_snapshot: string
  quantity: number
  unit_price: number
  duration_minutes: number
  line_total: number
  notes?: string | null
}

type VisitAppointment = {
  id: string
  appointment_date: string
  start_time: string
  end_time: string
  status: string
  quoted_total: number
  on_my_way_at?: string | null
  completed_at?: string | null
  internal_notes?: string | null
  ops_appointment_line_items: VisitLineItem[]
  ops_invoices?: { id: string }[] | null
}

type TemplateDetail = Template & {
  appointments: VisitAppointment[]
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

                {/* Line items preview */}
                {(tpl.line_items || []).length > 0 && (
                  <div className="mt-3 space-y-1 border-t pt-3">
                    {(tpl.line_items || []).map((l, i) => (
                      <div
                        key={i}
                        className="flex items-start justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <span className="font-medium">{l.name_snapshot}</span>
                          {l.notes && (
                            <span className="text-muted-foreground ml-1">
                              — {l.notes}
                            </span>
                          )}
                        </div>
                        <span className="text-muted-foreground shrink-0 tabular-nums">
                          {l.quantity > 1 ? `${l.quantity} × ` : ''}
                          {formatCurrency(l.unit_price)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

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

      <MonthEndBillingSection />
    </div>
  )
}

// ─── Month-End Billing Section ──────────────────────────────────────────

type BillingLineItem = {
  id?: string
  name_snapshot: string
  quantity: number
  unit_price: number
  duration_minutes: number
  line_total: number
  notes: string | null
}

type BillingVisit = {
  appointmentId: string
  date: string
  status: string
  total: number
  templateLabel: string
  description: string
  isAdHoc?: boolean
  lineItems: BillingLineItem[]
}

type BillingAddress = {
  id: string
  label: string | null
  street_1: string
  city: string
  state: string
  zip_code: string
}

type BillingCustomer = {
  customerId: string
  customerName: string
  businessName: string | null
  addresses: BillingAddress[]
  visits: BillingVisit[]
  totalVisits: number
  completedVisits: number
  runningTotal: number
  existingInvoice: {
    id: string
    status: string
    total: number
  } | null
}

type AddJobForm = {
  customerId: string
  addressId: string
  date: string
  startTime: string
  serviceCatalogItemId: string
  description: string
  quantity: string
  unitPrice: string
  durationMinutes: string
}

const emptyAddJob: AddJobForm = {
  customerId: '',
  addressId: '',
  date: '',
  startTime: '08:00',
  serviceCatalogItemId: '',
  description: '',
  quantity: '1',
  unitPrice: '',
  durationMinutes: '60',
}

function MonthEndBillingSection() {
  const now = new Date()
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [month, setMonth] = useState(defaultMonth)
  const [customers, setCustomers] = useState<BillingCustomer[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState<string | null>(null)
  const [addingFor, setAddingFor] = useState<string | null>(null)
  const [addForm, setAddForm] = useState<AddJobForm>(emptyAddJob)
  const [savingJob, setSavingJob] = useState(false)

  // Service catalog for one-off job form
  const [addJobCatalog, setAddJobCatalog] = useState<ServiceCatalogItem[]>([])
  const [addJobCategories, setAddJobCategories] = useState<string[]>([])
  const [addJobCategory, setAddJobCategory] = useState<string>('')

  // Expandable visit editing state
  const [expandedVisit, setExpandedVisit] = useState<string | null>(null)
  const [editLines, setEditLines] = useState<BillingLineItem[]>([])
  const [savingVisit, setSavingVisit] = useState(false)

  const load = useCallback(async (m: string) => {
    setLoading(true)
    try {
      const res = await fetch(
        `/api/admin/ops/recurring/billing-summary?month=${m}`,
      )
      const data = await res.json()
      setCustomers(data.customers || [])
    } catch {
      console.error('Failed to load billing summary')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(month)
  }, [load, month])

  useEffect(() => {
    fetch('/api/admin/ops/services')
      .then((r) => r.json())
      .then((data) => {
        const items: ServiceCatalogItem[] = data.services || []
        setAddJobCatalog(items)
        const cats = [
          ...new Set(items.map((s) => s.category).filter(Boolean)),
        ] as string[]
        setAddJobCategories(cats)
        if (cats.length > 0) setAddJobCategory(cats[0])
      })
      .catch(() => {
        /* silent */
      })
  }, [])

  const handleGenerate = async (customerId: string) => {
    setGenerating(customerId)
    try {
      const res = await fetch(
        '/api/admin/ops/recurring/generate-monthly-invoice',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customerId, month: `${month}-01` }),
        },
      )
      const data = await res.json()
      if (data.error) {
        alert(data.error)
      } else {
        load(month)
      }
    } catch {
      alert('Failed to generate invoice')
    } finally {
      setGenerating(null)
    }
  }

  const openAddForm = (entry: BillingCustomer) => {
    setAddingFor(entry.customerId)
    setAddForm({
      ...emptyAddJob,
      customerId: entry.customerId,
      addressId: entry.addresses[0]?.id || '',
    })
  }

  const handleSaveJob = async () => {
    if (
      !addForm.date ||
      (!addForm.serviceCatalogItemId && !addForm.description) ||
      !addForm.unitPrice
    ) {
      alert('Please fill in date, a service (or description), and price.')
      return
    }
    const selectedService = addJobCatalog.find(
      (s) => s.id === addForm.serviceCatalogItemId,
    )
    const nameSnapshot = selectedService?.name || addForm.description
    setSavingJob(true)
    try {
      const res = await fetch('/api/admin/ops/recurring/add-batch-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: addForm.customerId,
          serviceAddressId: addForm.addressId,
          appointmentDate: addForm.date,
          startTime: addForm.startTime,
          lineItems: [
            {
              service_catalog_item_id: addForm.serviceCatalogItemId || null,
              name_snapshot: nameSnapshot,
              notes: addForm.description || null,
              quantity: Number(addForm.quantity) || 1,
              unit_price: Number(addForm.unitPrice) || 0,
              duration_minutes: Number(addForm.durationMinutes) || 60,
            },
          ],
        }),
      })
      const data = await res.json()
      if (data.error) {
        alert(data.error)
      } else {
        setAddingFor(null)
        setAddForm(emptyAddJob)
        load(month)
      }
    } catch {
      alert('Failed to create job')
    } finally {
      setSavingJob(false)
    }
  }

  const toggleVisit = (visit: BillingVisit) => {
    if (expandedVisit === visit.appointmentId) {
      setExpandedVisit(null)
      setEditLines([])
    } else {
      setExpandedVisit(visit.appointmentId)
      setEditLines(visit.lineItems.map((li) => ({ ...li })))
    }
  }

  const updateLine = (
    index: number,
    field: keyof BillingLineItem,
    raw: string,
  ) => {
    setEditLines((prev) => {
      const next = [...prev]
      const line = { ...next[index] }

      if (field === 'name_snapshot' || field === 'notes') {
        ;(line as Record<string, unknown>)[field] = raw
      } else if (
        field === 'quantity' ||
        field === 'unit_price' ||
        field === 'duration_minutes'
      ) {
        ;(line as Record<string, unknown>)[field] = Number(raw) || 0
      }

      line.line_total =
        Math.round(Number(line.quantity) * Number(line.unit_price) * 100) / 100
      next[index] = line
      return next
    })
  }

  const addLine = () => {
    setEditLines((prev) => [
      ...prev,
      {
        name_snapshot: '',
        quantity: 1,
        unit_price: 0,
        duration_minutes: 0,
        line_total: 0,
        notes: null,
      },
    ])
  }

  const removeLine = (index: number) => {
    setEditLines((prev) => prev.filter((_, i) => i !== index))
  }

  const saveVisitLines = async (appointmentId: string) => {
    setSavingVisit(true)
    try {
      const res = await fetch(`/api/admin/ops/appointments/${appointmentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          line_items: editLines.map((li) => ({
            name_snapshot: li.name_snapshot,
            quantity: li.quantity,
            unit_price: li.unit_price,
            duration_minutes: li.duration_minutes,
            notes: li.notes || null,
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error || 'Failed to save line items')
      } else {
        setExpandedVisit(null)
        setEditLines([])
        load(month)
      }
    } catch {
      alert('Failed to save line items')
    } finally {
      setSavingVisit(false)
    }
  }

  const editLinesTotal =
    Math.round(editLines.reduce((s, li) => s + li.line_total, 0) * 100) / 100

  const monthLabel = new Date(`${month}-15`).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })

  if (!loading && customers.length === 0) return null

  return (
    <div className="space-y-4">
      <Card className="border-border/60 bg-card/80 p-6 shadow-sm backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold">Month-End Billing</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Completed visits gather here. Generate one invoice per customer to
              send to QuickBooks.
            </p>
          </div>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
          />
        </div>
      </Card>

      {loading ? (
        <Card className="border-border/60 bg-card/80 flex items-center justify-center p-12 shadow-sm backdrop-blur">
          <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
        </Card>
      ) : (
        customers.map((entry) => {
          const isGenerating = generating === entry.customerId
          const hasInvoice = !!entry.existingInvoice
          const canGenerate = entry.completedVisits > 0 && !hasInvoice
          const isAdding = addingFor === entry.customerId

          return (
            <Card
              key={entry.customerId}
              className="border-border/60 bg-card/80 overflow-hidden shadow-sm backdrop-blur"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b px-5 py-4">
                <div>
                  <h3 className="text-lg font-semibold">
                    {monthLabel} — {entry.businessName || entry.customerName}
                  </h3>
                  {entry.businessName && (
                    <p className="text-muted-foreground text-sm">
                      {entry.customerName}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {hasInvoice && (
                    <Badge
                      variant={
                        entry.existingInvoice!.status === 'paid'
                          ? 'default'
                          : 'outline'
                      }
                      className="text-sm"
                    >
                      {entry.existingInvoice!.status === 'paid'
                        ? 'PAID'
                        : entry.existingInvoice!.status === 'sent'
                          ? 'SENT TO QB'
                          : entry.existingInvoice!.status.toUpperCase()}
                    </Badge>
                  )}
                  {!hasInvoice && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        isAdding ? setAddingFor(null) : openAddForm(entry)
                      }
                      className="gap-1.5"
                    >
                      {isAdding ? (
                        <X className="h-3.5 w-3.5" />
                      ) : (
                        <Plus className="h-3.5 w-3.5" />
                      )}
                      {isAdding ? 'Cancel' : 'Add Job'}
                    </Button>
                  )}
                </div>
              </div>

              {/* Inline add-job form */}
              {isAdding &&
                (() => {
                  const filteredAddCatalog = addJobCategory
                    ? addJobCatalog.filter((s) => s.category === addJobCategory)
                    : addJobCatalog
                  const addJobSubtotal =
                    (Number(addForm.unitPrice) || 0) *
                    (Number(addForm.quantity) || 1)
                  return (
                    <div className="space-y-3 border-b bg-blue-500/5 px-5 py-4">
                      <p className="text-sm font-medium">
                        Add one-off job to {monthLabel} invoice
                      </p>

                      {/* Date & Time */}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs">Date</Label>
                          <Input
                            type="date"
                            value={addForm.date}
                            onChange={(e) =>
                              setAddForm((f) => ({
                                ...f,
                                date: e.target.value,
                              }))
                            }
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Start Time</Label>
                          <Input
                            type="time"
                            value={addForm.startTime}
                            onChange={(e) =>
                              setAddForm((f) => ({
                                ...f,
                                startTime: e.target.value,
                              }))
                            }
                            className="mt-1"
                          />
                        </div>
                      </div>

                      {/* Service catalog picker */}
                      <div>
                        <Label className="text-xs">Service</Label>
                        {addJobCategories.length > 1 && (
                          <div className="mt-1 mb-1 flex flex-wrap gap-1">
                            {addJobCategories.map((cat) => (
                              <button
                                key={cat}
                                type="button"
                                onClick={() => setAddJobCategory(cat)}
                                className={`rounded border px-2 py-0.5 text-xs capitalize transition ${
                                  addJobCategory === cat
                                    ? 'border-blue-500 bg-blue-500 text-white'
                                    : 'border-input bg-background text-muted-foreground hover:border-blue-400'
                                }`}
                              >
                                {cat}
                              </button>
                            ))}
                          </div>
                        )}
                        <select
                          value={addForm.serviceCatalogItemId}
                          onChange={(e) => {
                            const serviceId = e.target.value
                            const service = addJobCatalog.find(
                              (s) => s.id === serviceId,
                            )
                            setAddForm((f) => ({
                              ...f,
                              serviceCatalogItemId: serviceId,
                              unitPrice:
                                service?.base_price != null
                                  ? String(service.base_price)
                                  : f.unitPrice,
                              durationMinutes:
                                service?.default_duration_minutes != null
                                  ? String(service.default_duration_minutes)
                                  : f.durationMinutes,
                            }))
                          }}
                          className="border-input bg-background mt-1 h-9 w-full rounded-md border px-3 text-sm"
                        >
                          <option value="">— Pick from catalog —</option>
                          {filteredAddCatalog.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                              {s.base_price != null
                                ? ` — $${s.base_price}`
                                : ''}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Notes / custom description override */}
                      <div>
                        <Label className="text-xs">
                          Notes / Custom Description
                        </Label>
                        <Input
                          placeholder="e.g. Emergency spot treatment — lobby (optional)"
                          value={addForm.description}
                          onChange={(e) =>
                            setAddForm((f) => ({
                              ...f,
                              description: e.target.value,
                            }))
                          }
                          className="mt-1"
                        />
                      </div>

                      {/* Qty + Price + Duration calculator */}
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <Label className="text-xs">Qty</Label>
                          <Input
                            type="number"
                            min="1"
                            value={addForm.quantity}
                            onChange={(e) =>
                              setAddForm((f) => ({
                                ...f,
                                quantity: e.target.value,
                              }))
                            }
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Unit Price ($)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            value={addForm.unitPrice}
                            onChange={(e) =>
                              setAddForm((f) => ({
                                ...f,
                                unitPrice: e.target.value,
                              }))
                            }
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Duration (min)</Label>
                          <Input
                            type="number"
                            value={addForm.durationMinutes}
                            onChange={(e) =>
                              setAddForm((f) => ({
                                ...f,
                                durationMinutes: e.target.value,
                              }))
                            }
                            className="mt-1"
                          />
                        </div>
                      </div>

                      {/* Running total */}
                      {addJobSubtotal > 0 && (
                        <div className="flex items-center justify-end gap-2 rounded-md border border-blue-500/20 bg-blue-500/5 px-3 py-2">
                          <span className="text-muted-foreground text-xs">
                            {addForm.quantity !== '1' &&
                            Number(addForm.quantity) > 1
                              ? `${addForm.quantity} × $${Number(addForm.unitPrice).toFixed(2)}`
                              : null}
                          </span>
                          <span className="text-sm font-semibold">
                            Total: ${addJobSubtotal.toFixed(2)}
                          </span>
                        </div>
                      )}

                      {/* Address (if multiple) */}
                      {entry.addresses.length > 1 && (
                        <div>
                          <Label className="text-xs">Address</Label>
                          <select
                            value={addForm.addressId}
                            onChange={(e) =>
                              setAddForm((f) => ({
                                ...f,
                                addressId: e.target.value,
                              }))
                            }
                            className="border-input bg-background mt-1 h-9 w-full rounded-md border px-3 text-sm"
                          >
                            {entry.addresses.map((addr) => (
                              <option key={addr.id} value={addr.id}>
                                {addr.label || addr.street_1}, {addr.city}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setAddingFor(null)}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          onClick={handleSaveJob}
                          disabled={savingJob}
                          className="gap-1.5"
                        >
                          {savingJob && (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          )}
                          Add to Schedule & Invoice
                        </Button>
                      </div>
                    </div>
                  )
                })()}

              {/* Visit rows */}
              <div className="divide-y">
                {entry.visits.map((visit) => {
                  const isDone = visit.status === 'completed'
                  const dateObj = new Date(visit.date + 'T12:00:00')
                  const dateLabel = dateObj.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })
                  const isExpanded = expandedVisit === visit.appointmentId
                  const canEdit = !hasInvoice

                  return (
                    <div key={visit.appointmentId}>
                      {/* Collapsed summary row */}
                      <button
                        type="button"
                        className={`flex w-full items-center gap-4 px-5 py-3 text-left transition ${canEdit ? 'hover:bg-muted/40 cursor-pointer' : 'cursor-default'}`}
                        onClick={() => canEdit && toggleVisit(visit)}
                      >
                        {isDone ? (
                          <CheckCircle className="h-4 w-4 shrink-0 text-green-400" />
                        ) : (
                          <Clock className="text-muted-foreground h-4 w-4 shrink-0" />
                        )}
                        <span className="w-16 shrink-0 text-sm font-semibold tabular-nums">
                          {dateLabel}
                        </span>
                        <span
                          className={`min-w-0 flex-1 truncate text-sm ${isDone ? '' : 'text-muted-foreground'}`}
                        >
                          {visit.description || visit.templateLabel}
                          {visit.isAdHoc && (
                            <span className="text-muted-foreground ml-1.5 text-xs">
                              (one-off)
                            </span>
                          )}
                        </span>
                        <span
                          className={`shrink-0 text-sm font-semibold tabular-nums ${isDone ? '' : 'text-muted-foreground'}`}
                        >
                          {isDone ? formatCurrency(visit.total) : '—'}
                        </span>
                        {canEdit && (
                          <ChevronDown
                            className={`text-muted-foreground h-4 w-4 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                          />
                        )}
                      </button>

                      {/* Expanded line item editor */}
                      {isExpanded && (
                        <div className="border-t bg-blue-500/5 px-5 py-4">
                          <div className="space-y-2">
                            {/* Header row */}
                            <div className="text-muted-foreground grid grid-cols-[1fr_60px_80px_70px_1fr_80px_32px] items-center gap-2 text-xs font-medium">
                              <span>Service</span>
                              <span>Qty</span>
                              <span>Price</span>
                              <span>Mins</span>
                              <span>Notes</span>
                              <span className="text-right">Total</span>
                              <span />
                            </div>

                            {editLines.map((line, idx) => (
                              <div
                                key={idx}
                                className="grid grid-cols-[1fr_60px_80px_70px_1fr_80px_32px] items-center gap-2"
                              >
                                <Input
                                  value={line.name_snapshot}
                                  onChange={(e) =>
                                    updateLine(
                                      idx,
                                      'name_snapshot',
                                      e.target.value,
                                    )
                                  }
                                  placeholder="Service name"
                                  className="h-8 text-sm"
                                />
                                <Input
                                  type="number"
                                  value={line.quantity}
                                  onChange={(e) =>
                                    updateLine(idx, 'quantity', e.target.value)
                                  }
                                  className="h-8 text-sm"
                                  min={0}
                                  step="0.01"
                                />
                                <Input
                                  type="number"
                                  value={line.unit_price}
                                  onChange={(e) =>
                                    updateLine(
                                      idx,
                                      'unit_price',
                                      e.target.value,
                                    )
                                  }
                                  className="h-8 text-sm"
                                  min={0}
                                  step="0.01"
                                />
                                <Input
                                  type="number"
                                  value={line.duration_minutes}
                                  onChange={(e) =>
                                    updateLine(
                                      idx,
                                      'duration_minutes',
                                      e.target.value,
                                    )
                                  }
                                  className="h-8 text-sm"
                                  min={0}
                                />
                                <Input
                                  value={line.notes || ''}
                                  onChange={(e) =>
                                    updateLine(idx, 'notes', e.target.value)
                                  }
                                  placeholder="Notes"
                                  className="h-8 text-sm"
                                />
                                <span className="text-right text-sm font-semibold tabular-nums">
                                  {formatCurrency(line.line_total)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => removeLine(idx)}
                                  className="text-muted-foreground hover:text-destructive flex h-8 w-8 items-center justify-center rounded-md transition"
                                  title="Remove line"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>

                          {/* Footer: add line, total, save/cancel */}
                          <div className="mt-3 flex items-center justify-between gap-4">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={addLine}
                              className="gap-1.5"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              Add Line
                            </Button>

                            <div className="flex items-center gap-4">
                              <span className="text-sm font-semibold tabular-nums">
                                Total: {formatCurrency(editLinesTotal)}
                              </span>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setExpandedVisit(null)
                                  setEditLines([])
                                }}
                              >
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                onClick={() =>
                                  saveVisitLines(visit.appointmentId)
                                }
                                disabled={savingVisit || editLines.length === 0}
                                className="gap-1.5"
                              >
                                {savingVisit && (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                )}
                                Save
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Footer — total + generate button */}
              <div className="flex flex-wrap items-center justify-between gap-4 border-t px-5 py-4">
                <div>
                  <p className="text-2xl font-bold tabular-nums">
                    {formatCurrency(entry.runningTotal)}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {entry.completedVisits} of {entry.totalVisits} visits
                    completed
                  </p>
                </div>

                {hasInvoice ? (
                  <div className="flex items-center gap-2 text-sm">
                    <CheckCircle className="h-5 w-5 text-green-400" />
                    <span className="font-medium">
                      Invoice generated —{' '}
                      {formatCurrency(entry.existingInvoice!.total)}
                    </span>
                  </div>
                ) : (
                  <Button
                    onClick={() => handleGenerate(entry.customerId)}
                    disabled={!canGenerate || isGenerating}
                    className="gap-2"
                    title={
                      !canGenerate
                        ? 'No completed visits to invoice yet'
                        : undefined
                    }
                  >
                    {isGenerating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Receipt className="h-4 w-4" />
                    )}
                    Generate Invoice
                  </Button>
                )}
              </div>
            </Card>
          )
        })
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

// ─── Recurring Visit Panel ───────────────────────────────────────────────

function RecurringVisitPanel({
  appointment,
  template,
  onClose,
  onUpdated,
}: {
  appointment: VisitAppointment
  template: TemplateDetail
  onClose: () => void
  onUpdated: (updates: Partial<VisitAppointment>) => void
}) {
  const isBatch = template.invoice_mode === 'batch_monthly'
  const address = unwrap(template.ops_service_addresses)
  const invoiceId = Array.isArray(appointment.ops_invoices)
    ? (appointment.ops_invoices[0]?.id ?? null)
    : null

  type LocalLineItem = {
    id?: string
    service_catalog_item_id?: string | null
    name_snapshot: string
    quantity: string
    unit_price: string
    duration_minutes: string
    notes: string
  }

  const [status, setStatus] = useState(appointment.status)
  const [onMyWayAt, setOnMyWayAt] = useState<string | null>(
    appointment.on_my_way_at ?? null,
  )
  const [completedAt, setCompletedAt] = useState<string | null>(
    appointment.completed_at ?? null,
  )

  // Admin-only duration adjustment (hours) — derived from on_my_way_at → completed_at
  const calcDurationHours = (omw: string | null, done: string | null) => {
    if (!omw || !done) return ''
    const min = (new Date(done).getTime() - new Date(omw).getTime()) / 60000
    return min > 0 ? parseFloat((min / 60).toFixed(2)).toString() : ''
  }
  const [durationHours, setDurationHours] = useState(() =>
    calcDurationHours(
      appointment.on_my_way_at ?? null,
      appointment.completed_at ?? null,
    ),
  )
  const [savingDuration, setSavingDuration] = useState(false)
  const [durationSaved, setDurationSaved] = useState(false)
  const [lineItems, setLineItems] = useState<LocalLineItem[]>(
    (appointment.ops_appointment_line_items || []).map((l) => ({
      id: l.id,
      service_catalog_item_id: l.service_catalog_item_id ?? null,
      name_snapshot: l.name_snapshot,
      quantity: String(l.quantity),
      unit_price: String(l.unit_price),
      duration_minutes: String(l.duration_minutes),
      notes: l.notes ?? '',
    })),
  )
  const [notes, setNotes] = useState(appointment.internal_notes ?? '')
  const [saving, setSaving] = useState(false)
  const [savingLines, setSavingLines] = useState(false)
  const [elapsed, setElapsed] = useState('')
  const [catalog, setCatalog] = useState<ServiceCatalogItem[]>([])

  // Drive timer counts from on_my_way_at
  useEffect(() => {
    if (status !== 'on_my_way' || !onMyWayAt) {
      setElapsed('')
      return
    }
    const tick = () => {
      const diff = Date.now() - new Date(onMyWayAt).getTime()
      const h = Math.floor(diff / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setElapsed(
        `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`,
      )
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [status, onMyWayAt])

  useEffect(() => {
    fetch('/api/admin/ops/services')
      .then((r) => r.json())
      .then((d) => setCatalog(d.services || []))
      .catch(() => {})
  }, [])

  const subtotal = lineItems.reduce(
    (s, l) => s + (Number(l.unit_price) || 0) * (Number(l.quantity) || 0),
    0,
  )

  const handleStatusChange = async (newStatus: 'on_my_way' | 'completed') => {
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/ops/appointments/${appointment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (res.ok) {
        const data = await res.json()
        const nowIso = new Date().toISOString()
        if (newStatus === 'on_my_way') {
          const t = data.appointment?.on_my_way_at ?? nowIso
          setStatus('on_my_way')
          setOnMyWayAt(t)
          onUpdated({ status: 'on_my_way', on_my_way_at: t })
        } else {
          const t = data.appointment?.completed_at ?? nowIso
          setStatus('completed')
          setCompletedAt(t)
          // Pre-fill duration with whatever was recorded (on_my_way_at → now)
          setDurationHours(calcDurationHours(onMyWayAt, t))
          onUpdated({ status: 'completed', completed_at: t })
        }
      }
    } finally {
      setSaving(false)
    }
  }

  const handleSaveLines = async () => {
    setSavingLines(true)
    try {
      await fetch(`/api/admin/ops/appointments/${appointment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          line_items: lineItems.map((l) => ({
            service_catalog_item_id: l.service_catalog_item_id || null,
            name_snapshot: l.name_snapshot,
            quantity: Number(l.quantity) || 1,
            unit_price: Number(l.unit_price) || 0,
            duration_minutes: Number(l.duration_minutes) || 60,
            notes: l.notes || null,
          })),
        }),
      })
      onUpdated({ quoted_total: subtotal })
    } finally {
      setSavingLines(false)
    }
  }

  const handleSaveNotes = async () => {
    await fetch(`/api/admin/ops/appointments/${appointment.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ internal_notes: notes }),
    })
    onUpdated({ internal_notes: notes })
  }

  // Admin-only: adjust on_my_way_at backward from completed_at so stats are accurate
  const handleSaveDuration = async () => {
    if (!completedAt) return
    const hours = parseFloat(durationHours)
    if (!Number.isFinite(hours) || hours <= 0) return
    setSavingDuration(true)
    setDurationSaved(false)
    try {
      const newOnMyWayAt = new Date(
        new Date(completedAt).getTime() - hours * 3600000,
      ).toISOString()
      const res = await fetch(`/api/admin/ops/appointments/${appointment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on_my_way_at: newOnMyWayAt }),
      })
      if (res.ok) {
        setOnMyWayAt(newOnMyWayAt)
        onUpdated({ on_my_way_at: newOnMyWayAt })
        setDurationSaved(true)
        setTimeout(() => setDurationSaved(false), 3000)
      }
    } finally {
      setSavingDuration(false)
    }
  }

  const dateStr = new Date(
    appointment.appointment_date + 'T12:00:00',
  ).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  const timeStr = `${appointment.start_time?.slice(0, 5)} – ${appointment.end_time?.slice(0, 5)}`

  const statusColors: Record<string, string> = {
    completed: 'text-green-400',
    on_my_way: 'text-blue-400',
    booked: 'text-muted-foreground',
    confirmed: 'text-muted-foreground',
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="bg-background absolute top-0 right-0 flex h-full w-full max-w-lg flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b p-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="gap-1">
                <Repeat className="h-3 w-3" />
                Recurring Job
              </Badge>
              {isBatch && (
                <Badge variant="outline" className="text-xs">
                  Batch Monthly
                </Badge>
              )}
              <Badge
                variant="outline"
                className={`capitalize ${statusColors[status] ?? ''}`}
              >
                {status.replace(/_/g, ' ')}
              </Badge>
            </div>
            <h3 className="mt-2 text-lg leading-tight font-semibold">
              {template.label}
            </h3>
            <p className="text-muted-foreground text-sm">{dateStr}</p>
            <p className="text-muted-foreground text-sm">{timeStr}</p>
            {address && (
              <p className="text-muted-foreground mt-0.5 text-xs">
                {address.street_1}, {address.city}, {address.state}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="hover:bg-accent rounded-lg p-1.5 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* Job Controls — batch_monthly only */}
          {isBatch && (
            <div className="rounded-xl border p-4">
              <h4 className="mb-3 text-sm font-semibold">Job Controls</h4>
              {status === 'completed' ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-green-400">
                    <CheckCircle className="h-4 w-4" />
                    <span>Job closed out</span>
                    {completedAt && (
                      <span className="text-muted-foreground">
                        ·{' '}
                        {new Date(completedAt).toLocaleTimeString('en-US', {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </span>
                    )}
                  </div>
                  {/* Admin duration override */}
                  <div className="rounded-lg border border-dashed p-3">
                    <p className="text-muted-foreground mb-2 text-xs font-medium">
                      Adjust time on site (admin only)
                    </p>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        step="0.25"
                        min="0.25"
                        max="24"
                        className="border-input bg-background h-8 w-24 rounded-md border px-2 text-sm tabular-nums"
                        value={durationHours}
                        onChange={(e) => {
                          setDurationHours(e.target.value)
                          setDurationSaved(false)
                        }}
                        placeholder="hrs"
                      />
                      <span className="text-muted-foreground text-xs">
                        hours
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-auto"
                        onClick={() => void handleSaveDuration()}
                        disabled={savingDuration || !durationHours}
                      >
                        {savingDuration ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : durationSaved ? (
                          '✓ Saved'
                        ) : (
                          'Save'
                        )}
                      </Button>
                    </div>
                    {onMyWayAt && completedAt && (
                      <p className="text-muted-foreground mt-1.5 text-xs">
                        Recorded:{' '}
                        {Math.round(
                          (new Date(completedAt).getTime() -
                            new Date(onMyWayAt).getTime()) /
                            60000,
                        )}{' '}
                        min
                      </p>
                    )}
                  </div>
                </div>
              ) : status === 'on_my_way' ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-blue-400">
                    <Truck className="h-4 w-4" />
                    <span>En route</span>
                    {elapsed && (
                      <span className="font-mono font-semibold">{elapsed}</span>
                    )}
                  </div>
                  <Button
                    onClick={() => handleStatusChange('completed')}
                    disabled={saving}
                    className="w-full"
                  >
                    {saving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle className="mr-2 h-4 w-4" />
                    )}
                    Close Out Job
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => handleStatusChange('on_my_way')}
                  disabled={saving}
                  className="w-full"
                >
                  {saving ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Truck className="mr-2 h-4 w-4" />
                  )}
                  On My Way
                </Button>
              )}
            </div>
          )}

          {/* Per-visit: link to full invoice */}
          {!isBatch && invoiceId && (
            <a
              href={`/admin/operations/invoices/${invoiceId}`}
              className="hover:bg-accent flex items-center justify-between rounded-xl border p-4 text-sm font-medium transition-colors"
            >
              View Full Invoice
              <ChevronRight className="text-muted-foreground h-4 w-4" />
            </a>
          )}

          {/* Line Items */}
          <div className="rounded-xl border p-4">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-semibold">Line Items</h4>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setLineItems((prev) => [
                    ...prev,
                    {
                      name_snapshot: '',
                      quantity: '1',
                      unit_price: '',
                      duration_minutes: '60',
                      notes: '',
                      service_catalog_item_id: null,
                    },
                  ])
                }
              >
                <Plus className="mr-1 h-3 w-3" />
                Add
              </Button>
            </div>

            <div className="space-y-3">
              {lineItems.map((item, idx) => (
                <div key={idx} className="space-y-1.5 rounded-lg border p-3">
                  {catalog.length > 0 && (
                    <select
                      className="border-input bg-background h-8 w-full rounded-md border px-2 text-xs"
                      value={item.service_catalog_item_id ?? ''}
                      onChange={(e) => {
                        const svc = catalog.find((s) => s.id === e.target.value)
                        setLineItems((prev) =>
                          prev.map((l, i) =>
                            i !== idx
                              ? l
                              : {
                                  ...l,
                                  service_catalog_item_id:
                                    e.target.value || null,
                                  name_snapshot: svc?.name ?? l.name_snapshot,
                                  unit_price:
                                    svc?.base_price != null
                                      ? String(svc.base_price)
                                      : l.unit_price,
                                  duration_minutes:
                                    svc?.default_duration_minutes != null
                                      ? String(svc.default_duration_minutes)
                                      : l.duration_minutes,
                                },
                          ),
                        )
                      }}
                    >
                      <option value="">— Pick from catalog —</option>
                      {catalog.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                          {s.base_price != null ? ` — $${s.base_price}` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                  <input
                    className="border-input bg-background h-8 w-full rounded-md border px-2 text-xs"
                    placeholder="Service name"
                    value={item.name_snapshot}
                    onChange={(e) =>
                      setLineItems((prev) =>
                        prev.map((l, i) =>
                          i !== idx
                            ? l
                            : { ...l, name_snapshot: e.target.value },
                        ),
                      )
                    }
                  />
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      className="border-input bg-background h-8 w-16 rounded-md border px-2 text-xs"
                      placeholder="Qty"
                      value={item.quantity}
                      onChange={(e) =>
                        setLineItems((prev) =>
                          prev.map((l, i) =>
                            i !== idx ? l : { ...l, quantity: e.target.value },
                          ),
                        )
                      }
                    />
                    <input
                      type="number"
                      step="0.01"
                      className="border-input bg-background h-8 flex-1 rounded-md border px-2 text-xs"
                      placeholder="Unit price"
                      value={item.unit_price}
                      onChange={(e) =>
                        setLineItems((prev) =>
                          prev.map((l, i) =>
                            i !== idx
                              ? l
                              : { ...l, unit_price: e.target.value },
                          ),
                        )
                      }
                    />
                    <span className="w-16 shrink-0 text-right text-xs font-semibold tabular-nums">
                      {formatCurrency(
                        (Number(item.quantity) || 0) *
                          (Number(item.unit_price) || 0),
                      )}
                    </span>
                    {lineItems.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setLineItems((prev) =>
                            prev.filter((_, i) => i !== idx),
                          )
                        }
                        className="hover:text-destructive"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <input
                    className="border-input bg-background text-muted-foreground h-7 w-full rounded-md border px-2 text-xs"
                    placeholder="Notes (optional)"
                    value={item.notes}
                    onChange={(e) =>
                      setLineItems((prev) =>
                        prev.map((l, i) =>
                          i !== idx ? l : { ...l, notes: e.target.value },
                        ),
                      )
                    }
                  />
                </div>
              ))}
            </div>

            <div className="mt-3 flex items-center justify-between border-t pt-3">
              <span className="text-sm font-semibold">
                Subtotal: {formatCurrency(subtotal)}
              </span>
              <Button
                size="sm"
                onClick={handleSaveLines}
                disabled={savingLines}
              >
                {savingLines && (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                )}
                Save Line Items
              </Button>
            </div>
          </div>

          {/* Internal Notes */}
          <div className="rounded-xl border p-4">
            <h4 className="mb-2 text-sm font-semibold">Internal Notes</h4>
            <textarea
              className="border-input bg-background min-h-[80px] w-full rounded-md border px-3 py-2 text-sm"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={handleSaveNotes}
              placeholder="Notes visible only to staff..."
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Schedule Strip ───────────────────────────────────────────────────────

function ScheduleStrip({
  appointments,
  onSelectVisit,
}: {
  appointments: VisitAppointment[]
  onSelectVisit: (appt: VisitAppointment) => void
}) {
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex min-w-max gap-2 py-1">
        {appointments.map((appt) => {
          const isMissed =
            appt.appointment_date < today && appt.status === 'booked'
          const chipClass =
            appt.status === 'completed'
              ? 'border-green-500/40 bg-green-500/10 text-green-400'
              : appt.status === 'on_my_way'
                ? 'border-blue-500/40 bg-blue-500/10 text-blue-400'
                : isMissed
                  ? 'border-red-500/40 bg-red-500/10 text-red-400'
                  : 'border-border bg-card text-muted-foreground'

          const dateObj = new Date(appt.appointment_date + 'T12:00:00')
          const dayLabel = dateObj.toLocaleDateString('en-US', {
            weekday: 'short',
          })
          const dateLabel = dateObj.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })

          return (
            <button
              key={appt.id}
              type="button"
              onClick={() => onSelectVisit(appt)}
              className={`flex min-w-[76px] flex-col items-center rounded-xl border px-2.5 py-2 text-center transition-all hover:opacity-90 hover:shadow-sm ${chipClass}`}
            >
              <span className="text-[10px] font-medium tracking-wide uppercase opacity-70">
                {dayLabel}
              </span>
              <span className="text-sm font-semibold">{dateLabel}</span>
              <div className="mt-1 flex h-3.5 items-center justify-center">
                {appt.status === 'completed' && (
                  <CheckCircle className="h-3.5 w-3.5 text-green-400" />
                )}
                {appt.status === 'on_my_way' && (
                  <Truck className="h-3.5 w-3.5 text-blue-400" />
                )}
                {isMissed && (
                  <span className="text-[9px] font-medium text-red-400 uppercase">
                    Missed
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Month Holding Area ───────────────────────────────────────────────────

// MonthHoldingArea removed — monthly billing now lives in MonthEndBillingSection on the list view

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
  const [selectedVisit, setSelectedVisit] = useState<VisitAppointment | null>(
    null,
  )
  // Optimistic updates keyed by appointment ID; reset when template reloads via onRefresh
  const [localUpdates, setLocalUpdates] = useState<
    Record<string, Partial<VisitAppointment>>
  >({})

  const localAppts = useMemo(
    () => template.appointments.map((a) => ({ ...a, ...localUpdates[a.id] })),
    [template.appointments, localUpdates],
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

  const handleVisitUpdated = (updates: Partial<VisitAppointment>) => {
    if (!selectedVisit) return
    const apptId = selectedVisit.id
    setLocalUpdates((prev) => ({
      ...prev,
      [apptId]: { ...prev[apptId], ...updates },
    }))
    setSelectedVisit((prev) => (prev ? { ...prev, ...updates } : prev))
  }

  return (
    <div className="space-y-6">
      {/* Visit detail panel overlay */}
      {selectedVisit && (
        <RecurringVisitPanel
          appointment={selectedVisit}
          template={template}
          onClose={() => setSelectedVisit(null)}
          onUpdated={handleVisitUpdated}
        />
      )}

      {/* Header */}
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

      {/* Schedule + Pricing */}
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
          <h3 className="font-semibold">Default Pricing</h3>
          <div className="mt-2 space-y-2 text-sm">
            {(template.line_items || []).map((l, i) => (
              <div key={i} className="rounded-lg border bg-black/20 px-3 py-2">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{l.name_snapshot}</span>
                  <span className="shrink-0 font-medium tabular-nums">
                    {l.quantity} × {formatCurrency(l.unit_price)}
                  </span>
                </div>
                {(l as { notes?: string }).notes && (
                  <p className="mt-1 rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-300">
                    {(l as { notes?: string }).notes}
                  </p>
                )}
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
      </Card>

      {/* Monthly tally note — invoice generation lives in Month-End Billing on the main list */}
      {template.invoice_mode === 'batch_monthly' && (
        <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
          <div className="flex items-center gap-3">
            <Receipt className="text-muted-foreground h-5 w-5 shrink-0" />
            <div>
              <p className="text-sm font-medium">Batch Monthly Invoicing</p>
              <p className="text-muted-foreground text-sm">
                Completed visits from this template gather in the{' '}
                <span className="font-semibold">Month-End Billing</span> section
                at the bottom of the Recurring Jobs list. Generate the
                consolidated invoice from there.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Schedule Strip — all appointments as clickable date chips */}
      <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">All Visits ({localAppts.length})</h3>
          <p className="text-muted-foreground text-xs">
            Click any date to open visit details
          </p>
        </div>
        {localAppts.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No visits generated yet.
          </p>
        ) : (
          <ScheduleStrip
            appointments={localAppts}
            onSelectVisit={(appt) => setSelectedVisit(appt)}
          />
        )}
      </Card>
    </div>
  )
}
