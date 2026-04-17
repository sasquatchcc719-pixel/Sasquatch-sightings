'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, Ruler, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

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

type CustomerSearchResult = {
  id: string
  full_name: string
  first_name: string | null
  last_name: string | null
  business_name: string | null
  email: string | null
  phone: string
  notes: string | null
  ops_service_addresses: CustomerAddress[]
}

type NewEstimateWorkspaceProps = {
  initialDate: string | null
  initialTime: string | null
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function NewEstimateWorkspace({
  initialDate,
  initialTime,
}: NewEstimateWorkspaceProps) {
  const router = useRouter()

  const [customerQuery, setCustomerQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [customerResults, setCustomerResults] = useState<
    CustomerSearchResult[]
  >([])
  const [selectedCustomer, setSelectedCustomer] =
    useState<CustomerSearchResult | null>(null)
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(
    null,
  )

  const [usingNewAddress, setUsingNewAddress] = useState(false)
  const [newAddress, setNewAddress] = useState({
    label: 'Service Address',
    street_1: '',
    street_2: '',
    city: '',
    state: 'CO',
    zip_code: '',
    gate_code: '',
    notes: '',
  })

  const [useNewCustomer, setUseNewCustomer] = useState(false)
  const [newCustomer, setNewCustomer] = useState({
    first_name: '',
    last_name: '',
    business_name: '',
    phone: '',
    email: '',
    notes: '',
  })

  const [appointmentDate, setAppointmentDate] = useState(
    initialDate || todayIso(),
  )
  const [startTime, setStartTime] = useState(initialTime || '09:00')
  const [internalNotes, setInternalNotes] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Customer search with debounce
  useEffect(() => {
    if (useNewCustomer) return
    if (!customerQuery.trim()) {
      setCustomerResults([])
      return
    }
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        setSearching(true)
        try {
          const res = await fetch(
            `/api/admin/ops/customers?q=${encodeURIComponent(customerQuery)}`,
            { cache: 'no-store' },
          )
          const result = await res.json()
          if (!res.ok) {
            throw new Error(result.error || 'Failed to search customers')
          }
          setCustomerResults(result.customers || [])
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Search failed')
        } finally {
          setSearching(false)
        }
      })()
    }, 250)
    return () => window.clearTimeout(timeoutId)
  }, [customerQuery, useNewCustomer])

  const availableAddresses = useMemo(() => {
    return selectedCustomer?.ops_service_addresses || []
  }, [selectedCustomer])

  useEffect(() => {
    if (!selectedCustomer) {
      setSelectedAddressId(null)
      setUsingNewAddress(false)
      return
    }
    if (availableAddresses.length > 0 && !selectedAddressId) {
      setSelectedAddressId(availableAddresses[0].id)
      setUsingNewAddress(false)
    } else if (availableAddresses.length === 0) {
      setUsingNewAddress(true)
    }
  }, [selectedCustomer, availableAddresses, selectedAddressId])

  const canSubmit = useMemo(() => {
    if (submitting) return false
    if (!appointmentDate || !startTime) return false
    if (useNewCustomer) {
      const ok = newCustomer.phone.trim().length >= 7
      if (!ok) return false
    } else {
      if (!selectedCustomer) return false
    }
    if (usingNewAddress) {
      return (
        newAddress.street_1.trim().length > 0 &&
        newAddress.city.trim().length > 0 &&
        newAddress.zip_code.trim().length >= 5
      )
    }
    return !!selectedAddressId
  }, [
    submitting,
    appointmentDate,
    startTime,
    useNewCustomer,
    newCustomer.phone,
    selectedCustomer,
    usingNewAddress,
    newAddress.street_1,
    newAddress.city,
    newAddress.zip_code,
    selectedAddressId,
  ])

  const handleSubmit = useCallback(async () => {
    setSubmitting(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        appointment_date: appointmentDate,
        start_time: startTime,
        internal_notes: internalNotes || null,
      }

      if (useNewCustomer) {
        body.customer = {
          first_name: newCustomer.first_name || null,
          last_name: newCustomer.last_name || null,
          business_name: newCustomer.business_name || null,
          full_name:
            `${newCustomer.first_name} ${newCustomer.last_name}`.trim() ||
            newCustomer.business_name ||
            'Customer',
          phone: newCustomer.phone,
          email: newCustomer.email || null,
          notes: newCustomer.notes || null,
        }
      } else if (selectedCustomer) {
        body.customer_id = selectedCustomer.id
      }

      if (usingNewAddress) {
        body.address = {
          label: newAddress.label || 'Service Address',
          street_1: newAddress.street_1,
          street_2: newAddress.street_2 || null,
          city: newAddress.city,
          state: newAddress.state,
          zip_code: newAddress.zip_code,
          gate_code: newAddress.gate_code || null,
          notes: newAddress.notes || null,
        }
      } else if (selectedAddressId) {
        body.service_address_id = selectedAddressId
      }

      const res = await fetch('/api/admin/ops/estimates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(payload?.error || 'Failed to create estimate')
      }

      router.push(`/admin/operations/estimates/${payload.estimate_id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create estimate')
      setSubmitting(false)
    }
  }, [
    appointmentDate,
    startTime,
    internalNotes,
    useNewCustomer,
    newCustomer,
    selectedCustomer,
    usingNewAddress,
    newAddress,
    selectedAddressId,
    router,
  ])

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 md:p-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin/operations/estimates" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
        </Button>
      </div>

      <div>
        <div className="flex items-center gap-2">
          <Ruler className="text-muted-foreground h-5 w-5" />
          <h1 className="text-2xl font-bold">New estimate</h1>
        </div>
        <p className="text-muted-foreground text-sm">
          Book a measuring visit. You can add line items, lengths, widths, and
          detailed notes after the estimate is created.
        </p>
      </div>

      {/* ── Customer ─────────────────────────────────────────────────── */}
      <Card className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Customer</h2>
          <Button
            variant="link"
            className="h-auto p-0 text-xs"
            onClick={() => {
              setUseNewCustomer((v) => !v)
              setSelectedCustomer(null)
              setCustomerResults([])
              setCustomerQuery('')
            }}
          >
            {useNewCustomer
              ? 'Search existing customer'
              : 'Create new customer'}
          </Button>
        </div>

        {useNewCustomer ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">First name</Label>
              <Input
                value={newCustomer.first_name}
                onChange={(e) =>
                  setNewCustomer((c) => ({ ...c, first_name: e.target.value }))
                }
              />
            </div>
            <div>
              <Label className="text-xs">Last name</Label>
              <Input
                value={newCustomer.last_name}
                onChange={(e) =>
                  setNewCustomer((c) => ({ ...c, last_name: e.target.value }))
                }
              />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">Business (optional)</Label>
              <Input
                value={newCustomer.business_name}
                onChange={(e) =>
                  setNewCustomer((c) => ({
                    ...c,
                    business_name: e.target.value,
                  }))
                }
              />
            </div>
            <div>
              <Label className="text-xs">Phone *</Label>
              <Input
                value={newCustomer.phone}
                onChange={(e) =>
                  setNewCustomer((c) => ({ ...c, phone: e.target.value }))
                }
                placeholder="+1XXXXXXXXXX"
              />
            </div>
            <div>
              <Label className="text-xs">Email</Label>
              <Input
                type="email"
                value={newCustomer.email}
                onChange={(e) =>
                  setNewCustomer((c) => ({ ...c, email: e.target.value }))
                }
              />
            </div>
          </div>
        ) : selectedCustomer ? (
          <div className="rounded-md border p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium">
                  {selectedCustomer.business_name || selectedCustomer.full_name}
                </p>
                <p className="text-muted-foreground text-sm">
                  {selectedCustomer.phone}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedCustomer(null)
                  setSelectedAddressId(null)
                }}
              >
                Change
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <div className="relative">
              <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <Input
                className="pl-9"
                placeholder="Search by name, phone, or business…"
                value={customerQuery}
                onChange={(e) => setCustomerQuery(e.target.value)}
              />
            </div>
            {searching ? (
              <p className="text-muted-foreground mt-2 text-xs">Searching…</p>
            ) : null}
            {customerResults.length > 0 ? (
              <div className="mt-2 overflow-hidden rounded-md border">
                {customerResults.slice(0, 10).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="hover:bg-muted flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm"
                    onClick={() => {
                      setSelectedCustomer(c)
                      setCustomerResults([])
                      setCustomerQuery('')
                    }}
                  >
                    <span className="font-medium">
                      {c.business_name || c.full_name}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {c.phone}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </Card>

      {/* ── Address ──────────────────────────────────────────────────── */}
      {(selectedCustomer || useNewCustomer) && (
        <Card className="space-y-3 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Service address</h2>
            {availableAddresses.length > 0 ? (
              <Button
                variant="link"
                className="h-auto p-0 text-xs"
                onClick={() => setUsingNewAddress((v) => !v)}
              >
                {usingNewAddress
                  ? 'Pick saved address'
                  : 'Enter a different address'}
              </Button>
            ) : null}
          </div>

          {!usingNewAddress && availableAddresses.length > 0 ? (
            <div className="space-y-2">
              {availableAddresses.map((addr) => (
                <label
                  key={addr.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
                    selectedAddressId === addr.id
                      ? 'border-emerald-400 bg-emerald-50/60'
                      : 'hover:bg-muted'
                  }`}
                >
                  <input
                    type="radio"
                    className="mt-1"
                    checked={selectedAddressId === addr.id}
                    onChange={() => setSelectedAddressId(addr.id)}
                  />
                  <div className="flex-1 text-sm">
                    <p className="font-medium">{addr.label || 'Address'}</p>
                    <p className="text-muted-foreground">
                      {addr.street_1}
                      {addr.street_2 ? `, ${addr.street_2}` : ''}, {addr.city},{' '}
                      {addr.state} {addr.zip_code}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label className="text-xs">Street *</Label>
                <Input
                  value={newAddress.street_1}
                  onChange={(e) =>
                    setNewAddress((a) => ({ ...a, street_1: e.target.value }))
                  }
                />
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs">Street 2</Label>
                <Input
                  value={newAddress.street_2}
                  onChange={(e) =>
                    setNewAddress((a) => ({ ...a, street_2: e.target.value }))
                  }
                  placeholder="Apt, Suite, etc."
                />
              </div>
              <div>
                <Label className="text-xs">City *</Label>
                <Input
                  value={newAddress.city}
                  onChange={(e) =>
                    setNewAddress((a) => ({ ...a, city: e.target.value }))
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">State</Label>
                  <Input
                    value={newAddress.state}
                    onChange={(e) =>
                      setNewAddress((a) => ({ ...a, state: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <Label className="text-xs">Zip *</Label>
                  <Input
                    value={newAddress.zip_code}
                    onChange={(e) =>
                      setNewAddress((a) => ({
                        ...a,
                        zip_code: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">Gate code</Label>
                <Input
                  value={newAddress.gate_code}
                  onChange={(e) =>
                    setNewAddress((a) => ({ ...a, gate_code: e.target.value }))
                  }
                />
              </div>
              <div>
                <Label className="text-xs">Access notes</Label>
                <Input
                  value={newAddress.notes}
                  onChange={(e) =>
                    setNewAddress((a) => ({ ...a, notes: e.target.value }))
                  }
                />
              </div>
            </div>
          )}
        </Card>
      )}

      {/* ── Schedule ─────────────────────────────────────────────────── */}
      <Card className="space-y-3 p-5">
        <h2 className="text-base font-semibold">When to measure</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Date</Label>
            <Input
              type="date"
              value={appointmentDate}
              onChange={(e) => setAppointmentDate(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Start time</Label>
            <Input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </div>
        </div>
        <div>
          <Label className="text-xs">Internal notes (private)</Label>
          <Textarea
            rows={2}
            value={internalNotes}
            onChange={(e) => setInternalNotes(e.target.value)}
            placeholder="Anything you want to remember before the measure…"
          />
        </div>
        <p className="text-muted-foreground text-xs">
          30-minute block. You can adjust duration and add line items with
          length × width after creating the estimate.
        </p>
      </Card>

      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" asChild>
          <Link href="/admin/operations/estimates">Cancel</Link>
        </Button>
        <Button
          disabled={!canSubmit}
          onClick={() => void handleSubmit()}
          className="gap-2"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {submitting ? 'Creating…' : 'Create estimate'}
        </Button>
      </div>
    </div>
  )
}
