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
    const state = searchParams.get('state')
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

    // Validate state
    const savedState = request.cookies.get('qb_oauth_state')?.value
    if (!savedState || savedState !== state) {
      return NextResponse.redirect(
        new URL('/admin/operations?qb_error=invalid_state', request.url),
      )
    }

    const tokens = await exchangeCodeForTokens(code)
    await saveQBTokens({
      realmId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      accessTokenExpiresIn: tokens.expires_in,
      refreshTokenExpiresIn: tokens.x_refresh_token_expires_in,
    })

    const response = NextResponse.redirect(
      new URL('/admin/operations?qb_connected=1', request.url),
    )
    response.cookies.delete('qb_oauth_state')
    return response
  } catch (error) {
    console.error('[quickbooks/callback] Error:', error)
    return NextResponse.redirect(
      new URL('/admin/operations?qb_error=token_exchange_failed', request.url),
    )
  }
}
