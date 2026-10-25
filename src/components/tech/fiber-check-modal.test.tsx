import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { FiberCheckModal } from './fiber-check-modal'
const check = {
  id: 'check',
  appointmentLineItemId: 'line',
  unitIndex: 1,
  itemLabel: 'Rug',
  verdict: 'do_not_wet_clean' as const,
  determinedBy: 'stop_list',
  fiber: 'Viscose',
  confidence: 'high',
  hasTag: true,
  tagText: 'Viscose',
  burnResult: null,
  photoUrls: [],
  warnings: [],
  recommendedMethod: null,
  checkedByLabel: 'Synthetic tech',
  createdAt: '2026-10-25T00:00:00Z',
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
describe('saved fiber verdict exclusion errors', () => {
  it('shows the server rejection beside an existing verdict without closing it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: 'The edited invoice no longer qualifies for TF35',
        }),
      }),
    )
    const closed = vi.fn(),
      changed = vi.fn()
    render(
      <FiberCheckModal
        isOpen
        onClose={closed}
        appointmentId="job"
        lineItemId="line"
        lineItemName="Rug"
        existingCheck={check}
        onAppointmentUpdate={changed}
      />,
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove this item from the invoice' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'no longer qualifies for TF35',
    )
    expect(screen.getByText('DO NOT WET CLEAN')).toBeVisible()
    expect(closed).not.toHaveBeenCalled()
    expect(changed).not.toHaveBeenCalled()
  })
})
