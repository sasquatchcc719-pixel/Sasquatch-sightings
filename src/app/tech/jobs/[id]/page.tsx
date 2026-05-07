import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { getAssignedTechAppointment } from '@/lib/tech/appointments'
import { TechJobDetail } from '@/components/tech/tech-job-detail'

export default async function TechJobPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const access = await requireAnyRole(['admin', 'owner', 'tech'])
  const supabase = createAdminClient()
  const { id } = await params
  const appointment = await getAssignedTechAppointment(supabase, access.id, id)

  if (!appointment) notFound()

  return (
    <div className="space-y-4">
      <Link
        href="/tech"
        className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to today
      </Link>
      <TechJobDetail initialAppointment={appointment} />
    </div>
  )
}
