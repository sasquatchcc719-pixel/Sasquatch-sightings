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

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Context fetchers ──────────────────────────────────────────────────────────

async function getPhoneSettingsSnapshot(
  supabase: ReturnType<typeof createAdminClient>,
) {
  const { data } = await supabase
    .from('phone_settings')
    .select('*')
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
    .select('*')
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
    .select('*')
    .eq('category_key', categoryKey)
    .maybeSingle()
  return data
}

async function getRecentAppointments(
  supabase: ReturnType<typeof createAdminClient>,
) {
  const { data } = await supabase
    .from('ops_appointments')
    .select(
      'id, appointment_date, start_time, status, payment_status, quoted_total, internal_notes, lead_source, ops_customers!ops_appointments_customer_id_fkey(full_name, phone, email), ops_service_addresses(street_1, city, zip_code)',
    )
    .order('appointment_date', { ascending: false })
    .limit(15)
  return data ?? []
}

async function getRecentInvoices(
  supabase: ReturnType<typeof createAdminClient>,
) {
  const { data } = await supabase
    .from('ops_invoices')
    .select(
      'id, status, payment_method, subtotal, tax_amount, total, created_at, ops_appointments(appointment_date, ops_customers!ops_appointments_customer_id_fkey(full_name, phone))',
    )
    .order('created_at', { ascending: false })
    .limit(15)
  return data ?? []
}

async function getActiveConversations(
  supabase: ReturnType<typeof createAdminClient>,
) {
  const { data } = await supabase
    .from('conversations')
    .select(
      'id, phone_number, customer_name, status, ai_enabled, messages, updated_at',
    )
    .in('status', ['active', 'escalated'])
    .order('updated_at', { ascending: false })
    .limit(20)

  return (data ?? []).map((c) => {
    const msgs = Array.isArray(c.messages) ? c.messages : []
    const lastTwo = msgs.slice(-2).map((m: Record<string, unknown>) => ({
      role: m.role,
      content: String(m.content ?? '').slice(0, 200),
    }))
    return {
      phone: c.phone_number,
      customer_name: c.customer_name ?? null,
      status: c.status,
      ai_enabled: c.ai_enabled,
      updated_at: c.updated_at,
      recent_messages: lastTwo,
    }
  })
}

async function getRecentTwilioCallLogs() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!accountSid || !authToken) return []

  try {
    const since = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json?StartTime>=${since.slice(0, 10)}&PageSize=25`
    const res = await fetch(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      },
    })
    if (!res.ok) return []
    const json = (await res.json()) as {
      calls?: Array<{
        from: string
        to: string
        status: string
        duration: string
        start_time: string
        direction: string
      }>
    }
    return (json.calls ?? []).map((c) => ({
      from: c.from,
      to: c.to,
      status: c.status,
      duration_seconds: Number(c.duration),
      start_time: c.start_time,
      direction: c.direction,
    }))
  } catch {
    return []
  }
}

async function getRadarSummary(supabase: ReturnType<typeof createAdminClient>) {
  const { data: keywords } = await supabase
    .from('radar_keywords')
    .select('id, keyword, location')
    .eq('active', true)
    .limit(10)

  if (!keywords?.length) return { keywords: [], recent_rankings: [] }

  const { data: rankings } = await supabase
    .from('radar_rankings')
    .select(
      'keyword_id, rank_position, map_rank, created_at, radar_domains(domain, is_my_domain)',
    )
    .in(
      'keyword_id',
      keywords.map((k) => k.id),
    )
    .order('created_at', { ascending: false })
    .limit(40)

  return {
    keywords: keywords.map((k) => ({
      keyword: k.keyword,
      location: k.location,
    })),
    recent_rankings: (rankings ?? []).map((r) => ({
      keyword_id: r.keyword_id,
      rank: r.rank_position,
      map_rank: r.map_rank,
      date: r.created_at,
      domain: (
        r.radar_domains as unknown as {
          domain: string
          is_my_domain: boolean
        } | null
      )?.domain,
      is_ours: (
        r.radar_domains as unknown as {
          domain: string
          is_my_domain: boolean
        } | null
      )?.is_my_domain,
    })),
  }
}

async function getTodayStats(supabase: ReturnType<typeof createAdminClient>) {
  const today = new Date().toISOString().slice(0, 10)
  const { data: todayJobs } = await supabase
    .from('ops_appointments')
    .select(
      'id, status, quoted_total, ops_customers!ops_appointments_customer_id_fkey(full_name)',
    )
    .eq('appointment_date', today)

  const { data: recentRevenue } = await supabase
    .from('ops_invoices')
    .select('total, status, payment_method, created_at')
    .eq('status', 'paid')
    .gte(
      'created_at',
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    )

  const totalRevenue30d = (recentRevenue ?? []).reduce(
    (sum, inv) => sum + Number(inv.total ?? 0),
    0,
  )

  return {
    today_date: today,
    todays_jobs: (todayJobs ?? []).map((j) => ({
      status: j.status,
      quoted_total: j.quoted_total,
      customer: (j.ops_customers as unknown as { full_name: string } | null)
        ?.full_name,
    })),
    todays_job_count: (todayJobs ?? []).length,
    paid_revenue_last_30d: Math.round(totalRevenue30d * 100) / 100,
  }
}

// ── Execute query_database (no confirmation needed — SELECT only) ──────────────
async function executeReadQuery(
  supabase: ReturnType<typeof createAdminClient>,
  sql: string,
) {
  const { data, error } = await supabase.rpc('george_read_query', {
    sql_query: sql,
  })
  if (error) throw new Error(error.message)
  return data
}

// ── Action parser ─────────────────────────────────────────────────────────────

function parseAction(input: unknown): GeorgeActionPayload | null {
  const action = input as Record<string, unknown>
  const name = String(action?.name || '')
  const args = (action?.args || {}) as Record<string, unknown>
  const reason = String(action?.reason || '').trim() || 'Requested by operator'

  if (name === 'query_database') {
    const sql = String(args.sql || '').trim()
    if (!sql) return null
    return {
      name,
      args: { sql, description: String(args.description || sql) },
      reason,
    }
  }

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
    if (!phone) return null
    return { name, args: { phone }, reason }
  }

  if (name === 'set_ivr_timeout') {
    const target = String(args.target || '')
    const seconds = Number(args.seconds)
    if (target !== 'schedule' && target !== 'technical') return null
    if (seconds < 10 || seconds > 180) return null
    return { name, args: { target, seconds }, reason }
  }

  if (name === 'set_failover_target') {
    const target = String(args.target || '')
    const phone = normalizePhone(String(args.phone || ''))
    if (target !== 'primary' && target !== 'failover') return null
    if (!phone) return null
    return { name, args: { target, phone }, reason }
  }

  if (name === 'update_harry_profile') {
    const profileKey = String(args.profile_key || '')
    const promptOverrides = String(args.prompt_overrides || '')
    if (!profileKey || !promptOverrides) return null
    return {
      name,
      args: {
        profile_key: profileKey,
        prompt_overrides: promptOverrides,
        booking_mode: args.booking_mode ? String(args.booking_mode) : undefined,
        is_enabled:
          args.is_enabled !== undefined ? Boolean(args.is_enabled) : undefined,
      },
      reason,
    }
  }

  if (name === 'update_harry_knowledge_block') {
    const categoryKey = String(args.category_key || '')
    const content = String(args.content || '')
    if (!categoryKey || !content) return null
    return {
      name,
      args: {
        category_key: categoryKey,
        content,
        title: args.title ? String(args.title) : undefined,
        is_enabled:
          args.is_enabled !== undefined ? Boolean(args.is_enabled) : undefined,
      },
      reason,
    }
  }

  if (name === 'update_appointment_status') {
    const appointmentId = String(args.appointment_id || '')
    const status = String(args.status || '')
    const validStatuses = [
      'booked',
      'confirmed',
      'on_my_way',
      'in_progress',
      'completed',
      'cancelled',
      'pending_approval',
    ]
    if (!appointmentId || !validStatuses.includes(status)) return null
    return {
      name,
      args: {
        appointment_id: appointmentId,
        status: status as
          | 'booked'
          | 'confirmed'
          | 'on_my_way'
          | 'in_progress'
          | 'completed'
          | 'cancelled'
          | 'pending_approval',
      },
      reason,
    }
  }

  if (name === 'send_customer_sms') {
    const phone = normalizePhone(String(args.phone || ''))
    const message = String(args.message || '').trim()
    if (!phone || !message) return null
    return { name, args: { phone, message }, reason }
  }

  return null
}

// ── Audit writer ──────────────────────────────────────────────────────────────

async function writeAudit(params: {
  supabase: ReturnType<typeof createAdminClient>
  actorUserId: string
  actorEmail: string
  actorRole: string
  actionName: string
  status: string
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

// ── Preview builder ───────────────────────────────────────────────────────────

async function buildPreview(
  action: GeorgeActionPayload,
  supabase: ReturnType<typeof createAdminClient>,
) {
  if (action.name === 'query_database') {
    return {
      target: 'database (read-only)',
      before: {},
      after: { sql: action.args.sql },
    }
  }

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

  if (action.name === 'update_appointment_status') {
    const { data: appt } = await supabase
      .from('ops_appointments')
      .select(
        'id, status, ops_customers!ops_appointments_customer_id_fkey(full_name)',
      )
      .eq('id', action.args.appointment_id)
      .maybeSingle()
    return {
      target: `ops_appointments(${action.args.appointment_id})`,
      before: {
        status: appt?.status || null,
        customer:
          (appt?.ops_customers as unknown as { full_name: string } | null)
            ?.full_name || null,
      },
      after: { status: action.args.status },
    }
  }

  if (action.name === 'send_customer_sms') {
    return {
      target: `sms → ${action.args.phone}`,
      before: {},
      after: { message: action.args.message },
    }
  }

  // set_failover_target fallthrough
  const current = await getPhoneSettingsSnapshot(supabase)
  const key =
    (action as { args: { target: string } }).args.target === 'primary'
      ? 'twilio_primary_forward_number'
      : 'twilio_failover_forward_number'
  return {
    target: `phone_settings.${key}`,
    before: {
      [key]: String((current as Record<string, unknown>)?.[key] || ''),
    },
    after: { [key]: (action as { args: { phone: string } }).args.phone },
  }
}

// ── Action executor ───────────────────────────────────────────────────────────

async function executeAction(
  action: GeorgeActionPayload,
  supabase: ReturnType<typeof createAdminClient>,
): Promise<string | null> {
  if (action.name === 'query_database') {
    const result = await executeReadQuery(supabase, action.args.sql)
    return JSON.stringify(result)
  }

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
    return null
  }

  if (action.name === 'set_harry_toggle') {
    if (!isKnownHarryControlKey(action.args.setting_key))
      throw new Error('Unknown Harry setting key')
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
    return null
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
    if (!convo?.id) throw new Error('No conversation found for this phone')
    const { error } = await supabase
      .from('conversations')
      .update({
        status: action.name === 'hold_conversation' ? 'escalated' : 'active',
        ai_enabled: action.name !== 'hold_conversation',
        updated_at: new Date().toISOString(),
      })
      .eq('id', convo.id)
    if (error) throw error
    return null
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
    return null
  }

  if (action.name === 'set_failover_target') {
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
    return null
  }

  if (action.name === 'update_harry_profile') {
    const current = await getHarryProfileSnapshot(
      supabase,
      action.args.profile_key,
    )
    if (!current?.id)
      throw new Error(`Harry profile not found: ${action.args.profile_key}`)
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
    return null
  }

  if (action.name === 'update_harry_knowledge_block') {
    const current = await getHarryKnowledgeSnapshot(
      supabase,
      action.args.category_key,
    )
    if (!current?.id)
      throw new Error(
        `Harry knowledge block not found: ${action.args.category_key}`,
      )
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
    return null
  }

  if (action.name === 'update_appointment_status') {
    const { error } = await supabase
      .from('ops_appointments')
      .update({
        status: action.args.status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', action.args.appointment_id)
    if (error) throw error
    return null
  }

  if (action.name === 'send_customer_sms') {
    const accountSid = process.env.TWILIO_ACCOUNT_SID
    const authToken = process.env.TWILIO_AUTH_TOKEN
    const fromNumber = process.env.TWILIO_PHONE_NUMBER
    if (!accountSid || !authToken || !fromNumber)
      throw new Error('Twilio credentials not configured')

    const body = new URLSearchParams({
      To: action.args.phone,
      From: fromNumber,
      Body: action.args.message,
    })
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      },
    )
    if (!res.ok) {
      const err = (await res.json()) as { message?: string }
      throw new Error(err.message || `Twilio error: ${res.status}`)
    }
    return null
  }

  throw new Error(`Unknown action: ${(action as { name: string }).name}`)
}

// ── System prompt ─────────────────────────────────────────────────────────────

function assistantSystemPrompt(rolloutMode: string): string {
  return `You are George Henderson, a full-access operations intelligence agent for Sasquatch Carpet Cleaning (Colorado Springs, CO). You have READ access to every table in the database and WRITE access to an allowlisted set of actions.

Return ONLY strict JSON with this shape:
{
  "mode": "ask" | "propose_action",
  "assistant_message": "string",
  "action": {
    "name": "<action_name>",
    "args": { ... },
    "reason": "string"
  }
}

═══════════════════════════════════════
DATABASE SCHEMA (read via query_database)
═══════════════════════════════════════
ops_customers: id, full_name, first_name, last_name, business_name, email, phone, created_at
ops_appointments: id, customer_id→ops_customers, appointment_date, start_time, end_time, status(booked/confirmed/on_my_way/in_progress/completed/cancelled/pending_approval), payment_status, quoted_total, internal_notes, lead_source, created_at
ops_service_addresses: id, customer_id, label, street_1, street_2, city, state, zip_code, gate_code, notes
ops_invoices: id, appointment_id→ops_appointments, status(pending/paid/void), payment_method(cash/venmo/check/card), subtotal, tax_amount, total, created_at
ops_invoice_line_items: id, invoice_id, description, quantity, unit_price, line_total
service_catalog_items: id, name, category, base_price, default_duration_minutes, is_active
conversations: id, phone_number, customer_name, status(active/escalated/completed), ai_enabled, messages(jsonb array of {role,content,timestamp}), updated_at
sms_logs: id, recipient_phone, message_type, message_content, status, twilio_sid, sent_at
harry_control_settings: setting_key, is_enabled, label, description
harry_logic_profiles: profile_key, booking_mode, is_enabled, prompt_overrides
harry_knowledge_blocks: category_key, title, is_enabled, content
phone_settings: temporary_open_line_mode, twilio_primary_forward_number, twilio_failover_forward_number, ivr_schedule_timeout_seconds, ivr_technical_timeout_seconds
radar_keywords: id, keyword, location, active
radar_domains: id, domain, display_name, is_my_domain
radar_rankings: keyword_id, domain_id, rank_position, map_rank, created_at
market_intel_targets: id, type, value, source, is_active
market_intel: id, target_id, source, competitor, content, sentiment, captured_at
jobs: id, service_id, city, neighborhood, ai_description, status(draft/published), created_at
george_action_audit: id, action_name, status, target, reason, actor_email, created_at

═══════════════════════════════════════
AVAILABLE ACTIONS
═══════════════════════════════════════

READ (no confirmation needed — set mode "ask", execute immediately):
• query_database: args { sql: "SELECT ...", description: "plain English summary" }
  - Only SELECT statements. Use for any data question: revenue, job counts, conversation history, rankings, anything.
  - Examples:
    SELECT COUNT(*) as total, status, SUM(total) as revenue FROM ops_invoices GROUP BY status
    SELECT oc.full_name, oa.appointment_date, oa.status FROM ops_appointments oa JOIN ops_customers oc ON oc.id = oa.customer_id ORDER BY oa.appointment_date DESC LIMIT 10
    SELECT keyword, rank_position, map_rank, created_at FROM radar_rankings rr JOIN radar_keywords rk ON rk.id = rr.keyword_id ORDER BY created_at DESC LIMIT 20

WRITE (all require confirmation — set mode "propose_action"):
• set_open_line_mode: args { enabled: bool } — bypass IVR/business hours
• set_harry_toggle: args { setting_key: "auto_reply_enabled"|"escalation_alerts_enabled", enabled: bool }
• hold_conversation: args { phone: "+1XXXXXXXXXX" } — escalate, disable AI
• resume_conversation: args { phone: "+1XXXXXXXXXX" } — restore AI
• set_ivr_timeout: args { target: "schedule"|"technical", seconds: 10-180 }
• set_failover_target: args { target: "primary"|"failover", phone: "+1XXXXXXXXXX" }
• update_harry_profile: args { profile_key, prompt_overrides, booking_mode?, is_enabled? }
• update_harry_knowledge_block: args { category_key, content, title?, is_enabled? }
• update_appointment_status: args { appointment_id: "uuid", status: "booked"|"confirmed"|"on_my_way"|"in_progress"|"completed"|"cancelled"|"pending_approval" }
• send_customer_sms: args { phone: "+1XXXXXXXXXX", message: "text" }

RULES:
- For any data question, use query_database immediately. Never say "I can't access that."
- For informational responses (mode "ask"), include data results in assistant_message.
- Every WRITE action requires explicit confirmation from the operator.
- Current rollout mode: "${rolloutMode}".
- Phones must be E.164 format.`
}

// ── GET — load dashboard state ────────────────────────────────────────────────

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

// ── POST — chat handler ───────────────────────────────────────────────────────

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

    // ── Confirmation flow ────────────────────────────────────────────────────
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
              'Confirmation token not found. Ask me to propose the action again.',
          } as GeorgeChatResponse,
          { status: 404 },
        )
      }
      if (pending.consumed_at) {
        return NextResponse.json(
          {
            mode: 'error',
            assistant_message: 'That confirmation token is already used.',
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
            assistant_message: 'Integrity check failed. Action canceled.',
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
              'Invalid pending action. Ask me to generate it again.',
          } as GeorgeChatResponse,
          { status: 400 },
        )
      }

      const preview = await buildPreview(action, supabase)
      try {
        const queryResult = await executeAction(action, supabase)
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
          assistant_message: queryResult
            ? `Query complete:\n\`\`\`json\n${queryResult}\n\`\`\``
            : `Confirmed. Executed \`${action.name}\` successfully.`,
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
              : 'Unknown error',
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

    // ── Main chat flow ───────────────────────────────────────────────────────
    const message = String(body.message || '').trim()
    if (!message) {
      return NextResponse.json(
        { error: 'message is required' },
        { status: 400 },
      )
    }

    // Gather full context snapshot in parallel
    const [
      harrySnapshot,
      phoneSettings,
      profileRows,
      knowledgeRows,
      recentAppointments,
      recentInvoices,
      activeConversations,
      todayStats,
      radarSummary,
      callLogs,
    ] = await Promise.all([
      getHarryControlSnapshot({ bypassCache: true }),
      getPhoneSettingsSnapshot(supabase),
      supabase
        .from('harry_logic_profiles')
        .select('profile_key, booking_mode, is_enabled, prompt_overrides')
        .order('profile_key', { ascending: true })
        .then((r) => r.data),
      supabase
        .from('harry_knowledge_blocks')
        .select('category_key, title, is_enabled, content')
        .order('sort_order', { ascending: true })
        .then((r) => r.data),
      getRecentAppointments(supabase),
      getRecentInvoices(supabase),
      getActiveConversations(supabase),
      getTodayStats(supabase),
      getRadarSummary(supabase),
      getRecentTwilioCallLogs(),
    ])

    const contextSummary = {
      rollout_mode: rolloutMode,
      today_stats: todayStats,
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
        prompt_overrides: String(row.prompt_overrides || '').slice(0, 800),
      })),
      harry_knowledge_blocks: (knowledgeRows || []).map((row) => ({
        category_key: row.category_key,
        title: row.title,
        is_enabled: row.is_enabled,
        content: String(row.content || '').slice(0, 600),
      })),
      recent_appointments: recentAppointments,
      recent_invoices: recentInvoices,
      active_conversations: activeConversations,
      recent_call_logs: callLogs,
      radar: radarSummary,
    }

    const completion = await openai.chat.completions.create({
      model: GEORGE_MODEL,
      temperature: 0.2,
      max_tokens: 1200,
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
        assistant_message: "I couldn't parse that safely. Please rephrase.",
      } as GeorgeChatResponse)
    }

    const mode = String(parsed.mode || '')
    const assistantMessage = String(parsed.assistant_message || '').trim()

    // ── query_database: execute immediately, no confirmation ─────────────────
    if (mode === 'propose_action') {
      const action = parseAction(parsed.action)
      if (action?.name === 'query_database') {
        try {
          const queryResult = await executeReadQuery(supabase, action.args.sql)
          await writeAudit({
            supabase,
            actorUserId: actor.id,
            actorEmail: actor.email,
            actorRole: actor.role,
            actionName: 'query_database',
            status: 'executed',
            target: 'database (read-only)',
            reason: action.args.description,
            afterState: { sql: action.args.sql },
          })

          // Second GPT call: formulate a natural-language answer from query results
          const answerCompletion = await openai.chat.completions.create({
            model: GEORGE_MODEL,
            temperature: 0.3,
            max_tokens: 600,
            messages: [
              {
                role: 'system',
                content:
                  "You are George Henderson, ops assistant for Sasquatch Carpet Cleaning. Answer the operator's question in plain English using the query results below. Be concise, direct, and business-focused. No JSON.",
              },
              {
                role: 'user',
                content: `Question: ${message}\n\nQuery results: ${JSON.stringify(queryResult)}`,
              },
            ],
          })

          return NextResponse.json({
            mode: 'message',
            assistant_message:
              answerCompletion.choices[0]?.message?.content || assistantMessage,
          } as GeorgeChatResponse)
        } catch (queryError) {
          return NextResponse.json({
            mode: 'message',
            assistant_message: `Query failed: ${queryError instanceof Error ? queryError.message : 'Unknown error'}`,
          } as GeorgeChatResponse)
        }
      }
    }

    // ── Informational response ───────────────────────────────────────────────
    if (mode !== 'propose_action') {
      return NextResponse.json({
        mode: 'message',
        assistant_message: assistantMessage || 'Tell me exactly what you need.',
      } as GeorgeChatResponse)
    }

    // ── Propose write action with confirmation ───────────────────────────────
    const action = parseAction(parsed.action)
    if (!action) {
      return NextResponse.json({
        mode: 'message',
        assistant_message:
          "I can only run allowlisted actions. Check what's available and try again.",
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
        assistant_message: `George is in read-only rollout mode. Proposed \`${action.name}\` but execution is disabled.\n\nTarget: ${preview.target}\nBefore: ${JSON.stringify(preview.before)}\nAfter: ${JSON.stringify(preview.after)}`,
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

    return NextResponse.json({
      mode: 'confirmation_required',
      assistant_message:
        assistantMessage ||
        `I can apply \`${action.name}\`. Confirm to execute.`,
      confirmation: {
        token,
        expires_at: expiresAt,
        action_name: action.name,
        summary: `${action.name} → ${preview.target}`,
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
