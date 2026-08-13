import { describe, expect, it } from 'vitest'
import { burnTestVerdict, escalate, scanTagText } from './stop-list'
import { reconcile } from './analyze'
import { fiberItemKind, requiresFiberCheck } from './requires-check'

describe('scanTagText', () => {
  it('catches the Surya tag that started this', () => {
    // Verbatim from the destroyed rug's tag.
    const tag = `SURYA RUGS TEXTILES ART
Collection: Graphite
Design: GPH-52
Size: 8' x 11'
Contents: 100% VISCOSE
Origin: INDIA`
    const hits = scanTagText(tag)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].verdict).toBe('do_not_wet_clean')
    expect(hits[0].term).toBe('viscose')
  })

  it('catches every alias viscose is sold under', () => {
    for (const alias of [
      'rayon',
      'art silk',
      'faux silk',
      'bamboo silk',
      'banana silk',
      'tencel',
      'lyocell',
      'modal',
      'cupro',
    ]) {
      const hits = scanTagText(`Contents: 100% ${alias}`)
      expect(hits[0]?.verdict, alias).toBe('do_not_wet_clean')
    }
  })

  it('survives OCR noise and wide letter spacing', () => {
    expect(scanTagText('CONTENTS:  1 0 0 %   V I S C O S E')[0]?.verdict).toBe(
      'do_not_wet_clean',
    )
    expect(scanTagText('contents...viscose/cotton blend')[0]?.verdict).toBe(
      'do_not_wet_clean',
    )
  })

  it('catches the newer silk-sounding names for viscose', () => {
    // Researched 2026-08-13: the trade keeps inventing silk-like names for
    // regenerated cellulose. Cactus/Sabra is the Moroccan one.
    for (const alias of [
      'manmade silk',
      'eucalyptus silk',
      'vegan silk',
      'soy silk',
      'cactus silk',
      'sabra silk',
      'bemberg',
      'seacell',
    ]) {
      expect(scanTagText(`Contents: ${alias}`)[0]?.verdict, alias).toBe(
        'do_not_wet_clean',
      )
    }
  })

  it('flags acetate, which is destroyed by solvent as well as water', () => {
    for (const alias of ['acetate', 'triacetate', 'cellulose acetate']) {
      const hits = scanTagText(`100% ${alias}`)
      expect(hits[0]?.verdict, alias).toBe('do_not_wet_clean')
    }
    // The solvent warning is the point — a spotter destroys this fiber.
    expect(scanTagText('100% acetate')[0].warnings.join(' ')).toMatch(
      /acetone|alcohol/i,
    )
  })

  it('puts modacrylic on low moisture for heat', () => {
    const hits = scanTagText('100% modacrylic')
    expect(hits[0]?.verdict).toBe('low_moisture')
    expect(hits[0]?.warnings.join(' ')).toMatch(/melt|heat/i)
  })

  it('flags jute, sisal and seagrass', () => {
    for (const fiber of ['jute', 'sisal', 'seagrass', 'coir']) {
      expect(scanTagText(`100% ${fiber}`)[0]?.verdict, fiber).toBe(
        'do_not_wet_clean',
      )
    }
  })

  it('treats wool as cleanable but warns on heat and pH', () => {
    const hits = scanTagText('100% New Zealand Wool')
    expect(hits[0]?.verdict).toBe('go')
    expect(hits[0]?.warnings.join(' ')).toMatch(/120/)
  })

  it('puts cotton and linen on low moisture', () => {
    expect(scanTagText('100% cotton')[0]?.verdict).toBe('low_moisture')
    expect(scanTagText('100% linen')[0]?.verdict).toBe('low_moisture')
  })

  it('reads cleaning codes X and S', () => {
    expect(scanTagText('Cleaning Code: X')[0]?.verdict).toBe('do_not_wet_clean')
    expect(scanTagText('CODE S')[0]?.verdict).toBe('low_moisture')
  })

  it('does not fire on a stray letter x', () => {
    expect(scanTagText('Size 8 x 11')).toHaveLength(0)
    expect(scanTagText('Extra large sectional')).toHaveLength(0)
  })

  it('does not fire on substrings inside unrelated words', () => {
    expect(scanTagText('modality testing')).toHaveLength(0)
    expect(scanTagText('silkscreen print')).toHaveLength(0)
  })

  it('returns the most severe hit first on a blend', () => {
    const hits = scanTagText('60% cotton 40% viscose')
    expect(hits[0].verdict).toBe('do_not_wet_clean')
  })

  it('returns nothing for an unrecognized tag', () => {
    expect(scanTagText('100% polyester')).toHaveLength(0)
    expect(scanTagText('')).toHaveLength(0)
  })
})

describe('burnTestVerdict', () => {
  it('maps the three buckets', () => {
    expect(burnTestVerdict('melts').verdict).toBe('go')
    expect(burnTestVerdict('burning_hair').verdict).toBe('go')
    expect(burnTestVerdict('burns_like_paper').verdict).toBe('do_not_wet_clean')
  })

  it('warns to stop on silk-like sheen when protein fiber is found', () => {
    expect(burnTestVerdict('burning_hair').warnings.join(' ')).toMatch(/silk/i)
  })
})

describe('escalate', () => {
  it('always returns the more conservative verdict', () => {
    expect(escalate('go', 'do_not_wet_clean')).toBe('do_not_wet_clean')
    expect(escalate('do_not_wet_clean', 'go')).toBe('do_not_wet_clean')
    expect(escalate('go', 'low_moisture')).toBe('low_moisture')
    expect(escalate('go', 'go')).toBe('go')
  })
})

describe('reconcile', () => {
  const base = {
    tag_text: '',
    fiber: 'Polyester',
    confidence: 'high' as const,
    verdict: 'go' as const,
    warnings: [],
    recommended_method: 'Standard hot water extraction',
    next_test: '',
    summary: 'Safe to clean.',
  }

  it('overrides a model that clears a viscose tag', () => {
    // The failure mode this whole system exists to prevent.
    const result = reconcile(
      { ...base, tag_text: 'Contents: 100% VISCOSE', verdict: 'go' },
      {},
    )
    expect(result.verdict).toBe('do_not_wet_clean')
    expect(result.determinedBy).toBe('stop_list')
  })

  it('never relaxes a model verdict that is stricter than the stop list', () => {
    const result = reconcile(
      {
        ...base,
        tag_text: '100% wool',
        verdict: 'do_not_wet_clean',
        fiber: 'Wool with unstable dyes',
      },
      {},
    )
    expect(result.verdict).toBe('do_not_wet_clean')
  })

  it('lets a burn test override a confident model', () => {
    const result = reconcile({ ...base, verdict: 'go' }, {
      burnResult: 'burns_like_paper',
    })
    expect(result.verdict).toBe('do_not_wet_clean')
    expect(result.determinedBy).toBe('burn_test')
  })

  it('keeps the model verdict when nothing deterministic applies', () => {
    const result = reconcile(base, {})
    expect(result.verdict).toBe('go')
    expect(result.determinedBy).toBe('ai_vision')
  })
})

describe('requiresFiberCheck', () => {
  it('gates rug and upholstery catalog categories', () => {
    expect(
      requiresFiberCheck({
        name: 'Area Rug 8x11',
        catalogCategory: 'rug cleaning',
      }),
    ).toBe(true)
    expect(
      requiresFiberCheck({
        name: 'Sofa/ Couch 3 Seat',
        catalogCategory: 'Upholstery Cleaning',
      }),
    ).toBe(true)
  })

  it('does not gate carpet', () => {
    expect(
      requiresFiberCheck({
        name: 'Sasquatch Size Room (200 to 400 Sqft)',
        catalogCategory: 'Carpet Cleaning',
      }),
    ).toBe(false)
    expect(
      requiresFiberCheck({ name: 'Gratuity', catalogCategory: 'Carpet Cleaning' }),
    ).toBe(false)
  })

  it('falls back to the name when the catalog link is missing', () => {
    expect(requiresFiberCheck({ name: '8x11 area rug', catalogCategory: null })).toBe(
      true,
    )
    expect(requiresFiberCheck({ name: 'Sectional', catalogCategory: null })).toBe(
      true,
    )
    expect(
      requiresFiberCheck({ name: 'Mileage/ Travel', catalogCategory: null }),
    ).toBe(false)
  })

  it('classifies rug vs upholstery', () => {
    expect(
      fiberItemKind({ name: 'Area Rug 8x11', catalogCategory: 'rug cleaning' }),
    ).toBe('rug')
    expect(
      fiberItemKind({ name: 'Ottoman', catalogCategory: 'Upholstery Cleaning' }),
    ).toBe('upholstery')
  })
})
