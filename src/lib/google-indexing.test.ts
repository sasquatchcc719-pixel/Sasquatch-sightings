import { describe, expect, it } from 'vitest'
import { parseServiceAccountJson, buildJobUrl } from './google-indexing'

describe('parseServiceAccountJson', () => {
  it('parses correctly-escaped single-line JSON', () => {
    const raw =
      '{"type":"service_account","private_key":"-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n","client_email":"sa@example.iam.gserviceaccount.com"}'
    const obj = parseServiceAccountJson(raw) as Record<string, string>
    expect(obj.client_email).toBe('sa@example.iam.gserviceaccount.com')
    expect(obj.private_key).toContain('BEGIN PRIVATE KEY')
  })

  it('parses pretty-printed JSON with raw newlines inside the PEM string (the Vercel paste that broke every ping)', () => {
    const raw = `{
  "type": "service_account",
  "private_key": "-----BEGIN PRIVATE KEY-----
abc
def
-----END PRIVATE KEY-----
",
  "client_email": "sa@example.iam.gserviceaccount.com"
}`
    const obj = parseServiceAccountJson(raw) as Record<string, string>
    expect(obj.client_email).toBe('sa@example.iam.gserviceaccount.com')
    expect(obj.private_key).toBe(
      '-----BEGIN PRIVATE KEY-----\nabc\ndef\n-----END PRIVATE KEY-----\n',
    )
  })

  it('still throws on hopeless input', () => {
    expect(() => parseServiceAccountJson('not json at all')).toThrow()
  })
})

describe('buildJobUrl', () => {
  it('builds the www proxy URL with a slugged city', () => {
    expect(buildJobUrl('Palmer Lake', 'some-job-slug')).toBe(
      'https://www.sasquatchcarpet.com/sightings/palmer-lake/some-job-slug',
    )
  })
})
