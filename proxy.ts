import { updateSession } from '@/supabase/proxy'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  // Machine endpoints authenticate with Authorization bearer credentials.
  // Keep cookie/session refresh completely outside these namespaces.
  if (
    request.nextUrl.pathname.startsWith('/api/v1/') ||
    request.nextUrl.pathname === '/mcp' ||
    request.nextUrl.pathname.startsWith('/mcp/') ||
    request.nextUrl.pathname.startsWith('/.well-known/')
  ) {
    return NextResponse.next()
  }
  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - images - .svg, .png, .jpg, .jpeg, .gif, .webp
     * Feel free to modify this pattern to include more paths.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
