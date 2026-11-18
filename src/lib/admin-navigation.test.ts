import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NAVIGATION_PREFERENCES,
  NAVIGATION_ITEMS,
  cloneNavigationPreferences,
  normalizeNavigationPreferences,
} from './admin-navigation'

function allPlacedIds(sections: Record<string, string[]>): string[] {
  return Object.values(sections).flat()
}

describe('personal admin navigation preferences', () => {
  it('keeps every known screen exactly once on both editable surfaces', () => {
    const expected = NAVIGATION_ITEMS.map((item) => item.id).sort()
    for (const surface of ['desktop', 'mobile'] as const) {
      const placed = allPlacedIds(
        DEFAULT_NAVIGATION_PREFERENCES[surface].sections,
      )
      expect(placed).toHaveLength(new Set(placed).size)
      expect(placed.sort()).toEqual(expected)
    }
  })

  it('preserves the existing four mobile bottom tabs and desktop call-log shortcut', () => {
    expect(DEFAULT_NAVIGATION_PREFERENCES.mobile.bottom).toEqual([
      'schedule',
      'comms-home',
      'customers',
      'stats',
    ])
    expect(DEFAULT_NAVIGATION_PREFERENCES.desktop.shortcuts).toEqual([
      'call-log',
    ])
    expect(DEFAULT_NAVIGATION_PREFERENCES.desktop.shortcutAfter).toBe('comms')
  })

  it('removes invalid and duplicate entries while retaining newly added screens', () => {
    const preferences = normalizeNavigationPreferences({
      desktop: {
        sectionOrder: ['comms', 'comms', 'unknown'],
        sections: {
          comms: ['phone', 'phone', 'not-real'],
          operations: ['phone', 'schedule'],
        },
        hidden: ['phone', 'not-real', 'phone'],
        shortcuts: ['phone', 'phone', 'not-real'],
      },
      mobile: {
        sectionOrder: [],
        sections: {},
        hidden: [],
        bottom: ['schedule', 'customers', 'stats', 'phone', 'fleet'],
      },
    })

    expect(preferences.desktop.sectionOrder[0]).toBe('comms')
    expect(preferences.desktop.hidden).toEqual(['phone'])
    expect(preferences.desktop.shortcuts).toEqual(['phone'])
    expect(preferences.mobile.bottom).toHaveLength(4)
    expect(allPlacedIds(preferences.desktop.sections).sort()).toEqual(
      NAVIGATION_ITEMS.map((item) => item.id).sort(),
    )
  })

  it('clones layouts so unsaved editor changes cannot mutate saved state', () => {
    const saved = cloneNavigationPreferences(DEFAULT_NAVIGATION_PREFERENCES)
    const draft = cloneNavigationPreferences(saved)
    draft.mobile.bottom.reverse()
    draft.desktop.sections.operations.splice(0, 1)
    expect(saved.mobile.bottom).toEqual([
      'schedule',
      'comms-home',
      'customers',
      'stats',
    ])
    expect(saved.desktop.sections.operations).not.toEqual(
      draft.desktop.sections.operations,
    )
  })
})
