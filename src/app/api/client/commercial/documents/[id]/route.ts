import { NextRequest, NextResponse } from 'next/server'
import { requireClientManager } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

type Context = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: Context) {
  try {
    const { client } = await requireClientManager()
    const { id } = await params
    const db = createAdminClient()
    const { data: document, error } = await db
      .from('ops_commercial_documents')
      .select('filename,mime_type,storage_bucket,storage_path')
      .eq('id', id)
      .eq('customer_id', client.customer_id)
      .maybeSingle()

    if (error) throw error
    if (!document)
      return NextResponse.json(
        { error: 'Document not found.' },
        { status: 404 },
      )

    const { data, error: downloadError } = await db.storage
      .from(document.storage_bucket)
      .download(document.storage_path)
    if (downloadError || !data)
      throw downloadError || new Error('Document file is unavailable.')

    const disposition =
      request.nextUrl.searchParams.get('download') === '1'
        ? 'attachment'
        : 'inline'
    const safeFilename = document.filename.replace(/["\\\r\n]/g, '-')
    return new NextResponse(new Uint8Array(await data.arrayBuffer()), {
      headers: {
        'Content-Type': document.mime_type,
        'Content-Disposition': `${disposition}; filename="${safeFilename}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to download document'
    return NextResponse.json(
      { error: 'Unable to download document' },
      { status: message === 'Not a client manager' ? 403 : 500 },
    )
  }
}
