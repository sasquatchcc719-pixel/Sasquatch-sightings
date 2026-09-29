import type { Metadata } from 'next'
import { TomorrowFillControlCenter } from '@/components/admin/ops/tomorrow-fill-control-center'

export const metadata: Metadata = {
  title: 'Tomorrow Fill | Operations',
}

export default function TomorrowFillPage() {
  return <TomorrowFillControlCenter />
}
