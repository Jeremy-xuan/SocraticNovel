// test/time.test.mjs — 北京时间换算（N4 的 EC：服务器时钟/时区不可信）
//
// 这一组测试的价值在于：它们**不依赖运行测试那台机器的时区**。
// 任何一条失败都说明有人偷偷用了 `getHours()` / `toLocaleString`。

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BEIJING_OFFSET_MS,
  beijingDayKey,
  beijingDayStartMs,
  beijingHour,
  beijingIso,
  beijingMsAt,
  beijingParts,
  beijingStamp,
} from '../lib/time.mjs'

// 2026-10-21T01:12:00Z = 2026-10-21 09:12 北京时间
const UTC_MS = Date.UTC(2026, 9, 21, 1, 12, 0)

test('北京时间的各个数：UTC 01:12 → 北京 09:12', () => {
  const parts = beijingParts(UTC_MS)
  assert.equal(parts.year, 2026)
  assert.equal(parts.month, 10)
  assert.equal(parts.day, 21)
  assert.equal(parts.hour, 9)
  assert.equal(parts.minute, 12)
  assert.equal(parts.second, 0)
})

test('偏移量是固定的 8 小时（不随进程时区变）', () => {
  assert.equal(BEIJING_OFFSET_MS, 8 * 60 * 60 * 1000)
  assert.equal(beijingHour(UTC_MS), 9)
})

test('北京时间戳与 ISO：都带 +08:00 口径', () => {
  assert.equal(beijingIso(UTC_MS), '2026-10-21T09:12:00+08:00')
  assert.equal(beijingStamp(UTC_MS), '20261021T091200')
})

test('跨天的边界在 UTC 16:00（北京 00:00）', () => {
  const beforeMidnight = Date.UTC(2026, 9, 20, 15, 59, 59) // 北京 10-20 23:59:59
  const atMidnight = Date.UTC(2026, 9, 20, 16, 0, 0) // 北京 10-21 00:00:00
  assert.equal(beijingDayKey(beforeMidnight), '2026-10-20')
  assert.equal(beijingDayKey(atMidnight), '2026-10-21')
  assert.equal(beijingDayStartMs(UTC_MS), atMidnight)
})

test('日期键 + HH:mm → epoch（不做本地时区换算）', () => {
  assert.equal(beijingMsAt('2026-10-21', '08:00'), Date.UTC(2026, 9, 21, 0, 0, 0))
  assert.equal(beijingMsAt('2026-10-21', '23:00'), Date.UTC(2026, 9, 21, 15, 0, 0))
  assert.throws(() => beijingMsAt('2026/10/21', '08:00'), /YYYY-MM-DD/)
  assert.throws(() => beijingMsAt('2026-10-21', '8:00'), /HH:mm/)
})
