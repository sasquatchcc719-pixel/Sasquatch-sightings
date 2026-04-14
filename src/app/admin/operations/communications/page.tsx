'use client'

import { useState } from 'react'
import { CommunicationsCenter } from '@/components/admin/ops/communications-center'
import { DripCampaignsTab } from '@/components/admin/ops/drip-campaigns-tab'

const TABS = [
  { key: 'lifecycle', label: 'Lifecycle Templates' },
  { key: 'drip', label: 'Drip Campaigns' },
] as const

type TabKey = (typeof TABS)[number]['key']

export default function OperationsCommunicationsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('lifecycle')

  return (
    <div className="space-y-6">
      <div className="border-border/60 flex gap-1 border-b">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'border-primary text-primary border-b-2'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'lifecycle' && <CommunicationsCenter />}
      {activeTab === 'drip' && <DripCampaignsTab />}
    </div>
  )
}
