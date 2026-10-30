import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { analyzeFiber, reconcile } from './analyze'

const { create } = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create } }
  },
}))

const wool = {
  tag_text: 'DIANA\nMADE IN INDIA\n100% WOOL PILE',
  tag_fiber: '100% WOOL PILE',
  tag_confidence: 'high',
  restriction_basis: 'none',
  fiber: '100% wool pile',
  confidence: 'high',
  verdict: 'go',
  warnings: ['Use wool-safe chemistry'],
  recommended_method: 'Wool-safe extraction',
  next_test: '',
  summary: 'Wool is safe to clean.',
}
const polypropylene = {
  tag_text: 'DIANA\nMADE IN TURKEY\nMACHINE MADE\n100% POLYPROPYLENE',
  tag_fiber: '100% POLYPROPYLENE',
  tag_confidence: 'high',
}
const reply = (body: object) => ({
  choices: [{ message: { content: JSON.stringify(body) } }],
})
let image: string
beforeEach(async () => {
  vi.stubEnv('OPENAI_API_KEY', 'unit-test-placeholder')
  create.mockReset()
  image = `data:image/jpeg;base64,${(
    await sharp({
      create: { width: 8, height: 12, channels: 3, background: 'white' },
    })
      .jpeg()
      .toBuffer()
  ).toString('base64')}`
})
afterEach(() => vi.unstubAllEnvs())

const input = () => ({
  images: [image],
  itemKind: 'rug' as const,
  itemLabel: 'Area Rug 11x14',
  hasTag: true,
})

describe('independent tag verification', () => {
  it('holds the reported wool hallucination when a separate read says polypropylene', async () => {
    create
      .mockResolvedValueOnce(reply(wool))
      .mockResolvedValueOnce(reply(polypropylene))
    const result = await analyzeFiber(input())
    expect(result.verdict).toBe('do_not_wet_clean')
    expect(result.determinedBy).toBe('ai_vision')
    expect(result.confidence).toBe('low')
    expect(result.fiber).toMatch(/unconfirmed/i)
    expect(result.recommendedMethod).toMatch(/vacuum only/i)
    expect(result.warnings.join(' ')).toMatch(/disagree/i)
    expect(result.warnings.join(' ')).not.toMatch(/wool-safe/i)
    expect(result.nextTest).toMatch(/close-up/i)
    expect(result.trail.join(' ')).toMatch(/POLYPROPYLENE/)
    expect(result.raw).toMatchObject({ label_reading: polypropylene })
  })

  it.each(['Polypropylene', 'Olefin'])(
    'clears matching %s readings and keeps the reader independent',
    async (fiber) => {
      create
        .mockResolvedValueOnce(
          reply({ ...wool, ...polypropylene, fiber: 'Polypropylene' }),
        )
        .mockResolvedValueOnce(
          reply({
            ...polypropylene,
            tag_fiber: fiber,
            tag_text: `100% ${fiber}`,
          }),
        )
      const result = await analyzeFiber({
        ...input(),
        techNotes: 'suspected wool from the customer',
      })
      expect(result.verdict).toBe('go')
      expect(result.fiber).toMatch(/polypropylene/i)
      expect(result.warnings.join(' ')).not.toMatch(/wool/i)
      const request = create.mock.calls[1][0]
      const messages = JSON.stringify(request.messages)
      expect(messages).not.toMatch(
        /suspected wool from the customer|Wool is safe to clean/,
      )
      expect(
        request.messages.map((message: { role: string }) => message.role),
      ).not.toContain('assistant')
      expect(
        request.messages[1].content.filter(
          (part: { type: string }) => part.type === 'image_url',
        ),
      ).toHaveLength(2)
    },
  )

  it('requires every blend component to agree', async () => {
    create.mockResolvedValueOnce(reply(wool)).mockResolvedValueOnce(
      reply({
        tag_text: '80% Wool 20% Viscose',
        tag_fiber: '80% Wool 20% Viscose',
        tag_confidence: 'high',
      }),
    )
    expect((await analyzeFiber(input())).fiber).toMatch(/unconfirmed/i)
  })

  it('still applies wool precautions when both reads identify wool', async () => {
    create.mockResolvedValueOnce(reply(wool)).mockResolvedValueOnce(reply(wool))
    const result = await analyzeFiber(input())
    expect(result.verdict).toBe('go')
    expect(result.fiber).toMatch(/wool/i)
    expect(result.recommendedMethod).toMatch(/120°F/)
  })

  it('keeps backing restrictions separate from matching pile content', async () => {
    const tag = {
      ...polypropylene,
      tag_text: `${polypropylene.tag_text}\nBacking: jute`,
    }
    create
      .mockResolvedValueOnce(reply({ ...wool, ...tag, fiber: 'Polypropylene' }))
      .mockResolvedValueOnce(reply(tag))
    const result = await analyzeFiber(input())
    expect(result.verdict).toBe('low_moisture')
    expect(result.fiber).toMatch(/polypropylene/i)
    expect(result.warnings.join(' ')).toMatch(/foundation/i)
    expect(result.warnings.join(' ')).not.toMatch(/readings disagree/i)
  })

  it('does not confirm a cover from a filling-only label', async () => {
    const tag_text = 'ALL NEW MATERIAL POLYESTER FIBER BATTING 55% FOAM PAD 45%'
    create
      .mockResolvedValueOnce(
        reply({
          ...wool,
          tag_text,
          tag_fiber: 'Polyester',
          fiber: 'Polyester',
        }),
      )
      .mockResolvedValueOnce(
        reply({ tag_text, tag_fiber: '', tag_confidence: 'low' }),
      )
    expect((await analyzeFiber(input())).verdict).toBe('do_not_wet_clean')
  })

  it('does not let web research bypass a missing independent read', () => {
    const result = reconcile(
      {
        ...wool,
        tag_confidence: 'high',
        confidence: 'high',
        verdict: 'go',
        restriction_basis: 'none',
      },
      { hasTag: true, usedResearch: true, labelReading: null },
    )
    expect(result.verdict).toBe('do_not_wet_clean')
    expect(result.fiber).toMatch(/unconfirmed/i)
  })

  it.each(['low', 'medium'])(
    'holds a %s-confidence independent reading',
    async (confidence) => {
      create
        .mockResolvedValueOnce(reply(wool))
        .mockResolvedValueOnce(reply({ ...wool, tag_confidence: confidence }))
      expect((await analyzeFiber(input())).verdict).toBe('do_not_wet_clean')
    },
  )

  it('holds an unreadable label even when the first call is confident', async () => {
    create.mockResolvedValueOnce(reply(wool)).mockResolvedValueOnce(
      reply({
        tag_text: 'DIANA\nContent: [illegible]',
        tag_fiber: '',
        tag_confidence: 'low',
      }),
    )
    expect((await analyzeFiber(input())).verdict).toBe('do_not_wet_clean')
  })

  it('does not clear an item when the independent service fails', async () => {
    create
      .mockResolvedValueOnce(reply(wool))
      .mockRejectedValueOnce(new Error('timeout'))
    const result = await analyzeFiber(input())
    expect(result.verdict).toBe('do_not_wet_clean')
    expect(result.confidence).toBe('low')
  })

  it('checks a visible tag even when the technician selected no tag', async () => {
    create
      .mockResolvedValueOnce(reply(wool))
      .mockResolvedValueOnce(reply(polypropylene))
    expect((await analyzeFiber({ ...input(), hasTag: false })).verdict).toBe(
      'do_not_wet_clean',
    )
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('preserves cleaning restrictions found only by the independent read', async () => {
    create
      .mockResolvedValueOnce(
        reply({ ...wool, ...polypropylene, fiber: 'Polypropylene' }),
      )
      .mockResolvedValueOnce(
        reply({
          ...polypropylene,
          tag_text: `${polypropylene.tag_text}\nCleaning Code X`,
        }),
      )
    const result = await analyzeFiber(input())
    expect(result.verdict).toBe('do_not_wet_clean')
    expect(result.warnings.join(' ')).toMatch(/vacuum/i)
  })

  it('does not let a burn result clear contradictory label evidence', async () => {
    create.mockResolvedValueOnce(reply(wool)).mockResolvedValueOnce(reply(wool))
    const result = await analyzeFiber({ ...input(), burnResult: 'melts' })
    expect(result.verdict).toBe('do_not_wet_clean')
    expect(result.warnings.join(' ')).toMatch(/burn test/i)
  })

  it('keeps no-tag burn-only checks working without an OCR call', async () => {
    create.mockResolvedValueOnce(
      reply({ ...wool, tag_text: '', tag_fiber: '', fiber: 'Synthetic' }),
    )
    const result = await analyzeFiber({
      ...input(),
      images: [],
      hasTag: false,
      burnResult: 'melts',
    })
    expect(result.verdict).toBe('go')
    expect(result.determinedBy).toBe('burn_test')
    expect(create).toHaveBeenCalledTimes(1)
  })
})
