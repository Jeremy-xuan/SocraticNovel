// lib/trigger.mjs — N2.1 的触发判据（确定性、可单测）
//
// 文档 N2.1 给了一条主触发和一条兜底：
//   · 主：课堂进入收课相位（`classroom_set_phase` 切到 close）→ 引擎直接调服务
//   · 兜底：**学生至少 5 个回合发言，且会话闲置超过 2 小时** → 也算一节课结束
//
// 🔴 本模块**不自己起定时器**：定时/扫描是引擎的活（车道 J 接线）。这里只回答
//   「按这两个数，现在算不算一节课结束」——纯函数，方便单测与复用。

/** 兜底规则：学生发言回合下限。 */
export const IDLE_MIN_STUDENT_TURNS = 5

/** 兜底规则：闲置时长（2 小时）。 */
export const IDLE_MS = 2 * 60 * 60 * 1000

/**
 * 兜底判据：学生发言够多、且会话已经闲置够久 → 视为一节课结束。
 *
 * @param {object} input
 * @param {number} input.studentTurns - 本课里**学生**发言的回合数（引擎给的计数，不是总回合数）
 * @param {number} input.lastActivityAt - 最近一次回合活动的时刻（epoch ms）
 * @param {number} input.now - 现在（epoch ms）
 * @param {number} [input.minStudentTurns] - 默认 {@link IDLE_MIN_STUDENT_TURNS}
 * @param {number} [input.idleMs] - 默认 {@link IDLE_MS}
 * @returns {{closed: boolean, reason: string}}
 */
export function isLessonIdleClosed({ studentTurns, lastActivityAt, now, minStudentTurns = IDLE_MIN_STUDENT_TURNS, idleMs = IDLE_MS }) {
  if (!Number.isFinite(studentTurns) || studentTurns < minStudentTurns) {
    return { closed: false, reason: `学生发言 ${formatCount(studentTurns)} 回合，未达 ${minStudentTurns}` }
  }
  if (!Number.isFinite(lastActivityAt)) {
    return { closed: false, reason: '没有最近活动时间，无法判断空闲' }
  }
  if (!Number.isFinite(now)) {
    return { closed: false, reason: '没有当前时间，无法判断空闲' }
  }
  const idle = now - lastActivityAt
  // 文档措辞是「闲置**超过** 2 小时」：正好 2 小时整还不算，严格大于才算
  if (idle <= idleMs) {
    return { closed: false, reason: `闲置 ${Math.max(0, Math.round(idle / 60000))} 分钟，未满 ${Math.round(idleMs / 60000)} 分钟` }
  }
  return { closed: true, reason: `学生发言 ${studentTurns} 回合且闲置 ${Math.round(idle / 60000)} 分钟` }
}

/** @param {number} value */
function formatCount(value) {
  return Number.isFinite(value) ? String(value) : '（无）'
}
