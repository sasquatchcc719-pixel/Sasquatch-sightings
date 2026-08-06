import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

/**
 * Everything Google Local Services Ads, in one place.
 *
 * The awkward truth this endpoint works around: Google's billing export gives a
 * DATE, a lead COUNT and a DOLLAR amount — never which lead was charged. The
 * Google Ads API is no help either (local_services_lead.lead_charged is a bare
 * boolean). So a charge can only be tied to a person by matching on date.
 *
 * That match is therefore reported as a `matchConfidence`, never as fact:
 *   'exact'  — one charged lead that day and one LSA thread that day
 *   'likely' — same day, but more than one candidate
 *   'none'   — a charge with no thread (almost always a phone lead, which never
 *              produces a relay text)
 */

const MATCH_WINDOW_DAYS = 1

/**
 * Pull any 10-digit phone number out of message text.
 *
 * This is the ONLY way to identify who is on an LSA thread. The thread's own
 * phone_number is Google's relay line, not the customer's, and conversations
 * arriving from LSA have no ops_customer_id. So the only real evidence is the
 * customer typing their own number into a message — which most never do.
 *
 * A thread with no extractable number gets NO job link. Do not fall back to
 * matching by date: an earlier version did, and every thread ended up claiming
 * the same job because any LSA job inside the window matched every thread.
 */
function extractPhones(text: string): string[] {
  const out = new Set<string>()
  const re = /\b(\d{3})[-.\s]?(\d{3})[-.\s]?(\d{4})\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out.add(`${m[1]}${m[2]}${m[3]}`)
  return [...out]
}

function last10(value: string | null | undefined): string {
  return (value || '').replace(/\D/g, '').slice(-10)
}

type ThreadMessage = {
  role?: string
  content?: string
  timestamp?: string
}

function dayKey(value: string): string {
  return new Date(value).toISOString().slice(0, 10)
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(a).getTime() - new Date(b).getTime()) / 86_400_000,
  )
}

export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()

    const { searchParams } = new URL(request.url)
    const days = Math.min(
      Math.max(Number(searchParams.get('days') || 90), 1),
      1000,
    )
    const since = new Date()
    since.setDate(since.getDate() - days)
    const sinceKey = since.toISOString().slice(0, 10)

    // ── What Google charged ───────────────────────────────────────────────
    const { data: charges, error: chargeError } = await supabase
      .from('lsa_charges')
      .select('charge_date, description, leads, cost, credits')
      .gte('charge_date', sinceKey)
      .order('charge_date', { ascending: false })
    if (chargeError) throw chargeError

    // ── The conversations those leads produced ────────────────────────────
    const { data: convos, error: convoError } = await supabase
      .from('conversations')
      .select('id, phone_number, source, messages, created_at, updated_at')
      .or('source.ilike.%lsa%,source.ilike.%local services%')
      .gte('created_at', sinceKey)
      .order('created_at', { ascending: false })
    if (convoError) throw convoError

    // ── Jobs attributed to LSA ────────────────────────────────────────────
    const { data: appts, error: apptError } = await supabase
      .from('ops_appointments')
      .select(
        'id, appointment_date, status, quoted_total, customer_id, created_at',
      )
      .eq('lead_source_key', 'google_lsa')
      .gte('appointment_date', sinceKey)
      .order('appointment_date', { ascending: false })
    if (apptError) throw apptError

    const customerIds = [
      ...new Set((appts || []).map((a) => a.customer_id).filter(Boolean)),
    ] as string[]
    const nameById = new Map<string, string>()
    if (customerIds.length) {
      const { data: customers } = await supabase
        .from('ops_customers')
        .select('id, full_name')
        .in('id', customerIds)
      for (const c of customers || []) {
        nameById.set(c.id as string, (c.full_name as string) || '')
      }
    }

    // ── Identify who is on each thread, where the messages prove it ──────
    const phonesByConvo = new Map<string, string[]>()
    const allPhones = new Set<string>()
    for (const c of convos || []) {
      const messages: ThreadMessage[] = Array.isArray(c.messages)
        ? (c.messages as ThreadMessage[])
        : []
      const found = extractPhones(messages.map((m) => m.content || '').join(' '))
      phonesByConvo.set(c.id as string, found)
      found.forEach((p) => allPhones.add(p))
    }

    // Customer -> their jobs, for every source. A lead can turn into a job
    // tagged 'repeat_customer' (Google billing you for someone already yours),
    // so this deliberately does NOT filter to google_lsa.
    const customerByPhone = new Map<string, { id: string; name: string }>()
    const jobsByCustomer = new Map<
      string,
      { id: string; date: string; status: string; revenue: number; source: string }[]
    >()

    if (allPhones.size > 0) {
      const orFilter = [...allPhones]
        .map((p) => `phone.ilike.%${p}%`)
        .join(',')
      const { data: matchedCustomers } = await supabase
        .from('ops_customers')
        .select('id, full_name, phone')
        .or(orFilter)

      for (const cu of matchedCustomers || []) {
        const key = last10(cu.phone as string)
        if (key) {
          customerByPhone.set(key, {
            id: cu.id as string,
            name: (cu.full_name as string) || '',
          })
        }
      }

      const matchedIds = (matchedCustomers || []).map((c) => c.id as string)
      if (matchedIds.length) {
        const { data: theirJobs } = await supabase
          .from('ops_appointments')
          .select(
            'id, customer_id, appointment_date, status, quoted_total, lead_source_key',
          )
          .in('customer_id', matchedIds)
          .order('appointment_date', { ascending: false })

        for (const j of theirJobs || []) {
          const list = jobsByCustomer.get(j.customer_id as string) || []
          list.push({
            id: j.id as string,
            date: j.appointment_date as string,
            status: j.status as string,
            revenue: Number(j.quoted_total || 0),
            source: (j.lead_source_key as string) || 'unknown',
          })
          jobsByCustomer.set(j.customer_id as string, list)
        }
      }
    }

    // ── Shape each thread: who spoke last, did they ever come back ────────
    const threads = (convos || []).map((c) => {
      const messages: ThreadMessage[] = Array.isArray(c.messages)
        ? (c.messages as ThreadMessage[])
        : []
      const inbound = messages.filter((m) => m.role === 'user')
      const outbound = messages.filter((m) => m.role === 'assistant')
      const lastOutboundAt = outbound.length
        ? outbound[outbound.length - 1].timestamp || null
        : null
      const repliedAfterUs = lastOutboundAt
        ? inbound.some(
            (m) => (m.timestamp || '') > (lastOutboundAt as string),
          )
        : false

      let status: 'never_answered' | 'ghosted' | 'engaged'
      if (!outbound.length) status = 'never_answered'
      else if (!repliedAfterUs) status = 'ghosted'
      else status = 'engaged'

      const firstAt = (c.created_at as string) || ''

      // Only a phone number the customer typed themselves identifies them.
      // No number, no link — an unknown thread stays honestly unknown.
      const foundPhones = phonesByConvo.get(c.id as string) || []
      let identified: { id: string; name: string } | null = null
      for (const p of foundPhones) {
        const hit = customerByPhone.get(p)
        if (hit) {
          identified = hit
          break
        }
      }

      // Their first job on/after this conversation opened.
      const job = identified
        ? (jobsByCustomer.get(identified.id) || [])
            .filter((j) => daysBetween(j.date, firstAt) >= -2)
            .sort((a, b) => a.date.localeCompare(b.date))[0] || null
        : null

      return {
        id: c.id as string,
        phone: c.phone_number as string,
        startedAt: firstAt,
        lastActivityAt: (c.updated_at as string) || firstAt,
        messageCount: messages.length,
        inboundCount: inbound.length,
        outboundCount: outbound.length,
        status,
        preview: (inbound[0]?.content || '').slice(0, 240),
        messages: messages.slice(-40),
        identifiedAs: identified?.name || null,
        bookedJob: job
          ? {
              id: job.id,
              date: job.date,
              status: job.status,
              revenue: job.revenue,
              customer: identified?.name || '',
              // Surfaces the case worth arguing with Google about: a lead you
              // paid for whose job was booked as existing/repeat business.
              source: job.source,
            }
          : null,
      }
    })

    // ── Tie each charge to a thread by date, honestly ─────────────────────
    const ledger = (charges || []).map((ch) => {
      const chargeDay = ch.charge_date as string
      const sameDay = threads.filter(
        (t) =>
          Math.abs(daysBetween(chargeDay, dayKey(t.startedAt))) <=
          MATCH_WINDOW_DAYS,
      )
      const matchConfidence =
        sameDay.length === 0
          ? 'none'
          : sameDay.length === 1 && Number(ch.leads) === 1
            ? 'exact'
            : 'likely'

      return {
        date: chargeDay,
        leads: Number(ch.leads || 0),
        cost: Number(ch.cost || 0),
        credits: Number(ch.credits || 0),
        costPerLead:
          Number(ch.leads) > 0
            ? Math.round((Number(ch.cost) / Number(ch.leads)) * 100) / 100
            : null,
        matchConfidence,
        matches: sameDay.map((t) => ({
          threadId: t.id,
          phone: t.phone,
          status: t.status,
          identifiedAs: t.identifiedAs,
          bookedJob: t.bookedJob,
        })),
      }
    })

    const totalSpend = ledger.reduce((s, r) => s + r.cost, 0)
    const totalCredits = ledger.reduce((s, r) => s + r.credits, 0)
    const totalLeads = ledger.reduce((s, r) => s + r.leads, 0)
    const bookedJobs = (appts || []).filter((a) => a.status !== 'cancelled')
    const revenue = bookedJobs.reduce(
      (s, a) => s + Number(a.quoted_total || 0),
      0,
    )

    return NextResponse.json({
      days,
      since: sinceKey,
      summary: {
        spend: Math.round(totalSpend * 100) / 100,
        credits: Math.round(totalCredits * 100) / 100,
        leads: totalLeads,
        costPerLead:
          totalLeads > 0
            ? Math.round((totalSpend / totalLeads) * 100) / 100
            : null,
        jobs: bookedJobs.length,
        revenue: Math.round(revenue * 100) / 100,
        roas:
          totalSpend > 0 ? Math.round((revenue / totalSpend) * 100) / 100 : null,
        costPerJob:
          bookedJobs.length > 0
            ? Math.round((totalSpend / bookedJobs.length) * 100) / 100
            : null,
        // Threads where the customer stopped replying, or we never replied.
        ghosted: threads.filter((t) => t.status === 'ghosted').length,
        neverAnswered: threads.filter((t) => t.status === 'never_answered')
          .length,
      },
      ledger,
      threads,
      jobs: bookedJobs.map((a) => ({
        id: a.id as string,
        date: a.appointment_date as string,
        status: a.status as string,
        revenue: Number(a.quoted_total || 0),
        customer: nameById.get(a.customer_id as string) || '',
      })),
      // Phone leads never generate a relay text, so a charge with no thread is
      // expected, not a bug. Say so rather than letting it read as missing data.
      notes: {
        unmatchedCharges: ledger.filter((r) => r.matchConfidence === 'none')
          .length,
      },
    })
  } catch (error) {
    console.error('[admin/marketing/lsa][GET]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return NextResponse.json(
      { error: 'Failed to load LSA dashboard' },
      { status },
    )
  }
}
