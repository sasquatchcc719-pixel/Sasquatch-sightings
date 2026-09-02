// @vitest-environment node
/**
 * Charles: "if I send it will I get a carbon copy in my email to confirm?"
 * He would not have — the BCC reached the ops lifecycle templates and the
 * carpet estimate only, so nothing sent on a restoration project ever landed
 * in his inbox.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { opsEmailBcc } from '@/lib/ops/email-bcc'

const original = process.env.OPS_EMAIL_BCC
afterEach(() => {
  if (original === undefined) delete process.env.OPS_EMAIL_BCC
  else process.env.OPS_EMAIL_BCC = original
})

describe('the shop copy address', () => {
  it('strips the trailing newline production actually stores', () => {
    // The real value is "sasquatchcc719@gmail.com\n". Resend tolerates it;
    // a stricter provider, or a second address after it, would not.
    process.env.OPS_EMAIL_BCC = 'sasquatchcc719@gmail.com\n'
    expect(opsEmailBcc()).toBe('sasquatchcc719@gmail.com')
  })

  it('handles more than one address', () => {
    process.env.OPS_EMAIL_BCC = ' a@x.com , b@x.com \n'
    expect(opsEmailBcc()).toBe('a@x.com,b@x.com')
  })

  it('is undefined when unset, so Resend is not handed an empty bcc', () => {
    delete process.env.OPS_EMAIL_BCC
    expect(opsEmailBcc()).toBeUndefined()
  })

  it('is undefined when the value is only whitespace', () => {
    process.env.OPS_EMAIL_BCC = '  \n '
    expect(opsEmailBcc()).toBeUndefined()
  })
})
