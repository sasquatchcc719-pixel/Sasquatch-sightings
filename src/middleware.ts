import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Skip middleware for public routes
  if (
    pathname.startsWith('/auth/') ||
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

  // Create Supabase client
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
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
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value),
          )
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // Get user session
  const {
    data: { user },
  } = await supabase.auth.getUser()

  console.log('[Middleware] Path:', pathname)
  console.log('[Middleware] User:', user?.email || 'not logged in')

  // If not logged in and trying to access protected routes
  if (
    !user &&
    (pathname.startsWith('/admin') ||
      pathname.startsWith('/partners') ||
      pathname.startsWith('/tech'))
  ) {
    // Allow /partners/register without auth
    if (pathname === '/partners/register') {
      return response
    }
    console.log('[Middleware] No user, redirecting to login')
    return NextResponse.redirect(new URL('/auth/login', request.url))
  }

  // If logged in, check role for protected routes
  if (user) {
    // Prefer internal staff role, then partner role, then fall back to legacy admin.
    const { data: staffUser, error: staffError } = await supabase
      .from('staff_users')
      .select('role')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle()

    if (
      staffError &&
      !staffError.message.toLowerCase().includes('staff_users')
    ) {
      console.error(
        '[Middleware] staff_users lookup failed:',
        staffError.message,
      )
    }

    const { data: partner, error } = await supabase
      .from('partners')
      .select('role')
      .eq('user_id', user.id)
      .single()

    console.log('[Middleware] Partner record:', partner)
    console.log('[Middleware] Partner error:', error?.message)

    // Determine role with admin fallback for legacy users.
    // The strict role enforcement happens in the layouts (admin/layout.tsx,
    // tech/layout.tsx, etc) where session cookies are reliably available.
    const userRole = staffUser?.role || partner?.role || 'admin'
    console.log('[Middleware] Determined role:', userRole)

    // PROTECT /admin/* routes - never allow partners
    if (pathname.startsWith('/admin')) {
      if (userRole === 'partner') {
        console.log(
          '[Middleware] Partner trying to access /admin, redirecting to /partners',
        )
        return NextResponse.redirect(new URL('/partners', request.url))
      }
    }

    // PROTECT /partners route - only partners allowed (except /partners/register)
    if (pathname.startsWith('/partners') && pathname !== '/partners/register') {
      if (userRole !== 'partner') {
        console.log(
          '[Middleware] Non-partner trying to access /partners, redirecting',
        )
        return NextResponse.redirect(new URL('/admin', request.url))
      }
    }
  }

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
