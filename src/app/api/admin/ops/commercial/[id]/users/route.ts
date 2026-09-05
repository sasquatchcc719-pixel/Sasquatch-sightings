import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { z } from 'zod'
type Context = { params: Promise<{ id: string }> }
export async function POST(request: NextRequest, { params }: Context) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const { id } = await params
    const body = z
      .object({
        display_name: z.string().trim().min(2).max(200),
        email: z.email(),
        can_sign_agreements: z.boolean(),
      })
      .parse(await request.json())
    const db = createAdminClient()
    const { data: customer } = await db
      .from('ops_customers')
      .select('id')
      .eq('id', id)
      .eq('is_commercial', true)
      .maybeSingle()
    if (!customer)
      return NextResponse.json(
        { error: 'Commercial account not found' },
        { status: 404 },
      )
    const password = randomBytes(18).toString('base64url') + 'aA1!'
    const { data: created, error } = await db.auth.admin.createUser({
      email: body.email,
      password,
      email_confirm: true,
      app_metadata: { must_change_password: true },
    })
    if (error || !created.user)
      return NextResponse.json(
        {
          error:
            'Could not create this login. The email may already have an account; use a different contact email.',
        },
        { status: 409 },
      )
    const { error: linkError } = await db
      .from('ops_client_users')
      .insert({ ...body, user_id: created.user.id, customer_id: id })
    if (linkError) {
      await db.auth.admin.deleteUser(created.user.id)
      throw linkError
    }
    return NextResponse.json(
      {
        email: body.email,
        temporary_password: password,
        login_url: 'https://sightings.sasquatchcarpet.com/auth/login',
      },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (e) {
    return NextResponse.json(
      { error: 'Unable to create portal login' },
      {
        status:
          e instanceof Error && e.message === 'Not authorized' ? 403 : 400,
      },
    )
  }
}
export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const { id } = await params
    const body = z
      .object({
        user_id: z.uuid(),
        is_active: z.boolean(),
        can_sign_agreements: z.boolean(),
      })
      .parse(await request.json())
    const { data, error } = await createAdminClient()
      .from('ops_client_users')
      .update({
        is_active: body.is_active,
        can_sign_agreements: body.can_sign_agreements,
        updated_at: new Date().toISOString(),
      })
      .eq('id', body.user_id)
      .eq('customer_id', id)
      .select('id')
      .single()
    if (error) throw error
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json(
      { error: 'Unable to update portal access' },
      {
        status:
          e instanceof Error && e.message === 'Not authorized' ? 403 : 400,
      },
    )
  }
}
