import Link from 'next/link'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { loadCommercialData } from '@/lib/ops/commercial-server'
import { loadClientPortalData, formatTime } from '@/lib/ops/client-portal'
import {
  ClientCommercialDetails,
  panelClass,
} from '@/components/client/commercial-details'
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAnyRole(['admin', 'owner'])
  const { id } = await params
  const db = createAdminClient()
  const [commercial, schedule] = await Promise.all([
    loadCommercialData(db, id),
    loadClientPortalData(db, id),
  ])
  return (
    <div className="space-y-5 text-slate-100">
      <Link
        className="text-cyan-300"
        href={`/admin/operations/commercial/${id}`}
      >
        ← Back to account
      </Link>
      <h2 className="text-2xl font-bold">{commercial.businessName}</h2>
      <p className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-200">
        Read-only client preview. You are still signed in as staff. Draft
        agreements are private; only published and signed versions appear here.
      </p>
      <ClientCommercialDetails initialData={commercial} readOnly />
      <section className={panelClass}>
        <h3 className="mb-3 text-xl font-semibold">Scheduled visits</h3>
        <div className="space-y-3">
          {schedule.appointments.map((a) => (
            <div key={a.id} className="rounded-lg border border-white/10 p-3">
              <p>
                {a.appointment_date} · {formatTime(a.start_time)} · {a.status}
              </p>
              <p className="text-sm text-slate-300">
                {a.template_label ||
                  a.line_items.map((l) => l.name_snapshot).join(', ')}
              </p>
              {a.client_note && (
                <p className="text-xs text-slate-400">
                  Client note: {a.client_note}
                </p>
              )}
            </div>
          ))}
          {!schedule.appointments.length && <p>No scheduled visits yet.</p>}
        </div>
      </section>
    </div>
  )
}
