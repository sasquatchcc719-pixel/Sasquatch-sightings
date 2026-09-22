// @vitest-environment node
import { config as loadEnv } from 'dotenv'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

loadEnv({ path: '.env.local' })

import { createAdminClient } from '@/supabase/server'
import {
  deleteRestorationEquipmentPlacement,
  deleteRestorationWorkLine,
} from '@/lib/ops/restoration-charge-deletion'

const MARKER = 'RESTORATION_CHARGE_DELETION_TEST'
const supabase = createAdminClient()

let customerId = ''
let addressId = ''
let projectId = ''
let otherProjectId = ''
let visitId = ''
let removableLineId = ''
let keptLineId = ''
let equipmentIds: string[] = []
let invoiceId = ''

beforeAll(async () => {
  const { data: address } = await supabase
    .from('ops_service_addresses')
    .select('id, customer_id')
    .limit(1)
    .single()
  addressId = address!.id
  customerId = address!.customer_id

  const { data: projects } = await supabase
    .from('restoration_projects')
    .insert([
      {
        customer_id: customerId,
        service_address_id: addressId,
        cause_narrative: MARKER,
      },
      {
        customer_id: customerId,
        service_address_id: addressId,
        cause_narrative: `${MARKER}_OTHER`,
      },
    ])
    .select('id')
  projectId = projects![0].id
  otherProjectId = projects![1].id

  const appointmentDate = new Date(Date.now() + 86_400_000)
    .toISOString()
    .slice(0, 10)
  const { data: visit } = await supabase
    .from('ops_appointments')
    .insert({
      customer_id: customerId,
      service_address_id: addressId,
      booking_channel: 'admin',
      source: 'integration_test',
      status: 'booked',
      payment_status: 'unpaid',
      quickbooks_sync_status: 'held',
      appointment_date: appointmentDate,
      start_time: '09:00',
      end_time: '13:00',
      quoted_total: 75,
      kind: 'restoration',
      restoration_project_id: projectId,
      visit_type: 'mitigation',
      internal_notes: MARKER,
    })
    .select('id')
    .single()
  visitId = visit!.id

  const { data: lines } = await supabase
    .from('ops_appointment_line_items')
    .insert([
      {
        appointment_id: visitId,
        name_snapshot: 'Removable test line',
        quantity: 1,
        unit_price: 50,
        line_total: 50,
      },
      {
        appointment_id: visitId,
        name_snapshot: 'Kept test line',
        quantity: 1,
        unit_price: 25,
        line_total: 25,
      },
    ])
    .select('id')
  removableLineId = lines![0].id
  keptLineId = lines![1].id

  const today = new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Denver',
  })
  const { data: placements } = await supabase
    .from('restoration_equipment_placements')
    .insert(
      Array.from({ length: 3 }, (_, index) => ({
        project_id: projectId,
        catalog_code: 'DHM>',
        label: `${MARKER}_${index}`,
        placed_at: `${today}T12:00:00Z`,
        placed_on: today,
      })),
    )
    .select('id')
  equipmentIds = placements!.map((placement) => placement.id)
})

afterAll(async () => {
  if (projectId) {
    await supabase
      .from('restoration_projects')
      .update({ status: 'active' })
      .eq('id', projectId)
  }
  if (visitId) {
    if (invoiceId) {
      await supabase.from('ops_invoices').delete().eq('id', invoiceId)
    }
    await supabase
      .from('ops_appointment_line_items')
      .delete()
      .eq('appointment_id', visitId)
    await supabase.from('ops_appointments').delete().eq('id', visitId)
  }
  if (projectId) {
    await supabase
      .from('restoration_equipment_placements')
      .delete()
      .eq('project_id', projectId)
    await supabase.from('restoration_projects').delete().eq('id', projectId)
  }
  if (otherProjectId) {
    await supabase
      .from('restoration_projects')
      .delete()
      .eq('id', otherProjectId)
  }
})

describe('restoration charge deletion', () => {
  it('deletes exactly one Work line and leaves the other line intact', async () => {
    const result = await deleteRestorationWorkLine(supabase, {
      projectId,
      lineId: removableLineId,
    })

    expect(result).toEqual({ ok: true, removedAmount: 50 })
    const { data: remaining } = await supabase
      .from('ops_appointment_line_items')
      .select('id')
      .eq('appointment_id', visitId)
    expect(remaining?.map((line) => line.id)).toEqual([keptLineId])
  })

  it('refuses a Work line when the named project does not own it', async () => {
    const result = await deleteRestorationWorkLine(supabase, {
      projectId: otherProjectId,
      lineId: keptLineId,
    })

    expect(result).toEqual({ ok: false, error: 'charge_not_found' })
    const { data: kept } = await supabase
      .from('ops_appointment_line_items')
      .select('id')
      .eq('id', keptLineId)
      .maybeSingle()
    expect(kept?.id).toBe(keptLineId)
  })

  it('removes one exact placement from a multi-placement equipment batch', async () => {
    const target = equipmentIds[1]
    const result = await deleteRestorationEquipmentPlacement(supabase, {
      projectId,
      placementId: target,
    })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.removedAmount).toBeGreaterThan(0)
    const { data: remaining } = await supabase
      .from('restoration_equipment_placements')
      .select('id')
      .eq('project_id', projectId)
    expect(remaining).toHaveLength(2)
    expect(remaining?.some((placement) => placement.id === target)).toBe(false)
    expect(remaining?.map((placement) => placement.id).sort()).toEqual(
      [equipmentIds[0], equipmentIds[2]].sort(),
    )
  })

  it('rejects Work and equipment deletion once any project invoice exists', async () => {
    const { data: invoice } = await supabase
      .from('ops_invoices')
      .insert({
        appointment_id: visitId,
        status: 'draft',
        payment_status: 'unpaid',
        subtotal: 25,
        total: 25,
        sync_status: 'held',
      })
      .select('id')
      .single()
    invoiceId = invoice!.id

    const work = await deleteRestorationWorkLine(supabase, {
      projectId,
      lineId: keptLineId,
    })
    const equipment = await deleteRestorationEquipmentPlacement(supabase, {
      projectId,
      placementId: equipmentIds[0],
    })

    expect(work).toEqual({
      ok: false,
      error: 'project_financially_locked',
    })
    expect(equipment).toEqual({
      ok: false,
      error: 'project_financially_locked',
    })

    const { data: keptInvoice } = await supabase
      .from('ops_invoices')
      .select('id, total')
      .eq('id', invoiceId)
      .single()
    expect(keptInvoice).toMatchObject({ id: invoiceId, total: 25 })

    await supabase.from('ops_invoices').delete().eq('id', invoiceId)
    invoiceId = ''
  })

  it('also rejects deletion when a project is closed without an invoice', async () => {
    await supabase
      .from('restoration_projects')
      .update({ status: 'closed' })
      .eq('id', projectId)

    const work = await deleteRestorationWorkLine(supabase, {
      projectId,
      lineId: keptLineId,
    })

    expect(work).toEqual({
      ok: false,
      error: 'project_financially_locked',
    })

    const [{ data: keptLine }, { data: keptEquipment }] = await Promise.all([
      supabase
        .from('ops_appointment_line_items')
        .select('id')
        .eq('id', keptLineId)
        .maybeSingle(),
      supabase
        .from('restoration_equipment_placements')
        .select('id')
        .eq('id', equipmentIds[0])
        .maybeSingle(),
    ])
    expect(keptLine?.id).toBe(keptLineId)
    expect(keptEquipment?.id).toBe(equipmentIds[0])
  })
})
