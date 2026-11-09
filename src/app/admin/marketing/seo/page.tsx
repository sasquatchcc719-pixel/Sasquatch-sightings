'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { SeoLedgerEditor } from '@/components/admin/marketing/SeoLedgerEditor'
import { SeoBriefingContent } from '@/components/admin/marketing/SeoBriefingContent'
import type { SeoBriefing } from '@/lib/seo/briefing'

export default function SeoBriefingPage() {
  const [report, setReport] = useState<SeoBriefing | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/admin/marketing/seo/briefing', {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Read failed')
        return response.json() as Promise<SeoBriefing>
      })
      .then((value) => {
        if (!controller.signal.aborted) setReport(value)
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setError(true)
      })
    return () => controller.abort()
  }, [attempt])
  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-12">
      <div>
        <Link className="text-sm text-sky-300" href="/admin/marketing">
          ← Marketing
        </Link>
        <h1 className="mt-3 text-2xl font-semibold text-white">SEO briefing</h1>
        <p className="mt-2 text-sm text-slate-400">
          Results, recorded changes and the next two actions. Maps, organic
          search and business outcomes stay separate.
        </p>
      </div>
      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-amber-500/30 p-4 text-amber-200"
        >
          Could not read the briefing. No scans were started.
          <button
            className="ml-3 underline"
            onClick={() => {
              setError(false)
              setReport(null)
              setAttempt((n) => n + 1)
            }}
          >
            Retry
          </button>
        </div>
      ) : !report ? (
        <p role="status" className="text-slate-400">
          Reading existing evidence…
        </p>
      ) : (
        <SeoBriefingContent report={report} />
      )}
      <SeoLedgerEditor onSaved={() => setAttempt((n) => n + 1)} />
    </div>
  )
}
