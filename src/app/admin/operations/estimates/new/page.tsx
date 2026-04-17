import { NewEstimateWorkspace } from '@/components/admin/ops/new-estimate-workspace'

type PageProps = {
  searchParams: Promise<{ date?: string; time?: string }>
}

export default async function NewEstimatePage({ searchParams }: PageProps) {
  const { date, time } = await searchParams
  return (
    <NewEstimateWorkspace
      initialDate={date || null}
      initialTime={time || null}
    />
  )
}
