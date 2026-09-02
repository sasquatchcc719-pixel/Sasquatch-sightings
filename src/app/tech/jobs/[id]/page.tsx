import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { getTechAppointmentForAccess } from '@/lib/tech/appointments'
import { InvoiceDetail } from '@/components/admin/ops/invoice-detail'
import { TechJobDetail } from '@/components/tech/tech-job-detail'
import { RestorationProjectDetail } from '@/components/admin/ops/restoration-project-detail'

export default async function TechJobPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const access = await requireAnyRole(['admin', 'owner', 'tech'])
  const supabase = createAdminClient()
  const { id } = await params
  const appointment = await getTechAppointmentForAccess(supabase, {
    role: access.role,
    staffId: access.staff?.id ?? null,
    appointmentId: id,
  })

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
      {/*
        A water loss gets the water-loss screen, not the carpet invoice.

        The project invoice hangs off whichever visit the job was closed
        from, so a tech opening that visit used to fall into InvoiceDetail —
        a screen with no idea restoration exists. David Gonzalez opened the
        Benns job and got a bare line-item table with no readings, no
        equipment, no map. Charles: "he got this bullshit with nothing in it
        and he can't even take readings."
      */}
      {appointment.restorationProjectId ? (
        <RestorationProjectDetail
          projectId={appointment.restorationProjectId}
          visitId={appointment.id}
        />
      ) : appointment.invoice && !appointment.hidePricing ? (
        <InvoiceDetail invoiceId={appointment.invoice.id} mode="tech" />
      ) : (
        <TechJobDetail initialAppointment={appointment} />
      )}
    </div>
  )
}
