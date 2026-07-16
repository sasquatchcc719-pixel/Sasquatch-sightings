import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import {
  classifyCustomerMedia,
  type CustomerMediaAction,
} from '@/lib/twilio/inbound-media'

const ACTIONS = new Set<CustomerMediaAction>([
  'customer_file',
  'estimate',
  'job',
  'preexisting_damage',
])

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const { id } = await params
    const body = (await request.json()) as { action?: string }
    if (!body.action || !ACTIONS.has(body.action as CustomerMediaAction)) {
      return NextResponse.json(
        { error: 'A valid media action is required.' },
        { status: 400 },
      )
    }

    const result = await classifyCustomerMedia(
      createAdminClient(),
      id,
      body.action as CustomerMediaAction,
    )
    return NextResponse.json(result, { status: result.ok ? 200 : 409 })
  } catch (error) {
    console.error('[admin/customer-media/classify][POST]', error)
    return NextResponse.json(
      { error: 'Failed to classify customer media.' },
      { status: 500 },
    )
  }
}
