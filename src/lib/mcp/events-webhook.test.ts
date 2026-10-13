// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { resolvePublicCallback } from './events-webhook'

describe('MCP event callback URL validation', () => {
  it.each([
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
})
