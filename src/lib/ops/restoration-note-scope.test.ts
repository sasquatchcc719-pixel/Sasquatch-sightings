import { describe, it, expect } from 'vitest'
import { noteTextFor, noteIsDirty } from './restoration-note-scope'

const monday = { id: 'mon', restoration_visit_note: 'Closet still high.' }
const sunday = { id: 'sun', restoration_visit_note: 'Set the equipment.' }

describe('noteTextFor', () => {
  it("shows the visit's own saved note when nothing is being edited", () => {
    expect(noteTextFor(null, sunday)).toBe('Set the equipment.')
  })

  it('shows an edit that belongs to this visit', () => {
    expect(noteTextFor({ visitId: 'mon', text: 'in progress' }, monday)).toBe(
      'in progress',
    )
  })

  it("never shows another day's draft", () => {
    // The bug: today's draft appeared on yesterday's visit, and a blur there
    // would have written it onto the wrong day.
    expect(noteTextFor({ visitId: 'mon', text: "today's words" }, sunday)).toBe(
      'Set the equipment.',
    )
  })

  it('shows an empty box for a visit with no note', () => {
    expect(noteTextFor(null, { id: 'tue', restoration_visit_note: null })).toBe('')
  })
})

describe('noteIsDirty', () => {
  it('is dirty only for the visit being edited', () => {
    const edit = { visitId: 'mon', text: 'changed' }
    expect(noteIsDirty(edit, monday)).toBe(true)
    expect(noteIsDirty(edit, sunday)).toBe(false)
  })

  it('is not dirty when the text matches what is saved', () => {
    expect(noteIsDirty({ visitId: 'mon', text: 'Closet still high.' }, monday)).toBe(
      false,
    )
    // Trailing whitespace is not a change worth a save.
    expect(
      noteIsDirty({ visitId: 'mon', text: '  Closet still high.  ' }, monday),
    ).toBe(false)
  })

  it('is dirty for a first note on a visit that had none', () => {
    expect(
      noteIsDirty({ visitId: 'tue', text: 'walked it' }, {
        id: 'tue',
        restoration_visit_note: null,
      }),
    ).toBe(true)
  })
})
