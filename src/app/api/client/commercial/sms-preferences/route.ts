import { NextRequest, NextResponse } from 'next/server'
import { requireClientManager } from '@/lib/auth'
import {
  commercialSmsPreferenceSchema,
  normalizeCommercialSmsPhone,
  SCHEDULING_SMS_CONSENT,
} from '@/lib/ops/commercial'
import { createAdminClient } from '@/supabase/server'

export async function PATCH(request: NextRequest) {
  try {
    const { user, client } = await requireClientManager()
    const input = commercialSmsPreferenceSchema.parse(await request.json())
    const phone = normalizeCommercialSmsPhone(input.phone)
    const ipAddress =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
    const { error } = await createAdminClient().rpc(
      'set_commercial_sms_preference',
      {
        p_customer_id: client.customer_id,
        p_user_id: user.id,
        p_phone: phone,
        p_enabled: input.enabled,
        p_consent_text: input.enabled ? SCHEDULING_SMS_CONSENT : '',
        p_source: 'commercial_portal',
        p_ip_address: ipAddress,
        p_user_agent: request.headers.get('user-agent'),
      },
    )
    if (error) throw error
    return NextResponse.json({
      ok: true,
      smsPreferences: {
        phone,
        enabled: input.enabled,
        consentAt: input.enabled ? new Date().toISOString() : null,
      },
    })
  } catch (error) {
    const status =
      error instanceof Error && error.message === 'Not a client manager'
        ? 403
        : 400
    return NextResponse.json(
      {
        error:
          status === 403
            ? 'Not authorized'
            : 'Enter a valid mobile number and confirm the text authorization.',
      },
      { status },
    )
  }
}
