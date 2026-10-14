import { describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeHome, PLUGIN } from './harness'

describe('cache-ttl.sh', () => {
  test('a half-written transcript line does not hide the countdown', () => {
    const transcript = join(makeHome(), 'transcript.jsonl')
    const reply = {
      type: 'assistant',
      timestamp: new Date().toISOString(),
      message: { usage: { cache_creation: { ephemeral_5m_input_tokens: 10 } } },
    }
    writeFileSync(transcript, `${JSON.stringify(reply)}\n{"type":"assistant","timest\n`)
    const result = Bun.spawnSync(['bash', join(PLUGIN, 'files/cache-ttl.sh')], {
      stdin: Buffer.from(JSON.stringify({ transcript_path: transcript })),
    })
    expect(result.stdout.toString()).toMatch(/cache [45]m/)
  })
})
