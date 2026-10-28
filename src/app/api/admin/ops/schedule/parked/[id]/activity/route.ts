import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { loadUnscheduledActivity } from '@/lib/ops/unscheduled-activity'

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const { id } = await context.params
    if (!z.string().uuid().safeParse(id).success)
      return NextResponse.json(
        { error: 'Invalid appointment ID' },
        { status: 400 },
      )
    return NextResponse.json(
      await loadUnscheduledActivity(createAdminClient(), id),
      {
        headers: { 'Cache-Control': 'private, no-store' },
      },
    )
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to load contact history'
    return NextResponse.json(
      { error: message },
      {
        status:
          message === 'Not authorized'
            ? 403
            : message.endsWith('not found')
              ? 404
              : 500,
      },
    )
  }
}
