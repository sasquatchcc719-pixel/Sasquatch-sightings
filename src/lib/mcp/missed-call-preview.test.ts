// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { previewConversationSend } from './business-operations'
const actor = { subject: 'owner', label: 'Owner', scopes: ['business:read','customer:contact'] }
const sid = `CA${'1'.repeat(32)}`
function fixture(eligible: boolean) {
 let stored: any
 const rpc = vi.fn().mockResolvedValue({ data: { eligible }, error: null })
 const db = { rpc, from(table: string) {
  const q: any = {
   select: () => q, eq: () => q, lt: () => q, update: () => q,
   insert: (v: any) => { stored = v; return q },
   maybeSingle: async () => ({ data: table === 'conversations' ? { id: 'conversation', phone_number: '+17195550100', updated_at: 'version' } : table === 'missed_call_email_notifications' ? { call_sid: sid, conversation_id: 'conversation', occurred_at: '2026-11-12T05:20:00Z', finalized_at: '2026-11-12T05:20:30Z', sender: 'Sasquatch Carpet Cleaning <noreply@sasquatchcarpet.com>', recipient: 'sasquatchcc719@gmail.com', subject: `Sasquatch missed call: ${sid}`, status: 'accepted', provider_id: 'resend-notice-1', accepted_at: '2026-11-12T05:22:00Z' } : null, error: null }),
   single: async () => ({ data: { id: 'preview', preview: stored.preview, status: 'pending' }, error: null }),
  }; return q
 } }
 return { db, rpc, payload: () => stored?.action_payload }
}
const input = { conversation_id: 'conversation', body: 'User-approved exact reply', media_ids: [], idempotency_key: `missed-call:${sid}:v1` }
describe('missed-call MCP preview', () => {
 it('validates canonical call, phone and conversation without acquiring a send claim', async () => {
  const f = fixture(true)
  const result = await previewConversationSend(input, actor, f.db as never)
  expect(f.rpc).toHaveBeenCalledWith('claim_call_follow_up', { p_phone: '+17195550100', p_call_sid: sid, p_recording_sid: null, p_preview_only: true, p_conversation_id: 'conversation' })
  expect(f.payload()).toMatchObject({ missed_call_sid: sid, body: input.body, conversation_id: 'conversation' })
  expect(result.preview).toMatchObject({ missed_call_follow_up_evidence: { source: 'authenticated_owner_email_bridge', call_sid: sid, provider_notice_id: 'resend-notice-1', verified_live_record: true } })
 })
 it('refuses ineligible or previously handled calls before storing a preview', async () => {
  const f = fixture(false)
  await expect(previewConversationSend(input, actor, f.db as never)).rejects.toThrow('not eligible')
  expect(f.payload()).toBeUndefined()
 })
 it('rejects media before storing a call reply preview', async () => {
  const f = fixture(true)
  await expect(previewConversationSend({ ...input, media_ids: ['media'] }, actor, f.db as never)).rejects.toThrow('text only')
  expect(f.rpc).not.toHaveBeenCalled()
 })
 it('cannot bypass call context via first contact', async () => {
  const f = fixture(true)
  await expect(previewConversationSend({ ...input, conversation_id: undefined, customer_id: 'customer' }, actor, f.db as never)).rejects.toThrow('call-context')
  expect(f.rpc).not.toHaveBeenCalled()
 })
})
