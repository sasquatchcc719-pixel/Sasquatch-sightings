import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { DryingReportPDF } from '@/lib/ops/pdf/drying-report'
import { buildDryingReportData } from '@/lib/ops/pdf/drying-report-data'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { id } = await params
    const supabase = createAdminClient()

    const includePhotos = request.nextUrl.searchParams.get('photos') !== '0'
    const built = await buildDryingReportData(supabase, id, includePhotos)
    if (!built)
      return NextResponse.json({ error: 'project_not_found' }, { status: 404 })
    const { data } = built

    // A single unreachable photo must not cost the whole report. If the render
    // fails with images in, fall back to the same document without them rather
    // than handing back an error.
    let buffer: Buffer
    try {
      buffer = Buffer.from(
        await renderToBuffer(<DryingReportPDF data={data} />),
      )
    } catch (renderError) {
      console.error(
        '[restoration/report] retrying without photos:',
        renderError,
      )
      buffer = Buffer.from(
        await renderToBuffer(
          <DryingReportPDF data={{ ...data, includePhotos: false }} />,
        ),
      )
    }

    const safeName = (data.customer.name || 'report')
      .replace(/[^a-z0-9]+/gi, '-')
      .toLowerCase()
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="drying-report-${safeName}.pdf"`,
      },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to build report'
    return NextResponse.json(
      { error: message },
      { status: message === 'Not authorized' ? 403 : 500 },
    )
  }
}
