import { Suspense } from 'react'
import { RestorationNewWorkspace } from '@/components/admin/ops/restoration-new-workspace'

export default function RestorationNewPage() {
  return (
    <Suspense fallback={<div className="p-4 text-sm">Loading…</div>}>
      <RestorationNewWorkspace />
    </Suspense>
  )
}
