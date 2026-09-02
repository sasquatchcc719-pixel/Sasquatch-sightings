// @vitest-environment node
/**
 * The customer-facing accept page and the decision API both hand-write a
 * PostgREST select with an explicit FK hint on ops_customers. A typo there does
 * not fail type-check or the build — it fails at request time, in front of a
 * customer holding a bid. So exercise the real selects against the real DB.
 *
 * Read-only on purpose: inserting an appointment here would fire the live
 * booking triggers.
 */
import { config as loadEnv } from 'dotenv'
import { describe, it, expect } from 'vitest'

loadEnv({ path: '.env.local' })

import { createAdminClient } from '@/supabase/server'
import {
  createEstimateDecisionToken,
  verifyEstimateDecisionToken,
} from '@/lib/ops/estimate-decision-token'

const supabase = createAdminClient()

// The select in src/app/estimate/[token]/page.tsx
const PAGE_SELECT = `
      id,
      estimate_status,
      quoted_total,
      converted_appointment_id,
      ops_customers!ops_appointments_customer_id_fkey ( full_name, first_name, business_name ),
      ops_service_addresses ( street_1, street_2, city, state, zip_code ),
      ops_appointment_line_items (
        name_snapshot, quantity, unit_price, line_total, notes,
        pricing_unit_snapshot, area_segments
      )
    `

// The select in src/app/api/public/estimates/decision/route.ts
const DECISION_SELECT = `
        id,
        estimate_status,
        quoted_total,
        converted_appointment_id,
        ops_customers!ops_appointments_customer_id_fkey ( full_name, phone, email ),
        ops_service_addresses ( street_1, city, state, zip_code )
      `

describe('estimate decision selects', () => {
  it('the accept page select resolves against the real schema', async () => {
    const { error } = await supabase
      .from('ops_appointments')
      .select(PAGE_SELECT)
      .eq('kind', 'estimate')
      .limit(1)

    expect(error).toBeNull()
  })

  it('the decision API select resolves against the real schema', async () => {
    const { error } = await supabase
      .from('ops_appointments')
      .select(DECISION_SELECT)
      .eq('kind', 'estimate')
      .limit(1)

    expect(error).toBeNull()
  })

  it('a token minted for a real estimate verifies back to that estimate', async () => {
    const { data, error } = await supabase
      .from('ops_appointments')
      .select('id')
      .eq('kind', 'estimate')
      .limit(1)
      .single()

    expect(error).toBeNull()
    const token = createEstimateDecisionToken({ estimateId: data!.id })
    expect(verifyEstimateDecisionToken(token).estimateId).toBe(data!.id)
  })
})
