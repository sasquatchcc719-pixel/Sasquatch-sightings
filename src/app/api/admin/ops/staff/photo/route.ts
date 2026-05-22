import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export async function POST(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()

    const form = await request.formData()
    const file = form.get('file')
    const staffUserId = String(form.get('staff_user_id') || '').trim()

    if (!staffUserId || !(file instanceof File)) {
      return NextResponse.json(
        { error: 'staff_user_id and file are required' },
        { status: 400 },
      )
    }

    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const fileName = `staff-photos/${staffUserId}.${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('job-images')
      .upload(fileName, buffer, {
        contentType: file.type || 'image/jpeg',
        upsert: true,
      })

    if (uploadError) throw uploadError

    const {
      data: { publicUrl },
    } = supabase.storage.from('job-images').getPublicUrl(uploadData.path)

    const { error: updateError } = await supabase
      .from('staff_users')
      .update({ profile_image_url: publicUrl })
      .eq('id', staffUserId)

    if (updateError) throw updateError

    return NextResponse.json({ url: publicUrl })
  } catch (error) {
    console.error('[admin/ops/staff/photo][POST]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return NextResponse.json({ error: 'Failed to upload photo' }, { status })
  }
}
