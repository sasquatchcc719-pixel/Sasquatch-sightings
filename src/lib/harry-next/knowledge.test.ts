import { describe, expect, it } from 'vitest'
import { answerFromKnowledge, type KnowledgeBlock } from './knowledge'
import type { IntentModel } from './read-intent'

function fakeModel(reply: string): IntentModel {
  return async () => reply
}

const blocks: KnowledgeBlock[] = [
  { categoryKey: 'faq', title: 'FAQ', content: 'Our chemicals are 100% safe.' },
]

describe('answerFromKnowledge', () => {
  it('answers a normal question', async () => {
    const result = await answerFromKnowledge({
      message: 'are your chemicals safe?',
      blocks,
      model: fakeModel(
        '{"action":"answer","reply":"Totally safe — kid- and pet-friendly!"}',
      ),
    })
    expect(result).toEqual({
      status: 'answer',
      reply: 'Totally safe — kid- and pet-friendly!',
    })
  })

  it('escalates risky/uncovered topics instead of answering', async () => {
    const result = await answerFromKnowledge({
      message: 'my basement is flooding!',
      blocks,
      model: fakeModel('{"action":"escalate","reason":"water emergency"}'),
    })
    expect(result.status).toBe('escalate')
  })

  it('returns none for non-questions', async () => {
    const result = await answerFromKnowledge({
      message: 'thanks!',
      blocks,
      model: fakeModel('{"action":"none"}'),
    })
    expect(result.status).toBe('none')
  })

  it('escalates (never sends garbage) on unparseable model output', async () => {
    const result = await answerFromKnowledge({
      message: 'hi',
      blocks,
      model: fakeModel('uh, not json'),
    })
    expect(result.status).toBe('escalate')
  })
})
