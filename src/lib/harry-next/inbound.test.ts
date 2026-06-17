import { describe, expect, it } from 'vitest'
import { parseDecisionText } from './inbound'

describe('parseDecisionText', () => {
  it('reads a bare approve / reject', () => {
    expect(parseDecisionText('approve')).toEqual({
      decision: 'approve',
      id: null,
    })
    expect(parseDecisionText('reject')).toEqual({
      decision: 'reject',
      id: null,
    })
  })

  it('captures an id when included', () => {
    const id = '11111111-2222-3333-4444-555555555555'
    expect(parseDecisionText(`approve ${id}`)).toEqual({
      decision: 'approve',
      id,
    })
  })

  it('does NOT hijack normal Charles commands', () => {
    // These must fall through to the regular Harry-command handler.
    expect(parseDecisionText('no problem, book it for Tuesday')).toBeNull()
    expect(parseDecisionText('yes send it to Marianne')).toBeNull()
    expect(parseDecisionText('text Roger that we are on our way')).toBeNull()
    expect(parseDecisionText('')).toBeNull()
  })
})
