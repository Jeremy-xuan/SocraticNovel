// lib/emotionmark.mjs — 情绪标记（K1）的**纯函数**层
//
// 契约：`docs/计划与排产/契约_功能开发_2026-10-20.md` 的 **K1**（情绪标记）。
//   语法（K1.1，老师写的形态，全角括号）：
//
//     〔emo:<label>:<intensity>〕
//
//   · `<label>` ∈ calm | happy | shy | puzzled | excited（只这五个）
//   · `<intensity>`：`0.00`–`1.00`，**必须两位小数**（`0.6` 非法、`0.60` 合法）
//   · 位置：句末；一句至多一个；全小写
//
// 本文件目前只有**整串剥离**（`stripEmotionMarkers`）——它服务的场景是"落盘前再剥一次"
// （K1.2 末：`session_log.md` / `classroom_note` 可能读到历史会话或别的写入者的文本）。
// 流式解析器（`createEmotionStreamParser`，K1.3）在 C-e 的提交里加入本文件；
// 两者必须给出**逐字节相同**的剥离结果（同一份单测覆盖这一点）。
//
// 🔴 纪律：非法标签 / 强度越界 / 缺两位小数 → 整个标记**剥掉**但**不发事件**、不报错（K1.3-3）。
//    "剥掉"是硬性的：宁可少一个表情，也不能让「〔emo:…〕」出现在学生看得见的任何地方。

/** 允许的情绪标签（K1.1；与 C1 的五种可辨认状态一一对应）。 */
export const EMOTION_LABELS = ['calm', 'happy', 'shy', 'puzzled', 'excited']

/** 强度必须两位小数、且在 0.00–1.00。解析器**不做浮点格式容错**（K1.1）。 */
export const INTENSITY_RE = /^(?:0\.\d{2}|1\.00)$/

/** 标记的开括号/闭括号（U+3014 / U+3015）。 */
export const MARK_OPEN = '〔'
export const MARK_CLOSE = '〕'

/**
 * 判定一个"括号内文本"是否为**合法**标记，合法则返回事件。
 *
 * 括号内文本形如 `emo:shy:0.60`（不含 `〔〕`）。**纯函数**。
 * @param {string} inner
 * @returns {{label:string, intensity:number}|null} 非法一律 null（不发事件）
 */
export function parseEmotionBody(inner) {
  const m = /^emo:([a-z]+):(\d{1,2}\.\d{1,2})$/.exec(String(inner ?? ''))
  if (m === null) return null
  const label = m[1]
  if (!EMOTION_LABELS.includes(label)) return null
  if (!INTENSITY_RE.test(m[2])) return null
  return { label, intensity: Number.parseFloat(m[2]) }
}

/**
 * 把一段文本里的**所有** `〔…〕` 标记剥掉。**纯函数**。
 *
 * 口径：凡 `〔` 与 `〕` 成对的片段，无论是否合法，**整段剥掉**——
 * 合法的静默丢弃（整串场景不发事件），非法的也丢弃（K1.3-3：不显示、不报错）。
 * 未闭合的 `〔`（到文本末尾都没有 `〕`）原样保留：那是正文，不是标记（K1.3-2：不吞正文）。
 *
 * @param {string} text
 * @returns {string} 剥净的文本
 */
export function stripEmotionMarkers(text) {
  const s = String(text ?? '')
  if (!s.includes(MARK_OPEN)) return s
  let out = ''
  let i = 0
  while (i < s.length) {
    const open = s.indexOf(MARK_OPEN, i)
    if (open === -1) {
      out += s.slice(i)
      break
    }
    const close = s.indexOf(MARK_CLOSE, open + 1)
    if (close === -1) {
      // 没有闭括号：后面全是正文，原样保留
      out += s.slice(i)
      break
    }
    out += s.slice(i, open)
    i = close + 1
  }
  return out
}

/**
 * 剥标记 + 把结果里因剥离留下的多余空白收成正常文本。**纯函数**。
 * 只用于"人读正文"（例如 session_log 的学生原话），不用于流式下发。
 * @param {string} text
 */
export function stripEmotionMarkersClean(text) {
  return stripEmotionMarkers(text).replace(/[ \t]{2,}/g, ' ').trim()
}
