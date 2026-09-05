import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import {
  hasBlockingCustomerHistory,
  type CustomerDeletionCount,
  type CustomerDeletionPreview,
} from '@/lib/ops/customer-deletion'
import { createAdminClient } from '@/supabase/server'

type Context = { params: Promise<{ id: string }> }

type CountDefinition = {
  key: string
  label: string
  table: string
  column: string
}

const BLOCKING_COUNTS: CountDefinition[] = [
  {
    key: 'appointments',
    label: 'appointments and estimates',
    table: 'ops_appointments',
    column: 'customer_id',
  },
  {
    key: 'agreements',
    label: 'commercial agreements',
    table: 'ops_commercial_agreements',
    column: 'customer_id',
  },
  {
    key: 'service_concerns',
    label: 'service concerns',
    table: 'ops_service_concerns',
    column: 'customer_id',
  },
  {
    key: 'restoration_projects',
    label: 'water-loss projects',
    table: 'restoration_projects',
    column: 'customer_id',
  },
]

const REMOVED_COUNTS: CountDefinition[] = [
  {
    key: 'addresses',
    label: 'service addresses',
    table: 'ops_service_addresses',
    column: 'customer_id',
  },
  {
    key: 'commercial_profile',
    label: 'commercial profile',
    table: 'ops_commercial_profiles',
    column: 'customer_id',
  },
  {
    key: 'portal_users',
    label: 'portal logins',
    table: 'ops_client_users',
    column: 'customer_id',
  },
  {
    key: 'recurring_plans',
    label: 'recurring service plans',
    table: 'ops_recurring_templates',
    column: 'customer_id',
  },
  {
    key: 'batch_invoices',
    label: 'batch invoice drafts',
    table: 'ops_batch_invoices',
    column: 'customer_id',
  },
  {
    key: 'client_notes',
    label: 'client notes',
    table: 'ops_client_change_requests',
    column: 'customer_id',
  },
  {
    key: 'queued_messages',
    label: 'queued messages',
    table: 'ops_communication_queue',
    column: 'customer_id',
  },
  {
    key: 'drip_enrollments',
    label: 'drip enrollments',
    table: 'drip_campaign_enrollments',
    column: 'customer_id',
  },
  {
    key: 'reactivation_enrollments',
    label: 'reactivation enrollments',
    table: 'reactivation_campaign_enrollments',
    column: 'customer_id',
  },
  {
    key: 'cleaning_reminders',
    label: 'cleaning reminders',
    table: 'cleaning_reminders',
    column: 'customer_id',
  },
]

const DETACHED_COUNTS: CountDefinition[] = [
  {
    key: 'email_log',
    label: 'email history',
    table: 'ops_email_log',
    column: 'customer_id',
  },
  {
    key: 'reactivation_email_log',
    label: 'reactivation email history',
    table: 'reactivation_email_log',
    column: 'customer_id',
  },
  {
    key: 'review_requests',
    label: 'review request history',
    table: 'review_requests',
    column: 'customer_id',
  },
  {
    key: 'customer_media',
    label: 'saved customer media',
    table: 'ops_customer_media',
    column: 'customer_id',
  },
  {
    key: 'conversations',
    label: 'text conversations',
    table: 'conversations',
    column: 'ops_customer_id',
  },
]

async function loadCounts(
  db: ReturnType<typeof createAdminClient>,
  customerId: string,
  definitions: CountDefinition[],
): Promise<CustomerDeletionCount[]> {
  return Promise.all(
    definitions.map(async (definition) => {
      const { count, error } = await db
        .from(definition.table)
        .select('*', { count: 'exact', head: true })
        .eq(definition.column, customerId)
      if (error) throw error
      return {
        key: definition.key,
        label: definition.label,
        count: count || 0,
      }
    }),
  )
}

async function loadDeletionPreview(
  customerId: string,
): Promise<CustomerDeletionPreview | null> {
  const db = createAdminClient()
  const { data: customer, error } = await db
    .from('ops_customers')
    .select('id,full_name,business_name,phone,email,quickbooks_customer_id')
    .eq('id', customerId)
    .maybeSingle()
  if (error) throw error
  if (!customer) return null

  const [blocking, removed, detached] = await Promise.all([
    loadCounts(db, customerId, BLOCKING_COUNTS),
    loadCounts(db, customerId, REMOVED_COUNTS),
    loadCounts(db, customerId, DETACHED_COUNTS),
  ])

  return {
    customer: {
      id: customer.id,
      label: customer.business_name || customer.full_name,
      fullName: customer.full_name,
      phone: customer.phone,
      email: customer.email,
      quickbooksCustomerId: customer.quickbooks_customer_id,
    },
    blocking,
    removed,
    detached,
    canDelete: !hasBlockingCustomerHistory(blocking),
  }
}

function errorStatus(error: unknown): number {
  if (error instanceof Error && error.message === 'Not authorized') return 403
  return 500
}

export async function GET(_request: NextRequest, { params }: Context) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const { id } = await params
    const preview = await loadDeletionPreview(id)
    if (!preview) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }
    return NextResponse.json({ preview })
  } catch (error) {
    console.error('[ops/customers/:id/deletion][GET] Error:', error)
    return NextResponse.json(
      { error: 'Failed to inspect customer record' },
      { status: errorStatus(error) },
    )
  }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const { id } = await params
    const body = await request.json().catch(() => null)
    if (body?.confirmation !== 'DELETE') {
      return NextResponse.json(
        { error: 'Type DELETE to confirm permanent removal' },
        { status: 400 },
      )
    }

    const preview = await loadDeletionPreview(id)
    if (!preview) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }
    if (!preview.canDelete) {
      return NextResponse.json(
        {
          error: 'This customer has protected operational history',
          preview,
        },
        { status: 409 },
      )
    }

    const db = createAdminClient()
    const { data, error } = await db.rpc('delete_empty_ops_customer', {
      p_customer_id: id,
    })
    if (error) {
      const status =
        error.code === 'P0001' ? 409 : error.code === 'P0002' ? 404 : 500
      return NextResponse.json(
        { error: error.message || 'Failed to delete customer' },
        { status },
      )
    }

    const result = data as {
      id?: string
      label?: string
      portal_user_ids?: string[]
    } | null
    const authCleanupFailures: string[] = []
    for (const userId of result?.portal_user_ids || []) {
      const { error: authError } = await db.auth.admin.deleteUser(userId)
      if (authError) authCleanupFailures.push(userId)
    }

    return NextResponse.json({
      deleted: { id, label: result?.label || preview.customer.label },
      warning:
        authCleanupFailures.length > 0
          ? 'The customer was deleted, but a portal login needs manual cleanup.'
          : null,
    })
  } catch (error) {
    console.error('[ops/customers/:id/deletion][DELETE] Error:', error)
    return NextResponse.json(
      { error: 'Failed to delete customer' },
      { status: errorStatus(error) },
    )
  }
}
