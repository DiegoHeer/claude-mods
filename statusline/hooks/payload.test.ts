import { expect, test } from 'claude-code/testing'
import { displayName, statusInput } from './payload.js'

const FACTS = { sessionId: 'abc', transcriptPath: '/t.jsonl', cwd: '/repo/src', projectDir: '/repo', model: 'claude-opus-5-5' }

test('full figures', async () => {
  const usage = {
    startedAt: 0,
    context: { window: 200000, tokens: 15500, percent: 8 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 23.5, resetsAt: '2025-02-01T16:00:00Z' }],
    cost: { usd: 0.01234 },
  }
  const input = statusInput({ ...FACTS, usage })
  expect(input.session_id).toBe('abc')
  expect(input.transcript_path).toBe('/t.jsonl')
  expect(input.model).toEqual({ id: 'claude-opus-5-5', display_name: 'Opus 5.5' })
  expect(input.workspace).toEqual({ current_dir: '/repo/src', project_dir: '/repo' })
  expect(input.context_window).toEqual({
    context_window_size: 200000,
    total_input_tokens: 15500,
    used_percentage: 8,
    remaining_percentage: 92,
  })
  expect(input.rate_limits.five_hour).toEqual({ used_percentage: 23.5, resets_at: 1738425600 })
  expect(input.cost.total_cost_usd).toBe(0.01234)
})

test('before the first response', async () => {
  const input = statusInput({ ...FACTS, transcriptPath: undefined, usage: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } })
  expect(input.context_window.used_percentage).toBe(null)
  expect(input.context_window.remaining_percentage).toBe(null)
  expect(input.context_window.total_input_tokens).toBe(null)
  expect(input.cost.total_cost_usd).toBe(0)
  expect('rate_limits' in input).toBe(false)
  expect('transcript_path' in input).toBe(false)
})

test('a rate limit with no reset time', async () => {
  const usage = { startedAt: 0, context: { window: 200000 }, rateLimits: [{ kind: 'seven_day', percentUsed: 41.2 }] }
  expect(statusInput({ ...FACTS, usage }).rate_limits).toEqual({ seven_day: { used_percentage: 41.2 } })
})

test('displayName', async () => {
  expect(displayName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(displayName('claude-sonnet-5-5[1m]')).toBe('Sonnet 5.5')
  expect(displayName('Opus 5.5')).toBe('Opus 5.5')
  expect(displayName('claude-sonnet-4-20250514')).toBe('Sonnet 4')
  expect(displayName('claude-opus-4-1-20250805')).toBe('Opus 4.1')
})
