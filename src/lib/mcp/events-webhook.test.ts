// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createPinnedLookup, resolvePublicCallback } from './events-webhook'

describe('MCP event callback URL validation', () => {
  it.each([
    'not-a-url',
    'http://events.example.com/hook',
    'https://user:password@events.example.com/hook',
    'https://events.example.com:8443/hook',
  ])('rejects an unsafe callback form: %s', async (url) => {
    await expect(resolvePublicCallback(url)).rejects.toThrow('callback_invalid')
  })

  it('rejects callback hosts resolving to a loopback address', async () => {
    await expect(
      resolvePublicCallback('https://localhost/hook'),
    ).rejects.toThrow('callback_not_public')
  })

  it('returns the callback shape requested by the Node runtime', () => {
    const address = { address: '93.184.216.34', family: 4 }
    const lookup = createPinnedLookup(address)
    const one = vi.fn()
    const all = vi.fn()

    lookup('events.example.com', { all: false }, one)
    lookup('events.example.com', { all: true }, all)

    expect(one).toHaveBeenCalledWith(null, address.address, address.family)
    expect(all).toHaveBeenCalledWith(null, [address])
  })
})
