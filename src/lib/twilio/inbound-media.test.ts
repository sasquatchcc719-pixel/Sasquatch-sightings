// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { inboundMessageContent, parseTwilioInboundMedia } from './inbound-media'

function form(values: Record<string, string>): Pick<FormData, 'get'> {
  return {
    get(name: string) {
      return values[name] ?? null
    },
  }
}

describe('parseTwilioInboundMedia', () => {
  it('extracts indexed media URLs, types, and media SIDs', () => {
    const media = parseTwilioInboundMedia(
      form({
        NumMedia: '2',
        MediaUrl0:
          'https://api.twilio.com/2010-04-01/Accounts/AC1/Messages/MM1/Media/ME111',
        MediaContentType0: 'image/jpeg',
        MediaUrl1:
          'https://api.twilio.com/2010-04-01/Accounts/AC1/Messages/MM1/Media/ME222',
        MediaContentType1: 'image/png',
      }),
    )

    expect(media).toEqual([
      {
        index: 0,
        url: 'https://api.twilio.com/2010-04-01/Accounts/AC1/Messages/MM1/Media/ME111',
        contentType: 'image/jpeg',
        mediaSid: 'ME111',
      },
      {
        index: 1,
        url: 'https://api.twilio.com/2010-04-01/Accounts/AC1/Messages/MM1/Media/ME222',
        contentType: 'image/png',
        mediaSid: 'ME222',
      },
    ])
  })

  it('ignores missing media URLs and caps untrusted counts', () => {
    const media = parseTwilioInboundMedia(
      form({
        NumMedia: '999',
        MediaUrl0: '',
        MediaUrl1: 'https://example.com/x',
      }),
    )
    expect(media).toHaveLength(1)
    expect(media[0]).toMatchObject({
      index: 1,
      contentType: 'application/octet-stream',
    })
  })
})

describe('inboundMessageContent', () => {
  const photo = {
    index: 0,
    url: 'https://example.com/photo',
    contentType: 'image/jpeg',
    mediaSid: null,
  }

  it('keeps a customer caption', () => {
    expect(inboundMessageContent('  Here is the stain  ', [photo])).toBe(
      'Here is the stain',
    )
  })

  it('creates useful conversation text for photo-only MMS', () => {
    expect(inboundMessageContent('', [photo])).toBe('📷 Customer sent a photo')
    expect(inboundMessageContent('', [photo, { ...photo, index: 1 }])).toBe(
      '📷 Customer sent 2 photos',
    )
  })
})
