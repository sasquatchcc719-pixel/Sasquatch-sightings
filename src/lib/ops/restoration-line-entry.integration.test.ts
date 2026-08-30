// @vitest-environment node
/**
 * Voice/shorthand line entry against the real OpenAI API and the real catalog.
 *
 * The property under test is the division of labour: the model picks the KIND of
 * work, the loss context picks the price. The same sentence must produce Cat 1
 * codes for a clean loss and Cat 3 codes for a contaminated one.
 */
import { config as loadEnv } from 'dotenv'
import { describe, it, expect } from 'vitest'

loadEnv({ path: '.env.local' })
loadEnv({ path: '.env.vercel.production' })

import { createAdminClient } from '@/supabase/server'
import { parseRestorationLines } from '@/lib/ops/restoration-line-entry'

const supabase = createAdminClient()
const TRANSCRIPT =
  "ok so we're removing carpet, four foot flood cut, uh actually two foot flood " +
  'cut on the north wall, remove pad, and then spray antimicrobial on four ' +
  'hundred square feet. also gonna need to pull the tack strip.'

describe('restoration line entry', () => {
  it('turns shorthand into the right codes for the loss category', async () => {
    const clean = await parseRestorationLines(supabase, {
      transcript: TRANSCRIPT,
      context: { waterCategory: 1, afterHours: false },
    })
    expect(clean.ok).toBe(true)
    if (!clean.ok) return

    const codes = clean.lines.map((l) => l.code)
    expect(codes).toContain('FCC')   // tear out carpet
    expect(codes).toContain('PAD')   // tear out pad
    expect(codes).toContain('GRM')   // antimicrobial
    expect(codes).toContain('TACK')  // tackless strip

    // The technician corrected themselves mid-sentence: 2 ft, not 4 ft.
    expect(codes).toContain('DRYWLF')
    expect(codes).not.toContain('DRYW4')

    // A quantity is only captured where one was actually spoken.
    const antimicrobial = clean.lines.find((l) => l.code === 'GRM')
    expect(antimicrobial?.quantity).toBe(400)
    expect(clean.lines.find((l) => l.code === 'FCC')?.quantity).toBeNull()
  }, 60_000)

  it('prices the identical words as Category 3 when the loss is contaminated', async () => {
    const dirty = await parseRestorationLines(supabase, {
      transcript: TRANSCRIPT,
      context: { waterCategory: 3, afterHours: false },
    })
    expect(dirty.ok).toBe(true)
    if (!dirty.ok) return

    const byConcept = new Map(dirty.lines.map((l) => [l.conceptCode, l]))
    expect(byConcept.get('FCC')?.code).toBe('FCCS')
    expect(byConcept.get('FCC')?.unitPrice).toBeCloseTo(1.1, 2)
    expect(byConcept.get('PAD')?.code).toBe('PADS')
    expect(byConcept.get('TACK')?.code).toBe('TACKS')

    // Anti-microbial has no Cat 3 variant, so it must stay on the base rate
    // rather than being pushed onto some other item.
    expect(byConcept.get('GRM')?.code).toBe('GRM')
    expect(byConcept.get('GRM')?.unitPrice).toBeCloseTo(0.34, 2)
  }, 60_000)

  it('returns nothing for an empty transcript without calling the model', async () => {
    const result = await parseRestorationLines(supabase, {
      transcript: '   ',
      context: { waterCategory: 1, afterHours: false },
    })
    expect(result).toEqual({ ok: true, lines: [], unmatched: [] })
  })
})
