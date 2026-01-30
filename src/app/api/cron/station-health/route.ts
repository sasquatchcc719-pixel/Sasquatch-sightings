/**
 * Station Health Monitoring Cron Job
 * Runs daily to check for inactive NFC stations and send check-in SMS to partners
 *
 * This route is called by Vercel Cron on a schedule defined in vercel.json
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { sendPartnerSMS } from '@/lib/twilio'

// Thresholds in days
const WARNING_THRESHOLD_DAYS = 7
const INACTIVE_THRESHOLD_DAYS = 14

// Don't send alerts more than once per week
const ALERT_COOLDOWN_DAYS = 7

type PartnerStationData = {
  id: string
  location_name: string | null
  company_name: string | null
  phone: string | null
  last_sasquatch_tap_at: string | null
  last_review_tap_at: string | null
  google_review_url: string | null
  total_taps: number
}

type AlertToSend = {
  partnerId: string
  partnerName: string
  partnerPhone: string
  stationType: 'sasquatch' | 'review' | 'both'
  message: string
}

function daysSince(dateString: string | null): number | null {
  if (!dateString) return null
  return Math.floor(
    (Date.now() - new Date(dateString).getTime()) / (1000 * 60 * 60 * 24),
  )
}

export async function GET(request: NextRequest) {
  try {
    // Verify this is a legitimate cron request
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = await createAdminClient()
    const now = new Date()
    const results = {
      partnersChecked: 0,
      alertsSent: 0,
      sasquatchInactive: 0,
      reviewInactive: 0,
      errors: [] as string[],
    }

    // Fetch all location partners
    const { data: partners, error: partnersError } = await supabase
      .from('partners')
      .select(
        'id, location_name, company_name, phone, last_sasquatch_tap_at, last_review_tap_at, google_review_url, total_taps',
      )
      .eq('partner_type', 'location')

    if (partnersError) {
      console.error('Failed to fetch partners:', partnersError)
      return NextResponse.json(
        { error: 'Failed to fetch partners' },
        { status: 500 },
      )
    }

    if (!partners || partners.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No location partners to check',
        results,
      })
    }

    results.partnersChecked = partners.length

    // Check for recent alerts to avoid spamming
    const cooldownDate = new Date()
    cooldownDate.setDate(cooldownDate.getDate() - ALERT_COOLDOWN_DAYS)

    const { data: recentAlerts } = await supabase
      .from('station_health_alerts')
      .select('partner_id, station_type')
      .gte('sent_at', cooldownDate.toISOString())

    const recentAlertSet = new Set(
      (recentAlerts || []).map((a) => `${a.partner_id}-${a.station_type}`),
    )

    // Analyze each partner and queue alerts
    const alertsToSend: AlertToSend[] = []

    for (const partner of partners as PartnerStationData[]) {
      const partnerName =
        partner.location_name || partner.company_name || 'Partner'

      // Skip partners without phone numbers
      if (!partner.phone) continue

      // Check Sasquatch station status
      const sasquatchDays = daysSince(partner.last_sasquatch_tap_at)
      const sasquatchInactive =
        partner.total_taps > 0 &&
        sasquatchDays !== null &&
        sasquatchDays >= INACTIVE_THRESHOLD_DAYS

      // Check Google review station status (only if configured)
      const reviewDays = daysSince(partner.last_review_tap_at)
      const hasReviewStation = !!partner.google_review_url
      const reviewInactive =
        hasReviewStation &&
        reviewDays !== null &&
        reviewDays >= INACTIVE_THRESHOLD_DAYS

      // Skip if already alerted recently
      const sasquatchAlertedRecently = recentAlertSet.has(
        `${partner.id}-sasquatch`,
      )
      const reviewAlertedRecently = recentAlertSet.has(`${partner.id}-review`)

      if (sasquatchInactive) results.sasquatchInactive++
      if (reviewInactive) results.reviewInactive++

      // Determine what to alert about
      const shouldAlertSasquatch =
        sasquatchInactive && !sasquatchAlertedRecently
      const shouldAlertReview = reviewInactive && !reviewAlertedRecently

      if (shouldAlertSasquatch && shouldAlertReview) {
        alertsToSend.push({
          partnerId: partner.id,
          partnerName,
          partnerPhone: partner.phone,
          stationType: 'both',
          message: `Hey ${partnerName}! 👋 Noticed both your Sasquatch station and Google review station haven't had any taps lately. Want me to swing by and check on them?\n\n- Sasquatch Carpet Cleaning\n(719) 249-8791`,
        })
      } else if (shouldAlertSasquatch) {
        alertsToSend.push({
          partnerId: partner.id,
          partnerName,
          partnerPhone: partner.phone,
          stationType: 'sasquatch',
          message: `Hey ${partnerName}! 👋 Noticed your Sasquatch station hasn't had any taps in a while. Want me to swing by and check on it?\n\n- Sasquatch Carpet Cleaning\n(719) 249-8791`,
        })
      } else if (shouldAlertReview) {
        alertsToSend.push({
          partnerId: partner.id,
          partnerName,
          partnerPhone: partner.phone,
          stationType: 'review',
          message: `Hey ${partnerName}! 👋 Noticed your Google review station hasn't had any taps lately. Want me to swing by and check on it?\n\n- Sasquatch Carpet Cleaning\n(719) 249-8791`,
        })
      }
    }

    // Send alerts
    for (const alert of alertsToSend) {
      try {
        await sendPartnerSMS(alert.partnerPhone, alert.message)

        // Record the alert
        await supabase.from('station_health_alerts').insert({
          partner_id: alert.partnerId,
          station_type:
            alert.stationType === 'both' ? 'sasquatch' : alert.stationType,
          alert_type: 'inactive',
        })

        // If both stations, record second alert too
        if (alert.stationType === 'both') {
          await supabase.from('station_health_alerts').insert({
            partner_id: alert.partnerId,
            station_type: 'review',
            alert_type: 'inactive',
          })
        }

        results.alertsSent++
        console.log(`Station health alert sent to ${alert.partnerName}`)
      } catch (error) {
        console.error(`Failed to send alert to ${alert.partnerName}:`, error)
        results.errors.push(`${alert.partnerName}: ${error}`)
      }
    }

    console.log('Station health cron job completed:', results)

    return NextResponse.json({
      success: true,
      message: 'Station health check completed',
      results,
    })
  } catch (error) {
    console.error('Station health cron job error:', error)
    return NextResponse.json(
      { error: 'Failed to run station health check', details: String(error) },
      { status: 500 },
    )
  }
}
