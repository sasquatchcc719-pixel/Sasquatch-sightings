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
    // WHICH concepts the model hears varies run to run — it is a language
    // model listening to shorthand, and asserting a specific one here has
    // failed twice on the strength of nothing but a different guess. What does
    // not vary, and is the property this test owns: a clean loss never resolves
    // to a Category 3 rate. The concept-to-code mapping is deterministic and is
    // asserted against the real catalog in restoration-catalog.integration.test.ts.
    expect(codes.length).toBeGreaterThan(0)
    expect(codes.some((c) => c.endsWith('S'))).toBe(false)
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

    // What the model hears varies run to run — it occasionally files "removing
    // carpet" under a different concept, which is a hearing problem, not a
    // pricing one. So this asserts the property that matters here: WHATEVER it
    // heard came back on the Category 3 rate. The exact concept-to-code mapping
    // is deterministic and asserted against the real catalog in
    // restoration-catalog.integration.test.ts, where no model is involved.
    expect(dirty.lines.length).toBeGreaterThan(0)

    const CAT3 = { FCC: 'FCCS', PAD: 'PADS', TACK: 'TACKS' } as const
    for (const [concept, expectedCode] of Object.entries(CAT3)) {
      const heard = byConcept.get(concept)
      if (!heard) continue
      expect(heard.code).toBe(expectedCode)
    }

    // Anti-microbial has no Cat 3 variant, so it must stay on the base rate
    // rather than being pushed onto some other item.
    const antimicrobial = byConcept.get('GRM')
    if (antimicrobial) {
      expect(antimicrobial.code).toBe('GRM')
      expect(antimicrobial.unitPrice).toBeCloseTo(0.34, 2)
    }
  }, 60_000)

  it('returns nothing for an empty transcript without calling the model', async () => {
    const result = await parseRestorationLines(supabase, {
      transcript: '   ',
      context: { waterCategory: 1, afterHours: false },
    })
    expect(result).toEqual({ ok: true, lines: [], unmatched: [] })
  })
})
