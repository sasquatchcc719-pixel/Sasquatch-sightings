/**
 * Lead Nurturing Cron Job
 * Runs daily to send follow-up SMS to leads at Day 3, 7, and 14
 * 
 * This route is called by Vercel Cron on a schedule defined in vercel.json
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { sendCustomerSMS } from '@/lib/twilio'

const BOOKING_LINK = 'https://book.housecallpro.com/book/Sasquatch-Carpet-Cleaning-LLC/9841a0d5dee444b48d42e926168cb865?v2=true'

export async function GET(request: NextRequest) {
  try {
    // Verify this is a legitimate cron request
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createAdminClient()
    const now = new Date()
    const results = {
      day_3: 0,
      day_7: 0,
      day_14: 0,
      errors: [] as string[],
    }

    // Day 3: Find leads created 3 days ago that haven't received Day 3 SMS
    const threeDaysAgo = new Date(now)
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)
    threeDaysAgo.setHours(0, 0, 0, 0)
    
    const threeDaysAgoEnd = new Date(threeDaysAgo)
    threeDaysAgoEnd.setHours(23, 59, 59, 999)

    const { data: day3Leads, error: day3Error } = await supabase
      .from('leads')
      .select('id, name, phone, source')
      .gte('created_at', threeDaysAgo.toISOString())
      .lte('created_at', threeDaysAgoEnd.toISOString())
      .is('day_3_sms_sent_at', null)
      .in('status', ['new', 'contacted'])
      .in('source', ['contest', 'partner', 'website'])

    if (day3Error) {
      console.error('Error fetching Day 3 leads:', day3Error)
      results.errors.push(`Day 3: ${day3Error.message}`)
    } else if (day3Leads && day3Leads.length > 0) {
      for (const lead of day3Leads) {
        try {
          const message = `Hi ${lead.name || 'there'}, still need carpet cleaning?\nYou have $20 off! Use coupon: Contest20 (add to notes)\nBook now: ${BOOKING_LINK}\n- Sasquatch Carpet Cleaning\n(719) 249-8791`
          
          await sendCustomerSMS(lead.phone, message, lead.id, 'day_3_nurture')
          
          // Mark as sent
          await supabase
            .from('leads')
            .update({ day_3_sms_sent_at: now.toISOString() })
            .eq('id', lead.id)
          
          results.day_3++
          console.log(`Day 3 SMS sent to lead ${lead.id}`)
        } catch (error) {
          console.error(`Failed to send Day 3 SMS to lead ${lead.id}:`, error)
          results.errors.push(`Day 3 lead ${lead.id}: ${error}`)
        }
      }
    }

    // Day 7: Find leads created 7 days ago that haven't received Day 7 SMS
    const sevenDaysAgo = new Date(now)
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    sevenDaysAgo.setHours(0, 0, 0, 0)
    
    const sevenDaysAgoEnd = new Date(sevenDaysAgo)
    sevenDaysAgoEnd.setHours(23, 59, 59, 999)

    const { data: day7Leads, error: day7Error } = await supabase
      .from('leads')
      .select('id, name, phone, source')
      .gte('created_at', sevenDaysAgo.toISOString())
      .lte('created_at', sevenDaysAgoEnd.toISOString())
      .is('day_7_sms_sent_at', null)
      .in('status', ['new', 'contacted'])
      .in('source', ['contest', 'partner', 'website'])

    if (day7Error) {
      console.error('Error fetching Day 7 leads:', day7Error)
      results.errors.push(`Day 7: ${day7Error.message}`)
    } else if (day7Leads && day7Leads.length > 0) {
      for (const lead of day7Leads) {
        try {
          const message = `Special offer for ${lead.name || 'you'}!\nGet $25 off when you book this week.\nUse coupon: Contest25 (add to notes)\n${BOOKING_LINK}\n- Sasquatch Carpet Cleaning\n(719) 249-8791`
          
          await sendCustomerSMS(lead.phone, message, lead.id, 'day_7_nurture')
          
          // Mark as sent
          await supabase
            .from('leads')
            .update({ day_7_sms_sent_at: now.toISOString() })
            .eq('id', lead.id)
          
          results.day_7++
          console.log(`Day 7 SMS sent to lead ${lead.id}`)
        } catch (error) {
          console.error(`Failed to send Day 7 SMS to lead ${lead.id}:`, error)
          results.errors.push(`Day 7 lead ${lead.id}: ${error}`)
        }
      }
    }

    // Day 14: Find leads created 14 days ago that haven't received Day 14 SMS
    const fourteenDaysAgo = new Date(now)
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)
    fourteenDaysAgo.setHours(0, 0, 0, 0)
    
    const fourteenDaysAgoEnd = new Date(fourteenDaysAgo)
    fourteenDaysAgoEnd.setHours(23, 59, 59, 999)

    const { data: day14Leads, error: day14Error } = await supabase
      .from('leads')
      .select('id, name, phone, source')
      .gte('created_at', fourteenDaysAgo.toISOString())
      .lte('created_at', fourteenDaysAgoEnd.toISOString())
      .is('day_14_sms_sent_at', null)
      .in('status', ['new', 'contacted'])
      .in('source', ['contest', 'partner', 'website'])

    if (day14Error) {
      console.error('Error fetching Day 14 leads:', day14Error)
      results.errors.push(`Day 14: ${day14Error.message}`)
    } else if (day14Leads && day14Leads.length > 0) {
      for (const lead of day14Leads) {
        try {
          const message = `Last chance, ${lead.name || 'friend'}!\nBook this week and get $30 off.\nUse coupon: Contest30 (add to notes)\n${BOOKING_LINK}\nReply STOP to unsubscribe\n- Sasquatch Carpet Cleaning\n(719) 249-8791`
          
          await sendCustomerSMS(lead.phone, message, lead.id, 'day_14_nurture')
          
          // Mark as sent
          await supabase
            .from('leads')
            .update({ day_14_sms_sent_at: now.toISOString() })
            .eq('id', lead.id)
          
          results.day_14++
          console.log(`Day 14 SMS sent to lead ${lead.id}`)
        } catch (error) {
          console.error(`Failed to send Day 14 SMS to lead ${lead.id}:`, error)
          results.errors.push(`Day 14 lead ${lead.id}: ${error}`)
        }
      }
    }

    console.log('Lead nurturing cron job completed:', results)

    return NextResponse.json({
      success: true,
      message: 'Lead nurturing completed',
      results,
    })

  } catch (error) {
    console.error('Lead nurturing cron job error:', error)
    return NextResponse.json(
      { error: 'Failed to run lead nurturing', details: String(error) },
      { status: 500 }
    )
  }
}
