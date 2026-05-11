import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { getAssignedTechAppointment } from '@/lib/tech/appointments'
import { createAdminClient } from '@/supabase/server'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const access = await requireAnyRole(['admin', 'owner', 'tech'])
    const supabase = createAdminClient()
    const { id: appointmentId } = await params
    const appointment = await getAssignedTechAppointment(
      supabase,
      access.id,
      appointmentId,
    )

    if (!appointment) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    if (appointment.hidePricing || !appointment.invoice) {
      return NextResponse.json(
        { error: 'Signature capture is unavailable for this job' },
        { status: 403 },
      )
    }

    const { signatureData, customerName } = await request.json()
    if (!signatureData || !customerName) {
      return NextResponse.json(
        { error: 'Missing signature data or customer name' },
        { status: 400 },
      )
    }

    const base64Data = String(signatureData).replace(
      /^data:image\/\w+;base64,/,
      '',
    )
    const buffer = Buffer.from(base64Data, 'base64')
    const fileName = `signatures/signature_${appointment.invoice.id}_${Date.now()}.png`
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('job-images')
      .upload(fileName, buffer, {
        contentType: 'image/png',
        cacheControl: '3600',
      })

    if (uploadError) throw uploadError

    const {
      data: { publicUrl },
    } = supabase.storage.from('job-images').getPublicUrl(uploadData.path)

    const { error: updateError } = await supabase
      .from('ops_invoices')
      .update({
        signature_url: publicUrl,
        signature_captured_at: new Date().toISOString(),
        signature_customer_name: String(customerName).trim(),
      })
      .eq('id', appointment.invoice.id)

    if (updateError) throw updateError

    return NextResponse.json({
      success: true,
      signatureUrl: publicUrl,
    })
  } catch (error) {
    console.error('[tech/signature][POST]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return NextResponse.json(
      { error: status === 401 ? 'Unauthorized' : 'Failed to save signature' },
      { status },
    )
  }
}
