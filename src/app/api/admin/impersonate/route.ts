import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export async function POST(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()
    const { userId } = (await request.json()) as { userId?: string }

    if (!userId) {
      return NextResponse.json({ error: 'userId required' }, { status: 400 })
    }

    const { data: authUser, error: userError } =
      await supabase.auth.admin.getUserById(userId)
    if (userError || !authUser.user?.email) {
      return NextResponse.json(
        { error: 'User not found or has no email' },
        { status: 404 },
      )
    }

    const { data: linkData, error: linkError } =
      await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email: authUser.user.email,
        options: {
          redirectTo: 'https://sightings.sasquatchcarpet.com/tech-preview',
        },
      })
    if (linkError || !linkData?.properties?.action_link) {
      throw linkError ?? new Error('No action link returned')
    }

    return NextResponse.json({ url: linkData.properties.action_link })
  } catch (error) {
    console.error('[admin/impersonate][POST]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return NextResponse.json({ error: 'Failed to create session' }, { status })
  }
}
