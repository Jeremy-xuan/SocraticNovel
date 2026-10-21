// test/worldguard.test.mjs — N5.3 的代码级守卫（唯一硬约束）
//
// 每一条都是「写盘前就该被挡住」的用例：教学文件、运行记录、越界路径、代码维护的日志。

import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyWorldWrite, FORBIDDEN_FILES, MAX_WRITE_BYTES } from '../lib/worldguard.mjs'

test('允许：characters/ 与 world/ 下的 .md', () => {
  for (const path of ['characters/an.md', 'characters/deepseek.md', 'world/setting.md', 'world/metaphor.md']) {
    const verdict = classifyWorldWrite(path)
    assert.equal(verdict.ok, true, path)
    assert.equal(verdict.path, path)
  }
})

test('拒绝：教学文件（N5.3 点名的每一个）', () => {
  const paths = ['materials/ch01.md', 'curriculum.md', 'knowledge_points.md', 'system_core.md', '_anchor.md']
  for (const path of paths) {
    const verdict = classifyWorldWrite(path)
    assert.equal(verdict.ok, false, path)
    assert.equal(verdict.code, 'FORBIDDEN_PATH', path)
    assert.match(verdict.reason, /不许碰/)
  }
})

test('拒绝：运行记录与教室清单（不在 N5.3 的字面清单里，但同样不许被世界观改）', () => {
  for (const path of ['runtime/notes.jsonl', 'runtime/progress.md', 'runtime/wechat_group.jsonl', 'classroom.yaml', 'AGENTS.md', 'CLAUDE.md', 'story/ch01.md', 'tools/validate']) {
    const verdict = classifyWorldWrite(path)
    assert.equal(verdict.ok, false, path)
  }
})

test('拒绝：代码维护的两份日志（只能追加，不能重写）', () => {
  for (const path of ['world/proposals.md', 'world/changelog.md']) {
    const verdict = classifyWorldWrite(path)
    assert.equal(verdict.ok, false, path)
    assert.equal(verdict.code, 'CODE_OWNED')
  }
})

test('拒绝：越界路径与绝对路径', () => {
  assert.equal(classifyWorldWrite('../outside.md').code, 'PATH_ESCAPE')
  assert.equal(classifyWorldWrite('world/../materials/ch01.md').code, 'PATH_ESCAPE')
  assert.equal(classifyWorldWrite('/etc/passwd').code, 'ABSOLUTE_PATH')
  assert.equal(classifyWorldWrite('C:/windows/x.md').code, 'ABSOLUTE_PATH')
  assert.equal(classifyWorldWrite('').code, 'EMPTY_PATH')
  assert.equal(classifyWorldWrite('world/').code, 'NOT_A_FILE')
})

test('拒绝：非 .md 与白名单之外的目录', () => {
  assert.equal(classifyWorldWrite('world/setting.png').code, 'NOT_MARKDOWN')
  assert.equal(classifyWorldWrite('notes/x.md').code, 'OUT_OF_SCOPE')
  assert.equal(classifyWorldWrite('world/sub/x.md').ok, true)
})

test('拒绝：超过单文件上限（防止把整本教材灌进一张角色卡）', () => {
  const verdict = classifyWorldWrite('characters/an.md', { bytes: MAX_WRITE_BYTES + 1 })
  assert.equal(verdict.ok, false)
  assert.equal(verdict.code, 'TOO_LARGE')
  assert.equal(classifyWorldWrite('characters/an.md', { bytes: MAX_WRITE_BYTES }).ok, true)
})

test('黑名单是逐条列出来的（改动时能看见自己动了什么）', () => {
  assert.deepEqual([...FORBIDDEN_FILES].sort(), ['AGENTS.md', 'CLAUDE.md', '_anchor.md', 'classroom.yaml', 'curriculum.md', 'knowledge_points.md', 'system_core.md'].sort())
})
