import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { normalizeOpsPhone, opsPhoneLookupVariants } from '@/lib/ops/phone'

export async function GET(request: NextRequest) {
  const supabase = createAdminClient()
  
  try {
    const inlineCustomer = {
      first_name: 'New',
      last_name: 'Estimate',
      phone: '+10000000000',
    }
    
    const fullName = 'New Estimate'
    const phone = normalizeOpsPhone(inlineCustomer.phone)
    const variants = opsPhoneLookupVariants(inlineCustomer.phone)
    const { data: matches, error: matchError } = await supabase
      .from('ops_customers')
      .select('id')
      .in('phone', variants)
      .order('updated_at', { ascending: false })
      .limit(1)

    if (matchError) throw new Error('Match error: ' + JSON.stringify(matchError))
    
    if (matches && matches.length > 0) {
       return NextResponse.json({ success: true, customerId: matches[0].id, found: true })
    }

    // Try inserting
    const { data: inserted, error: insertError } = await supabase
      .from('ops_customers')
      .insert({
        full_name: fullName,
        first_name: inlineCustomer.first_name,
        last_name: inlineCustomer.last_name,
        phone,
      })
      .select('id')
      .single()

    if (insertError) {
      return NextResponse.json({ error: 'Insert error', details: insertError }, { status: 500 })
    }

    return NextResponse.json({ success: true, customerId: inserted.id, inserted: true })

  } catch (error) {
    return NextResponse.json({ error: 'Outer error', details: error }, { status: 500 })
  }
}
