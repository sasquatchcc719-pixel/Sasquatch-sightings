import { NextResponse } from 'next/server'

function disabled() {
  return NextResponse.json(
    {
      error:
        'Recrawl requests are disabled. Google indexing is monitored without sending crawl notifications.',
    },
    { status: 410 },
  )
}

export const GET = disabled
export const POST = disabled
