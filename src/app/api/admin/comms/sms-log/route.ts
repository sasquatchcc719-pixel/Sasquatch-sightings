import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { opsPhoneLookupVariants } from '@/lib/ops/phone'
import { createAdminClient } from '@/supabase/server'

/** Outbound Operations / lifecycle SMS (Twilio), stored in sms_logs with message_type ops_* */
export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech', 'marketing'])

    const { searchParams } = new URL(request.url)
    const limit = Math.min(Number(searchParams.get('limit') || 50), 200)
    const offset = Number(searchParams.get('offset') || 0)
    const messageType = String(searchParams.get('message_type') || '').trim()
    const status = String(searchParams.get('status') || '').trim()
    const q = String(searchParams.get('q') || '').trim()

    const supabase = createAdminClient()
    let searchPhoneVariants: string[] = []
    if (q) {
      const escaped = q.replace(/[,%]/g, ' ').trim()
      if (escaped) {
        const { data: matchedCustomers } = await supabase
          .from('ops_customers')
          .select('phone')
          .ilike('full_name', `%${escaped}%`)
          .limit(100)
        const set = new Set<string>()
        for (const customer of matchedCustomers || []) {
          for (const variant of opsPhoneLookupVariants(
            String(customer.phone || ''),
          )) {
            set.add(variant)
          }
        }
        searchPhoneVariants = [...set]
      }
    }

    let query = supabase
      .from('sms_logs')
      .select(
        `
        id,
        recipient_phone,
        message_type,
        message_content,
        status,
        twilio_sid,
        sent_at
      `,
        { count: 'exact' },
      )
      .like('message_type', 'ops_%')
      .order('sent_at', { ascending: false })

    if (messageType) query = query.eq('message_type', messageType)
    if (status) query = query.eq('status', status)
    if (q) {
      const escaped = q.replace(/[,%]/g, ' ').trim()
      if (escaped) {
        const parts = [
          `recipient_phone.ilike.%${escaped}%`,
          `message_content.ilike.%${escaped}%`,
        ]
        if (searchPhoneVariants.length > 0) {
          const inList = searchPhoneVariants.join(',')
          parts.push(`recipient_phone.in.(${inList})`)
        }
        query = query.or(parts.join(','))
      }
    }

    const { data, error, count } = await query.range(offset, offset + limit - 1)

    if (error) throw error

    const rows = data || []
    const allVariants = new Set<string>()
    for (const row of rows) {
      for (const variant of opsPhoneLookupVariants(
        String(row.recipient_phone || ''),
      )) {
        allVariants.add(variant)
      }
    }

    let customerByVariant = new Map<
      string,
      { full_name: string | null; phone: string | null }
    >()
    if (allVariants.size > 0) {
      const variantList = [...allVariants]
      const { data: customers } = await supabase
        .from('ops_customers')
        .select('full_name, phone')
        .in('phone', variantList)
        .limit(500)

      for (const customer of customers || []) {
        for (const variant of opsPhoneLookupVariants(
          String(customer.phone || ''),
        )) {
          if (!customerByVariant.has(variant)) {
            customerByVariant.set(variant, {
              full_name: customer.full_name || null,
              phone: customer.phone || null,
            })
          }
        }
      }
    }

    const enriched = rows.map((row) => {
      const variants = opsPhoneLookupVariants(String(row.recipient_phone || ''))
      const matched = variants
        .map((v) => customerByVariant.get(v))
        .find(Boolean)
      return {
        ...row,
        customer_name: matched?.full_name || null,
        customer_phone: matched?.phone || null,
      }
    })

    return NextResponse.json({ messages: enriched, total: count || 0 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Not authorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[comms/sms-log] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
