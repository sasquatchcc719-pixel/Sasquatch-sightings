import { NextResponse } from 'next/server'
import { requireClientManager } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

/**
 * POST /api/client/password-flag
 * Clears the must_change_password flag. Called by the portal after the client has
 * successfully set a new password via supabase.auth.updateUser().
 */
export async function POST() {
  try {
    const { user } = await requireClientManager()
    const supabase = createAdminClient()

    const { data: authUser } = await supabase.auth.admin.getUserById(user.id)
    const meta = authUser?.user?.app_metadata ?? {}

    const { error } = await supabase.auth.admin.updateUserById(user.id, {
      app_metadata: { ...meta, must_change_password: false },
    })
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    const status =
      error instanceof Error && error.message === 'Not a client manager'
        ? 403
        : 500
    return NextResponse.json({ error: 'Failed to update flag' }, { status })
  }
}
