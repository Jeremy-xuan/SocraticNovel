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

/**
 * 取 markdown 文件头里的「引用行规则」（连续以 `>` 开头的行，直到第一个非引用行）。
 * 找不到返回空串——**不抛**：抛不抛、抛什么码由调用方按自己的文件语义决定
 * （日记要 `NO_DIARY_RULES`，群聊要 `NO_GROUP_RULES`）。
 * @param {string} markdown
 * @returns {string}
 */
export function extractQuotedRules(markdown) {
  const lines = String(markdown ?? '').split('\n')
  const rules = []
  let collecting = false
  for (const line of lines) {
    if (line.startsWith('>')) {
      collecting = true
      rules.push(line.replace(/^>\s?/, '').trimEnd())
      continue
    }
    if (collecting) break
  }
  return rules.join('\n').trim()
}

/**
 * 去掉叙事层的情绪标记 `〔emo:<label>:<强度>〕`（K1.1：只有以 `emo:` 开头的括号对才是标记，
 * 其它 `〔…〕` 是正文）。用于把学生原话写进 `notes.jsonl` 前的清洗（K3.2 要求 quote 已剥净）。
 * @param {string} text
 * @returns {string}
 */
export function stripEmotionMarkers(text) {
  return String(text ?? '').replace(/〔emo:[^〕]*〕/g, '')
}

/**
 * 去掉 markdown 格式符号，只留可读文字（`notes.jsonl` 的 `quote` / `note` 用）。
 * 口径与引擎 `lib/notestore.mjs` 的 `stripMarkdown` 一致：只剥格式、不改字；**不剥 `_`**
 * （下划线在代码里是名字的一部分）。
 * @param {string} text
 * @returns {string}
 */
export function stripMarkdown(text) {
  let s = String(text ?? '').replace(/\r\n?/g, '\n')
  s = s.replace(/^[ \t]*```[^\n]*$/gm, '')
  s = s.replace(/`{1,2}([^`]*)`{1,2}/g, '$1')
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  s = s.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
  s = s.replace(/^[ \t]{0,3}>[ \t]?/gm, '')
  s = s.replace(/^[ \t]*[-*+][ \t]+/gm, '')
  s = s.replace(/^[ \t]*\d+[.)][ \t]+/gm, '')
  s = s.replace(/\*\*([\s\S]*?)\*\*/g, '$1')
  s = s.replace(/\*([^*\n]+)\*/g, '$1')
  s = s.replace(/~~([\s\S]*?)~~/g, '$1')
  s = s.replace(/\*+/g, '').replace(/~~/g, '')
  return s.replace(/\s+/g, ' ').trim()
}
