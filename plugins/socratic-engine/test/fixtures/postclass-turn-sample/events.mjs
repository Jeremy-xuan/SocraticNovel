// test/fixtures/postclass-turn-sample/events.mjs
//
// 会话事件样本：形状逐字照抄真实会话日志（见取证件 b-3 的逐字样本），
// 用于单测「给定投影样本 → 应追加的确切文本」。
// 刻意覆盖 4 种情况：
//   ① 学生消息（source.kind === 'user'）
//   ② 注入消息（agent-instructions / socratic-engine）—— 必须被排除
//   ③ 工具调用（tool/call 给 name，tool/result 给成败）
//   ④ 有 call 无 result 的工具 —— 必须记「未完成」，不得谎报成功

const T = 1789800000000

/** 学生多行原话（渲染时应折叠为单行）。 */
export const STUDENT_LINE_TURN2 = '我不太懂\n指针是什么'

export const EVENTS = Object.freeze([
  { type: 'turn/start', seq: 0, time: T + 0, data: { turn: 1 } },
  {
    type: 'user/message',
    seq: 1,
    time: T + 100,
    data: { role: 'user', id: 'm1', source: { kind: 'user' }, content: [{ type: 'text', text: '第 1 讲开始吧' }] },
  },
  {
    type: 'assistant/message',
    seq: 2,
    time: T + 200,
    data: {
      turn: 1,
      step: 1,
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: '先看看环境。' },
          { type: 'tool-call', id: 'c1', name: 'bash', arguments: '{"command":"pwd"}' },
        ],
      },
    },
  },
  { type: 'tool/call', seq: 3, time: T + 300, data: { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{"command":"pwd"}' } },
  {
    type: 'tool/result',
    seq: 4,
    time: T + 400,
    data: {
      turn: 1,
      step: 1,
      message: {
        role: 'user',
        id: 'r1',
        source: { kind: 'tool', callId: 'c1' },
        content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: '/tmp\n' }], isError: false }],
      },
    },
  },
  {
    type: 'assistant/message',
    seq: 5,
    time: T + 500,
    data: { turn: 1, step: 2, message: { role: 'assistant', content: [{ type: 'text', text: '环境没问题。' }] } },
  },
  { type: 'step/end', seq: 6, time: T + 600, data: { turn: 1, step: 2 } },
  { type: 'turn/end', seq: 7, time: T + 700, data: { turn: 1, reason: { kind: 'completed' } } },

  // ---- 第 2 回合（turn-stopping 在 seq 15 之后触发，尚无 turn/end） ----
  { type: 'turn/start', seq: 8, time: T + 1000, data: { turn: 2 } },
  {
    type: 'user/message',
    seq: 9,
    time: T + 1100,
    data: {
      role: 'user',
      id: 'm2',
      source: { kind: 'agent-instructions', form: 'instructions' },
      content: [{ type: 'text', text: '# 项目指令（AGENTS.md）…' }],
    },
  },
  {
    type: 'user/message',
    seq: 10,
    time: T + 1200,
    data: {
      role: 'user',
      id: 'm3',
      source: { kind: 'socratic-engine', form: 'classroom-block', block: 'state' },
      content: [{ type: 'text', text: '<system-reminder>相位：quiz</system-reminder>' }],
    },
  },
  {
    type: 'user/message',
    seq: 11,
    time: T + 1300,
    data: { role: 'user', id: 'm4', source: { kind: 'user' }, content: [{ type: 'text', text: STUDENT_LINE_TURN2 }] },
  },
  {
    type: 'assistant/message',
    seq: 12,
    time: T + 1400,
    data: {
      turn: 2,
      step: 1,
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: '我看看教室状态。' },
          { type: 'tool-call', id: 'c2', name: 'classroom_status', arguments: '{}' },
        ],
      },
    },
  },
  { type: 'tool/call', seq: 13, time: T + 1500, data: { turn: 2, step: 1, callId: 'c2', name: 'classroom_status', arguments: '{}' } },
  {
    type: 'tool/result',
    seq: 14,
    time: T + 1600,
    data: {
      turn: 2,
      step: 1,
      message: {
        role: 'user',
        id: 'r2',
        source: { kind: 'tool', callId: 'c2' },
        content: [{ type: 'tool-result', toolCallId: 'c2', content: [{ type: 'text', text: 'boom' }], isError: true }],
      },
    },
  },
  {
    type: 'assistant/message',
    seq: 15,
    time: T + 1700,
    data: {
      turn: 2,
      step: 2,
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: '换个办法。' },
          { type: 'tool-call', id: 'c3', name: 'bash', arguments: '{"command":"ls"}' },
        ],
      },
    },
  },
  { type: 'tool/call', seq: 16, time: T + 1800, data: { turn: 2, step: 2, callId: 'c3', name: 'bash', arguments: '{"command":"ls"}' } },
])

/** 本回合最后一个事件的时间（= 追加记录应使用的时间戳）。 */
export const TURN2_LAST_TIME = T + 1800
