import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import {
  agreementContentSchema,
  publicationIssues,
  type CommercialAgreement,
} from '@/lib/ops/commercial'
import { agreementHash } from '@/lib/ops/commercial-server'
import { z } from 'zod'
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAnyRole(['admin', 'owner'])
    const { id } = await params
    const body = z
      .object({
        action: z.enum(['save', 'publish', 'withdraw', 'revise']),
        revision: z.number().int().positive(),
        content: agreementContentSchema.optional(),
      })
      .parse(await request.json())
    const db = createAdminClient()
    const { data: raw, error: loadError } = await db
      .from('ops_commercial_agreements')
      .select('*')
      .eq('id', id)
      .single()
    if (loadError || !raw)
      return NextResponse.json(
        { error: 'Agreement not found' },
        { status: 404 },
      )
    const agreement = raw as CommercialAgreement
    if (body.revision !== agreement.revision)
      return NextResponse.json(
        { error: 'This agreement changed. Reload before continuing.' },
        { status: 409 },
      )
    if (body.action === 'revise') {
      if (agreement.status === 'draft')
        throw new Error('Edit this draft directly.')
      const { data, error } = await db
        .from('ops_commercial_agreements')
        .insert({
          customer_id: agreement.customer_id,
          source_estimate_id: agreement.source_estimate_id,
          previous_version_id: id,
          version: agreement.version + 1,
          content: agreement.content,
          created_by: user.id,
        })
        .select('id')
        .single()
      if (error?.code === '23505')
        return NextResponse.json(
          {
            error:
              'A revision already exists. Open it from the agreement list.',
          },
          { status: 409 },
        )
      if (error) throw error
      return NextResponse.json(data)
    }
    const updates: Record<string, unknown> = {}
    if (body.action === 'withdraw') {
      if (agreement.status !== 'published')
        throw new Error(
          'Only an unsigned published agreement can be withdrawn.',
        )
      updates.status = 'withdrawn'
    } else {
      if (agreement.status !== 'draft')
        throw new Error('Create a new version to change published terms.')
      const content = agreementContentSchema.parse(
        body.content || agreement.content,
      )
      if (content.service_address_id) {
        const { data: addr } = await db
          .from('ops_service_addresses')
          .select('id')
          .eq('id', content.service_address_id)
          .eq('customer_id', agreement.customer_id)
          .maybeSingle()
        if (!addr)
          throw new Error('Service address does not belong to this business.')
      }
      updates.content = content
      if (body.action === 'publish') {
        const issues = publicationIssues(content)
        if (issues.length)
          return NextResponse.json({ error: issues.join(' ') }, { status: 400 })
        updates.status = 'published'
        updates.content_hash = agreementHash(content)
        updates.published_at = new Date().toISOString()
        updates.published_by = user.id
      }
    }
    const { data, error } = await db
      .from('ops_commercial_agreements')
      .update(updates)
      .eq('id', id)
      .eq('revision', body.revision)
      .eq('status', agreement.status)
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!data)
      return NextResponse.json(
        { error: 'This agreement changed. Reload before continuing.' },
        { status: 409 },
      )
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unable to update agreement' },
      {
        status:
          e instanceof Error && e.message === 'Not authorized' ? 403 : 400,
      },
    )
  }
}
