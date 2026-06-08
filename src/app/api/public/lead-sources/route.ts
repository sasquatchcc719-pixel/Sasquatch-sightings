import { NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { getPublicLeadSourceOptions } from '@/lib/lead-sources'
import { getLeadSourceOptions } from '@/lib/server/lead-sources'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control':
    'public, max-age=300, s-maxage=300, stale-while-revalidate=3600',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function GET() {
  const supabase = createAdminClient()
  const options = await getLeadSourceOptions(supabase, {
    activeOnly: true,
    publicOnly: true,
  })

  return NextResponse.json(
    {
      options: getPublicLeadSourceOptions(options),
      updated_at: new Date().toISOString(),
    },
    { headers: CORS },
  )
}
