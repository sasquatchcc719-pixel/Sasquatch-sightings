import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

/**
 * GET /api/admin/stats/lead-sources
 * Returns lead source breakdown with booking counts and revenue
 */
export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('start_date') || '2020-01-01'
    const endDate = searchParams.get('end_date') || '2099-12-31'

    // Get lead source breakdown with revenue
    const { data, error } = await supabase.rpc('get_lead_source_stats', {
      p_start_date: startDate,
      p_end_date: endDate,
    })

    if (error) {
      // Fallback to direct query if RPC doesn't exist yet
      const { data: appointments, error: queryError } = await supabase
        .from('ops_appointments')
        .select(
          `
          id,
          lead_source,
          status,
          quoted_total,
          ops_invoices(total)
        `,
        )
        .gte('appointment_date', startDate)
        .lte('appointment_date', endDate)
        .neq('status', 'cancelled')
        .not('lead_source', 'is', null)

      if (queryError) throw queryError

      // Aggregate in memory
      const sourceMap = new Map<
        string,
        { count: number; completed: number; revenue: number }
      >()

      for (const appt of appointments || []) {
        const source = appt.lead_source || 'Unknown'
        const existing = sourceMap.get(source) || {
          count: 0,
          completed: 0,
          revenue: 0,
        }

        existing.count++
        if (appt.status === 'completed') existing.completed++

        // Use invoice total if available, otherwise quoted total
        const invoiceTotal = Array.isArray(appt.ops_invoices)
          ? appt.ops_invoices[0]?.total
          : (appt.ops_invoices as any)?.total
        const revenue = invoiceTotal || appt.quoted_total || 0
        existing.revenue += Number(revenue)

        sourceMap.set(source, existing)
      }

      // Convert to array and sort
      const sources = Array.from(sourceMap.entries())
        .map(([name, stats]) => ({
          lead_source: name,
          booking_count: stats.count,
          completed_count: stats.completed,
          total_revenue: Math.round(stats.revenue * 100) / 100,
          avg_ticket:
            stats.count > 0
              ? Math.round((stats.revenue / stats.count) * 100) / 100
              : 0,
        }))
        .sort((a, b) => b.booking_count - a.booking_count)

      const totalBookings = sources.reduce((sum, s) => sum + s.booking_count, 0)
      const totalRevenue = sources.reduce((sum, s) => sum + s.total_revenue, 0)

      return NextResponse.json({
        sources: sources.map((s) => ({
          ...s,
          percentage:
            totalBookings > 0
              ? Math.round((s.booking_count / totalBookings) * 1000) / 10
              : 0,
        })),
        total_bookings: totalBookings,
        total_revenue: Math.round(totalRevenue * 100) / 100,
        date_range: { start: startDate, end: endDate },
      })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('[stats/lead-sources] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load lead source stats' },
      { status: 500 },
    )
  }
}
