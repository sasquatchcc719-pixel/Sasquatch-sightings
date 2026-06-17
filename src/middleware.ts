import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Skip middleware for public routes
  if (
    pathname.startsWith('/auth/') ||
    pathname === '/tech-preview' ||
    pathname.startsWith('/sightings') ||
    pathname.startsWith('/work/') ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/static/') ||
    pathname === '/' ||
    pathname === '/book' ||
    pathname.startsWith('/book') ||
    pathname === '/g' ||
    pathname.startsWith('/g/') ||
    pathname.startsWith('/r/') ||
    pathname.startsWith('/review/') ||
    pathname.startsWith('/tap/') ||
    pathname.startsWith('/location/') ||
    pathname.startsWith('/links/') ||
    pathname.startsWith('/privacy') ||
    pathname.startsWith('/terms') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.ico')
  ) {
    return NextResponse.next()
  }

  // Only check auth for protected routes
  const isProtected =
    pathname.startsWith('/admin') ||
    pathname.startsWith('/partners') ||
    pathname.startsWith('/tech') ||
    pathname === '/redirect'

  if (!isProtected) {
    return NextResponse.next()
  }

  let response = NextResponse.next({
    request: { headers: request.headers },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          response = NextResponse.next({
            request: { headers: request.headers },
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Allow /partners/register without auth
  if (pathname === '/partners/register') {
    return response
  }

  // If not logged in on a protected route, redirect to login
  if (!user) {
    return NextResponse.redirect(new URL('/auth/login', request.url))
  }

  // Role-based access control happens in the layouts (admin/layout.tsx,
  // tech/layout.tsx, partners/layout.tsx) where we can do DB queries
  // safely without timing out the middleware.
  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
