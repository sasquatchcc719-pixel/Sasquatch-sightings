'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useState } from 'react'
import {
  Briefcase,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  DollarSign,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  Pencil,
  Search,
  UserRound,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

type CustomerAddress = {
  id: string
  label: string | null
  street_1: string
  street_2: string | null
  city: string
  state: string
  zip_code: string
  gate_code: string | null
  notes: string | null
}

type CustomerJob = {
  id: string
  status: string
  appointment_date: string
  start_time: string | null
  ops_invoices: { id: string } | null
  ops_service_addresses: { street_1: string; city: string } | null
  ops_job_photos?: CustomerJobPhoto[]
}

type CustomerJobPhoto = {
  id: string
  public_url: string | null
  label: string | null
  source: string | null
  uploaded_by_label: string | null
  original_filename: string | null
  created_at: string
}

type CustomerInboundMedia = {
  id: string
  appointment_id: string | null
  job_photo_id: string | null
  content_type: string
  category: string
  created_at: string
  signed_url: string
}

type CustomerRow = {
  id: string
  full_name: string
  first_name: string | null
  last_name: string | null
  business_name: string | null
  email: string | null
  phone: string
  notes: string | null
  email_opt_out: boolean | null
  quickbooks_customer_id: string | null
  created_at: string
  job_count?: number
  last_job_date?: string | null
  total_revenue?: number
  lead_source?: string | null
  jobs?: CustomerJob[]
  customer_media?: CustomerInboundMedia[]
  ops_service_addresses: CustomerAddress[]
}

type CustomerEditState = {
  first_name: string
  last_name: string
  business_name: string
  phone: string
  email: string
  notes: string
  email_opt_out: boolean
  addresses: Array<{
    id: string
    label: string
    street_1: string
    street_2: string
    city: string
    state: string
    zip_code: string
    gate_code: string
    notes: string
  }>
}

function formatCurrency(cents: number): string {
  return `$${cents.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatCustomerSince(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

const UPCOMING_STATUSES = new Set([
  'booked',
  'confirmed',
  'on_my_way',
  'in_progress',
])
const STAT_TOGGLE_CLASS =
  'inline-flex cursor-pointer items-center gap-1 rounded-md border border-transparent bg-secondary px-2.5 py-0.5 text-xs font-normal text-secondary-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2'

function formatJobDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatTime(hhmm: string | null): string {
  if (!hhmm) return ''
  const [h, m] = hhmm.slice(0, 5).split(':').map(Number)
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function getJobPhotos(job: CustomerJob): CustomerJobPhoto[] {
  return (job.ops_job_photos || [])
    .filter((photo) => Boolean(photo.public_url))
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
}

function getCustomerPhotoCount(customer: CustomerRow): number {
  const jobPhotoCount = (customer.jobs || []).reduce(
    (count, job) => count + getJobPhotos(job).length,
    0,
  )
  const conversationOnlyCount = (customer.customer_media || []).filter(
    (media) => Boolean(media.signed_url) && !media.job_photo_id,
  ).length
  return jobPhotoCount + conversationOnlyCount
}

function getConversationOnlyMedia(
  customer: CustomerRow,
): CustomerInboundMedia[] {
  return (customer.customer_media || []).filter(
    (media) => Boolean(media.signed_url) && !media.job_photo_id,
  )
}

function customerMediaLabel(category: string): string {
  if (category === 'estimate') return 'Estimate / preliminary'
  if (category === 'customer_file') return 'Customer file'
  if (category === 'preexisting_damage') return 'Pre-existing damage'
  if (category === 'job') return 'Job & invoice'
  return 'Unclassified text photo'
}

function formatJobAddress(
  address: CustomerJob['ops_service_addresses'],
): string | null {
  if (!address) return null
  return [address.street_1, address.city].filter(Boolean).join(', ') || null
}

export function CustomersDirectory() {
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<CustomerEditState | null>(null)
  const [editSaving, setEditSaving] = useState(false)
  const [expandedJobs, setExpandedJobs] = useState<
    Record<string, 'upcoming' | 'completed' | null>
  >({})
  const [expandedPhotos, setExpandedPhotos] = useState<Record<string, boolean>>(
    {},
  )

  const fetchCustomers = async () => {
    const hasQuery = query.trim().length > 0
    if (hasQuery) {
      setSearching(true)
    } else {
      setLoading(true)
    }
    setError(null)
    try {
      const response = await fetch(
        `/api/admin/ops/customers?q=${encodeURIComponent(query.trim())}`,
        { cache: 'no-store' },
      )
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to load customers')
      }
      setCustomers(result.customers || [])
    } catch (searchError) {
      setError(
        searchError instanceof Error
          ? searchError.message
          : 'Failed to load customers',
      )
    } finally {
      setLoading(false)
      setSearching(false)
    }
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void fetchCustomers()
    }, 250)
    return () => window.clearTimeout(timeoutId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const startEdit = (customer: CustomerRow) => {
    setEditForm({
      first_name: customer.first_name || '',
      last_name: customer.last_name || '',
      business_name: customer.business_name || '',
      phone: customer.phone || '',
      email: customer.email || '',
      notes: customer.notes || '',
      email_opt_out: customer.email_opt_out ?? false,
      addresses: (customer.ops_service_addresses || []).map((a) => ({
        id: a.id,
        label: a.label || '',
        street_1: a.street_1,
        street_2: a.street_2 || '',
        city: a.city,
        state: a.state,
        zip_code: a.zip_code,
        gate_code: a.gate_code || '',
        notes: a.notes || '',
      })),
    })
    setEditingId(customer.id)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditForm(null)
  }

  const saveEdit = async (customerId: string) => {
    if (!editForm) return
    setEditSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/ops/customers/${customerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer: {
            first_name: editForm.first_name,
            last_name: editForm.last_name,
            business_name: editForm.business_name || null,
            phone: editForm.phone,
            email: editForm.email || null,
            notes: editForm.notes || null,
            email_opt_out: editForm.email_opt_out,
          },
          addresses: editForm.addresses.map((a) => ({
            id: a.id,
            label: a.label || null,
            street_1: a.street_1,
            street_2: a.street_2 || null,
            city: a.city,
            state: a.state,
            zip_code: a.zip_code,
            gate_code: a.gate_code || null,
            notes: a.notes || null,
          })),
        }),
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to update customer')
      }
      setEditingId(null)
      setEditForm(null)
      await fetchCustomers()
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Failed to update customer',
      )
    } finally {
      setEditSaving(false)
    }
  }

  const updateAddrField = (addrIndex: number, field: string, value: string) => {
    setEditForm((prev) => {
      if (!prev) return prev
      const addresses = [...prev.addresses]
      addresses[addrIndex] = { ...addresses[addrIndex], [field]: value }
      return { ...prev, addresses }
    })
  }

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading customers...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold">Customers</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Returning customer directory from Ops records, including saved
              service addresses used by New Job.
            </p>
          </div>
          <Button asChild size="sm">
            <Link href="/admin/operations/new-job">New Job</Link>
          </Button>
        </div>

        <div className="mt-4">
          <label
            htmlFor="customers-search"
            className="text-muted-foreground text-xs font-medium tracking-[0.2em] uppercase"
          >
            Search
          </label>
          <div className="relative mt-2">
            <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <Input
              id="customers-search"
              className="pl-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name, business, phone, or email"
            />
          </div>
          <div className="text-muted-foreground mt-2 text-xs">
            Showing up to the latest 10 matches.
          </div>
        </div>
      </Card>

      {error ? (
        <Card className="border-destructive/30 bg-destructive/10 text-destructive p-4 text-sm">
          {error}
        </Card>
      ) : null}

      {searching ? (
        <Card className="border-border/60 bg-card/80 p-4 text-sm shadow-sm backdrop-blur">
          <div className="text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Searching...
          </div>
        </Card>
      ) : null}

      {customers.length === 0 ? (
        <Card className="border-border/60 bg-card/80 p-6 shadow-sm backdrop-blur">
          <div className="text-muted-foreground text-sm">
            No customers found yet. If you already imported customers, try a
            broader search or clear the search box.
          </div>
        </Card>
      ) : (
        <div className="grid gap-3">
          {customers.map((customer) => {
            const isEditing = editingId === customer.id

            return (
              <Card
                key={customer.id}
                className="border-border/60 bg-card/80 p-4 shadow-sm backdrop-blur"
              >
                {isEditing && editForm ? (
                  /* ── Edit mode ──────────────────────────────── */
                  <div className="space-y-4">
                    <p className="text-muted-foreground text-xs font-medium tracking-[0.2em] uppercase">
                      Edit Customer
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">First Name</Label>
                        <Input
                          value={editForm.first_name}
                          onChange={(e) =>
                            setEditForm((f) =>
                              f ? { ...f, first_name: e.target.value } : f,
                            )
                          }
                          className="h-9"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Last Name</Label>
                        <Input
                          value={editForm.last_name}
                          onChange={(e) =>
                            setEditForm((f) =>
                              f ? { ...f, last_name: e.target.value } : f,
                            )
                          }
                          className="h-9"
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Business Name</Label>
                      <Input
                        value={editForm.business_name}
                        onChange={(e) =>
                          setEditForm((f) =>
                            f ? { ...f, business_name: e.target.value } : f,
                          )
                        }
                        className="h-9"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Phone</Label>
                        <Input
                          value={editForm.phone}
                          onChange={(e) =>
                            setEditForm((f) =>
                              f ? { ...f, phone: e.target.value } : f,
                            )
                          }
                          className="h-9"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Email</Label>
                        <Input
                          value={editForm.email}
                          onChange={(e) =>
                            setEditForm((f) =>
                              f ? { ...f, email: e.target.value } : f,
                            )
                          }
                          className="h-9"
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Notes</Label>
                      <textarea
                        className="border-border/60 bg-background/70 w-full rounded-xl border p-3 text-sm"
                        rows={2}
                        value={editForm.notes}
                        onChange={(e) =>
                          setEditForm((f) =>
                            f ? { ...f, notes: e.target.value } : f,
                          )
                        }
                      />
                    </div>

                    <div className="flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-amber-200">
                          Suppress all emails
                        </p>
                        <p className="mt-0.5 text-xs text-amber-200/60">
                          No booking confirmations, job-complete emails, or drip
                          campaigns. Use for QB-billed commercial accounts (e.g.
                          Recovery Village).
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={editForm.email_opt_out}
                        onClick={() =>
                          setEditForm((f) =>
                            f ? { ...f, email_opt_out: !f.email_opt_out } : f,
                          )
                        }
                        className={`relative ml-4 inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                          editForm.email_opt_out
                            ? 'bg-amber-500'
                            : 'bg-white/20'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform ${
                            editForm.email_opt_out
                              ? 'translate-x-5'
                              : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>

                    {editForm.addresses.map((addr, addrIdx) => (
                      <div
                        key={addr.id}
                        className="border-border/60 space-y-2 rounded-xl border p-3"
                      >
                        <p className="text-muted-foreground text-xs font-medium tracking-[0.2em] uppercase">
                          Address {addrIdx + 1}
                        </p>
                        <div>
                          <Label className="text-xs">Street</Label>
                          <Input
                            value={addr.street_1}
                            onChange={(e) =>
                              updateAddrField(
                                addrIdx,
                                'street_1',
                                e.target.value,
                              )
                            }
                            className="h-9"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Street 2</Label>
                          <Input
                            value={addr.street_2}
                            onChange={(e) =>
                              updateAddrField(
                                addrIdx,
                                'street_2',
                                e.target.value,
                              )
                            }
                            className="h-9"
                            placeholder="Apt, Suite, etc."
                          />
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <Label className="text-xs">City</Label>
                            <Input
                              value={addr.city}
                              onChange={(e) =>
                                updateAddrField(addrIdx, 'city', e.target.value)
                              }
                              className="h-9"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">State</Label>
                            <Input
                              value={addr.state}
                              onChange={(e) =>
                                updateAddrField(
                                  addrIdx,
                                  'state',
                                  e.target.value,
                                )
                              }
                              className="h-9"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Zip</Label>
                            <Input
                              value={addr.zip_code}
                              onChange={(e) =>
                                updateAddrField(
                                  addrIdx,
                                  'zip_code',
                                  e.target.value,
                                )
                              }
                              className="h-9"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label className="text-xs">Gate Code</Label>
                            <Input
                              value={addr.gate_code}
                              onChange={(e) =>
                                updateAddrField(
                                  addrIdx,
                                  'gate_code',
                                  e.target.value,
                                )
                              }
                              className="h-9"
                              placeholder="Optional"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Access Notes</Label>
                            <Input
                              value={addr.notes}
                              onChange={(e) =>
                                updateAddrField(
                                  addrIdx,
                                  'notes',
                                  e.target.value,
                                )
                              }
                              className="h-9"
                              placeholder="Optional"
                            />
                          </div>
                        </div>
                      </div>
                    ))}

                    <div className="flex gap-2 pt-1">
                      <Button
                        className="flex-1 gap-2"
                        disabled={editSaving}
                        onClick={() => void saveEdit(customer.id)}
                      >
                        {editSaving ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : null}
                        {editSaving ? 'Saving…' : 'Save Changes'}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={cancelEdit}
                        disabled={editSaving}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  /* ── View mode ─────────────────────────────── */
                  <>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <UserRound className="h-4 w-4" />
                          <div className="font-semibold">
                            {customer.business_name || customer.full_name}
                          </div>
                        </div>
                        {customer.business_name ? (
                          <div className="text-muted-foreground mt-1 text-sm">
                            Contact: {customer.full_name}
                          </div>
                        ) : null}
                        <div className="text-muted-foreground mt-1 text-sm">
                          {customer.phone}
                          {customer.email ? ` · ${customer.email}` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5"
                          onClick={() => startEdit(customer)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </Button>
                        <Badge variant="outline">
                          {customer.ops_service_addresses?.length || 0} address
                          {(customer.ops_service_addresses?.length || 0) === 1
                            ? ''
                            : 'es'}
                        </Badge>
                      </div>
                    </div>

                    {/* ── Stats row ────────────────────────────── */}
                    {(() => {
                      const allJobs = customer.jobs ?? []
                      const upcoming = allJobs.filter((j) =>
                        UPCOMING_STATUSES.has(j.status),
                      )
                      const completed = allJobs.filter(
                        (j) => j.status === 'completed',
                      )
                      const photoCount = getCustomerPhotoCount(customer)
                      const conversationMedia =
                        getConversationOnlyMedia(customer)
                      const photoJobs = allJobs.filter(
                        (job) => getJobPhotos(job).length > 0,
                      )
                      const expanded = expandedJobs[customer.id] ?? null
                      const photosExpanded =
                        expandedPhotos[customer.id] === true
                      const toggleExpand = (type: 'upcoming' | 'completed') =>
                        setExpandedJobs((prev) => ({
                          ...prev,
                          [customer.id]:
                            prev[customer.id] === type ? null : type,
                        }))
                      const togglePhotos = () =>
                        setExpandedPhotos((prev) => ({
                          ...prev,
                          [customer.id]: !prev[customer.id],
                        }))
                      const expandedList =
                        expanded === 'upcoming'
                          ? upcoming
                          : expanded === 'completed'
                            ? completed
                            : []

                      return (
                        <>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {upcoming.length > 0 ? (
                              <button
                                type="button"
                                className={`${STAT_TOGGLE_CLASS} text-blue-300 hover:bg-blue-500/20`}
                                onClick={() => toggleExpand('upcoming')}
                              >
                                <Clock className="h-3 w-3" />
                                {upcoming.length} upcoming
                                {expanded === 'upcoming' ? (
                                  <ChevronUp className="h-3 w-3" />
                                ) : (
                                  <ChevronDown className="h-3 w-3" />
                                )}
                              </button>
                            ) : null}
                            {completed.length > 0 ? (
                              <button
                                type="button"
                                className={`${STAT_TOGGLE_CLASS} hover:bg-green-500/20`}
                                onClick={() => toggleExpand('completed')}
                              >
                                <CheckCircle2 className="h-3 w-3" />
                                {completed.length} completed
                                {expanded === 'completed' ? (
                                  <ChevronUp className="h-3 w-3" />
                                ) : (
                                  <ChevronDown className="h-3 w-3" />
                                )}
                              </button>
                            ) : null}
                            {photoCount > 0 ? (
                              <button
                                type="button"
                                className={`${STAT_TOGGLE_CLASS} hover:bg-sky-500/20`}
                                onClick={togglePhotos}
                              >
                                <ImageIcon className="h-3 w-3" />
                                {photoCount} photo
                                {photoCount === 1 ? '' : 's'}
                                {photosExpanded ? (
                                  <ChevronUp className="h-3 w-3" />
                                ) : (
                                  <ChevronDown className="h-3 w-3" />
                                )}
                              </button>
                            ) : null}
                            {customer.last_job_date ? (
                              <Badge
                                variant="secondary"
                                className="gap-1 text-xs font-normal"
                              >
                                <CalendarDays className="h-3 w-3" />
                                Last: {customer.last_job_date}
                              </Badge>
                            ) : null}
                            {(customer.total_revenue ?? 0) > 0 ? (
                              <Badge
                                variant="secondary"
                                className="gap-1 text-xs font-normal"
                              >
                                <DollarSign className="h-3 w-3" />
                                {formatCurrency(customer.total_revenue!)}
                              </Badge>
                            ) : null}
                            {customer.lead_source ? (
                              <Badge
                                variant="outline"
                                className="text-xs font-normal"
                              >
                                {customer.lead_source}
                              </Badge>
                            ) : null}
                            {customer.quickbooks_customer_id ? (
                              <Badge
                                variant="outline"
                                className="text-xs font-normal"
                              >
                                QB
                              </Badge>
                            ) : null}
                            {customer.email_opt_out ? (
                              <Badge
                                variant="outline"
                                className="border-amber-500/40 bg-amber-500/10 text-xs font-normal text-amber-300"
                              >
                                No emails
                              </Badge>
                            ) : null}
                          </div>

                          {expanded && expandedList.length > 0 ? (
                            <div className="mt-2 space-y-1.5">
                              {expandedList.map((job) => {
                                const addr = job.ops_service_addresses
                                const invoiceId = job.ops_invoices?.id
                                const content = (
                                  <div
                                    className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                                      invoiceId
                                        ? 'border-border/60 bg-background/70 hover:border-primary/40 hover:bg-primary/5 cursor-pointer transition-colors'
                                        : 'border-border/40 bg-background/50'
                                    }`}
                                  >
                                    <div className="flex items-center gap-3">
                                      <span className="font-medium">
                                        {formatJobDate(job.appointment_date)}
                                      </span>
                                      {job.start_time ? (
                                        <span className="text-muted-foreground text-xs">
                                          {formatTime(job.start_time)}
                                        </span>
                                      ) : null}
                                      {addr ? (
                                        <span className="text-muted-foreground text-xs">
                                          {addr.street_1}, {addr.city}
                                        </span>
                                      ) : null}
                                    </div>
                                    {invoiceId ? (
                                      <ExternalLink className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                                    ) : (
                                      <span className="text-muted-foreground text-xs">
                                        No invoice
                                      </span>
                                    )}
                                  </div>
                                )
                                return invoiceId ? (
                                  <Link
                                    key={job.id}
                                    href={`/admin/operations/invoices/${invoiceId}`}
                                  >
                                    {content}
                                  </Link>
                                ) : (
                                  <div key={job.id}>{content}</div>
                                )
                              })}
                            </div>
                          ) : null}

                          {photosExpanded &&
                          (photoJobs.length > 0 ||
                            conversationMedia.length > 0) ? (
                            <div className="border-border/60 bg-background/70 mt-3 rounded-xl border p-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2 text-sm font-medium">
                                  <ImageIcon className="text-muted-foreground h-4 w-4" />
                                  Customer & Job Photos
                                </div>
                                <Badge
                                  variant="outline"
                                  className="text-xs font-normal"
                                >
                                  {photoCount} total
                                </Badge>
                              </div>
                              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                                {conversationMedia.map((media) => (
                                  <div
                                    key={media.id}
                                    className="border-border/60 bg-card/70 overflow-hidden rounded-lg border"
                                  >
                                    <a
                                      href={media.signed_url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="bg-muted relative block aspect-[4/3]"
                                    >
                                      {media.content_type.startsWith(
                                        'image/',
                                      ) ? (
                                        <Image
                                          src={media.signed_url}
                                          alt="Customer-submitted text message photo"
                                          fill
                                          unoptimized
                                          sizes="(max-width: 768px) 50vw, (max-width: 1280px) 33vw, 25vw"
                                          className="object-cover"
                                        />
                                      ) : (
                                        <div className="flex h-full items-center justify-center p-3 text-center text-xs font-medium">
                                          Open customer attachment
                                        </div>
                                      )}
                                    </a>
                                    <div className="space-y-1.5 p-2">
                                      <Badge className="bg-sky-500/15 text-[10px] font-medium text-sky-300">
                                        Text message
                                      </Badge>
                                      <div className="text-muted-foreground text-xs">
                                        {customerMediaLabel(media.category)}
                                      </div>
                                      <div className="text-muted-foreground text-[10px]">
                                        {new Date(
                                          media.created_at,
                                        ).toLocaleDateString()}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                                {photoJobs.flatMap((job) => {
                                  const invoiceId = job.ops_invoices?.id
                                  const address = formatJobAddress(
                                    job.ops_service_addresses,
                                  )

                                  return getJobPhotos(job).map((photo) => {
                                    const photoUrl = photo.public_url || ''

                                    return (
                                      <div
                                        key={photo.id}
                                        className="border-border/60 bg-card/70 overflow-hidden rounded-lg border"
                                      >
                                        <a
                                          href={photoUrl}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="bg-muted relative block aspect-[4/3]"
                                        >
                                          <Image
                                            src={photoUrl}
                                            alt={`${photo.source === 'customer' ? 'Customer-submitted' : 'Staff-uploaded'} job photo from ${formatJobDate(job.appointment_date)}`}
                                            fill
                                            sizes="(max-width: 768px) 50vw, (max-width: 1280px) 33vw, 25vw"
                                            className="object-cover"
                                          />
                                        </a>
                                        <div className="space-y-1.5 p-2">
                                          <div className="flex items-center justify-between gap-2">
                                            <span className="truncate text-xs font-medium">
                                              {formatJobDate(
                                                job.appointment_date,
                                              )}
                                            </span>
                                            {photo.source === 'customer' ? (
                                              <Badge className="shrink-0 bg-emerald-500/15 text-[10px] font-medium text-emerald-300">
                                                Customer
                                              </Badge>
                                            ) : null}
                                          </div>
                                          {address ? (
                                            <div
                                              className="text-muted-foreground truncate text-xs"
                                              title={address}
                                            >
                                              {address}
                                            </div>
                                          ) : null}
                                          {invoiceId ? (
                                            <Button
                                              asChild
                                              size="sm"
                                              variant="ghost"
                                              className="h-7 w-full justify-start px-2 text-xs"
                                            >
                                              <Link
                                                href={`/admin/operations/invoices/${invoiceId}`}
                                              >
                                                Open invoice
                                                <ExternalLink className="ml-auto h-3 w-3" />
                                              </Link>
                                            </Button>
                                          ) : (
                                            <div className="text-muted-foreground px-2 text-xs">
                                              No invoice
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    )
                                  })
                                })}
                              </div>
                            </div>
                          ) : null}
                        </>
                      )
                    })()}

                    {/* Customer since */}
                    {customer.created_at ? (
                      <div className="text-muted-foreground mt-2 text-xs">
                        Customer since{' '}
                        {formatCustomerSince(customer.created_at)}
                      </div>
                    ) : null}

                    {/* Notes */}
                    {customer.notes ? (
                      <div className="text-muted-foreground mt-2 text-sm">
                        {customer.notes}
                      </div>
                    ) : null}

                    {/* Addresses */}
                    {customer.ops_service_addresses?.length > 0 ? (
                      <div className="mt-3 grid gap-2">
                        {customer.ops_service_addresses.map((address) => (
                          <div
                            key={address.id}
                            className="border-border/60 bg-background/70 rounded-xl border p-3 text-sm"
                          >
                            <div className="font-medium">
                              {address.label || 'Service Address'}
                            </div>
                            <div className="text-muted-foreground mt-1">
                              {address.street_1}
                              {address.street_2
                                ? `, ${address.street_2}`
                                : ''}, {address.city}, {address.state}{' '}
                              {address.zip_code}
                            </div>
                            {address.gate_code ? (
                              <div className="text-muted-foreground mt-1 text-xs">
                                Gate: {address.gate_code}
                              </div>
                            ) : null}
                            {address.notes ? (
                              <div className="text-muted-foreground mt-1 text-xs">
                                Notes: {address.notes}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
