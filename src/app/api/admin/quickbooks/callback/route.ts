import { NextRequest, NextResponse } from 'next/server'
import { getUserWithRole, hasRoleAccess } from '@/lib/auth'
import { exchangeCodeForTokens, saveQBTokens } from '@/lib/quickbooks-auth'
import { createAdminClient } from '@/supabase/server'
import { resumeQuickBooksAuthorizationJobs } from '@/lib/ops/quickbooks-sync-jobs'
import {
  verifyQBState,
  QB_STATE_COOKIE,
  QB_STATE_COOKIE_PATH,
} from '@/lib/quickbooks-oauth-state'

export async function GET(request: NextRequest) {
  function finish(parameter: string, value: string) {
    const destination = new URL('/admin/operations', request.url)
    destination.searchParams.set(parameter, value)
    const response = NextResponse.redirect(destination)
    response.cookies.set(QB_STATE_COOKIE, '', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 0,
      path: QB_STATE_COOKIE_PATH,
    })
    return response
  }
  try {
    const { user, role } = await getUserWithRole()
    if (!user || !hasRoleAccess(role, ['admin', 'owner'])) {
      return finish('qb_error', 'unauthorized')
    }

    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    const realmId = searchParams.get('realmId')
    const error = searchParams.get('error')

    if (
      !verifyQBState(
        request.cookies.get(QB_STATE_COOKIE)?.value,
        searchParams.get('state'),
        user.id,
      )
    ) {
      return finish('qb_error', 'invalid_state')
    }

    if (error) {
      console.error('[quickbooks/callback] QB returned error:', error)
      return finish('qb_error', error)
    }

    if (!code || !realmId) {
      return finish('qb_error', 'missing_params')
    }

    const tokens = await exchangeCodeForTokens(code)
    await saveQBTokens({
      realmId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      accessTokenExpiresIn: tokens.expires_in,
      refreshTokenExpiresIn: tokens.x_refresh_token_expires_in,
    })

    // Reconnection fixes authorization, not invoice data. Resume only jobs
    // blocked by that authorization failure; leave real invoice errors alone.
    await resumeQuickBooksAuthorizationJobs(createAdminClient(), true)

    return finish('qb_connected', '1')
  } catch (err) {
    console.error(
      '[quickbooks/callback] Token exchange or save failed:',
      err instanceof Error ? err.message : err,
    )
    return finish('qb_error', 'token_exchange_failed')
  }
}
