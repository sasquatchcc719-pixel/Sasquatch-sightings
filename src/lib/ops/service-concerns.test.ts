import { describe, expect, it } from 'vitest'
import { buildServiceConcernIntakeMessage } from './service-concerns'

describe('buildServiceConcernIntakeMessage', () => {
  it('requests photos for visible concerns without pre-approving a return', () => {
    const message = buildServiceConcernIntakeMessage()

    expect(message).toContain('one wide photo and one close-up')
    expect(message).toContain('seeing or smelling')
    expect(message).toContain('fully dry and vacuum once')
    expect(message).toContain('Before we schedule a return visit')
    expect(message).toContain('recommend the right next step')
    expect(message).not.toContain('we will come back')
    expect(message).not.toContain('no charge')
  })
})
