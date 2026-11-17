import { simulateReadableStream } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'

export const textModel = (chunks: string[], seen?: { system?: string; model?: string }) => new MockLanguageModelV4({
  doStream: async (opts) => {
    if (seen) seen.system = JSON.stringify(opts.prompt)
    return { stream: simulateReadableStream({ chunks: [
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 't' },
      ...chunks.map((delta) => ({ type: 'text-delta' as const, id: 't', delta })),
      { type: 'text-end', id: 't' },
      { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: { total: 5, noCache: 5 }, outputTokens: { total: 2, text: 2 } } },
    ] as never }) }
  },
})
