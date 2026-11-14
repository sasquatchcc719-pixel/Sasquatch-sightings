import { NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { readCellularUsage } from '@/lib/hologram-usage'

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    return NextResponse.json(await readCellularUsage(), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    console.error(
      '[cellular-usage] Unable to load carrier usage:',
      error instanceof Error ? error.message : 'Unknown error',
    )
    return NextResponse.json(
      { error: 'Cellular usage is unavailable' },
      { status: 503 },
    )
  }
}
