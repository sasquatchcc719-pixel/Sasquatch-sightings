import { beforeAll, describe, expect, it } from 'vitest'
import {
  buildEstimateDecisionUrl,
  createEstimateDecisionToken,
  EstimateTokenError,
  verifyEstimateDecisionToken,
} from './estimate-decision-token'

const ESTIMATE_ID = '4859863a-8983-4ec0-89bf-dadf034b5349'

beforeAll(() => {
  process.env.PAYMENT_LINK_SIGNING_SECRET = 'test-secret-for-estimate-links'
})

describe('estimate decision token', () => {
  it('round-trips the estimate id', () => {
    const token = createEstimateDecisionToken({ estimateId: ESTIMATE_ID })
    expect(verifyEstimateDecisionToken(token).estimateId).toBe(ESTIMATE_ID)
  })

  it('rejects a tampered payload', () => {
    const token = createEstimateDecisionToken({ estimateId: ESTIMATE_ID })
    const [, signature] = token.split('.')
    const forged = Buffer.from(
      JSON.stringify({ v: 1, e: 'some-other-estimate', exp: 9999999999 }),
    ).toString('base64url')
    expect(() => verifyEstimateDecisionToken(`${forged}.${signature}`)).toThrow(
      EstimateTokenError,
    )
  })

  it('rejects a malformed token', () => {
    expect(() => verifyEstimateDecisionToken('not-a-token')).toThrow(
      EstimateTokenError,
    )
    expect(() => verifyEstimateDecisionToken('a.b.c')).toThrow(
      EstimateTokenError,
    )
  })

  it('rejects an expired token', () => {
    const token = createEstimateDecisionToken({
      estimateId: ESTIMATE_ID,
      expiresAt: new Date(Date.now() - 1000),
    })
    try {
      verifyEstimateDecisionToken(token)
      throw new Error('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(EstimateTokenError)
      expect((error as EstimateTokenError).code).toBe('expired')
    }
  })

  it('builds a url on the sightings origin', () => {
    const token = createEstimateDecisionToken({ estimateId: ESTIMATE_ID })
    expect(
      buildEstimateDecisionUrl('https://sightings.sasquatchcarpet.com/', token),
    ).toBe(`https://sightings.sasquatchcarpet.com/estimate/${token}`)
  })
})
