import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import RecurringVisitDetail from '@/components/admin/ops/recurring-visit-detail'

export default async function RecurringVisitPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <Suspense
      fallback={
        <div className="text-muted-foreground flex items-center gap-3 p-8">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading visit…
        </div>
      }
    >
      <RecurringVisitDetail appointmentId={id} />
    </Suspense>
  )
}
