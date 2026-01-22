import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/supabase/server'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    
    if (!id) {
      return NextResponse.json(
        { error: 'Sighting ID is required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Update the share_verified field
    const { data, error } = await supabase
      .from('sightings')
      .update({ share_verified: true })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Error updating share_verified:', error)
      return NextResponse.json(
        { error: 'Failed to verify entry' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Entry verified',
      data
    })

  } catch (error) {
    console.error('Verify entry error:', error)
    return NextResponse.json(
      { error: 'Failed to verify entry' },
      { status: 500 }
    )
  }
}
