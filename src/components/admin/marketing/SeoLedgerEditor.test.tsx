import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { SeoLedgerEditor } from './SeoLedgerEditor'
const evidence = {
  version: 1,
  hypothesis: 'Improve visibility',
  exactChange: 'Change heading',
  deploymentRef: null,
  deployedAt: null,
  affectedUrls: [],
  queries: [],
  baseline: [],
  reviewDates: ['2026-12-01'],
  outcomes: [],
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
function fill() {
  fireEvent.change(screen.getByLabelText('Change title'), {
    target: { value: 'Monument heading' },
  })
  fireEvent.change(
    screen.getByLabelText('Hypothesis: what should improve and why?'),
    { target: { value: 'Improve visibility' } },
  )
  fireEvent.change(screen.getByLabelText('Exact change made or planned'), {
    target: { value: 'Change heading' },
  })
  fireEvent.change(
    screen.getByLabelText('Review dates (YYYY-MM-DD, one per line)'),
    { target: { value: '2026-12-01' } },
  )
}
describe('SEO ledger editor', () => {
  it('validates required evidence without sending', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    render(<SeoLedgerEditor />)
    fireEvent.click(screen.getByText('Save new change record'))
    expect(screen.getByRole('status').textContent).toContain('Add a title')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('creates a record with no invented baseline or deployment', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetch)
    const onSaved = vi.fn()
    render(<SeoLedgerEditor onSaved={onSaved} />)
    fill()
    fireEvent.click(screen.getByText('Save new change record'))
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    const sent = JSON.parse(fetch.mock.calls[0][1].body)
    expect(sent.seo_change).toEqual(evidence)
    expect(fetch.mock.calls[0][1].method).toBe('POST')
  })
  it('uses the saved revision and preserves draft on conflict', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          events: [
            {
              id: 'e1',
              title: 'Saved heading',
              seo_revision: 4,
              seo_change: evidence,
            },
          ],
        }),
      })
      .mockResolvedValueOnce({ ok: false, status: 409 })
    vi.stubGlobal('fetch', fetch)
    render(<SeoLedgerEditor />)
    fireEvent.click(screen.getByText('Load latest saved changes'))
    await screen.findByLabelText('Saved change')
    fireEvent.change(screen.getByLabelText('Saved change'), {
      target: { value: 'e1' },
    })
    fireEvent.change(screen.getByLabelText('Exact change made or planned'), {
      target: { value: 'Updated heading' },
    })
    fireEvent.click(screen.getByText('Save reviewed evidence'))
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain(
        'changed elsewhere',
      ),
    )
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({
      id: 'e1',
      expected_revision: 4,
      seo_change: { exactChange: 'Updated heading' },
    })
    expect(
      (
        screen.getByLabelText(
          'Exact change made or planned',
        ) as HTMLInputElement
      ).value,
    ).toBe('Updated heading')
    expect(
      (screen.getByText('Save reviewed evidence') as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })
  it('blocks blind retry after network uncertainty', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('network'))
    vi.stubGlobal('fetch', fetch)
    render(<SeoLedgerEditor />)
    fill()
    fireEvent.click(screen.getByText('Save new change record'))
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('uncertain'),
    )
    expect(
      (screen.getByText('Save new change record') as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    expect(
      (screen.getByLabelText('Change title') as HTMLInputElement).value,
    ).toBe('Monument heading')
  })
})
