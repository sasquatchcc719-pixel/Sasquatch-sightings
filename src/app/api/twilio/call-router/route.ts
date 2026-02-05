import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Default settings in case database is unavailable
const DEFAULT_SETTINGS = {
  business_hours_start: 9,
  business_hours_end: 17,
  business_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
  sip_endpoints: ['chuck'],
  sip_domain: 'sasquatch-cc.sip.twilio.com',
  dial_timeout: 20,
}

export async function POST(request: NextRequest) {
  try {
    // Get the caller's phone number from Twilio
    const formData = await request.formData()
    const callerPhone = formData.get('From') as string

    console.log(`[Call Router] Incoming call from: ${callerPhone}`)

    // Fetch phone settings from database
    let settings = DEFAULT_SETTINGS
    try {
      const { data } = await supabase
        .from('phone_settings')
        .select('*')
        .limit(1)
        .single()

      if (data) {
        settings = {
          business_hours_start: data.business_hours_start,
          business_hours_end: data.business_hours_end,
          business_days: data.business_days,
          sip_endpoints: data.sip_endpoints,
          sip_domain: data.sip_domain,
          dial_timeout: data.dial_timeout,
        }
      }
    } catch (dbError) {
      console.error(
        '[Call Router] Failed to fetch settings, using defaults:',
        dbError,
      )
    }

    // Get current time in Mountain Time (Monument, CO)
    const now = new Date()

    // Use separate formatters for reliable parsing
    const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Denver',
      weekday: 'long',
    })
    const hourFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Denver',
      hour: 'numeric',
      hour12: false,
    })

    const weekdayStr = weekdayFormatter.format(now)
    const hourStr = hourFormatter.format(now).replace(/\D/g, '') // Strip non-digits
    const hour = parseInt(hourStr) || 0

    // Check business days
    const isBusinessDay = settings.business_days.includes(weekdayStr)

    // Business hours check using settings
    const isBusinessHours =
      isBusinessDay &&
      hour >= settings.business_hours_start &&
      hour < settings.business_hours_end

    console.log(
      `[Call Router] MT Time: ${weekdayStr} ${hour}:00, isBusinessDay: ${isBusinessDay}, isBusinessHours: ${isBusinessHours}`,
    )
    console.log(
      `[Call Router] Settings: start=${settings.business_hours_start}, end=${settings.business_hours_end}, days=${settings.business_days.join(',')}`,
    )
    console.log(`[Call Router] Current UTC: ${now.toISOString()}`)

    let twimlResponse

    if (isBusinessHours) {
      console.log(
        `[Call Router] Business hours - ring phones: ${settings.sip_endpoints.join(', ')}`,
      )

      // Build SIP dial list
      const sipElements = settings.sip_endpoints
        .map(
          (endpoint) => `    <Sip>sip:${endpoint}@${settings.sip_domain}</Sip>`,
        )
        .join('\n')

      twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="${settings.dial_timeout}" action="https://sasquatch-sightings-git-main-charles-sewells-projects.vercel.app/api/twilio/call-after-hours">
${sipElements}
  </Dial>
</Response>`
    } else {
      console.log(`[Call Router] After hours - play message and send SMS`)
      twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect method="POST">https://sasquatch-sightings-git-main-charles-sewells-projects.vercel.app/api/twilio/call-after-hours</Redirect>
</Response>`
    }

    return new NextResponse(twimlResponse, {
      status: 200,
      headers: {
        'Content-Type': 'text/xml',
      },
    })
  } catch (error) {
    console.error('[Call Router] Error:', error)

    // Fallback: redirect to after hours if something goes wrong
    const fallbackTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>We're experiencing technical difficulties. Please try again later.</Say>
  <Hangup/>
</Response>`

    return new NextResponse(fallbackTwiml, {
      status: 200,
      headers: {
        'Content-Type': 'text/xml',
      },
    })
  }
}
