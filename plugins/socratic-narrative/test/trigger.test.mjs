// test/trigger.test.mjs — N2.1 兜底判据（学生 ≥5 回合发言 且 闲置 >2 小时）

import assert from 'node:assert/strict'
import test from 'node:test'
import { IDLE_MIN_STUDENT_TURNS, IDLE_MS, isLessonIdleClosed } from '../lib/trigger.mjs'

const HOUR = 60 * 60 * 1000

test('常量就是文档里的数（5 回合 / 2 小时）', () => {
  assert.equal(IDLE_MIN_STUDENT_TURNS, 5)
  assert.equal(IDLE_MS, 2 * HOUR)
})

test('刚下课 1 分钟：不算结束', () => {
  const now = 10 * HOUR
  const result = isLessonIdleClosed({ studentTurns: 8, lastActivityAt: now - 60 * 1000, now })
  assert.equal(result.closed, false)
  assert.match(result.reason, /闲置 1 分钟/)
})

test('闲置够久但学生只说了 4 回合：不算结束', () => {
  const now = 10 * HOUR
  const result = isLessonIdleClosed({ studentTurns: 4, lastActivityAt: now - 3 * HOUR, now })
  assert.equal(result.closed, false)
  assert.match(result.reason, /未达 5/)
})

test('5 回合 + 闲置刚过 2 小时：算结束', () => {
  const now = 10 * HOUR
  const result = isLessonIdleClosed({ studentTurns: 5, lastActivityAt: now - 2 * HOUR - 1000, now })
  assert.equal(result.closed, true)
  assert.match(result.reason, /学生发言 5 回合/)
})

test('正好 2 小时整：边界算「未满」（严格大于才算闲置够）', () => {
  const now = 10 * HOUR
  const result = isLessonIdleClosed({ studentTurns: 6, lastActivityAt: now - 2 * HOUR, now })
  assert.equal(result.closed, false)
})

test('缺时间数据时不猜（宁可判不算）', () => {
  assert.equal(isLessonIdleClosed({ studentTurns: 9, lastActivityAt: Number.NaN, now: 1 }).closed, false)
  assert.equal(isLessonIdleClosed({ studentTurns: 9, lastActivityAt: 1, now: Number.NaN }).closed, false)
  assert.equal(isLessonIdleClosed({ studentTurns: 9 }).closed, false)
})
