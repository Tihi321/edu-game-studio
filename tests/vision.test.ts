import { describe, expect, it } from 'vitest'
import { toAnthropicMessages } from '../src/engine/models/anthropic'
import { toGeminiContents } from '../src/engine/models/gemini'
import { OpenAiCompatClient, toOpenAiMessages } from '../src/engine/models/openaiCompat'
import { AnthropicClient } from '../src/engine/models/anthropic'
import { GeminiClient } from '../src/engine/models/gemini'
import { contentText, estimateMessagesTokens, hasImages, IMAGE_TOKENS } from '../src/engine/models/types'
import type { ChatMessage } from '../src/engine/models/types'
import { collect } from '../src/engine/models/types'

const messages: ChatMessage[] = [
  { role: 'system', content: 'You are a critic.' },
  {
    role: 'user',
    content: [
      { type: 'text', text: 'Does this match?' },
      { type: 'image', mime: 'image/png', data: 'AAAA' }
    ]
  },
  { role: 'assistant', content: 'Looking.' }
]

describe('message content helpers', () => {
  it('reads the text of string and part contents, and spots images', () => {
    expect(contentText('hi')).toBe('hi')
    expect(contentText(messages[1]!.content)).toBe('Does this match?')
    expect(hasImages(messages)).toBe(true)
    expect(hasImages([{ role: 'user', content: 'plain' }])).toBe(false)
    expect(estimateMessagesTokens([{ role: 'user', content: [{ type: 'image', mime: 'image/png', data: 'AAAA' }] }])).toBe(IMAGE_TOKENS)
  })
})

describe('vision mapping, no network', () => {
  it('OpenAI-compatible: an image part becomes an image_url data URI, a string stays a string', () => {
    expect(toOpenAiMessages(messages)).toEqual([
      { role: 'system', content: 'You are a critic.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Does this match?' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }
        ]
      },
      { role: 'assistant', content: 'Looking.' }
    ])
  })

  it('Anthropic: an image part becomes a base64 image block, system messages are left out', () => {
    expect(toAnthropicMessages(messages)).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Does this match?' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }
        ]
      },
      { role: 'assistant', content: 'Looking.' }
    ])
  })

  it('Gemini: an image part becomes inlineData, assistant becomes model, system messages are left out', () => {
    expect(toGeminiContents(messages)).toEqual([
      { role: 'user', parts: [{ text: 'Does this match?' }, { inlineData: { mimeType: 'image/png', data: 'AAAA' } }] },
      { role: 'model', parts: [{ text: 'Looking.' }] }
    ])
  })

  /** A fetch that records the JSON body and answers with an empty stream. */
  function recorder(): { fetchImpl: typeof fetch; bodies: Record<string, unknown>[] } {
    const bodies: Record<string, unknown>[] = []
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return new Response('data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }) as unknown as typeof fetch
    return { fetchImpl, bodies }
  }

  it('the clients send the mapped messages in the request body', async () => {
    const o = recorder()
    await collect(new OpenAiCompatClient({ id: 'o', baseUrl: 'http://x/v1', fetchImpl: o.fetchImpl }).chat({ model: 'm', messages }))
    expect((o.bodies[0]!.messages as { content: unknown }[])[1]!.content).toEqual(toOpenAiMessages(messages)[1]!.content)

    const a = recorder()
    await collect(new AnthropicClient({ id: 'a', apiKey: 'k', fetchImpl: a.fetchImpl }).chat({ model: 'm', messages }))
    expect(a.bodies[0]!.messages).toEqual(toAnthropicMessages(messages))
    expect(a.bodies[0]!.system).toBe('You are a critic.')

    const g = recorder()
    await collect(new GeminiClient({ id: 'g', apiKey: 'k', fetchImpl: g.fetchImpl }).chat({ model: 'm', messages }))
    expect(g.bodies[0]!.contents).toEqual(toGeminiContents(messages))
    expect(g.bodies[0]!.systemInstruction).toEqual({ parts: [{ text: 'You are a critic.' }] })
  })
})
