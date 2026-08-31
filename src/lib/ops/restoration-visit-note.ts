import OpenAI from 'openai'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Spoken rambling -> the day's note.
 *
 * Every day of a water loss needs its own note, and the note is what a carrier
 * reads to understand why the job took five days. Typing one on a phone in a
 * wet basement does not happen; talking does.
 *
 * The division of labour is the same as the line-item scanner. The model tidies
 * WORDS. It is given the day's facts — the readings actually taken, the
 * equipment actually running — so it can refer to them, and it is told plainly
 * that it may use nothing else. It never decides a category, a price, or
 * whether something is dry.
 */

const MODEL = process.env.RESTORATION_NOTE_MODEL || 'gpt-5.5'

export type VisitFacts = {
  visitLabel: string
  visitDate: string
  areas: Array<{ name: string; sqft: number | null }>
  readings: Array<{ label: string; material: string | null; value: number }>
  equipment: Array<{ code: string; units: number }>
  airReadings: Array<{ role: string; tempF: number | null; rhPct: number | null }>
}

export type NoteDraft =
  | { ok: true; note: string }
  | { ok: false; error: string }

export async function loadVisitFacts(
  supabase: SupabaseClient,
  params: { projectId: string; appointmentId: string },
): Promise<VisitFacts | null> {
  const { data: visit } = await supabase
    .from('ops_appointments')
    .select('id, appointment_date, visit_type')
    .eq('id', params.appointmentId)
    .maybeSingle()
  if (!visit) return null

  const [{ data: areas }, { data: points }, { data: equipment }, { data: air }] =
    await Promise.all([
      supabase
        .from('restoration_areas')
        .select('name, affected_sqft')
        .eq('project_id', params.projectId),
      supabase
        .from('restoration_reading_points')
        .select('label, material, restoration_readings(value, appointment_id)')
        .eq('project_id', params.projectId),
      supabase
        .from('restoration_equipment_placements')
        .select('catalog_code')
        .eq('project_id', params.projectId)
        .is('removed_at', null),
      supabase
        .from('restoration_air_readings')
        .select('role, temp_f, rh_pct')
        .eq('appointment_id', params.appointmentId),
    ])

  // Plain names, not catalog codes: the note is read by a customer and an
  // adjuster, and "8 DRY and 1 DHM>>" means nothing to either of them.
  const EQUIPMENT_NAMES: Record<string, string> = {
    DRY: 'air mover',
    'DRY+': 'air mover',
    'DRY++': 'air mover',
    'DHM>': 'dehumidifier',
    'DHM>>': 'dehumidifier',
    NAFAN: 'air scrubber',
  }
  const byCode = new Map<string, number>()
  for (const row of equipment ?? []) {
    const code = String(row.catalog_code)
    const name = EQUIPMENT_NAMES[code] ?? code
    byCode.set(name, (byCode.get(name) ?? 0) + 1)
  }

  return {
    visitLabel: String(visit.visit_type ?? 'visit'),
    visitDate: String(visit.appointment_date),
    areas: (areas ?? []).map((a) => ({
      name: String(a.name),
      sqft: a.affected_sqft == null ? null : Number(a.affected_sqft),
    })),
    // Only readings taken on THIS visit: the note describes this day.
    readings: (points ?? []).flatMap((p) => {
      const mine = ((p.restoration_readings ?? []) as Array<{
        value: number
        appointment_id: string | null
      }>).filter((r) => r.appointment_id === params.appointmentId)
      return mine.map((r) => ({
        label: String(p.label),
        material: p.material as string | null,
        value: Number(r.value),
      }))
    }),
    equipment: [...byCode.entries()].map(([code, units]) => ({ code, units })),
    airReadings: (air ?? []).map((r) => ({
      role: String(r.role),
      tempF: r.temp_f == null ? null : Number(r.temp_f),
      rhPct: r.rh_pct == null ? null : Number(r.rh_pct),
    })),
  }
}

export function buildNotePrompt(facts: VisitFacts, transcript: string): string {
  const lines: string[] = []
  lines.push(`VISIT: ${facts.visitLabel} on ${facts.visitDate}`)

  if (facts.areas.length > 0) {
    lines.push(
      'AREAS: ' +
        facts.areas
          .map((a) => `${a.name}${a.sqft ? ` (${a.sqft} sq ft affected)` : ''}`)
          .join(', '),
    )
  }
  if (facts.readings.length > 0) {
    lines.push(
      'MOISTURE READINGS TAKEN TODAY: ' +
        facts.readings
          .map((r) => `point ${r.label}${r.material ? ` (${r.material})` : ''} ${r.value}%`)
          .join(', '),
    )
  }
  if (facts.airReadings.length > 0) {
    lines.push(
      'AIR READINGS TAKEN TODAY: ' +
        facts.airReadings
          .map((r) => `${r.role} ${r.tempF ?? '?'}°F / ${r.rhPct ?? '?'}% RH`)
          .join(', '),
    )
  }
  if (facts.equipment.length > 0) {
    lines.push(
      'EQUIPMENT RUNNING: ' +
        facts.equipment
          .map((e) => `${e.units} ${e.code}${e.units === 1 ? '' : 's'}`)
          .join(', '),
    )
  }

  lines.push('', 'WHAT THE TECHNICIAN SAID:', transcript.trim())
  return lines.join('\n')
}

export async function draftVisitNote(
  facts: VisitFacts,
  transcript: string,
): Promise<NoteDraft> {
  const said = transcript.trim()
  if (!said) return { ok: false, error: 'Nothing was said' }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return { ok: false, error: 'OPENAI_API_KEY not configured' }

  const system = [
    'You turn a restoration technician\'s spoken notes into the written note for',
    'that day of the job. It is read later by the customer and by an insurance',
    'adjuster.',
    '',
    'Write two to four plain sentences. Past tense. What was found, what was done,',
    'what still needs attention. No headings, no bullet points, no salutation.',
    '',
    'You may use ONLY what the technician said and the figures given to you above',
    'it. Do not invent a reading, a room, a piece of equipment, or a cause. If he',
    'rambles or corrects himself, take the corrected version and drop the rest.',
    '',
    'Never state that anything is dry, or that the job is finished, unless he said',
    'so — that is his call and it has consequences.',
    '',
    'Plain trade language. Do not dress it up, and do not add reassurance or',
    'apology that he did not say.',
  ].join('\n')

  try {
    const openai = new OpenAI({ apiKey })
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: buildNotePrompt(facts, said) },
      ],
    })
    const note = completion.choices[0]?.message?.content?.trim()
    if (!note) return { ok: false, error: 'no response from the model' }
    return { ok: true, note }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'draft failed' }
  }
}
