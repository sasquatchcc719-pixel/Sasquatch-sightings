import { describe, expect, it } from 'vitest'
import { verifyProductionSource } from '../check-production-source.mjs'
const main = 'a'.repeat(40)
const previous = 'b'.repeat(40)
const remote = main + '\trefs/heads/main\n'
describe('production release source', () => {
  it('accepts the current main commit for Git builds and clean release fallback builds', () => {
    expect(
      verifyProductionSource({ VERCEL_GIT_COMMIT_SHA: main }, remote),
    ).toBe(main)
    expect(
      verifyProductionSource({ SIGHTINGS_RELEASE_SHA: main }, remote),
    ).toBe(main)
  })
  it.each([
    {},
    { VERCEL_GIT_COMMIT_SHA: previous },
    { VERCEL_GIT_COMMIT_SHA: previous, SIGHTINGS_RELEASE_SHA: main },
    { SIGHTINGS_RELEASE_SHA: previous },
  ])('rejects an off-main, stale or unknown deployment', (env) => {
    expect(() => verifyProductionSource(env, remote)).toThrow(
      /current origin\/main/,
    )
  })
  it('fails closed if the remote does not identify main', () => {
    expect(() =>
      verifyProductionSource(
        { VERCEL_GIT_COMMIT_SHA: main },
        main + '\trefs/heads/preview',
      ),
    ).toThrow(/Could not verify/)
  })
})
