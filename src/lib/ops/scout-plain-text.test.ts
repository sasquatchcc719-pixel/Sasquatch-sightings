import { describe, expect, it } from 'vitest'
import { toPlainText } from './scout-plain-text'

describe('toPlainText', () => {
  it('unwraps the bold labels gpt-4o keeps producing', () => {
    expect(toPlainText('**Enzyme Treatment:** breaks down the urine.')).toBe(
      'Enzyme Treatment: breaks down the urine.',
    )
  })

  it('cleans a real bulleted answer end to end', () => {
    const reply = [
      '## How it works',
      '',
      '- **Enzyme Treatment:** breaks down the urine.',
      '- **Black Light:** will still glow.',
      '',
      'Judge it by smell.',
    ].join('\n')

    expect(toPlainText(reply)).toBe(
      [
        'How it works',
        '',
        '• Enzyme Treatment: breaks down the urine.',
        '• Black Light: will still glow.',
        '',
        'Judge it by smell.',
      ].join('\n'),
    )
  })

  it('strips italics and underscore emphasis', () => {
    expect(toPlainText('That is *not* a step backward.')).toBe(
      'That is not a step backward.',
    )
    expect(toPlainText('__Important:__ give it 48 hours.')).toBe(
      'Important: give it 48 hours.',
    )
  })

  it('reduces links to their text', () => {
    expect(toPlainText('See [our reviews](https://example.com/reviews).')).toBe(
      'See our reviews.',
    )
  })

  it('removes code fences and inline backticks', () => {
    expect(toPlainText('```\nTotal: $260\n```')).toBe('Total: $260')
    expect(toPlainText('Use `book_new_job` here.')).toBe(
      'Use book_new_job here.',
    )
  })

  // Guardrails: a false positive here corrupts a message a customer reads.
  it('leaves a lone asterisk or underscore alone', () => {
    expect(toPlainText('The room is 10*12 feet.')).toBe(
      'The room is 10*12 feet.',
    )
    expect(toPlainText('The tool book_new_job failed.')).toBe(
      'The tool book_new_job failed.',
    )
    expect(toPlainText('Rooms * rate = total')).toBe('Rooms * rate = total')
  })

  it('keeps prices, punctuation and hyphenated words intact', () => {
    const reply =
      "You're booked! Confirmation #A1B2C3D4\n• 2 Sasquatch Size Rooms × $90 = $180\nTotal: $180 — see you Tuesday."
    expect(toPlainText(reply)).toBe(reply)
  })

  it('preserves an already-plain answer exactly', () => {
    const reply =
      'Urine soaks through into the backing and pad. Our enzyme treatment breaks it down so it can come up and out.'
    expect(toPlainText(reply)).toBe(reply)
  })

  it('handles empty input', () => {
    expect(toPlainText('')).toBe('')
  })
})
