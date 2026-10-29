export type NfcEngagementType =
  | 'booking'
  | 'form'
  | 'text_chat'
  | 'call'
  | 'booking_started'

const BUTTON_ENGAGEMENT: Record<string, NfcEngagementType> = {
  booking_widget_submit: 'booking',
  form_submit: 'form',
  text_chat: 'text_chat',
  text: 'text_chat',
  text_us: 'text_chat',
  call: 'call',
  booking_widget_open: 'booking_started',
  booking_page: 'booking_started',
  book_now: 'booking_started',
}

const ENGAGEMENT_RANK: Record<NfcEngagementType, number> = {
  booking: 4,
  form: 3,
  text_chat: 2,
  call: 1,
  booking_started: 0,
}

export function engagementForButton(
  buttonType: string,
): NfcEngagementType | null {
  return BUTTON_ENGAGEMENT[buttonType] ?? null
}

export function shouldUpgradeEngagement(
  current: string | null | undefined,
  next: NfcEngagementType,
) {
  const currentRank = ENGAGEMENT_RANK[current as NfcEngagementType] ?? -1
  return ENGAGEMENT_RANK[next] > currentRank
}
