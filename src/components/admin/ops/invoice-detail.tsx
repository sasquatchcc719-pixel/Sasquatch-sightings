'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
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

export function InvoiceDetail({ invoiceId }: InvoiceDetailProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
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

  return (
    <div className="space-y-6">
      {error ? (
        <Card className="border-destructive/30 bg-destructive/10 text-destructive p-4 text-sm">
          {error}
        </Card>
      ) : null}

      <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-muted-foreground text-xs font-medium tracking-[0.22em] uppercase">
              Invoice
            </p>
            <h2 className="mt-1 text-2xl font-semibold">
              {customer?.business_name || customer?.full_name || 'Customer'}
            </h2>
            <p className="text-muted-foreground mt-2 text-sm">
              {appointment?.appointment_date} ·{' '}
              {appointment?.start_time.slice(0, 5)} -{' '}
              {appointment?.end_time.slice(0, 5)}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">${total.toFixed(2)}</Badge>
            {appointment?.id ? (
              <Button asChild variant="outline">
                <Link href={`/admin/operations/appointments/${appointment.id}`}>
                  Open Job
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1fr,0.9fr]">
        <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
          <h3 className="text-lg font-semibold">Invoice Status</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div>
              <Label htmlFor="invoice-status">Status</Label>
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
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Save Invoice
            </Button>
          </div>
        </Card>

        <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
          <h3 className="text-lg font-semibold">Billing Context</h3>
          <div className="text-muted-foreground mt-4 space-y-2 text-sm">
            <div className="text-foreground font-medium">
              {customer?.business_name || customer?.full_name}
            </div>
            <div>{customer?.phone || 'No phone'}</div>
            <div>
              {address?.street_1}, {address?.city}, {address?.state}{' '}
              {address?.zip_code}
            </div>
          </div>
        </Card>
      </div>

      <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
        <h3 className="text-lg font-semibold">Line Items</h3>
        <div className="mt-4 space-y-4">
          {lineItems.map((item, index) => (
            <div
              key={item.id}
              className="border-border/60 bg-background/70 rounded-2xl border p-4"
            >
              <div className="grid gap-3 md:grid-cols-[1.6fr,0.8fr,0.8fr]">
                <div>
                  <Label htmlFor={`line-description-${index}`}>
                    Description
                  </Label>
                  <Input
                    id={`line-description-${index}`}
                    value={item.description}
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
                <div>
                  <Label htmlFor={`line-quantity-${index}`}>Quantity</Label>
                  <Input
                    id={`line-quantity-${index}`}
                    value={String(item.quantity)}
                    disabled
                  />
                </div>
                <div>
                  <Label htmlFor={`line-price-${index}`}>Unit Price</Label>
                  <Input
                    id={`line-price-${index}`}
                    type="number"
                    step="0.01"
                    value={item.unit_price}
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
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-end text-lg font-semibold">
          Total: ${total.toFixed(2)}
        </div>
      </Card>
    </div>
  )
}
