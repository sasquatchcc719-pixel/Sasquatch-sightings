import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { EquipmentBillingDateEditor } from './equipment-billing-date-editor'

describe('EquipmentBillingDateEditor', () => {
  it('saves an explicit out date and confirms that the bill refreshed', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(true)

    render(
      <EquipmentBillingDateEditor
        id="equipment-dates-dhm"
        code="DHM>"
        units={1}
        placedOn="2026-09-11"
        removedOn={null}
        onSave={onSave}
      />,
    )

    await user.type(screen.getByLabelText('DHM> out date'), '2026-09-14')
    await user.click(screen.getByRole('button', { name: 'Save dates' }))

    expect(onSave).toHaveBeenCalledWith('2026-09-11', '2026-09-14')
    expect(
      screen.getByText('Dates saved. The running bill has been refreshed.'),
    ).toBeInTheDocument()
  })

  it('blocks an out date before the in date', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(true)

    render(
      <EquipmentBillingDateEditor
        id="equipment-dates-dhm"
        code="DHM>"
        units={1}
        placedOn="2026-09-11"
        removedOn={null}
        onSave={onSave}
      />,
    )

    await user.type(screen.getByLabelText('DHM> out date'), '2026-09-10')

    expect(
      screen.getByText('Out date cannot be before the in date.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save dates' })).toBeDisabled()
  })
})
