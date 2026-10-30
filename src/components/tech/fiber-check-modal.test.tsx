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
  it('describes tag evidence without claiming the photo reading is infallible', () => {
    render(
      <FiberCheckModal
        isOpen
        onClose={vi.fn()}
        appointmentId="job"
        lineItemId="line"
        lineItemName="Rug"
        existingCheck={check}
        onAppointmentUpdate={vi.fn()}
      />,
    )
    expect(
      screen.getByText(/compare the fiber content with the actual label/i),
    ).toBeVisible()
    expect(screen.queryByText(/not a judgment call/i)).not.toBeInTheDocument()
  })

  it('lets the technician retake a label from a saved result', () => {
    render(
      <FiberCheckModal
        isOpen
        onClose={vi.fn()}
        appointmentId="job"
        lineItemId="line"
        lineItemName="Rug"
        existingCheck={check}
        onAppointmentUpdate={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retake tag photo' }))
    expect(screen.queryByText('DO NOT WET CLEAN')).not.toBeInTheDocument()
    expect(screen.getByText('Does this item have a care tag?')).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Take photo or choose from library' }),
    ).toBeVisible()
  })

  it('offers retake when an immediate API result contains tag text without hasTag', () => {
    render(
      <FiberCheckModal
        isOpen
        onClose={vi.fn()}
        appointmentId="job"
        lineItemId="line"
        lineItemName="Rug"
        existingCheck={{ ...check, hasTag: undefined! }}
        onAppointmentUpdate={vi.fn()}
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Retake tag photo' }),
    ).toBeVisible()
  })

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
