import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/supabase/client'

// Initialize Supabase Client (created freshly to avoid caching issues in polling)
const supabase = createClient()

export const dynamic = 'force-dynamic' // Ensure this is not cached by Next.js

export async function GET(req: NextRequest) {
    try {
        // Calculate timestamp for 24 hours ago
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

        // Fetch sightings from last 24 hours
        const { data: sightings, error } = await supabase
            .from('sightings')
            .select('id, image_url, email, created_at, full_name, description')
            .gt('created_at', oneDayAgo)
            .order('created_at', { ascending: false })

        if (error) {
            console.error('Supabase Polling Error:', error)
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        // Return clean list for Zapier
        return NextResponse.json({
            timestamp: new Date().toISOString(),
            count: sightings?.length || 0,
            sightings: sightings || []
        }, { status: 200 })

    } catch (error) {
        console.error('Webhook Error:', error)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
