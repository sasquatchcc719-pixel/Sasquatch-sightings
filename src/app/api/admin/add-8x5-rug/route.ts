import { NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'

export async function POST() {
  try {
    const supabase = createAdminClient()

    // Insert the 8x5 area rug
    const { data, error } = await supabase
      .from('service_catalog_items')
      .upsert(
        {
          name: 'Area Rug 8x5',
          slug: 'area-rug-8x5',
          description: 'Professional cleaning for 8x5 area rug',
          category: 'rug cleaning',
          default_duration_minutes: 30,
          buffer_minutes: 30,
          base_price: 32.0,
          pricing_unit: 'per rug',
          is_active: true,
          online_booking_enabled: true,
          sort_order: 410,
        },
        { onConflict: 'slug' },
      )
      .select()

    if (error) throw error

    return NextResponse.json({
      success: true,
      message: '8x5 area rug added to catalog',
      data,
    })
  } catch (error) {
    console.error('[admin/add-8x5-rug] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add rug',
      },
      { status: 500 },
    )
  }
}
