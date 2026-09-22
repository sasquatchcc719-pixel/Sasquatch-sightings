import { describe, expect, it } from 'vitest'
import { metadata } from './layout'

describe('tap share preview metadata', () => {
  it('uses the business name and wooden-sign image', () => {
    expect(metadata).toMatchObject({
      title: 'Sasquatch Carpet Cleaning',
      description:
        'Tap for water damage help or a free carpet cleaning estimate.',
      openGraph: {
        title: 'Sasquatch Carpet Cleaning',
        description:
          'Tap for water damage help or a free carpet cleaning estimate.',
        siteName: 'Sasquatch Carpet Cleaning',
        images: [
          {
            url: '/tap/share-card.jpg',
            width: 1200,
            height: 630,
            alt: 'Sasquatch Carpet Cleaning logo on a wooden sign',
          },
        ],
      },
      twitter: {
        card: 'summary_large_image',
        title: 'Sasquatch Carpet Cleaning',
        description:
          'Tap for water damage help or a free carpet cleaning estimate.',
        images: ['/tap/share-card.jpg'],
      },
    })
  })
})
