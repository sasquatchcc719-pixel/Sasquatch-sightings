// @vitest-environment node
/**
 * Every role we offer must actually be writable.
 *
 * `location` used to carry the meaning — 'affected', 'reference', 'exterior' —
 * and a check constraint enforced it. When `role` took that job over, the old
 * constraint stayed, and every reading whose role was not literally 'affected'
 * was rejected by the database. Charles lost eleven readings to it in half an
 * hour, standing in a customer's basement, because 'affected' happens to appear
 * in both lists and nothing else did.
 *
 * This test exists so a dropdown option can never again offer something the
 * table refuses.
 */
import { config as loadEnv } from 'dotenv'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

loadEnv({ path: '.env.local' })

import { createAdminClient } from '@/supabase/server'
import { AIR_ROLES } from '@/lib/ops/restoration-psychrometry'

const supabase = createAdminClient()
const MARKER = 'AIR_ROLE_TEST'
let projectId = ''

beforeAll(async () => {
  const { data: addr } = await supabase
    .from('ops_service_addresses')
    .select('id, customer_id')
    .limit(1)
    .single()

  const { data: project } = await supabase
    .from('restoration_projects')
    .insert({
      customer_id: addr!.customer_id,
      service_address_id: addr!.id,
      cause_narrative: MARKER,
    })
    .select('id')
    .single()
  projectId = project!.id
})

afterAll(async () => {
  await supabase.from('restoration_air_readings').delete().eq('project_id', projectId)
  await supabase.from('restoration_projects').delete().eq('id', projectId)
})

describe('air reading roles', () => {
  it('accepts every role the screen offers', async () => {
    for (const role of AIR_ROLES) {
      const { error } = await supabase.from('restoration_air_readings').insert({
        project_id: projectId,
        role: role.value,
        location: role.label,
        temp_f: 74,
        rh_pct: 44,
      })
      expect(error, `role ${role.value} was rejected: ${error?.message}`).toBeNull()
    }

    const { data } = await supabase
      .from('restoration_air_readings')
      .select('role')
      .eq('project_id', projectId)
    expect(data).toHaveLength(AIR_ROLES.length)
  })

  it('accepts a label a person would actually type', async () => {
    const { error } = await supabase.from('restoration_air_readings').insert({
      project_id: projectId,
      role: 'outside',
      location: 'Front porch, by the hose bib',
      temp_f: 72,
      rh_pct: 40,
    })
    expect(error).toBeNull()
  })

  it('still refuses a blank label, which would be unidentifiable in a report', async () => {
    const { error } = await supabase.from('restoration_air_readings').insert({
      project_id: projectId,
      role: 'outside',
      location: '   ',
      temp_f: 72,
      rh_pct: 40,
    })
    expect(error).not.toBeNull()
  })
})
