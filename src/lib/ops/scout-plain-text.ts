/**
 * Strip markdown out of Scout's replies.
 *
 * Both website chat widgets print the reply as raw text — the Angular one via
 * `{{ message.content }}` and the commercial landing page via
 * `bubble.textContent`. Neither renders markdown, so when gpt-4o decides to
 * answer with "**Enzyme Treatment:**" the customer literally sees the asterisks
 * and the chat looks broken.
 *
 * The system prompt tells it not to. It does anyway, especially on long
 * explanations where it mirrors the shape of the reference material. Same lesson
 * as the booking honesty gate: if the customer must never see it, the server has
 * to be the one guaranteeing it.
 *
 * Conservative by design. It only unwraps *paired* emphasis markers, so a lone
 * asterisk or an underscore inside something like book_new_job survives intact —
 * mangling real content would be worse than leaving a stray character.
 */

export function toPlainText(text: string): string {
  if (!text) return text

  let out = text

  // Fenced code blocks: drop the fence lines, keep what was inside.
  out = out.replace(/^[ \t]*```[a-z0-9]*[ \t]*\n?/gim, '')

  // Inline code.
  out = out.replace(/`([^`\n]+)`/g, '$1')

  // Bold, then italic. Bold first so **x** does not leave a stray pair behind.
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '$1')
  out = out.replace(/__([^_\n]+)__/g, '$1')
  out = out.replace(/(?<!\*)\*(?!\s)([^*\n]+?)(?<![\s*])\*(?!\*)/g, '$1')

  // Links and images become just the words. The prompt forbids sending URLs at
  // all, so the target is never something the customer needs.
  out = out.replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')

  // Headings become ordinary lines.
  out = out.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')

  // Markdown bullets become the one marker the widgets can display.
  out = out.replace(/^([ \t]*)[*+-][ \t]+/gm, '$1• ')

  // Anything left over from unbalanced emphasis.
  out = out.replace(/\*\*/g, '')

  // Collapse the blank-line runs that headings and fences leave behind.
  out = out.replace(/\n{3,}/g, '\n\n')

  return out.trim()
}
