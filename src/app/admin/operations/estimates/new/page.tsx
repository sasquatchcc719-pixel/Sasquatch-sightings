'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function NewEstimatePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const creating = useRef(false)

  useEffect(() => {
    if (creating.current) return
    creating.current = true

    const date = searchParams.get('date') || todayIso()
    const time = searchParams.get('time') || '09:00'

    void (async () => {
      try {
        const res = await fetch('/api/admin/ops/estimates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appointment_date: date,
            start_time: time,
            // Create a placeholder customer — the user will update details
            // on the estimate detail page.
            customer: {
              first_name: 'New',
              last_name: 'Estimate',
              phone: '+10000000000',
              email: null,
              business_name: null,
            },
            address: {
              label: 'Service Address',
              street_1: 'TBD',
              city: 'TBD',
              state: 'CO',
              zip_code: '00000',
            },
          }),
        })
        const payload = await res.json().catch(() => null)
        if (!res.ok) {
          throw new Error(payload?.error || 'Failed to create estimate')
        }
        // Go straight to the estimate detail / builder page
        router.replace(`/admin/operations/estimates/${payload.estimate_id}`)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create estimate')
        creating.current = false
      }
    })()
  }, [router, searchParams])

  if (error) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-6">
        <p className="text-lg font-medium text-rose-600">{error}</p>
        <button
          className="rounded-md bg-slate-800 px-4 py-2 text-sm text-white hover:bg-slate-700"
          onClick={() => router.push('/admin/operations/estimates')}
        >
          Back to estimates
        </button>
      </div>
    )
  }

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-6">
      <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
      <p className="text-muted-foreground text-sm">Creating estimate…</p>
    </div>
  )
}
