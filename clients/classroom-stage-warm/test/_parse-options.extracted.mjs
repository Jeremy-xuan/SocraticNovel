    function parseOptions(text) {
      try {
        const lines = String(text || '').split('\n')
        const hits = []
        // 🔴 两条分支各自带捕获组：只给"括号"那条加组会让 `1.` 这条匹配成功却拿不到编号
        //    （实测踩过：编号变 undefined → 连续性检查全废 → 选项一条都抽不出来）
        const re = /^\s*(?:[（(]?([1-6])[)）]|([1-6])[.、])\s*(.+?)\s*$/
        for (const l of lines) {
          const m = re.exec(l)
          if (m) {
            const idx = Number(m[1] != null ? m[1] : m[2])
            const body = String((m[3] != null ? m[3] : m[2]) || '').replace(/[*_`]/g, '').trim()
            if (idx === hits.length + 1 && body) hits.push(body)
          } else if (hits.length && !l.trim()) {
            /* 空行不打断 */
          } else if (hits.length) {
            break   // 清单结束
          }
        }
        return hits.length >= 2 ? hits.slice(0, 6) : []
      } catch { return [] }
    }

export { parseOptions }
