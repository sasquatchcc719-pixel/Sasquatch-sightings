import { describe, expect, it } from 'vitest'
import { getOpsTemplateKeysForEvent } from '@/lib/ops/communications'

describe('getOpsTemplateKeysForEvent', () => {
  it('sends both SMS and email when a job is rescheduled', () => {
    expect(getOpsTemplateKeysForEvent('job_rescheduled')).toEqual([
      'job_rescheduled_sms',
      'job_rescheduled_email',
    ])
  })
})
