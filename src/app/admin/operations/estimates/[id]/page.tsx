import { EstimateDetail } from '@/components/admin/ops/estimate-detail'

type EstimateDetailPageProps = {
  params: Promise<{ id: string }>
}

export default async function EstimateDetailPage({
  params,
}: EstimateDetailPageProps) {
  const { id } = await params
  return <EstimateDetail estimateId={id} />
}
