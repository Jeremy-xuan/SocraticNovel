/*!
 * stage-emotion-parse.js —— 契约 K1.3 的「流式情绪标记解析器」
 *
 * 语法：〔emo:<label>:<intensity>〕   label ∈ calm|happy|shy|puzzled|excited
 *                                   intensity ∈ 0.00–1.00（必须两位小数）
 *
 * 职责只有一件：把**可能带情绪标记**的流式文本，变成「剥净的文本 + 情绪事件」。
 * 它不认识舞台、不认识 PIXI、不读 DOM、不发网络请求——纯函数式状态机。
 *
 * 四条硬约束（逐条对应契约 K1.3）：
 *   1. 跨 chunk 拼接：见到 `〔` 但还没见到 `〕` 时，从 `〔` 起的尾巴**不往下传**。
 *   2. flush() 时仍不完整：尾巴**原样交回**（宁可显示半截，不吞正文），**不发事件**。
 *   3. 非法标签 / 强度越界 / 缺两位小数：整个标记**剥掉**，**不发事件**，不报错。
 *   4. 一句多个标记：取第一个（发事件），其余剥掉（不发事件）。
 *   判据：对同一段文本，**任意切分方式**的 chunk 序列，输出与一次性喂入逐字节相同。
 *
 * 用法（浏览器，经典 <script>，无构建）：
 *   var p = window.__SOCRATIC_EMOTION_PARSE__.createEmotionStreamParser()
 *   var r = p.push(chunk)   // → { text: '已剥净的新增文本', events: [{label, intensity}] }
 *   var f = p.flush()       // → { text: '未闭合的尾巴（原样）' }
 *
 * 用法（Node 单测）：import 或 require 均可，见文件末尾的导出。
 */
;(function (root, factory) {
  'use strict'
  var api = factory()
  if (typeof module === 'object' && module && module.exports) module.exports = api
  if (root) {
    try { root.__SOCRATIC_EMOTION_PARSE__ = api } catch (e) { /* 只读全局不该阻断加载 */ }
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function () {
  'use strict'

  /** 合法标签表（K1.1：只这五个，全小写）。 */
  var LABELS = { calm: 1, happy: 1, shy: 1, puzzled: 1, excited: 1 }

  var OPEN = '〔'          // U+3014
  var CLOSE = '〕'         // U+3015
  var MARKER_HEAD = OPEN + 'emo:'

  /**
   * 完整标记的严格形态。故意**不接受** `0.6`（缺位）、`1.0`、`0.600`、大小写混写——
   * 契约明说「解析器不做浮点格式容错」。
   */
  var MARKER_RE = /^〔emo:(calm|happy|shy|puzzled|excited):(0\.[0-9]{2}|1\.00)〕$/

  /** 句末（K1.1：标记落在句末标点之后；这里用来判「换句了，可以再收一个事件」）。 */
  var SENTENCE_END_RE = /[。！？…!?.;；\n]/

  /**
   * 创建一个解析器实例。实例持有「上一 chunk 留下的尾巴」这一个状态，
   * 除此之外全部无副作用。
   * @returns {{ push: function(string): {text: string, events: Array<{label: string, intensity: number}>}, flush: function(): {text: string} }}
   */
  function createEmotionStreamParser () {
    var held = ''                  // 从 `〔` 起、还没等到 `〕` 的尾巴
    var gotOneThisSentence = false // 本句是否已经交过事件（K1.3 第 4 条）

    /**
     * 把一段「确定可以往下传」的文本交给 sink，同时更新「是否换句」的状态。
     * 关键：句界判定只看**已经传出去的字符**，因此与 chunk 怎么切无关。
     */
    function emit (sink, text) {
      if (!text) return
      sink.push(text)
      if (SENTENCE_END_RE.test(text)) gotOneThisSentence = false
    }

    /**
     * 扫描缓冲区：把能判定的部分推进 sink / events，返回还不该外传的尾巴。
     */
    function drain (buf, sink, events) {
      var rest = buf
      var i = rest.indexOf(OPEN)
      while (i !== -1) {
        var j = rest.indexOf(CLOSE, i + 1)
        if (j === -1) {
          // 有开无闭：`〔` 之前先传，`〔` 之后留着等后续 chunk（K1.3 第 1 条）
          emit(sink, rest.slice(0, i))
          return rest.slice(i)
        }
        var candidate = rest.slice(i, j + 1)
        emit(sink, rest.slice(0, i))
        if (candidate.indexOf(MARKER_HEAD) === 0) {
          // 形态上就是情绪标记：无论合法与否，一律剥掉（K1.3 第 3 条）
          var m = MARKER_RE.exec(candidate)
          if (m && !gotOneThisSentence) {
            events.push({ label: m[1], intensity: Number(m[2]) })
            gotOneThisSentence = true
          }
        } else {
          // 不是情绪标记（例如正文里的〔注〕）：原样保留，不做任何猜测
          sink.push(candidate)
        }
        rest = rest.slice(j + 1)
        i = rest.indexOf(OPEN)
      }
      emit(sink, rest)
      return ''
    }

    return {
      /**
       * 喂一个 chunk。
       * @param {string} chunk 文本增量（非字符串按空串处理，绝不抛）
       * @returns {{text: string, events: Array<{label: string, intensity: number}>}}
       */
      push: function (chunk) {
        var sink = []
        var events = []
        var piece = typeof chunk === 'string' ? chunk : ''
        if (piece) held = drain(held + piece, sink, events)
        return { text: sink.join(''), events: events }
      },

      /**
       * 收尾：把仍不完整的尾巴原样交回，不发事件（K1.3 第 2 条）。
       * 调用后状态清空，实例可以继续用（下一个流从头开始）。
       * @returns {{text: string}}
       */
      flush: function () {
        var tail = held
        held = ''
        gotOneThisSentence = false
        return { text: tail }
      }
    }
  }

  return {
    version: 1,
    labels: Object.keys(LABELS),
    parse: createEmotionStreamParser,
    createEmotionStreamParser: createEmotionStreamParser,
    /** 一次性剥净（不产生事件流语义时的便捷函数；内部仍走同一台状态机）。 */
    strip: function (text) {
      var p = createEmotionStreamParser()
      var a = p.push(typeof text === 'string' ? text : '')
      var b = p.flush()
      return a.text + b.text
    }
  }
})
