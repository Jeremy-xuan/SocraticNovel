import { parseOptions } from '/tmp/avalon-recon/parse-options.mod.mjs'
const cases = [
  ['编号点号', '先选一个方向：\n1. 先看 PCB\n2. 看状态迁移\n3. 看代码', ['先看 PCB', '看状态迁移', '看代码']],
  ['顿号', '1、甲\n2、乙', ['甲', '乙']],
  ['括号', '（1）甲\n（2）乙\n（3）丙', ['甲', '乙', '丙']],
  ['单条不算选项', '今天讲 1. 进程', []],
  ['非连续编号不算', '1. 甲\n3. 丙', []],
  ['七条截到六条', '1.a\n2.b\n3.c\n4.d\n5.e\n6.f\n7.g', ['a','b','c','d','e','f']],
  ['普通正文', '先别急着记定义，说说看？', []],
  ['空输入', '', []],
  ['行内数字不误判', '内存有 2. 5 GB 左右', []],
]
let pass = 0
for (const [name, input, want] of cases) {
  const got = parseOptions(input)
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) pass++
  console.log((ok ? '✔' : '✖') + ' ' + name + (ok ? '' : `  期望 ${JSON.stringify(want)} 得到 ${JSON.stringify(got)}`))
}
console.log(`\n${pass}/${cases.length} 通过`)
process.exit(pass === cases.length ? 0 : 1)
