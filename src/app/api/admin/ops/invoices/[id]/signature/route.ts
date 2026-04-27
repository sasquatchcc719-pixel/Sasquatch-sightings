import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { requireAnyRole } from '@/lib/auth'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['owner', 'admin', 'tech'])
    const supabase = createAdminClient()
    const { signatureData, customerName } = await request.json()

    if (!signatureData || !customerName) {
      return NextResponse.json(
        { error: 'Missing signature data or customer name' },
        { status: 400 },
      )
    }

    const { id: invoiceId } = await params

    // Convert base64 to buffer
    const base64Data = signatureData.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(base64Data, 'base64')

    // Upload to Supabase Storage
    const fileName = `signature_${invoiceId}_${Date.now()}.png`
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('job-photos')
      .upload(fileName, buffer, {
        contentType: 'image/png',
        cacheControl: '3600',
      })

    if (uploadError) {
      console.error('Storage upload error:', uploadError)
      return NextResponse.json(
        { error: 'Failed to upload signature' },
        { status: 500 },
      )
    }

    // Get public URL
    const {
      data: { publicUrl },
    } = supabase.storage.from('job-photos').getPublicUrl(uploadData.path)

    // Update invoice with signature info
    const { error: updateError } = await supabase
      .from('ops_invoices')
      .update({
        signature_url: publicUrl,
        signature_captured_at: new Date().toISOString(),
        signature_customer_name: customerName,
      })
      .eq('id', invoiceId)

    if (updateError) {
      console.error('Database update error:', updateError)
      return NextResponse.json(
        { error: 'Failed to save signature' },
        { status: 500 },
      )
    }

    return NextResponse.json({
      success: true,
      signatureUrl: publicUrl,
    })
  } catch (error) {
    console.error('Signature save error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
