import { RecurringManager } from '@/components/admin/ops/recurring-manager'
import { ClientRequestsPanel } from '@/components/admin/ops/client-requests-panel'

type RecurringPageProps = {
  searchParams: Promise<{ sourceAppointment?: string }>
}

export default async function RecurringPage({
  searchParams,
}: RecurringPageProps) {
  const { sourceAppointment } = await searchParams

  return (
    <>
      <ClientRequestsPanel />
      <RecurringManager sourceAppointmentId={sourceAppointment} />
    </>
  )
}
