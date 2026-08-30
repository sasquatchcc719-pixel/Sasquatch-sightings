import { RestorationProjectDetail } from '@/components/admin/ops/restoration-project-detail'

export default async function RestorationProjectPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <RestorationProjectDetail projectId={id} />
}
