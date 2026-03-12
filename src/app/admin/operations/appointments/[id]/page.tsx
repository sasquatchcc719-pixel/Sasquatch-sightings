import { AppointmentDetail } from '@/components/admin/ops/appointment-detail'

type AppointmentDetailPageProps = {
  params: Promise<{ id: string }>
}

export default async function AppointmentDetailPage({
  params,
}: AppointmentDetailPageProps) {
  const { id } = await params
  return <AppointmentDetail appointmentId={id} />
}
