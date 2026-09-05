'use client'

import { useEffect, useState } from 'react'
import { z } from 'zod'

// These records never enter an API payload, customer database, or notification.
const KEY = 'sasquatch:commercial-test-requests:v1'
const EVENT = 'commercial-test-requests-changed'
const MAX_AGE = 7 * 24 * 60 * 60 * 1000
const schema = z.object({
  id: z.string().startsWith('test-'),
  customer_id: z.string(),
  business_name: z.string(),
  request_type: z.string(),
  message: z.string().nullable(),
  details: z.record(z.string(), z.string()),
  appointment_id: z.string().nullable(),
  admin_notes: z.string().nullable(),
  status: z.enum(['pending', 'approved', 'declined', 'done']),
  created_at: z.string().datetime(),
  resolved_at: z.string().datetime().nullable(),
})
export type TestRequest = z.infer<typeof schema>

function read(): TestRequest[] {
  const raw = localStorage.getItem(KEY)
  if (!raw) return []
  const parsed = z.array(schema).safeParse(JSON.parse(raw))
  if (!parsed.success)
    throw new Error(
      'Test records could not be read. Clear this browser’s test records and try again.',
    )
  return parsed.data
    .filter((r) => Date.now() - Date.parse(r.created_at) < MAX_AGE)
    .slice(0, 50)
}

export function useCommercialTestRequests(customerId?: string) {
  const [records, setRecords] = useState<TestRequest[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    function reload() {
      try {
        setRecords(read())
        setError('')
      } catch {
        setError(
          'Browser test storage is unavailable or unreadable. Your test was not loaded. Real requests are unaffected.',
        )
      }
    }
    reload()
    window.addEventListener(EVENT, reload)
    window.addEventListener('storage', reload)
    return () => {
      window.removeEventListener(EVENT, reload)
      window.removeEventListener('storage', reload)
    }
  }, [])

  function change(update: (current: TestRequest[]) => TestRequest[]) {
    try {
      const next = update(read()).slice(0, 50)
      localStorage.setItem(KEY, JSON.stringify(next))
      setRecords(next)
      setError('')
      window.dispatchEvent(new Event(EVENT))
    } catch {
      throw new Error(
        'Could not save the test record in this browser. Allow browser storage and try again; no request was sent.',
      )
    }
  }

  function add(
    record: Omit<
      TestRequest,
      'id' | 'created_at' | 'resolved_at' | 'status' | 'admin_notes'
    >,
  ) {
    const next: TestRequest = {
      ...record,
      id: `test-${crypto.randomUUID()}`,
      created_at: new Date().toISOString(),
      status: 'pending',
      admin_notes: null,
      resolved_at: null,
    }
    change((current) => [next, ...current])
    return next
  }
  function resolve(id: string, status: TestRequest['status'], notes?: string) {
    change((current) =>
      current.map((r) =>
        r.id === id && (!customerId || r.customer_id === customerId)
          ? {
              ...r,
              status,
              admin_notes: notes ?? r.admin_notes,
              resolved_at:
                status === 'pending' ? null : new Date().toISOString(),
            }
          : r,
      ),
    )
  }
  function clear() {
    // Remove only this feature's browser records, never production records.
    if (customerId)
      change((current) => current.filter((r) => r.customer_id !== customerId))
    else {
      localStorage.removeItem(KEY)
      setRecords([])
      setError('')
      window.dispatchEvent(new Event(EVENT))
    }
  }
  return {
    records: records.filter((r) => !customerId || r.customer_id === customerId),
    error,
    add,
    resolve,
    clear,
  }
}
