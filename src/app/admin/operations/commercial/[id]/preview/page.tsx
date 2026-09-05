import Link from 'next/link'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { loadCommercialData } from '@/lib/ops/commercial-server'
import { loadClientPortalData } from '@/lib/ops/client-portal'
import { ClientCommercialDetails } from '@/components/client/commercial-details'
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
      <p className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-xs text-slate-300">
        Read-only client preview. You are still signed in as staff. Draft
        agreements are private; only published and signed versions appear here.
      </p>
      <ClientCommercialDetails
        initialData={commercial}
        schedule={schedule}
        readOnly
      />
    </div>
  )
}
