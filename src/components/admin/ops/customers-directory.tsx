'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Loader2, Search, UserRound } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

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

type CustomerRow = {
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

export function CustomersDirectory() {
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [customers, setCustomers] = useState<CustomerRow[]>([])

  useEffect(() => {
    const runSearch = async () => {
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
          {
            cache: 'no-store',
          },
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

    const timeoutId = window.setTimeout(() => {
      void runSearch()
    }, 250)
    return () => window.clearTimeout(timeoutId)
  }, [query])

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
          {customers.map((customer) => (
            <Card
              key={customer.id}
              className="border-border/60 bg-card/80 p-4 shadow-sm backdrop-blur"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
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
                <Badge variant="outline">
                  {customer.ops_service_addresses?.length || 0} saved address
                  {(customer.ops_service_addresses?.length || 0) === 1
                    ? ''
                    : 'es'}
                </Badge>
              </div>

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
                        {address.street_2 ? `, ${address.street_2}` : ''},{' '}
                        {address.city}, {address.state} {address.zip_code}
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
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
