// lib/text.mjs — 字数与文本处理的小工具（N2.3 的「不超过 120 字」靠这里判）
//
// 🔴 「字」的口径：**Unicode 码点**（`[...text].length`），不是 UTF-16 长度。
//    理由：`"𠮷".length === 2`（代理对），而人读的是 1 个字；用码点计数才和「120 字」这个
//    写作规则同口径。这个选择写进 README，别在别处再定一套。

/**
 * 按 Unicode 码点数一个字符串有多少「字」。
 * @param {string} text
 * @returns {number}
 */
export function charCount(text) {
  return [...text].length
}

/**
 * 取出 markdown 里某个二级标题下的正文（到下一个同级或更高级标题为止）。
 * 找不到标题返回 `null`（**不**回退成整篇——那会让「角色声音段」悄悄变成整份 `_anchor.md`）。
 * @param {string} markdown
 * @param {string} headingText - 标题文字（不含 `## ` 前缀），按 `includes` 匹配（标题里允许带括号说明）
 * @returns {string | null}
 */
export function sectionByHeading(markdown, headingText) {
  const lines = markdown.split('\n')
  let start = -1
  let level = 0
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(#{1,6})\s+(.*)$/.exec(lines[index])
    if (match === null) continue
    if (start === -1) {
      if (match[1].length === 2 && match[2].includes(headingText)) {
        start = index + 1
        level = 2
      }
      continue
    }
    if (match[1].length <= level) {
      return lines.slice(start, index).join('\n').trim()
    }
  }
  if (start === -1) return null
  return lines.slice(start).join('\n').trim()
}

/**
 * 取文本尾部若干字符（给「最近的记录」这类输入用），并保证不把代理对切成两半。
 * @param {string} text
 * @param {number} limit
 * @returns {string}
 */
export function tailChars(text, limit) {
  if (limit <= 0) return ''
  const points = [...text]
  if (points.length <= limit) return text
  return points.slice(-limit).join('')
}

/**
 * 把一段内容包进带标签的文件块，供提示词里逐字引用。
 * @param {string} label - 例如 `runtime/session_log.md`
 * @param {string} body
 * @returns {string}
 */
export function fileBlock(label, body) {
  return [`<<<FILE ${label}`, body.replace(/\n+$/, ''), `FILE ${label}>>>`].join('\n')
}

/**
 * 本地日期 `YYYY-MM-DD`（日记条目标题用）。
 * 用宿主的本地时区而不是 UTC：一节课的「今天是哪天」应该与教室里的人一致。
 * @param {number} ms - epoch ms
 * @returns {string}
 */
export function formatLocalDate(ms) {
  const date = new Date(ms)
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
