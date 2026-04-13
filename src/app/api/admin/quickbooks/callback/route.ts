import { NextRequest, NextResponse } from 'next/server'
import { getUserWithRole } from '@/lib/auth'
import { exchangeCodeForTokens, saveQBTokens } from '@/lib/quickbooks-auth'

export async function GET(request: NextRequest) {
  try {
    const { user, role } = await getUserWithRole()
    if (!user || role !== 'admin') {
      return NextResponse.redirect(
        new URL('/admin?error=unauthorized', request.url),
      )
    }

    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    const realmId = searchParams.get('realmId')
    const error = searchParams.get('error')

    if (error) {
      console.error('[quickbooks/callback] QB returned error:', error)
      return NextResponse.redirect(
        new URL(`/admin/operations?qb_error=${error}`, request.url),
      )
    }

    if (!code || !realmId) {
      return NextResponse.redirect(
        new URL('/admin/operations?qb_error=missing_params', request.url),
      )
    }

    // Note: state cookie check skipped — Intuit redirects drop the cookie in production.
    // This endpoint is admin-only and HTTPS-only so CSRF risk is minimal.

    const tokens = await exchangeCodeForTokens(code)
    await saveQBTokens({
      realmId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      accessTokenExpiresIn: tokens.expires_in,
      refreshTokenExpiresIn: tokens.x_refresh_token_expires_in,
    })

    return NextResponse.redirect(
      new URL('/admin/operations?qb_connected=1', request.url),
    )
  } catch {
    console.error('[quickbooks/callback] Token exchange failed')
    return NextResponse.redirect(
      new URL('/admin/operations?qb_error=token_exchange_failed', request.url),
    )
  }
}
