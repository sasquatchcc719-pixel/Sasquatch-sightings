import Link from 'next/link'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { loadCommercialData } from '@/lib/ops/commercial-server'
import { loadClientPortalData } from '@/lib/ops/client-portal'
import { CommercialClientPreview } from '@/components/admin/ops/commercial-client-preview'
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
      <CommercialClientPreview commercial={commercial} schedule={schedule} />
    </div>
  )
}
