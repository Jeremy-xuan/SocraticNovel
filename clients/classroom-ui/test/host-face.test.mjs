// test/host-face.test.mjs — 面板宿主半边的契约单测（B2，2026-10-21）
//
// 🔴 纪律：不装宿主、不起服务、不联网；只 import 本包 `lib/` 下的模块。
//
// 钉住四件事（前两条是「不 import 宿主包」之后**唯一**还成立的理由来源）：
//   ① `lib/remote-service.mjs` 产出的 `typertRemote` 绑定逐字段满足宿主网关 `readBinding()`
//      的要求（`service` 指自己、`serviceKey` 是服务名、`namespace` 是字符串）；
//   ② `markRemote()` 在原型上写的描述符与宿主 `remoteMethods()` 读的形状一致
//      （字符串键 `@deepseek-ai/dsh-typert-protocol/remote-methods`、`{version:1, methods:[…]}`）；
//   ③ `lib/typert.host.js` 的清单里**只剩**叙事两条（白板已下线），服务名与
//      `lib/narrative-host.mjs` 的 `SERVICE_KEY` 逐字一致；
//   ④ 本包源码里没有任何 `@deepseek-ai/*` 的 import（静态或动态）。
//
// 跑法：node test/host-face.test.mjs（也可经仓库级入口 node check.mjs）

import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { REMOTE_METHOD_DESCRIPTOR, RemoteService, markRemote } from '../lib/remote-service.mjs'
import { TYPERT } from '../lib/typert.host.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

let checks = 0
const ok = (label) => {
  checks += 1
  console.log(`  ✔ ${label}`)
}

// ── ① typertRemote 绑定 ────────────────────────────────────────────────────
{
  const ctx = { name: 'fake-ctx' }
  class Sample extends RemoteService {
    constructor(owner) {
      super(owner, 'sampleService')
    }
  }
  const service = new Sample(ctx)
  assert.equal(service.ctx, ctx, 'this.ctx 必须是构造时给的上下文（方法里靠它读别的服务）')
  assert.equal(service.name, 'sampleService')
  assert.equal(Object.isFrozen(service.typertRemote), true, '绑定要冻结（网关会读它，但没人该改它）')
  assert.equal(service.typertRemote.service, service, 'binding.service 必须 === the receiver 的 original（readBinding 的第一条）')
  assert.equal(service.typertRemote.serviceKey, 'sampleService', 'binding.serviceKey 必须等于 cordis 服务键')
  assert.equal(service.typertRemote.namespace, 'sampleService', '缺省 namespace ＝ 服务名')
  assert.equal(typeof service.typertRemote.namespace, 'string')
  ok('RemoteService：typertRemote = {service, serviceKey, namespace} 且冻结')

  class Renamed extends RemoteService {
    constructor(owner) {
      super(owner, 'k', { namespace: 'wire' })
    }
  }
  assert.equal(new Renamed(ctx).typertRemote.namespace, 'wire', 'namespace 可覆盖（wire 名与服务键不同名时）')
  ok('RemoteService：namespace 可覆盖')
}

// ── ② markRemote 的原型描述符 ───────────────────────────────────────────────
{
  assert.equal(REMOTE_METHOD_DESCRIPTOR, '@deepseek-ai/dsh-typert-protocol/remote-methods', '这个字符串是跨端契约，一个字都不能改')

  class Svc {
    async status() {}
    async diaries() {}
  }
  markRemote(Svc.prototype, 'status')
  markRemote(Svc.prototype, 'diaries')
  const descriptor = Object.getOwnPropertyDescriptor(Svc.prototype, REMOTE_METHOD_DESCRIPTOR)?.value
  assert.equal(descriptor.version, 1)
  assert.deepEqual(
    descriptor.methods.map((method) => method.method),
    ['status', 'diaries'],
    '顺序＝清单顺序（网关按这个顺序装配实参）',
  )
  assert.deepEqual(descriptor.methods[0].invocation, { kind: 'direct' })
  assert.equal(Object.isFrozen(descriptor), true)
  assert.equal(Object.isFrozen(descriptor.methods), true)
  ok('markRemote：描述符形状 = {version:1, methods:[…]}，direct invocation')

  // 重复标记同一形状 → 幂等（分包被加载两次不会炸）
  markRemote(Svc.prototype, 'status')
  assert.equal(descriptor.methods.length, 2)
  ok('markRemote：同形状重复标记是幂等的')

  // 冲突标记 → 抛错（不静默覆盖）
  assert.throws(() => markRemote(Svc.prototype, 'status', { kind: 'stream' }), /调用标记冲突/)
  ok('markRemote：冲突标记抛错')

  // exportName / mode 透传
  class Svc2 {
    async read() {}
  }
  markRemote(Svc2.prototype, 'read', { kind: 'direct' }, 'stream', 'readAll')
  const d2 = Object.getOwnPropertyDescriptor(Svc2.prototype, REMOTE_METHOD_DESCRIPTOR)?.value
  assert.equal(d2.methods[0].exportName, 'readAll')
  assert.equal(d2.methods[0].mode, 'stream')
  ok('markRemote：exportName 与 mode 透传')
}

// ── ③ TYPERT 清单只剩叙事两条 ───────────────────────────────────────────────
{
  const ids = TYPERT.invocations.map((invocation) => invocation.id)
  assert.deepEqual(ids, ['classroom-ui#classroomNarrative/status', 'classroom-ui#classroomNarrative/diaries'])
  ok('TYPERT：只剩 classroomNarrative 的 status / diaries（白板三条已下线）')
  assert.equal(
    TYPERT.invocations.some((invocation) => invocation.service === 'whiteboardStore'),
    false,
    'whiteboardStore 不许再出现在清单里',
  )
  ok('TYPERT：清单里没有 whiteboardStore')

  const services = TYPERT.model.services.map((service) => service.key)
  assert.deepEqual(services, ['classroomNarrative'])
  ok('TYPERT.model：只剩叙事服务的形状')

  // 每个 invocation 的 service/namespace 与 lib/narrative-host.mjs 的服务名一致
  const narrativeSource = readFileSync(join(ROOT, 'lib', 'narrative-host.mjs'), 'utf8')
  const serviceKey = /const SERVICE_KEY = '([^']+)'/.exec(narrativeSource)?.[1]
  assert.equal(serviceKey, 'classroomNarrative')
  for (const invocation of TYPERT.invocations) {
    assert.equal(invocation.service, serviceKey, `${invocation.id}: service 必须是 ${serviceKey}`)
    assert.equal(invocation.namespace, serviceKey, `${invocation.id}: namespace 必须是 ${serviceKey}`)
    assert.equal(typeof invocation.parameters, 'object')
    assert.equal(typeof invocation.result.create, 'function', '0.2.1 的 codec 必须带 create() 工厂')
    for (const parameter of invocation.parameters) {
      assert.equal(typeof parameter.codec.create, 'function', `${invocation.id}/${parameter.name}: codec 要有 create()`)
    }
  }
  ok('TYPERT：每条 invocation 的 service/namespace/参数 codec 都合规')
}

// ── ④ 源码里不许出现宿主包 import ───────────────────────────────────────────
{
  const HOST_STATIC = /(?:^|\s)(?:import|export)[^;\n]*?from\s*['"]@deepseek-ai\//
  const HOST_DYNAMIC = /import\s*\(\s*['"]@deepseek-ai\//

  /** 递归列源码文件（跳过 node_modules / vendor / test）。 */
  const walk = (dir, out = []) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'vendor' || entry.startsWith('.')) continue
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path, out)
      else if (/\.(mjs|js)$/.test(entry)) out.push(path)
    }
    return out
  }
  const files = [...walk(join(ROOT, 'lib')), join(ROOT, 'cordis.patch.yml')].filter((path) => /\.(mjs|js)$/.test(path))
  const offenders = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
    for (const [index, line] of text.split('\n').entries()) {
      if (HOST_STATIC.test(line) || HOST_DYNAMIC.test(line)) {
        offenders.push(`${relative(ROOT, file)}:${index + 1}  ${line.trim()}`)
      }
    }
  }
  assert.deepEqual(offenders, [], `面板源码里出现了宿主包 import：\n${offenders.join('\n')}`)
  ok('源码：lib/ 下没有任何 @deepseek-ai/* 的 import（含动态 import）')

  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const hostDeps = Object.keys(pkg.dependencies ?? {}).filter((name) => name.startsWith('@deepseek-ai/'))
  assert.deepEqual(hostDeps, [], 'dependencies 里不该有宿主包')
  ok('package.json：dependencies 里没有 @deepseek-ai/*')
}

console.log(`\nhost-face: ${checks} 项通过`)
