import { NextRequest, NextResponse } from 'next/server'
import { getUserWithRole } from '@/lib/auth'
import { buildQBAuthUrl } from '@/lib/quickbooks-auth'
import crypto from 'crypto'

export async function GET(request: NextRequest) {
  try {
    const { user, role } = await getUserWithRole()
    if (!user || role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const state = crypto.randomBytes(16).toString('hex')
    const authUrl = buildQBAuthUrl(state)

    const url = new URL(request.url)
    if (url.searchParams.get('debug') === '1') {
      return NextResponse.json({
        authUrl,
        parsed: Object.fromEntries(new URL(authUrl).searchParams),
      })
    }

    const response = NextResponse.redirect(authUrl)
    response.cookies.set('qb_oauth_state', state, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 600, // 10 minutes
      path: '/',
    })

    return response
  } catch (error) {
    console.error('[quickbooks/connect] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
