import { EstimateDetail } from '@/components/admin/ops/estimate-detail'

type EstimateDetailPageProps = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ schedule?: string }>
}

export default async function EstimateDetailPage({
  params,
  searchParams,
}: EstimateDetailPageProps) {
  const { id } = await params
  const { schedule } = await searchParams
  return <EstimateDetail estimateId={id} openSchedule={schedule === '1'} />
}
