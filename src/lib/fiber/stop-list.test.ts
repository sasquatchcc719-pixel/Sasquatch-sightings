import { describe, expect, it } from 'vitest'
import { burnTestVerdict, escalate, scanTagText } from './stop-list'
import { lookupQueryFor, reconcile } from './analyze'
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

  it('flags hand-tufted construction even when the fibre is safe', () => {
    // A wool hand-tufted rug passes a fibre check and still delaminates.
    const hits = scanTagText('100% Wool. Hand Tufted in India.')
    expect(hits[0]?.verdict).toBe('low_moisture')
    expect(hits[0]?.warnings.join(' ')).toMatch(/latex|delaminat/i)
  })

  it('stops on finishes that water destroys regardless of fibre', () => {
    for (const finish of ['crushed velvet', 'chintz', 'moire']) {
      expect(scanTagText(`100% polyester ${finish}`)[0]?.verdict, finish).toBe(
        'do_not_wet_clean',
      )
    }
  })

  it('puts pile fabrics on low moisture', () => {
    for (const pile of ['velvet', 'velour', 'chenille']) {
      expect(scanTagText(`${pile} upholstery`)[0]?.verdict, pile).toBe(
        'low_moisture',
      )
    }
  })

  it('separates real leather from bonded leather', () => {
    // Leather cleaning is a service Sasquatch sells — it must not be blocked.
    expect(scanTagText('Top grain leather')[0]?.verdict).toBe('low_moisture')
    // Bonded leather peels no matter what; that has to be said up front.
    expect(scanTagText('Bonded leather sofa')[0]?.verdict).toBe(
      'do_not_wet_clean',
    )
  })

  it('knows the performance brands, which are not fibre contents', () => {
    const crypton = scanTagText('Crypton Home performance fabric')
    expect(crypton[0]?.verdict).toBe('go')
    expect(crypton[0]?.warnings.join(' ')).toMatch(/bleach|solvent/i)

    const sunbrella = scanTagText('Sunbrella acrylic')
    expect(sunbrella[0]?.verdict).toBe('go')
    expect(sunbrella[0]?.warnings.join(' ')).toMatch(/bleach/i)
  })

  it('reads the W/S code without mistaking it for S', () => {
    const hits = scanTagText('Cleaning Code: W/S')
    expect(hits[0]?.verdict).toBe('go')
    expect(hits[0]?.warnings.join(' ')).toMatch(/test/i)
  })

  it('flags Haitian cotton and hides', () => {
    expect(scanTagText('Haitian cotton')[0]?.verdict).toBe('do_not_wet_clean')
    expect(scanTagText('100% sheepskin')[0]?.verdict).toBe('do_not_wet_clean')
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
    expect(scanTagText('100% polyester')[0]?.verdict).toBe('go')
    expect(scanTagText('Unknown material')).toHaveLength(0)
    expect(scanTagText('')).toHaveLength(0)
  })

  it('keeps polyester pile separate from cotton warp and backing in the saved Noble tag', () => {
    const hits = scanTagText(
      'NOBLE COLLECTION\nBacking Cotton\nWarp Yarn Polyester+Cotton\nPile Yarn %100 Polyester\nMade in Turkey',
    )
    expect(hits.every((hit) => hit.verdict === 'go')).toBe(true)
    expect(hits.find((hit) => hit.kind === 'fiber')?.fiber).toMatch(
      /polyester/i,
    )
    expect(hits.flatMap((hit) => hit.warnings).join(' ')).toMatch(/foundation/i)
  })

  it('does not identify a furniture cover from its law tag stuffing', () => {
    const hits = scanTagText(
      'ALL NEW MATERIAL\nBODY\nURETHANE FOAM 75%\nBLENDED COTTON FELT 20%\nPOLYESTER FIBER BATTING 5%',
    )
    expect(hits.filter((hit) => hit.kind === 'fiber')).toHaveLength(0)
  })

  it('keeps jute foundation precautions distinct from jute face fiber', () => {
    expect(scanTagText('Pile: 100% polyester\nBacking: jute')[0]?.verdict).toBe(
      'low_moisture',
    )
    expect(scanTagText('Content: 100% jute')[0]?.verdict).toBe(
      'do_not_wet_clean',
    )
  })

  it('retains face-fiber evidence when OCR puts multiple fields on one line', () => {
    expect(scanTagText('Backing: cotton, Pile: 100% viscose')[0]?.verdict).toBe(
      'do_not_wet_clean',
    )
    expect(
      scanTagText('Pile: 100% polyester. Backing: cotton').every(
        (hit) => hit.verdict === 'go',
      ),
    ).toBe(true)
    expect(
      scanTagText('Content: 100% polyester\nJute foundation')[0]?.verdict,
    ).toBe('low_moisture')
    expect(scanTagText('Pet friendly rug')).toHaveLength(0)
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
    const result = reconcile(
      { ...base, verdict: 'go' },
      {
        burnResult: 'burns_like_paper',
      },
    )
    expect(result.verdict).toBe('do_not_wet_clean')
    expect(result.determinedBy).toBe('burn_test')
  })

  it('keeps the model verdict when nothing deterministic applies', () => {
    const result = reconcile(base, {})
    expect(result.verdict).toBe('go')
    expect(result.determinedBy).toBe('ai_vision')
  })
})

describe('lookupQueryFor', () => {
  it('looks up a tag that names a product but not its fibre', () => {
    const q = lookupQueryFor('SURYA\nCollection: Graphite\nDesign: GPH-52')
    expect(q).toContain('Graphite')
    expect(q).toContain('GPH-52')
  })

  it('does not bother when the tag already states content', () => {
    expect(lookupQueryFor('Contents: 100% VISCOSE')).toBeNull()
    expect(lookupQueryFor('80% wool 20% nylon')).toBeNull()
    expect(lookupQueryFor('Contents: 55% cotton')).toBeNull()
  })

  it('drops the care boilerplate that appears on every tag', () => {
    const q = lookupQueryFor(
      'SAFAVIEH\nHeritage HG-652\nProfessional cleaning recommended\nwww.safavieh.com',
    )
    expect(q).not.toMatch(/professional|www/i)
    expect(q).toContain('Heritage')
  })

  it('skips tags with nothing identifying on them', () => {
    expect(lookupQueryFor('')).toBeNull()
    expect(lookupQueryFor('Made in')).toBeNull()
  })
})

describe('never clearing an unidentified rug', () => {
  const noTag = {
    tag_text: '',
    fiber: 'Possibly synthetic',
    confidence: 'medium' as const,
    verdict: 'go' as const,
    warnings: [],
    recommended_method: 'Hot water extraction',
    next_test: '',
    summary: 'Looks synthetic.',
  }

  it('drops a low-confidence no-tag "go" to low moisture', () => {
    const r = reconcile(noTag, {})
    expect(r.verdict).toBe('low_moisture')
    expect(r.warnings.join(' ')).toMatch(/not positively identified/i)
    expect(r.recommendedMethod).toMatch(/encapsulation/i)
  })

  it('allows a confident identification through', () => {
    const r = reconcile({ ...noTag, confidence: 'high' }, {})
    expect(r.verdict).toBe('go')
  })

  it('allows it through once a burn test says synthetic', () => {
    const r = reconcile(noTag, { burnResult: 'melts' })
    expect(r.verdict).toBe('go')
  })

  it('does not interfere when a tag was read', () => {
    const r = reconcile(
      {
        ...noTag,
        tag_text: '100% polyester',
        tag_fiber: '100% polyester',
        tag_confidence: 'high',
        restriction_basis: 'none',
      },
      {},
    )
    expect(r.verdict).toBe('go')
  })

  it('does not treat an unreadable composition as confirmed just because other tag text exists', () => {
    const r = reconcile(
      { ...noTag, tag_text: 'Aladdin Rug Gallery\nContent: [illegible]' },
      { hasTag: true },
    )
    expect(r.verdict).toBe('low_moisture')
    expect(r.nextTest).toMatch(/close-up/i)
  })
})

describe('readable face content corrects unsupported fiber refusals', () => {
  const mistaken = {
    tag_text: "Aladdin's Rug Gallery\nContent: Wool\nMade in: USA",
    tag_fiber: 'Wool',
    tag_confidence: 'high' as const,
    restriction_basis: 'fiber' as const,
    fiber: 'Viscose',
    confidence: 'high' as const,
    verdict: 'do_not_wet_clean' as const,
    warnings: ['Viscose degrades when wet'],
    recommended_method: 'Vacuum only',
    next_test: 'Burn the fringe',
    summary: 'Viscose. Do not wet clean.',
  }

  it.each(['Wool', 'Polyester', 'Nylon', 'Polypropylene'])(
    'uses the %s content label instead of a sheen guess',
    (fiber) => {
      const r = reconcile(
        { ...mistaken, tag_text: `Content: ${fiber}`, tag_fiber: fiber },
        {},
      )
      expect(r.verdict).toBe('go')
      expect(r.fiber).toBe(fiber)
      expect(r.determinedBy).toBe('stop_list')
      expect(r.recommendedMethod).toMatch(/extraction/i)
      expect(r.warnings.join(' ')).not.toMatch(/viscose/i)
      expect(r.summary).not.toMatch(/viscose|do not wet clean/i)
      expect(r.nextTest).toBeNull()
    },
  )

  it.each([
    'Cleaning Code X',
    'Contents: 80% wool 20% viscose',
    'Dry clean only',
  ])('retains a documented restriction: %s', (restriction) => {
    const r = reconcile(
      { ...mistaken, tag_text: `Content: Wool\n${restriction}` },
      {},
    )
    expect(r.verdict).toBe('do_not_wet_clean')
  })

  it('preserves actual dye-test evidence', () => {
    const r = reconcile(
      {
        ...mistaken,
        fiber: 'Wool',
        restriction_basis: 'dye_test',
        warnings: ['Red dye transferred to the white towel'],
      },
      {},
    )
    expect(r.verdict).toBe('do_not_wet_clean')
    expect(r.warnings.join(' ')).toMatch(/transferred/)
  })

  it('keeps a known pile fiber when construction restricts cleaning', () => {
    const r = reconcile(
      {
        ...mistaken,
        tag_text: 'Content: Wool\nHand tufted',
        verdict: 'go',
        restriction_basis: 'none',
      },
      {},
    )
    expect(r.verdict).toBe('low_moisture')
    expect(r.fiber).toBe('Wool')
    expect(r.recommendedMethod).toMatch(/encapsulation/i)
    expect(r.warnings.join(' ')).toMatch(/latex/i)
  })

  it('uses the wool protocol for a wool/nylon blend', () => {
    const r = reconcile(
      {
        ...mistaken,
        tag_text: 'Content: 80% wool 20% nylon',
        tag_fiber: '80% wool 20% nylon',
      },
      {},
    )
    expect(r.verdict).toBe('go')
    expect(r.recommendedMethod).toMatch(/120°F/)
  })

  it('refreshes the summary whenever deterministic guidance replaces model guidance', () => {
    const r = reconcile(
      {
        ...mistaken,
        fiber: 'Wool',
        verdict: 'go',
        restriction_basis: 'none',
        summary: 'Only vacuum; fiber unidentified.',
      },
      {},
    )
    expect(r.summary).toMatch(/extraction/)
    expect(r.summary).not.toMatch(/unidentified|only vacuum/i)
  })

  it('does not invent certainty from ambiguous handwriting', () => {
    const r = reconcile(
      {
        ...mistaken,
        tag_text: 'Content: [illegible]',
        tag_fiber: '',
        tag_confidence: 'low',
        confidence: 'low',
        fiber: 'Unknown',
        restriction_basis: 'unidentified',
        verdict: 'low_moisture',
      },
      {},
    )
    expect(r.fiber).toBe('Unknown')
    expect(r.confidence).toBe('low')
    expect(r.verdict).not.toBe('go')
  })

  it('does not turn a low-confidence hazardous word into a confirmed viscose identification', () => {
    const r = reconcile(
      {
        ...mistaken,
        tag_text: 'Content: Viscose [illegible]',
        tag_fiber: '',
        tag_confidence: 'low',
      },
      { hasTag: true },
    )
    expect(r.fiber).toMatch(/unconfirmed/i)
    expect(r.confidence).toBe('low')
    expect(r.nextTest).toMatch(/close-up/i)
    expect(r.summary).not.toMatch(/viscose/i)
    expect(r.warnings.join(' ')).not.toMatch(/permanent|half its strength/i)
  })

  it('requires cover evidence even if a model calls polyester filling high confidence', () => {
    const r = reconcile(
      {
        ...mistaken,
        tag_text: 'ALL NEW MATERIAL POLYESTER FIBER BATTING 55% FOAM PAD 45%',
        tag_fiber: '',
        restriction_basis: 'unidentified',
        fiber: 'Polyester',
        verdict: 'go',
      },
      { hasTag: true },
    )
    expect(r.verdict).not.toBe('go')
    expect(r.nextTest).toBeTruthy()
  })

  it('does not let unrelated research downgrade readable on-item composition', () => {
    const r = reconcile(mistaken, { usedResearch: true })
    expect(r.verdict).toBe('go')
  })
})

describe('web research may never clear an item', () => {
  const base = {
    tag_text: 'SURYA Collection: Graphite Design: GPH-52',
    fiber: 'Polyester',
    confidence: 'high' as const,
    verdict: 'go' as const,
    warnings: [],
    recommended_method: 'Hot water extraction',
    next_test: '',
    summary: 'Product listing says polyester.',
  }

  it('holds a web-cleared item at low moisture', () => {
    // Asked about this exact rug, web search answered "polyester". The tag on
    // the real thing reads 100% VISCOSE. This is why a listing cannot clear.
    const r = reconcile(base, { usedResearch: true })
    expect(r.verdict).toBe('low_moisture')
    expect(r.warnings.join(' ')).toMatch(/web lookup/i)
  })

  it('lets a burn test clear what research could not', () => {
    const r = reconcile(base, { usedResearch: true, burnResult: 'melts' })
    expect(r.verdict).toBe('go')
  })

  it('still lets research escalate to a refusal', () => {
    const r = reconcile(
      { ...base, verdict: 'do_not_wet_clean', fiber: 'Viscose' },
      { usedResearch: true },
    )
    expect(r.verdict).toBe('do_not_wet_clean')
  })

  it('does not interfere when no research was used', () => {
    expect(reconcile(base, {}).verdict).toBe('go')
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
      requiresFiberCheck({
        name: 'Gratuity',
        catalogCategory: 'Carpet Cleaning',
      }),
    ).toBe(false)
  })

  it('falls back to the name when the catalog link is missing', () => {
    expect(
      requiresFiberCheck({ name: '8x11 area rug', catalogCategory: null }),
    ).toBe(true)
    expect(
      requiresFiberCheck({ name: 'Sectional', catalogCategory: null }),
    ).toBe(true)
    expect(
      requiresFiberCheck({ name: 'Mileage/ Travel', catalogCategory: null }),
    ).toBe(false)
  })

  it('classifies rug vs upholstery', () => {
    expect(
      fiberItemKind({ name: 'Area Rug 8x11', catalogCategory: 'rug cleaning' }),
    ).toBe('rug')
    expect(
      fiberItemKind({
        name: 'Ottoman',
        catalogCategory: 'Upholstery Cleaning',
      }),
    ).toBe('upholstery')
  })
})
