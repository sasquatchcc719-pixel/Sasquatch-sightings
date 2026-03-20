import { randomUUID, createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import {
  clearHarryControlCache,
  getHarryControlSnapshot,
  isKnownHarryControlKey,
} from '@/lib/harry/control'
import {
  getGeorgeRolloutMode,
  isGeorgeFeatureEnabled,
} from '@/lib/harry/features'
import type {
  GeorgeActionPayload,
  GeorgeChatRequest,
  GeorgeChatResponse,
} from '@/lib/george/contracts'

const GEORGE_MODEL = 'gpt-4.1'
const CONFIRM_TTL_MS = 10 * 60 * 1000

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null

function normalizePhone(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return digits.startsWith('+') ? digits : `+${digits}`
}

function hashPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

function parseJsonFromModel(content: string): Record<string, unknown> | null {
  const trimmed = String(content || '').trim()
  if (!trimmed) return null
  const cleaned = trimmed
    .replace(/^```json/i, '')
    .replace(/^```/i, '')
    .replace(/```$/i, '')
    .trim()
  try {
    return JSON.parse(cleaned) as Record<string, unknown>
  } catch {
    return null
  }
}

function parseAction(input: unknown): GeorgeActionPayload | null {
  const action = input as Record<string, unknown>
  const name = String(action?.name || '')
  const args = (action?.args || {}) as Record<string, unknown>
  const reason = String(action?.reason || '').trim() || 'Requested by operator'

  if (name === 'set_open_line_mode') {
    return { name, args: { enabled: Boolean(args.enabled) }, reason }
  }

  if (name === 'set_harry_toggle') {
    const settingKey = String(args.setting_key || '')
    if (
      settingKey !== 'auto_reply_enabled' &&
      settingKey !== 'escalation_alerts_enabled'
    ) {
      return null
    }
    return {
      name,
      args: { setting_key: settingKey, enabled: Boolean(args.enabled) },
      reason,
    }
  }

  if (name === 'hold_conversation' || name === 'resume_conversation') {
    const phone = normalizePhone(String(args.phone || ''))
    if (!phone || phone.length < 8) return null
    return { name, args: { phone }, reason }
  }

  if (name === 'set_ivr_timeout') {
    const target = String(args.target || '')
    if (target !== 'schedule' && target !== 'technical') return null
    const seconds = Math.round(Number(args.seconds))
    if (!Number.isFinite(seconds) || seconds < 10 || seconds > 120) return null
    return { name, args: { target, seconds }, reason }
  }

  if (name === 'set_failover_target') {
    const target = String(args.target || '')
    if (target !== 'primary' && target !== 'failover') return null
    const phone = normalizePhone(String(args.phone || ''))
    if (!phone || phone.length < 8) return null
    return { name, args: { target, phone }, reason }
  }

  if (name === 'update_harry_profile') {
    const profileKey = String(args.profile_key || '').trim()
    const promptOverrides = String(args.prompt_overrides || '').trim()
    const bookingModeRaw = String(args.booking_mode || '').trim()
    const isEnabledRaw = args.is_enabled
    if (!profileKey || !promptOverrides) return null
    const payload: GeorgeActionPayload = {
      name,
      args: {
        profile_key: profileKey,
        prompt_overrides: promptOverrides,
      },
      reason,
    }
    if (bookingModeRaw) {
      payload.args.booking_mode = bookingModeRaw
    }
    if (isEnabledRaw !== undefined) {
      payload.args.is_enabled = Boolean(isEnabledRaw)
    }
    return payload
  }

  if (name === 'update_harry_knowledge_block') {
    const categoryKey = String(args.category_key || '').trim()
    const content = String(args.content || '').trim()
    const title = String(args.title || '').trim()
    const isEnabledRaw = args.is_enabled
    if (!categoryKey || !content) return null
    const payload: GeorgeActionPayload = {
      name,
      args: {
        category_key: categoryKey,
        content,
      },
      reason,
    }
    if (title) payload.args.title = title
    if (isEnabledRaw !== undefined) {
      payload.args.is_enabled = Boolean(isEnabledRaw)
    }
    return payload
  }

  return null
}

async function getPhoneSettingsSnapshot(
  supabase: ReturnType<typeof createAdminClient>,
) {
  const { data } = await supabase
    .from('phone_settings')
    .select(
      'id, temporary_open_line_mode, dial_timeout, twilio_primary_forward_number, twilio_failover_forward_number, ivr_schedule_timeout_seconds, ivr_technical_timeout_seconds',
    )
    .limit(1)
    .maybeSingle()
  return data
}

async function getHarryProfileSnapshot(
  supabase: ReturnType<typeof createAdminClient>,
  profileKey: string,
) {
  const { data } = await supabase
    .from('harry_logic_profiles')
    .select(
      'id, profile_key, label, channel_key, booking_mode, prompt_overrides, is_enabled',
    )
    .eq('profile_key', profileKey)
    .maybeSingle()
  return data
}

async function getHarryKnowledgeSnapshot(
  supabase: ReturnType<typeof createAdminClient>,
  categoryKey: string,
) {
  const { data } = await supabase
    .from('harry_knowledge_blocks')
    .select('id, category_key, title, content, is_enabled, sort_order')
    .eq('category_key', categoryKey)
    .maybeSingle()
  return data
}

async function writeAudit(params: {
  supabase: ReturnType<typeof createAdminClient>
  actorUserId: string
  actorEmail: string
  actorRole: string
  actionName: string
  status: 'proposed' | 'executed' | 'failed'
  target?: string
  reason?: string
  beforeState?: Record<string, unknown>
  afterState?: Record<string, unknown>
  errorMessage?: string
}) {
  await params.supabase.from('george_action_audit').insert({
    actor_user_id: params.actorUserId,
    actor_email: params.actorEmail,
    actor_role: params.actorRole,
    action_name: params.actionName,
    status: params.status,
    target: params.target || null,
    reason: params.reason || null,
    before_state: params.beforeState || null,
    after_state: params.afterState || null,
    error_message: params.errorMessage || null,
  })
}

async function buildPreview(
  action: GeorgeActionPayload,
  supabase: ReturnType<typeof createAdminClient>,
) {
  if (action.name === 'set_open_line_mode') {
    const current = await getPhoneSettingsSnapshot(supabase)
    return {
      target: 'phone_settings.temporary_open_line_mode',
      before: {
        temporary_open_line_mode: Boolean(current?.temporary_open_line_mode),
      },
      after: { temporary_open_line_mode: action.args.enabled },
    }
  }

  if (action.name === 'set_harry_toggle') {
    const snapshot = await getHarryControlSnapshot({ bypassCache: true })
    const current = snapshot.rows.find(
      (row) => row.setting_key === action.args.setting_key,
    )
    return {
      target: `harry_control_settings.${action.args.setting_key}`,
      before: { is_enabled: Boolean(current?.is_enabled) },
      after: { is_enabled: action.args.enabled },
    }
  }

  if (
    action.name === 'hold_conversation' ||
    action.name === 'resume_conversation'
  ) {
    const { data: convo } = await supabase
      .from('conversations')
      .select('id, phone_number, status, ai_enabled, updated_at')
      .eq('phone_number', action.args.phone)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    return {
      target: `conversations(${action.args.phone})`,
      before: {
        id: convo?.id || null,
        status: convo?.status || null,
        ai_enabled: convo?.ai_enabled ?? null,
      },
      after:
        action.name === 'hold_conversation'
          ? { status: 'escalated', ai_enabled: false }
          : { status: 'active', ai_enabled: true },
    }
  }

  if (action.name === 'set_ivr_timeout') {
    const current = await getPhoneSettingsSnapshot(supabase)
    const key =
      action.args.target === 'schedule'
        ? 'ivr_schedule_timeout_seconds'
        : 'ivr_technical_timeout_seconds'
    return {
      target: `phone_settings.${key}`,
      before: { [key]: Number(current?.[key] || 0) },
      after: { [key]: action.args.seconds },
    }
  }

  if (action.name === 'update_harry_profile') {
    const current = await getHarryProfileSnapshot(
      supabase,
      action.args.profile_key,
    )
    return {
      target: `harry_logic_profiles.${action.args.profile_key}`,
      before: {
        booking_mode: current?.booking_mode || null,
        is_enabled:
          current?.is_enabled === undefined
            ? null
            : Boolean(current.is_enabled),
        prompt_overrides: String(current?.prompt_overrides || ''),
      },
      after: {
        booking_mode:
          action.args.booking_mode ||
          String(current?.booking_mode || 'bounded_auto_booking'),
        is_enabled:
          action.args.is_enabled !== undefined
            ? action.args.is_enabled
            : Boolean(current?.is_enabled ?? true),
        prompt_overrides: action.args.prompt_overrides,
      },
    }
  }

  if (action.name === 'update_harry_knowledge_block') {
    const current = await getHarryKnowledgeSnapshot(
      supabase,
      action.args.category_key,
    )
    return {
      target: `harry_knowledge_blocks.${action.args.category_key}`,
      before: {
        title: String(current?.title || ''),
        is_enabled:
          current?.is_enabled === undefined
            ? null
            : Boolean(current.is_enabled),
        content: String(current?.content || ''),
      },
      after: {
        title: action.args.title || String(current?.title || ''),
        is_enabled:
          action.args.is_enabled !== undefined
            ? action.args.is_enabled
            : Boolean(current?.is_enabled ?? true),
        content: action.args.content,
      },
    }
  }

  const current = await getPhoneSettingsSnapshot(supabase)
  const key =
    action.args.target === 'primary'
      ? 'twilio_primary_forward_number'
      : 'twilio_failover_forward_number'
  return {
    target: `phone_settings.${key}`,
    before: { [key]: String(current?.[key] || '') },
    after: { [key]: action.args.phone },
  }
}

async function executeAction(
  action: GeorgeActionPayload,
  supabase: ReturnType<typeof createAdminClient>,
) {
  if (action.name === 'set_open_line_mode') {
    const { data: row } = await supabase
      .from('phone_settings')
      .select('id')
      .limit(1)
      .single()
    if (!row) throw new Error('phone_settings row not found')
    const { error } = await supabase
      .from('phone_settings')
      .update({ temporary_open_line_mode: action.args.enabled })
      .eq('id', row.id)
    if (error) throw error
    return
  }

  if (action.name === 'set_harry_toggle') {
    if (!isKnownHarryControlKey(action.args.setting_key)) {
      throw new Error('Unknown Harry setting key')
    }
    const snapshot = await getHarryControlSnapshot({ bypassCache: true })
    const existing = snapshot.rows.find(
      (row) => row.setting_key === action.args.setting_key,
    )
    if (!existing) throw new Error('Harry setting not found')
    const { error } = await supabase.from('harry_control_settings').upsert(
      {
        setting_key: existing.setting_key,
        group_key: existing.group_key,
        label: existing.label,
        description: existing.description,
        is_enabled: action.args.enabled,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'setting_key' },
    )
    if (error) throw error
    clearHarryControlCache()
    return
  }

  if (
    action.name === 'hold_conversation' ||
    action.name === 'resume_conversation'
  ) {
    const { data: convo } = await supabase
      .from('conversations')
      .select('id')
      .eq('phone_number', action.args.phone)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!convo?.id) {
      throw new Error('No conversation found for this phone')
    }
    const { error } = await supabase
      .from('conversations')
      .update({
        status: action.name === 'hold_conversation' ? 'escalated' : 'active',
        ai_enabled: action.name !== 'hold_conversation',
        updated_at: new Date().toISOString(),
      })
      .eq('id', convo.id)
    if (error) throw error
    return
  }

  if (action.name === 'set_ivr_timeout') {
    const { data: row } = await supabase
      .from('phone_settings')
      .select('id')
      .limit(1)
      .single()
    if (!row) throw new Error('phone_settings row not found')
    const updates =
      action.args.target === 'schedule'
        ? { ivr_schedule_timeout_seconds: action.args.seconds }
        : { ivr_technical_timeout_seconds: action.args.seconds }
    const { error } = await supabase
      .from('phone_settings')
      .update(updates)
      .eq('id', row.id)
    if (error) throw error
    return
  }

  if (action.name === 'update_harry_profile') {
    const current = await getHarryProfileSnapshot(
      supabase,
      action.args.profile_key,
    )
    if (!current?.id) {
      throw new Error(`Harry profile not found: ${action.args.profile_key}`)
    }
    const { error } = await supabase
      .from('harry_logic_profiles')
      .update({
        prompt_overrides: action.args.prompt_overrides,
        booking_mode: action.args.booking_mode || current.booking_mode,
        is_enabled:
          action.args.is_enabled !== undefined
            ? action.args.is_enabled
            : current.is_enabled,
        updated_at: new Date().toISOString(),
      })
      .eq('id', current.id)
    if (error) throw error
    return
  }

  if (action.name === 'update_harry_knowledge_block') {
    const current = await getHarryKnowledgeSnapshot(
      supabase,
      action.args.category_key,
    )
    if (!current?.id) {
      throw new Error(
        `Harry knowledge block not found: ${action.args.category_key}`,
      )
    }
    const { error } = await supabase
      .from('harry_knowledge_blocks')
      .update({
        title: action.args.title || current.title,
        content: action.args.content,
        is_enabled:
          action.args.is_enabled !== undefined
            ? action.args.is_enabled
            : current.is_enabled,
        updated_at: new Date().toISOString(),
      })
      .eq('id', current.id)
    if (error) throw error
    return
  }

  const { data: row } = await supabase
    .from('phone_settings')
    .select('id')
    .limit(1)
    .single()
  if (!row) throw new Error('phone_settings row not found')
  const updates =
    action.args.target === 'primary'
      ? { twilio_primary_forward_number: action.args.phone }
      : { twilio_failover_forward_number: action.args.phone }
  const { error } = await supabase
    .from('phone_settings')
    .update(updates)
    .eq('id', row.id)
  if (error) throw error
}

function assistantSystemPrompt(rolloutMode: string): string {
  return `You are George Henderson, an admin-only operations copilot for Sasquatch Carpet Cleaning.
Return ONLY strict JSON with this shape:
{
  "mode": "ask" | "propose_action",
  "assistant_message": "string",
  "action": {
    "name": "set_open_line_mode" | "set_harry_toggle" | "hold_conversation" | "resume_conversation" | "set_ivr_timeout" | "set_failover_target" | "update_harry_profile" | "update_harry_knowledge_block",
    "args": { ... },
    "reason": "string"
  }
}

Rules:
- Never invent actions outside the allowlist.
- If request is informational, use mode "ask" and omit action.
- For actions, include concrete args.
- set_harry_toggle only supports setting_key "auto_reply_enabled" or "escalation_alerts_enabled".
- hold/resume conversation requires phone number in E.164.
- set_ivr_timeout target: "schedule" or "technical", seconds between 10 and 120.
- set_failover_target target: "primary" or "failover" with E.164 phone.
- update_harry_profile requires profile_key + prompt_overrides, optional booking_mode and is_enabled.
- update_harry_knowledge_block requires category_key + content, optional title and is_enabled.
- Mention that every mutation requires explicit confirmation.
- Current rollout mode is "${rolloutMode}".`
}

export async function GET() {
  try {
    const actor = await requireAnyRole(['admin', 'owner', 'dispatcher'])
    if (!isGeorgeFeatureEnabled()) {
      return NextResponse.json(
        { error: 'George Henderson is disabled' },
        { status: 403 },
      )
    }
    const supabase = createAdminClient()
    const { data: actions } = await supabase
      .from('george_action_audit')
      .select(
        'id, action_name, status, target, reason, actor_email, created_at, error_message',
      )
      .order('created_at', { ascending: false })
      .limit(25)

    return NextResponse.json({
      enabled: true,
      rollout_mode: getGeorgeRolloutMode(),
      model: GEORGE_MODEL,
      actor: { id: actor.id, email: actor.email, role: actor.role },
      recent_actions: actions || [],
    })
  } catch (error) {
    console.error('[admin/george][GET] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load George status' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAnyRole(['admin', 'owner', 'dispatcher'])
    if (!isGeorgeFeatureEnabled()) {
      return NextResponse.json(
        { error: 'George Henderson is disabled' },
        { status: 403 },
      )
    }
    if (!openai) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY not configured' },
        { status: 500 },
      )
    }

    const rolloutMode = getGeorgeRolloutMode()
    const supabase = createAdminClient()
    const body = (await request.json()) as GeorgeChatRequest
    const confirmationToken = String(body.confirmation_token || '').trim()

    if (confirmationToken) {
      const { data: pending } = await supabase
        .from('george_pending_actions')
        .select('*')
        .eq('confirmation_token', confirmationToken)
        .eq('actor_user_id', actor.id)
        .maybeSingle()

      if (!pending) {
        return NextResponse.json(
          {
            mode: 'error',
            assistant_message:
              'Confirmation token was not found. Ask me to propose the action again.',
          } as GeorgeChatResponse,
          { status: 404 },
        )
      }
      if (pending.consumed_at) {
        return NextResponse.json(
          {
            mode: 'error',
            assistant_message:
              'That confirmation token is already used. Ask me to propose the action again.',
          } as GeorgeChatResponse,
          { status: 409 },
        )
      }
      if (Date.parse(String(pending.expires_at || '')) < Date.now()) {
        return NextResponse.json(
          {
            mode: 'error',
            assistant_message:
              'That confirmation has expired. Ask me to propose the action again.',
          } as GeorgeChatResponse,
          { status: 410 },
        )
      }

      const payloadHash = hashPayload(pending.action_payload)
      if (payloadHash !== String(pending.payload_hash || '')) {
        await supabase
          .from('george_pending_actions')
          .update({ consumed_at: new Date().toISOString() })
          .eq('id', pending.id)
        return NextResponse.json(
          {
            mode: 'error',
            assistant_message:
              'The pending action failed integrity checks and was canceled.',
          } as GeorgeChatResponse,
          { status: 409 },
        )
      }

      const action = parseAction(pending.action_payload)
      if (!action) {
        return NextResponse.json(
          {
            mode: 'error',
            assistant_message:
              'The pending action is invalid. Ask me to generate it again.',
          } as GeorgeChatResponse,
          { status: 400 },
        )
      }

      const preview = await buildPreview(action, supabase)
      try {
        await executeAction(action, supabase)
        await writeAudit({
          supabase,
          actorUserId: actor.id,
          actorEmail: actor.email,
          actorRole: actor.role,
          actionName: action.name,
          status: 'executed',
          target: preview.target,
          reason: action.reason,
          beforeState: preview.before,
          afterState: preview.after,
        })
        await supabase
          .from('george_pending_actions')
          .update({ consumed_at: new Date().toISOString() })
          .eq('id', pending.id)

        return NextResponse.json({
          mode: 'executed',
          assistant_message: `Confirmed. Executed \`${action.name}\` successfully.`,
        } as GeorgeChatResponse)
      } catch (executeError) {
        await writeAudit({
          supabase,
          actorUserId: actor.id,
          actorEmail: actor.email,
          actorRole: actor.role,
          actionName: action.name,
          status: 'failed',
          target: preview.target,
          reason: action.reason,
          beforeState: preview.before,
          afterState: preview.after,
          errorMessage:
            executeError instanceof Error
              ? executeError.message
              : 'Unknown execution error',
        })
        await supabase
          .from('george_pending_actions')
          .update({ consumed_at: new Date().toISOString() })
          .eq('id', pending.id)
        return NextResponse.json(
          {
            mode: 'error',
            assistant_message:
              executeError instanceof Error
                ? `Execution failed: ${executeError.message}`
                : 'Execution failed unexpectedly.',
          } as GeorgeChatResponse,
          { status: 500 },
        )
      }
    }

    const message = String(body.message || '').trim()
    if (!message) {
      return NextResponse.json(
        { error: 'message is required' },
        { status: 400 },
      )
    }

    const harrySnapshot = await getHarryControlSnapshot({ bypassCache: true })
    const phoneSettings = await getPhoneSettingsSnapshot(supabase)
    const [{ data: profileRows }, { data: knowledgeRows }] = await Promise.all([
      supabase
        .from('harry_logic_profiles')
        .select('profile_key, booking_mode, is_enabled, prompt_overrides')
        .order('profile_key', { ascending: true }),
      supabase
        .from('harry_knowledge_blocks')
        .select('category_key, title, is_enabled, content')
        .order('sort_order', { ascending: true }),
    ])
    const contextSummary = {
      rollout_mode: rolloutMode,
      harry_controls: {
        auto_reply_enabled: harrySnapshot.settings.auto_reply_enabled,
        escalation_alerts_enabled:
          harrySnapshot.settings.escalation_alerts_enabled,
      },
      phone_settings: {
        temporary_open_line_mode: Boolean(
          phoneSettings?.temporary_open_line_mode,
        ),
        ivr_schedule_timeout_seconds: Number(
          phoneSettings?.ivr_schedule_timeout_seconds || 0,
        ),
        ivr_technical_timeout_seconds: Number(
          phoneSettings?.ivr_technical_timeout_seconds || 0,
        ),
        twilio_primary_forward_number:
          phoneSettings?.twilio_primary_forward_number || null,
        twilio_failover_forward_number:
          phoneSettings?.twilio_failover_forward_number || null,
      },
      harry_profiles: (profileRows || []).map((row) => ({
        profile_key: row.profile_key,
        booking_mode: row.booking_mode,
        is_enabled: row.is_enabled,
        prompt_overrides: String(row.prompt_overrides || '').slice(0, 1200),
      })),
      harry_knowledge_blocks: (knowledgeRows || []).map((row) => ({
        category_key: row.category_key,
        title: row.title,
        is_enabled: row.is_enabled,
        content: String(row.content || '').slice(0, 1200),
      })),
    }

    const completion = await openai.chat.completions.create({
      model: GEORGE_MODEL,
      temperature: 0.2,
      max_tokens: 500,
      messages: [
        { role: 'system', content: assistantSystemPrompt(rolloutMode) },
        {
          role: 'system',
          content: `Current runtime context:\n${JSON.stringify(contextSummary)}`,
        },
        { role: 'user', content: message },
      ],
    })

    const raw = completion.choices[0]?.message?.content || ''
    const parsed = parseJsonFromModel(raw)

    if (!parsed) {
      return NextResponse.json({
        mode: 'message',
        assistant_message:
          "I couldn't parse that safely. Please rephrase the request with exact target and value.",
      } as GeorgeChatResponse)
    }

    const mode = String(parsed.mode || '')
    const assistantMessage = String(parsed.assistant_message || '').trim()

    if (mode !== 'propose_action') {
      return NextResponse.json({
        mode: 'message',
        assistant_message:
          assistantMessage ||
          'I reviewed your request. Tell me exactly what setting you want changed.',
      } as GeorgeChatResponse)
    }

    const action = parseAction(parsed.action)
    if (!action) {
      return NextResponse.json({
        mode: 'message',
        assistant_message:
          'I can only run allowlisted actions. Try toggles, conversation hold/resume, Twilio timeout/target updates, or Harry profile/knowledge logic updates.',
      } as GeorgeChatResponse)
    }

    const preview = await buildPreview(action, supabase)
    await writeAudit({
      supabase,
      actorUserId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      actionName: action.name,
      status: 'proposed',
      target: preview.target,
      reason: action.reason,
      beforeState: preview.before,
      afterState: preview.after,
    })

    if (rolloutMode !== 'confirm_actions') {
      return NextResponse.json({
        mode: 'message',
        assistant_message:
          `George is currently in read-only rollout mode. Proposed action \`${action.name}\` is ready but execution is disabled.\n\n` +
          `Target: ${preview.target}\nBefore: ${JSON.stringify(preview.before)}\nAfter: ${JSON.stringify(preview.after)}`,
      } as GeorgeChatResponse)
    }

    const token = randomUUID()
    const expiresAt = new Date(Date.now() + CONFIRM_TTL_MS).toISOString()
    const payloadHash = hashPayload(action)

    const { error: pendingError } = await supabase
      .from('george_pending_actions')
      .insert({
        confirmation_token: token,
        actor_user_id: actor.id,
        actor_email: actor.email,
        actor_role: actor.role,
        action_name: action.name,
        action_payload: action,
        payload_hash: payloadHash,
        expires_at: expiresAt,
      })
    if (pendingError) throw pendingError

    const summary = `${action.name} -> ${preview.target}`
    return NextResponse.json({
      mode: 'confirmation_required',
      assistant_message:
        assistantMessage ||
        `I can apply \`${action.name}\`. Confirm to execute this change.`,
      confirmation: {
        token,
        expires_at: expiresAt,
        action_name: action.name,
        summary,
        preview,
      },
    } as GeorgeChatResponse)
  } catch (error) {
    console.error('[admin/george][POST] Error:', error)
    return NextResponse.json(
      {
        mode: 'error',
        assistant_message: 'George failed to process that request.',
      } as GeorgeChatResponse,
      { status: 500 },
    )
  }
}
