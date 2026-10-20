const HOST = "/Users/wujunjie/Documents/ChatGPT/大学申请/开源线/DSH定制/code/clients/live2d-host";
const cap = await import("file://" + HOST + "/src/capability.js");
const fs = await import("node:fs/promises");

async function probe(dir, name) {
  const model3 = JSON.parse(await fs.readFile(`${dir}/models/${name}/${name}.model3.json`, "utf8"));
  let cdi = null;
  try { cdi = JSON.parse(await fs.readFile(`${dir}/models/${name}/${name}.cdi3.json`, "utf8")); } catch {}
  const c = cap.parseCapability(model3, { modelId: name, displayInfo: cdi });
  return { name, lip: c.lipSync, exprs: c.expressionCount, exprsNames: c.expressions.map(e=>e.name).slice(0,8),
           motionGroups: c.motionGroupUnion, cdiGroups: c.displayInfoParameterGroups };
}

const dir = HOST + "/out";
for (const n of ["Haru", "Mao", "Wanko", "Mark", "Rice", "Hiyori", "Natori", "Ren"]) {
  const r = await probe(dir, n);
  console.log(`\n=== ${r.name} ===`);
  console.log("  lipSync.status   :", r.lip.status);
  console.log("  lipSync.source   :", r.lip.source);
  console.log("  lipSync.parameter:", r.lip.parameter);
  console.log("  detail           :", r.lip.detail);
  console.log("  表情数/名        :", r.exprs, JSON.stringify(r.exprsNames));
  console.log("  动作组           :", JSON.stringify(r.motionGroups));
  console.log("  cdi3语义分组     :", r.cdiGroups.available, JSON.stringify(r.cdiGroups.groups));
}
