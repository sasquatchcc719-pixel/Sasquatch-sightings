import { describe, expect, it } from 'vitest'
import { buildHarryRecoveryPlan } from './recovery'
import { HARRY_PRODUCTION_REPLAY_CASES } from './replay-cases'
import { guardHarryResponseAgainstOutcomes } from './workflow'

describe('Harry production failure replays', () => {
  for (const replay of HARRY_PRODUCTION_REPLAY_CASES) {
    it(replay.name, () => {
      const recovery = buildHarryRecoveryPlan(replay.outcome, replay.state)
      const guarded = guardHarryResponseAgainstOutcomes({
        response: replay.proposedResponse,
        workflowState: replay.state,
        outcomes: [replay.outcome],
      })

      expect(recovery?.reason || 'none').toBe(replay.expectedRecovery)
      expect(guarded.blockedFalseClaim).toBe(replay.expectFalseClaimBlocked)
    })
  }
})
