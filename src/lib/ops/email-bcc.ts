/**
 * The shop's own copy of a customer email.
 *
 * Charles, before sending a customer her drying report: "if I send it will I
 * get a carbon copy in my email to confirm?" He would not have — the BCC was
 * wired into the ops lifecycle templates and the carpet estimate only, so
 * nothing sent on a restoration project ever reached his inbox.
 *
 * Trimmed because the production value is stored with a trailing newline
 * ("sasquatchcc719@gmail.com\n"). Resend tolerates it today; a stricter
 * provider or a second address in the list would not.
 */
export function opsEmailBcc(): string | undefined {
  const raw = process.env.OPS_EMAIL_BCC
  if (!raw) return undefined
  const cleaned = raw
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean)
  return cleaned.length > 0 ? cleaned.join(',') : undefined
}
