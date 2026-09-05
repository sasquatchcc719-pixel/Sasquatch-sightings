import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/supabase/server'

// Deliberately serve a plain form without analytics or client scripts. Email
// scanners may GET this URL; only a customer's POST consumes the one-time link.
export async function GET(request: NextRequest) {
  const candidate = request.nextUrl.searchParams.get('token_hash') || ''
  const token = /^[a-zA-Z0-9_-]{20,256}$/.test(candidate) ? candidate : ''
  const failed = request.nextUrl.searchParams.has('expired') || !token
  return new NextResponse(
    `<!doctype html><html lang="en"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex,nofollow"><title>Your Sasquatch customer account</title>
    <style>body{margin:0;background:#eef0e7;color:#193e35;font:17px/1.65 system-ui,sans-serif}main{max-width:500px;margin:10vh auto;padding:32px;background:#fff;border:1px solid #d7dfd6;border-radius:24px}h1{line-height:1.2}button{width:100%;padding:16px;background:#245b46;color:white;border:0;border-radius:10px;font:inherit;font-weight:600;cursor:pointer}a{color:#245b46}small{display:block;margin-top:24px;color:#53695e}@media(max-width:560px){main{margin:24px 16px;padding:24px}}</style>
    </head><body><main><p>SASQUATCH · COMMERCIAL CARE</p>
    <h1>${failed ? 'Let’s get you into your account.' : 'Your customer account is ready.'}</h1>
    ${failed ? `<p>This sign-in link is missing, expired, or has already been used.</p><p>If you already chose a password, <a href="/auth/login">sign in with your email and password</a>. Otherwise, <a href="/auth/forgot-password">set a password using your email</a>, or call or text Charles for a fresh setup link.</p>` : `<p>Continue to choose your password, confirm business details, and review your service agreement. If your account is already set up, you can review it right away.</p><form method="post" action="/auth/portal-access"><input type="hidden" name="token_hash" value="${token}"><button type="submit">Continue to your account</button></form><p>Already set up? <a href="/auth/login">Sign in with your password</a>.</p>`}
    <small>Need help? Call or text <a href="tel:+17192498791">(719) 249-8791</a>.<br>No appointment is booked by opening your account.</small>
    </main></body></html>`,
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'private, no-store',
        'Referrer-Policy': 'strict-origin',
        'Content-Security-Policy':
          "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
        'X-Content-Type-Options': 'nosniff',
      },
    },
  )
}

export async function POST(request: NextRequest) {
  if (request.headers.get('origin') !== request.nextUrl.origin)
    return new NextResponse('Please open the link from your setup email.', {
      status: 403,
    })
  const form = await request.formData()
  const token_hash = form.get('token_hash')
  if (
    typeof token_hash === 'string' &&
    /^[a-zA-Z0-9_-]{20,256}$/.test(token_hash)
  ) {
    const auth = await createClient()
    const { error } = await auth.auth.verifyOtp({
      type: 'magiclink',
      token_hash,
    })
    if (!error)
      return NextResponse.redirect(new URL('/client', request.url), 303)
  }
  return NextResponse.redirect(
    new URL('/auth/portal-access?expired=1', request.url),
    303,
  )
}
