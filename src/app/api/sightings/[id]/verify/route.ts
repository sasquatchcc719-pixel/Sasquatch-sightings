import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import {
  SIGHTING_SUBMISSION_COOKIE,
  verifySightingSubmission,
} from '@/lib/sighting-submission'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params

    if (!id) {
      return NextResponse.json(
        { error: 'Sighting ID is required' },
        { status: 400 },
      )
    }

    if (
      !verifySightingSubmission(
        request.cookies.get(SIGHTING_SUBMISSION_COOKIE)?.value,
        id,
      )
    ) {
      return NextResponse.json(
        { error: 'Submission verification required' },
        { status: 403 },
      )
    }

    const supabase = createAdminClient()

    // Update the share_verified field
    const { data, error } = await supabase
      .from('sightings')
      .update({ share_verified: true })
      .eq('id', id)
      .select('id, share_verified')
      .single()

    if (error) {
      console.error('Error updating share_verified:', error)
      return NextResponse.json(
        { error: 'Failed to verify entry' },
        { status: 500 },
      )
    }

    const response = NextResponse.json({
      success: true,
      message: 'Entry verified',
      data: { id: data.id, share_verified: data.share_verified },
    })
    response.cookies.set(SIGHTING_SUBMISSION_COOKIE, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/sightings',
      maxAge: 0,
    })
    return response
  } catch (error) {
    console.error('Verify entry error:', error)
    return NextResponse.json(
      { error: 'Failed to verify entry' },
      { status: 500 },
    )
  }
}
