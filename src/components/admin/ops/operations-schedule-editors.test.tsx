import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { BlockFormState } from './operations-schedule-types'
import { BlockTimeForm } from './operations-schedule-editors'

const initialForm: BlockFormState = {
  title: 'Grand Mesa',
  description: '',
  start_date: '2026-10-05',
  end_date: '2026-10-05',
  start_time: '09:00',
  end_time: '17:00',
  is_all_day: false,
  assigned_staff_user_id: null,
}

function BlockTimeHarness({
  onSave,
}: {
  onSave: (form: BlockFormState) => void
}) {
  const [form, setForm] = useState(initialForm)
  return (
    <BlockTimeForm
      open
      form={form}
      saving={false}
      setForm={setForm}
      onSubmit={(event) => {
        event.preventDefault()
        onSave(form)
      }}
      onCancel={() => undefined}
    />
  )
}

describe('BlockTimeForm', () => {
  it('saves independent start and end date-time endpoints', () => {
    const onSave = vi.fn()
    render(<BlockTimeHarness onSave={onSave} />)

    const starts = screen.getByRole('group', { name: 'Starts' })
    const ends = screen.getByRole('group', { name: 'Ends' })

    expect(within(starts).getByLabelText('Date')).toHaveValue('2026-10-05')
    expect(within(starts).getByLabelText('Time')).toHaveValue('09:00')

    fireEvent.change(within(ends).getByLabelText('Date'), {
      target: { value: '2026-10-08' },
    })
    fireEvent.change(within(ends).getByLabelText('Time'), {
      target: { value: '17:00' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save Block' }))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        start_date: '2026-10-05',
        start_time: '09:00',
        end_date: '2026-10-08',
        end_time: '17:00',
      }),
    )
  })
})
