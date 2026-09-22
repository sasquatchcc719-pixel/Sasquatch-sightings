import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RestorationChargeRemoveButton } from './restoration-charge-remove-button'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('RestorationChargeRemoveButton', () => {
  it('names the exact charge and dollar impact before removing it', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const onRemove = vi.fn().mockResolvedValue(true)

    render(
      <RestorationChargeRemoveButton
        target="DHM> placement 1 of 2, in Sep 11, still running, ID abc12345"
        amount={295.92}
        onRemove={onRemove}
      />,
    )

    await user.click(screen.getByRole('button', { name: /^Remove:/ }))

    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining(
        'DHM> placement 1 of 2, in Sep 11, still running, ID abc12345',
      ),
    )
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('$295.92'))
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /^Remove:/ })).toHaveTextContent(
      'Removed',
    )
  })

  it('does nothing when confirmation is cancelled', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const onRemove = vi.fn().mockResolvedValue(true)

    render(
      <RestorationChargeRemoveButton
        target="work charge"
        amount={25}
        onRemove={onRemove}
      />,
    )

    await user.click(screen.getByRole('button', { name: /^Remove:/ }))
    expect(onRemove).not.toHaveBeenCalled()
  })

  it('blocks double submits and exposes deleting and error states', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    let resolveRemoval: ((removed: boolean) => void) | undefined
    const onRemove = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveRemoval = resolve
        }),
    )

    render(
      <RestorationChargeRemoveButton
        target="work charge"
        amount={25}
        onRemove={onRemove}
      />,
    )

    const button = screen.getByRole('button', { name: /^Remove:/ })
    await user.click(button)
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent('Removing…')
    await user.click(button)
    expect(onRemove).toHaveBeenCalledTimes(1)

    resolveRemoval?.(false)
    expect(await screen.findByText('Try again')).toBeInTheDocument()
  })
})
