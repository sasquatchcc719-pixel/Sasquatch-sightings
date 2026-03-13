'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ExternalLink, Loader2, MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'

type InvoiceDetailProps = {
  invoiceId: string
}

type InvoiceDetail = {
  id: string
  status: string
  payment_status: string
  subtotal: number
  total: number
  ops_appointments:
    | {
        id: string
        appointment_date: string
        start_time: string
        end_time: string
        status: string
        ops_customers:
          | {
              full_name: string
              business_name: string | null
              phone: string | null
            }
          | {
              full_name: string
              business_name: string | null
              phone: string | null
            }[]
          | null
        ops_service_addresses:
          | {
              street_1: string
              city: string
              state: string
              zip_code: string
            }
          | {
              street_1: string
              city: string
              state: string
              zip_code: string
            }[]
          | null
      }
    | null
    | Array<{
        id: string
        appointment_date: string
        start_time: string
        end_time: string
        status: string
        ops_customers:
          | {
              full_name: string
              business_name: string | null
              phone: string | null
            }
          | {
              full_name: string
              business_name: string | null
              phone: string | null
            }[]
          | null
        ops_service_addresses:
          | {
              street_1: string
              city: string
              state: string
              zip_code: string
            }
          | {
              street_1: string
              city: string
              state: string
              zip_code: string
            }[]
          | null
      }>
  ops_invoice_line_items: Array<{
    id: string
    appointment_line_item_id: string | null
    description: string
    quantity: number
    unit_price: number
    line_total: number
  }>
}

function unwrapRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] || null : value
}

function buildMapsUrl(
  street_1: string,
  city: string,
  state: string,
  zip_code: string,
): string {
  const destination = encodeURIComponent(
    `${street_1}, ${city}, ${state} ${zip_code}`,
  )
  return `https://www.google.com/maps/dir/?api=1&destination=${destination}`
}

export function InvoiceDetail({ invoiceId }: InvoiceDetailProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null)
  const [status, setStatus] = useState('draft')
  const [paymentStatus, setPaymentStatus] = useState('unpaid')
  const [lineItems, setLineItems] = useState<
    Array<{
      id: string
      appointment_line_item_id: string | null
      description: string
      quantity: number
      unit_price: string
    }>
  >([])

  useEffect(() => {
    async function loadInvoice() {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(`/api/admin/ops/invoices/${invoiceId}`, {
          cache: 'no-store',
        })
        const result = await response.json()
        if (!response.ok) {
          throw new Error(result.error || 'Failed to load invoice')
        }
        setInvoice(result.invoice)
        setStatus(result.invoice.status)
        setPaymentStatus(result.invoice.payment_status)
        setLineItems(
          (result.invoice.ops_invoice_line_items || []).map(
            (item: {
              id: string
              appointment_line_item_id: string | null
              description: string
              quantity: number
              unit_price: number
            }) => ({
              id: item.id,
              appointment_line_item_id: item.appointment_line_item_id,
              description: item.description,
              quantity: Number(item.quantity),
              unit_price: String(item.unit_price),
            }),
          ),
        )
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Failed to load invoice',
        )
      } finally {
        setLoading(false)
      }
    }

    void loadInvoice()
  }, [invoiceId])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/ops/invoices/${invoiceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          payment_status: paymentStatus,
          line_items: lineItems.map((item) => ({
            id: item.id,
            appointment_line_item_id: item.appointment_line_item_id,
            description: item.description,
            quantity: item.quantity,
            unit_price: Number(item.unit_price || 0),
          })),
        }),
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to update invoice')
      }
      router.refresh()
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Failed to update invoice',
      )
    } finally {
      setSaving(false)
    }
  }

  const runAppointmentAction = async (updates: {
    status?: string
    payment_status?: string
    label: string
  }) => {
    const appointment = unwrapRelation(invoice?.ops_appointments)
    if (!appointment?.id) return
    setActionLoading(updates.label)
    setError(null)
    try {
      const response = await fetch(
        `/api/admin/ops/appointments/${appointment.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(updates.status ? { status: updates.status } : {}),
            ...(updates.payment_status
              ? { payment_status: updates.payment_status }
              : {}),
          }),
        },
      )
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to update job')
      }
      router.refresh()
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'Failed to update job',
      )
    } finally {
      setActionLoading(null)
    }
  }

  const handleDeleteInvoice = async () => {
    const confirmed = window.confirm(
      'Delete this invoice? This is mainly for cleanup/testing and cannot be undone.',
    )
    if (!confirmed) return

    setActionLoading('Delete Invoice')
    setError(null)
    try {
      const response = await fetch(`/api/admin/ops/invoices/${invoiceId}`, {
        method: 'DELETE',
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to delete invoice')
      }
      if (result.appointment_id) {
        router.push(`/admin/operations/appointments/${result.appointment_id}`)
      } else {
        router.push('/admin/operations')
      }
      router.refresh()
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : 'Failed to delete invoice',
      )
    } finally {
      setActionLoading(null)
    }
  }

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading invoice...
      </div>
    )
  }

  if (!invoice) {
    return (
      <div className="text-muted-foreground text-sm">Invoice not found.</div>
    )
  }

  const appointment = unwrapRelation(invoice.ops_appointments)
  const customer = unwrapRelation(appointment?.ops_customers)
  const address = unwrapRelation(appointment?.ops_service_addresses)
  const total = lineItems.reduce(
    (sum, item) => sum + item.quantity * Number(item.unit_price || 0),
    0,
  )

  const mapsUrl =
    address?.street_1 && address?.city && address?.state && address?.zip_code
      ? buildMapsUrl(
          address.street_1,
          address.city,
          address.state,
          address.zip_code,
        )
      : null

  const customerName =
    customer?.business_name || customer?.full_name || 'Customer'
  const serviceDate = appointment?.appointment_date
  const timeRange =
    appointment?.start_time && appointment?.end_time
      ? `${appointment.start_time.slice(0, 5)} – ${appointment.end_time.slice(0, 5)}`
      : null

  return (
    <div className="space-y-6">
      {error ? (
        <Card className="border-destructive/30 bg-destructive/10 text-destructive p-4 text-sm">
          {error}
        </Card>
      ) : null}

      {/* ── Invoice Header ── */}
      <Card className="border-border/60 bg-card/80 p-6 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-4">
          {/* Identity block */}
          <div>
            <p className="text-muted-foreground text-xs font-medium tracking-[0.22em] uppercase">
              Invoice
            </p>
            <h2 className="mt-1 text-2xl font-semibold">{customerName}</h2>
            {customer?.phone ? (
              <p className="text-muted-foreground mt-0.5 text-sm">
                {customer.phone}
              </p>
            ) : null}
            {address ? (
              <p className="text-muted-foreground mt-1 text-sm">
                {address.street_1}, {address.city}, {address.state}{' '}
                {address.zip_code}
              </p>
            ) : null}
          </div>

          {/* Invoice meta + actions */}
          <div className="flex flex-col items-end gap-3">
            <div className="text-right">
              {serviceDate ? (
                <p className="text-muted-foreground text-sm">
                  Date:{' '}
                  <span className="text-foreground font-medium">
                    {serviceDate}
                  </span>
                </p>
              ) : null}
              {timeRange ? (
                <p className="text-muted-foreground text-sm">
                  Time:{' '}
                  <span className="text-foreground font-medium">
                    {timeRange}
                  </span>
                </p>
              ) : null}
              <p className="mt-1 text-xl font-bold">${total.toFixed(2)}</p>
              <Badge variant="outline" className="mt-1 capitalize">
                {paymentStatus}
              </Badge>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {mapsUrl ? (
                <Button asChild variant="outline" size="sm" className="gap-2">
                  <a href={mapsUrl} target="_blank" rel="noopener noreferrer">
                    <MapPin className="h-4 w-4" />
                    Route
                  </a>
                </Button>
              ) : null}
              {appointment?.id ? (
                <Button asChild variant="outline" size="sm" className="gap-2">
                  <Link
                    href={`/admin/operations/appointments/${appointment.id}`}
                  >
                    <ExternalLink className="h-4 w-4" />
                    Open Job
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </Card>

      {/* ── Line Items ── */}
      <Card className="border-border/60 bg-card/80 overflow-hidden shadow-sm backdrop-blur">
        <div className="p-5 pb-3">
          <h3 className="text-lg font-semibold">Line Items</h3>
        </div>

        {/* Table header */}
        <div className="border-border/60 border-t">
          <div className="bg-muted/40 grid grid-cols-[1fr,80px,100px,100px] gap-0 px-5 py-2 text-xs font-medium tracking-wide text-slate-500 uppercase">
            <span>Description</span>
            <span className="text-center">Qty</span>
            <span className="text-right">Unit Price</span>
            <span className="text-right">Total</span>
          </div>
        </div>

        {/* Table rows */}
        <div className="divide-border/60 divide-y">
          {lineItems.map((item, index) => {
            const lineTotal = item.quantity * Number(item.unit_price || 0)
            return (
              <div
                key={item.id}
                className="grid grid-cols-[1fr,80px,100px,100px] items-center gap-0 px-5 py-3"
              >
                <div className="pr-4">
                  <Input
                    id={`line-description-${index}`}
                    value={item.description}
                    className="h-8 text-sm"
                    onChange={(event) =>
                      setLineItems((current) =>
                        current.map((line, lineIndex) =>
                          lineIndex === index
                            ? { ...line, description: event.target.value }
                            : line,
                        ),
                      )
                    }
                  />
                </div>
                <div className="flex justify-center">
                  <Input
                    id={`line-quantity-${index}`}
                    value={String(item.quantity)}
                    disabled
                    className="h-8 w-14 text-center text-sm"
                  />
                </div>
                <div className="flex justify-end">
                  <Input
                    id={`line-price-${index}`}
                    type="number"
                    step="0.01"
                    value={item.unit_price}
                    className="h-8 w-24 text-right text-sm"
                    onChange={(event) =>
                      setLineItems((current) =>
                        current.map((line, lineIndex) =>
                          lineIndex === index
                            ? { ...line, unit_price: event.target.value }
                            : line,
                        ),
                      )
                    }
                  />
                </div>
                <div className="text-right text-sm font-medium tabular-nums">
                  ${lineTotal.toFixed(2)}
                </div>
              </div>
            )
          })}
        </div>

        {/* Total row */}
        <div className="border-border/60 bg-muted/20 border-t px-5 py-3">
          <div className="flex items-center justify-end gap-6">
            <span className="text-muted-foreground text-sm font-medium">
              Total
            </span>
            <span className="text-xl font-bold tabular-nums">
              ${total.toFixed(2)}
            </span>
          </div>
        </div>
      </Card>

      {/* ── Invoice Controls ── */}
      <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
        <h3 className="text-lg font-semibold">Invoice Controls</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="invoice-status">Invoice Status</Label>
            <select
              id="invoice-status"
              className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="draft">Draft</option>
              <option value="ready">Ready</option>
              <option value="sent">Sent</option>
              <option value="paid">Paid</option>
              <option value="void">Void</option>
            </select>
          </div>
          <div>
            <Label htmlFor="invoice-payment-status">Payment Status</Label>
            <select
              id="invoice-payment-status"
              className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
              value={paymentStatus}
              onChange={(event) => setPaymentStatus(event.target.value)}
            >
              <option value="unpaid">Unpaid</option>
              <option value="partial">Partial</option>
              <option value="paid">Paid</option>
              <option value="waived">Waived</option>
            </select>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save Invoice
          </Button>
          {appointment?.id ? (
            <>
              <Button
                variant="outline"
                disabled={Boolean(actionLoading)}
                onClick={() =>
                  void runAppointmentAction({
                    label: 'Confirm',
                    status: 'confirmed',
                  })
                }
              >
                {actionLoading === 'Confirm' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Confirm
              </Button>
              <Button
                variant="outline"
                disabled={Boolean(actionLoading)}
                onClick={() =>
                  void runAppointmentAction({
                    label: 'On My Way',
                    status: 'on_my_way',
                  })
                }
              >
                {actionLoading === 'On My Way' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                On My Way
              </Button>
              <Button
                variant="outline"
                disabled={Boolean(actionLoading)}
                onClick={() =>
                  void runAppointmentAction({
                    label: 'Complete',
                    status: 'completed',
                  })
                }
              >
                {actionLoading === 'Complete' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Finished
              </Button>
              <Button
                variant="outline"
                disabled={Boolean(actionLoading)}
                onClick={() =>
                  void runAppointmentAction({
                    label: 'Mark Paid',
                    payment_status: 'paid',
                  })
                }
              >
                {actionLoading === 'Mark Paid' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Mark Paid
              </Button>
            </>
          ) : null}
          <Button
            variant="outline"
            disabled={Boolean(actionLoading)}
            onClick={() => void handleDeleteInvoice()}
          >
            {actionLoading === 'Delete Invoice' ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Delete Invoice Only
          </Button>
        </div>
      </Card>
    </div>
  )
}
