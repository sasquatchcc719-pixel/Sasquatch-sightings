import { describe, expect, it } from 'vitest'
import { getServicePhoto, getServiceCategoryPhoto } from './service-photos'

const standard = [
  [
    'Small Area / Walk-in Closet (up to 100 sq ft)',
    'small-area-walk-in-closet-up-to-100-sqft',
    'small-area-closet',
  ],
  [
    'Regular Size Room (100 to 200 Sqft)',
    'regular-size-room-100-to-200-sqft',
    'regular-bedroom',
  ],
  [
    'Sasquatch Size Room (200 to 400 Sqft)',
    'sasquatch-size-room-200-to-400-sqft',
    'sasquatch-living-room',
  ],
  [
    'Monster Size Room (400 to 600 Sqft)',
    'monster-size-room-400-to-600-sqft',
    'monster-basement',
  ],
  [
    'Jumbo Humongous Room (600 to 800 Sqft)',
    'jumbo-humungous-room-600-to800-sqft',
    'jumbo-walkout-basement',
  ],
]

describe('residential room-size photos', () => {
  it.each(standard)(
    'matches canonical and legacy identity for %s',
    (name, slug, asset) => {
      expect(
        getServicePhoto({ name, category: 'Carpet Cleaning' })?.src,
      ).toContain(asset)
      expect(
        getServicePhoto({
          name: 'Renamed room',
          slug,
          category: 'Carpet Cleaning',
        })?.src,
      ).toContain(asset)
    },
  )

  it('preserves specialized cleaning photos and does not guess other service sizes', () => {
    for (const [name] of standard) {
      expect(
        getServicePhoto({
          name: `Legendary Restoration — ${name}`,
          category: 'Legendary Restoration Clean',
        })?.src,
      ).toContain('legendary-restoration-cleaning')
    }
    expect(
      getServicePhoto({ name: 'Regular Size Room', category: 'Restoration' }),
    ).toBeUndefined()
    expect(
      getServicePhoto({ name: 'Low Moisture Regular Room' })?.src,
    ).toContain('low-moisture')
    expect(
      getServicePhoto({ name: 'Commercial carpet cleaning' })?.src,
    ).toContain('commercial-carpet')
    expect(
      getServicePhoto({ name: 'Step Carpet Cleaning (Per Step Charge)' })?.src,
    ).toContain('stair-carpet')
    for (const name of [
      'Urine Eliminator Treatment',
      'Pre-Vacuuming',
      'Oversized Room Carpet Cleaning (800+ sqft)',
    ]) {
      expect(
        getServicePhoto({ name, category: 'Carpet Cleaning' }),
      ).toBeUndefined()
    }
  })

  it('represents the standard category with the bedroom even when stairs are first', () => {
    expect(
      getServiceCategoryPhoto('Carpet Cleaning', [
        { name: 'Step Carpet Cleaning', category: 'Carpet Cleaning' },
        {
          name: standard[1][0],
          slug: standard[1][1],
          category: 'Carpet Cleaning',
        },
      ])?.src,
    ).toContain('residential-regular-bedroom')
  })
  it('uses supplied category images while preserving Legendary carpet imagery', () => {
    expect(getServiceCategoryPhoto('Carpet Deodorizer', [])?.src).toContain(
      'carpet-deodorizer',
    )
    expect(getServiceCategoryPhoto('Restoration', [])?.src).toContain(
      'water-restoration',
    )
    expect(getServiceCategoryPhoto('Water Treatment', [])?.src).toContain(
      'water-filtration',
    )
    expect(
      getServiceCategoryPhoto('Legendary Restoration Clean', [])?.src,
    ).toContain('legendary-restoration-cleaning')
  })
})
