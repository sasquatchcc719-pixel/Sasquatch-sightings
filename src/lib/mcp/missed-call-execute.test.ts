// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
const { send } = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@/lib/ops/conversation-reply', () => ({ sendConversationReply: send }))
import { executePreparedAction, payloadHash } from './business-operations'
const actor = { subject: 'owner', label: 'Owner', scopes: ['business:read','customer:contact'] }
describe('ordinary MCP retry guard', () => {
 it.each(['sending','unknown'])('blocks a non-reserved reply while a call attempt is %s', async status => {
  const payload = { conversation_id: 'conversation', body: 'Reply', media_ids: [], expected_updated_at: 'version' }
  const action = { id: 'preview', actor_user_id: 'owner', action_type: 'conversation.send', status: 'pending', required_scope: 'customer:contact', expires_at: new Date(Date.now()+60_000).toISOString(), action_payload: payload, payload_hash: payloadHash(payload) }
  const db = { from(table: string) {
   const q: any = { select: () => q, eq: () => q, in: () => q, limit: () => q, update: () => q, insert: () => q,
    maybeSingle: async () => ({ error: null, data: table === 'mcp_action_previews' ? action : table === 'conversations' ? { phone_number: '+17195550100', updated_at: 'version' } : table === 'call_follow_up_claims' ? { call_sid: `CA${'1'.repeat(32)}`, status } : null }) }
   return q
  } }
  await expect(executePreparedAction({ confirmation_id: 'preview', confirmed: true }, actor, db as never)).rejects.toThrow('Unresolved call follow-up attempt')
  expect(send).not.toHaveBeenCalled()
 })
})
