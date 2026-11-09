import Link from 'next/link'
import { ChannelPnlView } from '@/components/admin/marketing/ChannelPnlView'

export default function MarketingPage() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-white">Marketing</h2>
        <p className="text-sm text-slate-400">
          What each lead source actually earns after ad spend and labor — so you
          can see which ones are worth the money.
        </p>
      </div>
      <Link
        href="/admin/marketing/seo"
        className="inline-block text-sm text-sky-300"
      >
        Open SEO briefing →
      </Link>
      <ChannelPnlView />
    </div>
  )
}
