import { NextRequest, NextResponse } from 'next/server'
import { getUserWithRole, hasRoleAccess } from '@/lib/auth'
import { buildQBAuthUrl, getQBRedirectUri } from '@/lib/quickbooks-auth'
import {
  createQBState,
  QB_STATE_COOKIE,
  QB_STATE_COOKIE_PATH,
  QB_STATE_MAX_AGE,
} from '@/lib/quickbooks-oauth-state'

export async function GET(request: NextRequest) {
  try {
    const { user, role } = await getUserWithRole()
    if (!user || !hasRoleAccess(role, ['admin', 'owner'])) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Issue the host-only cookie on the same origin Intuit will return to.
    const callbackOrigin = new URL(getQBRedirectUri()).origin
    if (new URL(request.url).origin !== callbackOrigin) {
      return NextResponse.redirect(
        new URL('/api/admin/quickbooks/connect', callbackOrigin),
      )
    }

    const { state, cookie } = createQBState(user.id)
    const authUrl = buildQBAuthUrl(state)

    const response = NextResponse.redirect(authUrl)
    response.cookies.set(QB_STATE_COOKIE, cookie, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: QB_STATE_MAX_AGE,
      path: QB_STATE_COOKIE_PATH,
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
