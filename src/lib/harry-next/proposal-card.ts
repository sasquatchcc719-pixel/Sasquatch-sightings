/**
 * Harry (next) — the Telegram approval card.
 *
 * Pure text builder. The card always shows three things so the owner can judge
 * at a glance: WHO it goes to (bound recipient), WHAT will change, and the EXACT
 * message that will be sent. No number appears here that wasn't computed by code
 * upstream — this function invents nothing.
 */
export function buildApprovalCard(params: {
  customerName: string | null
  recipientPhone: string
  actionSummary: string
  proposedReply: string
}): string {
  const name = params.customerName?.trim() || 'this customer'
  return [
    '🟡 *Harry needs your approval*',
    '',
    `👤 ${name} (${params.recipientPhone})`,
    `🛠 ${params.actionSummary}`,
    '',
    '💬 Message Harry will send:',
    `"${params.proposedReply}"`,
    '',
    'Reply *approve* to send it, or *reject* to cancel. Nothing goes out until you do.',
  ].join('\n')
}
