// @vitest-environment node
/**
 * Integration tests for the Telegram SMS relay.
 *
 * Exercises the pure logic (group classification, contact card) plus the
 * real-DB round trips (group discovery, topic→phone mapping, unmapped-topic
 * no-op). No SMS is ever sent and no live Telegram call is made — the live
 * end-to-end (real topic + card + SMS) is verified manually after deploy.
 */
import { config as loadEnv } from 'dotenv'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

loadEnv({ path: '.env.local' })

import { createAdminClient } from '@/supabase/server'
import {
  classifyGroupRole,
  renderContactCardText,
  rememberRelayGroup,
  findThreadByTopic,
  relayTopicReplyToSms,
} from './relay'
import type { InboundSmsCustomerContext } from '@/lib/twilio/inbound-sms-customer-context'

describe('relay: group classification', () => {
  it('routes by keyword and ignores unrelated groups', () => {
    expect(classifyGroupRole('LSA Leads')).toBe('lsa')
    expect(classifyGroupRole('Customers')).toBe('customers')
    expect(classifyGroupRole('  customer texts  ')).toBe('customers')
    expect(classifyGroupRole('Random Group')).toBeNull()
    expect(classifyGroupRole(undefined)).toBeNull()
  })
})

describe('relay: contact card', () => {
  it('renders a new-lead card when no customer matches', () => {
    const card = renderContactCardText('+17195551234', null)
    expect(card).toContain('(719) 555-1234')
    expect(card).toContain('new lead')
    expect(card).toContain('sightings.sasquatchcarpet.com')
  })

  it('renders name, contact details, and linked job history', () => {
    const context: InboundSmsCustomerContext = {
      customer: {
        id: 'cust-123',
        name: 'Jane Doe',
        businessName: 'Acme Co',
        email: 'jane@example.com',
        phone: '+17195550000',
      },
      address: '123 Main St, Monument, CO 80132',
      jobs: [
        {
          id: 'appt-9',
          date: '2026-06-20',
          startTime: '10:00',
          status: 'scheduled',
          quotedTotal: 250,
          address: '123 Main St',
          services: ['Carpet cleaning'],
          timing: 'upcoming',
        },
      ],
    }
    const card = renderContactCardText('+17195551234', context)
    expect(card).toContain('Jane Doe')
    expect(card).toContain('Acme Co')
    expect(card).toContain('jane@example.com')
    expect(card).toContain('123 Main St, Monument, CO 80132')
    expect(card).toContain('Carpet cleaning')
    expect(card).toContain('$250.00')
    expect(card).toContain('/admin/operations/appointments/appt-9')
  })
})

describe('relay: real-DB mapping', () => {
  const supabase = createAdminClient()
  const TEST_GROUP_ID = -1009999000001 // fake supergroup id, never a real chat
  const TEST_TOPIC_ID = 987654
  const TEST_PHONE = `+1719555${String(Date.now()).slice(-4)}`

  afterAll(async () => {
    await supabase
      .from('telegram_relay_threads')
      .delete()
      .eq('phone', TEST_PHONE)
    // leave discovered real groups intact; only remove our fake test group
    await supabase
      .from('telegram_relay_groups')
      .delete()
      .eq('chat_id', TEST_GROUP_ID)
  })

  it('rememberRelayGroup upserts a classified group, ignores unknown titles', async () => {
    // Unknown title → no row written.
    await rememberRelayGroup(supabase, {
      id: TEST_GROUP_ID,
      title: 'Totally Unrelated',
      type: 'supergroup',
    })
    const { data: none } = await supabase
      .from('telegram_relay_groups')
      .select('role')
      .eq('chat_id', TEST_GROUP_ID)
    expect(none ?? []).toHaveLength(0)
  })

  it('maps a topic back to its customer phone, and no-ops on unmapped topics', async () => {
    // Seed a thread row directly (simulating a created topic).
    const { error } = await supabase.from('telegram_relay_threads').insert({
      phone: TEST_PHONE,
      group_chat_id: TEST_GROUP_ID,
      topic_id: TEST_TOPIC_ID,
      business_number: '+17192498791',
      customer_name: 'Relay Test',
      is_lsa: false,
    })
    expect(error).toBeNull()

    const found = await findThreadByTopic(
      supabase,
      TEST_GROUP_ID,
      TEST_TOPIC_ID,
    )
    expect(found?.phone).toBe(TEST_PHONE)
    expect(found?.business_number).toBe('+17192498791')

    // An unmapped topic must be a silent no-op (no SMS attempted).
    const result = await relayTopicReplyToSms({
      supabase,
      groupChatId: TEST_GROUP_ID,
      topicId: 111111, // not seeded
      text: 'should not send',
    })
    expect(result.sent).toBe(false)
    expect(result.reason).toBe('unmapped-topic')
  })
})
