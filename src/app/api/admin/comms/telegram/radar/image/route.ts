import { requireAnyRole } from '@/lib/auth'
import { buildRadarDailyReport } from '@/lib/radar-scan'
import { renderReportCardPng } from '@/lib/reports/report-card'
export const maxDuration = 60
export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'marketing'])
    const report = await buildRadarDailyReport()
    if (!report)
      return Response.json(
        { error: 'No ranking history available' },
        { status: 404 },
      )
    const png = await renderReportCardPng(report.card)
    return new Response(new Uint8Array(png), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'private, max-age=60',
      },
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'History unavailable'
    return Response.json(
      { error: message },
      { status: message === 'Not authorized' ? 403 : 500 },
    )
  }
}
