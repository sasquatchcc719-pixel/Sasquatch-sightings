// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { sendPush } = vi.hoisted(() => ({ sendPush: vi.fn() }))

vi.mock('@/lib/onesignal', () => ({
  sendOneSignalToExternalIds: sendPush,
}))

import {
  jobReminderPushIdempotencyKey,
  sendDavidJobReminderPush,
} from './job-reminder-push'

function supabaseWithStaff(staff: Record<string, unknown> | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: staff, error: null })
  const limit = vi.fn(() => ({ maybeSingle }))
  const or = vi.fn(() => ({ limit }))
  const select = vi.fn(() => ({ or }))
  const from = vi.fn(() => ({ select }))

  return { client: { from } as never, from, or }
}

describe('David job reminder push', () => {
  beforeEach(() => {
    sendPush.mockReset()
    sendPush.mockResolvedValue({ id: 'notification-id' })
  })

  it('targets only David using his auth user id', async () => {
    const { client, from, or } = supabaseWithStaff({
      user_id: 'david-auth-user-id',
      display_name: 'David Gonzalez',
      role: 'tech',
      is_active: true,
    })

    await expect(
      sendDavidJobReminderPush({
        supabase: client,
        appointmentId: 'appointment-123',
        appointmentDate: '2026-10-02',
        assignedStaffUserId: 'david-staff-id',
        customerName: 'Jane Customer',
        address: '123 Main St, Monument, CO 80132',
        timeLabel: '9:00 AM',
      }),
    ).resolves.toBe(true)

    expect(from).toHaveBeenCalledWith('staff_users')
    expect(or).toHaveBeenCalledWith(
      'id.eq.david-staff-id,user_id.eq.david-staff-id',
    )
    expect(sendPush).toHaveBeenCalledWith(
      expect.objectContaining({
        externalIds: ['david-auth-user-id'],
        heading: 'Job in 30 minutes',
        content: '9:00 AM · Jane Customer\n123 Main St, Monument, CO 80132',
        data: {
          type: 'job_reminder',
          appointment_id: 'appointment-123',
        },
        url: 'https://sightings.sasquatchcarpet.com/tech/jobs/appointment-123',
        idempotencyKey: jobReminderPushIdempotencyKey(
          'appointment-123',
          '2026-10-02',
        ),
      }),
    )
  })

  it('does not push a job assigned to another technician', async () => {
    const { client } = supabaseWithStaff({
      user_id: 'another-auth-user-id',
      display_name: 'Another Technician',
      role: 'tech',
      is_active: true,
    })

    await expect(
      sendDavidJobReminderPush({
        supabase: client,
        appointmentId: 'appointment-456',
        appointmentDate: '2026-10-02',
        assignedStaffUserId: 'another-staff-id',
        customerName: 'Jane Customer',
        address: '123 Main St',
        timeLabel: '9:00 AM',
      }),
    ).resolves.toBe(false)

    expect(sendPush).not.toHaveBeenCalled()
  })

  it('uses a stable UUID idempotency key for cron retries', () => {
    const first = jobReminderPushIdempotencyKey('appointment-123', '2026-10-02')
    const second = jobReminderPushIdempotencyKey(
      'appointment-123',
      '2026-10-02',
    )

    expect(first).toBe(second)
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })
})
