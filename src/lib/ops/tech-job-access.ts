import type { createAdminClient } from '@/supabase/server'

type AdminClient = ReturnType<typeof createAdminClient>

type OperationalAccess = {
  role: string
  staff: {
    id: string
  } | null
}

export async function assertTechAppointmentAccess(
  supabase: AdminClient,
  access: OperationalAccess,
  appointmentId: string,
) {
  if (access.role !== 'tech') return
  if (!access.staff?.id) throw new Error('Not authorized')

  const { data, error } = await supabase
    .from('ops_appointments')
    .select('id')
    .eq('id', appointmentId)
    .eq('assigned_staff_user_id', access.staff.id)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('Not authorized')
}

export async function assertTechInvoiceAccess(
  supabase: AdminClient,
  access: OperationalAccess,
  invoiceId: string,
) {
  if (access.role !== 'tech') return

  const { data, error } = await supabase
    .from('ops_invoices')
    .select('appointment_id')
    .eq('id', invoiceId)
    .maybeSingle()

  if (error) throw error
  if (!data?.appointment_id) throw new Error('Not authorized')

  await assertTechAppointmentAccess(supabase, access, data.appointment_id)
}
