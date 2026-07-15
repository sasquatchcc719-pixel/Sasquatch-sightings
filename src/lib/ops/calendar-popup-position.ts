type CalendarPopupPositionInput = {
  x: number
  y: number
  viewportWidth: number
  viewportHeight: number
  preferredWidth?: number
  gutter?: number
}

type CalendarPopupPosition = {
  left: number
  top: number
  width: number
  placeAbove: boolean
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function getCalendarPopupPosition({
  x,
  y,
  viewportWidth,
  viewportHeight,
  preferredWidth = 340,
  gutter = 12,
}: CalendarPopupPositionInput): CalendarPopupPosition {
  const availableWidth = Math.max(0, viewportWidth - gutter * 2)
  const width = Math.min(preferredWidth, availableWidth)
  const maxLeft = Math.max(gutter, viewportWidth - width - gutter)
  const placeAbove = y > viewportHeight / 2

  return {
    left: clamp(x - width / 2, gutter, maxLeft),
    top: clamp(
      y + (placeAbove ? -gutter : gutter),
      gutter,
      Math.max(gutter, viewportHeight - gutter),
    ),
    width,
    placeAbove,
  }
}
