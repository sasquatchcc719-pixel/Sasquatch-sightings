/**
 * Funnel stats for Vendor vs Contest comparison
 * GET /api/admin/funnel-stats
 * Returns conversation counts and lead counts (including by status) per funnel.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { getUserWithRole } from '@/lib/auth'

const VENDOR_SOURCES = ['NFC Card', 'nfc_card']
const CONTEST_SOURCES = ['Contest']

export async function GET() {
  try {
    const { user, role } = await getUserWithRole()
    if (!user || (role !== 'admin' && role !== 'owner')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = await createAdminClient()

    // Conversations by source
    const { data: conversations } = await supabase
      .from('conversations')
      .select('id, source')

    const vendorConversations =
      conversations?.filter((c) => VENDOR_SOURCES.includes(c.source)) ?? []
    const contestConversations =
      conversations?.filter((c) => CONTEST_SOURCES.includes(c.source)) ?? []

    // Leads by source and status
    const { data: leads } = await supabase
      .from('leads')
      .select('id, source, status')

    const vendorLeads =
      leads?.filter((l) => VENDOR_SOURCES.includes(l.source)) ?? []
    const contestLeads =
      leads?.filter((l) => CONTEST_SOURCES.includes(l.source)) ?? []

    const statuses = [
      'new',
      'contacted',
      'quoted',
      'scheduled',
      'won',
      'lost',
    ] as const
    const byStatus = (list: { status: string }[]) =>
      statuses.reduce(
        (acc, s) => {
          acc[s] = list.filter((l) => l.status === s).length
          return acc
        },
        {} as Record<(typeof statuses)[number], number>,
      )

    const vendorLeadsByStatus = byStatus(vendorLeads)
    const contestLeadsByStatus = byStatus(contestLeads)

    const conversionRate = (leadsCount: number, convCount: number) =>
      convCount > 0 ? Math.round((leadsCount / convCount) * 100) : 0

    return NextResponse.json({
      vendor: {
        conversations: vendorConversations.length,
        leads: vendorLeads.length,
        leadsByStatus: vendorLeadsByStatus,
        conversionRatePct: conversionRate(
          vendorLeads.length,
          vendorConversations.length,
        ),
      },
      contest: {
        conversations: contestConversations.length,
        leads: contestLeads.length,
        leadsByStatus: contestLeadsByStatus,
        conversionRatePct: conversionRate(
          contestLeads.length,
          contestConversations.length,
        ),
      },
    })
  } catch (error) {
    console.error('Funnel stats error:', error)
    return NextResponse.json(
      { error: 'Failed to load funnel stats' },
      { status: 500 },
    )
  }
}
