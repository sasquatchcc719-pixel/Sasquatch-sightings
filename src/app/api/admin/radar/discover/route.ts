/**
 * Discover domains from SerpApi for a keyword + location (competitor discovery).
 * Admin only. One SerpApi call; returns list of domain strings.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUserWithRole } from '@/lib/auth'
import { fetchSerpDomains } from '@/lib/serpApi'

export async function POST(request: NextRequest) {
  const { user, role } = await getUserWithRole()
  if (!user || role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await request.json()
  const { keyword, location } = body as { keyword?: string; location?: string }
  if (!keyword?.trim() || !location?.trim()) {
    return NextResponse.json(
      { error: 'keyword and location are required' },
      { status: 400 },
    )
  }
  try {
    const domains = await fetchSerpDomains(keyword.trim(), location.trim())
    return NextResponse.json({ domains })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Discover failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
