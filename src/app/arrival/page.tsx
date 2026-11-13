import type { Metadata } from 'next'
import ArrivalProgress from './arrival-progress'

export const metadata: Metadata = {
  title: 'Your arrival | Sasquatch Carpet Cleaning',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
  openGraph: null,
  twitter: null,
}

export default function ArrivalPage() {
  return <ArrivalProgress />
}
