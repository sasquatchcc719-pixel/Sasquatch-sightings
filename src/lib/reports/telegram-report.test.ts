import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { deliverReportCard } from './telegram-report'

describe('deliverReportCard', () => {
  it('sends the graph after the detail so it remains visible in Telegram', async () => {
    const order: string[] = []
    const storage = {
      from: vi.fn(() => ({
        upload: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: vi.fn(() => ({
          data: { publicUrl: 'https://example.test/radar.png' },
        })),
      })),
    }
    const result = await deliverReportCard({
      supabase: { storage } as unknown as SupabaseClient,
      slug: 'radar-daily',
      runKey: '2026-09-23',
      card: {
        eyebrow: 'Radar Daily',
        title: 'Sep 23',
        metrics: [{ label: 'Visible', value: '2/5' }],
      },
      caption: '7-week fixed-location history',
      text: 'Detailed ranks',
      sendText: async () => {
        order.push('text')
        return true
      },
      sendPhoto: async () => {
        order.push('photo')
        return true
      },
    })

    expect(order).toEqual(['text', 'photo'])
    expect(result).toMatchObject({ imageSent: true, textSent: true })
  })

  it('does not report a skipped text notification as sent', async () => {
    const storage = {
      from: vi.fn(() => ({
        upload: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: vi.fn(() => ({
          data: { publicUrl: 'https://example.test/radar.png' },
        })),
      })),
    }
    const result = await deliverReportCard({
      supabase: { storage } as unknown as SupabaseClient,
      slug: 'radar-daily',
      runKey: '2026-09-23',
      card: {
        eyebrow: 'Radar Daily',
        title: 'Sep 23',
        metrics: [],
      },
      caption: '7-week fixed-location history',
      text: 'Detailed ranks',
      sendText: async () => false,
      sendPhoto: async () => true,
    })

    expect(result.textSent).toBe(false)
  })
})
