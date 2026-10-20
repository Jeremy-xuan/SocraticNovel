/* 最小探针：直接写 ParamArmLA/RA/LB/RB，看画面动不动。绕开 min/max 查询。 */
const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { createReadStream, existsSync, statSync, readFileSync } = require('node:fs');
const { extname, join, normalize } = require('node:path');
const HOST='/Users/wujunjie/Documents/ChatGPT/大学申请/开源线/DSH定制/code/clients/live2d-host';
const OUT=join(HOST,'out');
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.png':'image/png','.moc3':'application/octet-stream'};
function srv(root){return new Promise(r=>{const s=createServer((q,p)=>{let rel=normalize(decodeURIComponent((q.url||'/').split('?')[0])).replace(/^(\.\.[/\\])+/,'');if(rel==='/')rel='/demo.html';const a=join(root,rel);if(!existsSync(a)||!statSync(a).isFile()){p.writeHead(404).end();return}p.writeHead(200,{'content-type':MIME[extname(a).toLowerCase()]||'application/octet-stream'});createReadStream(a).pipe(p)});s.listen(0,'127.0.0.1',()=>r({s,port:s.address().port}))})}
(async()=>{
  const {s,port}=await srv(OUT);
  const b=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const pg=await b.newPage({viewport:{width:1200,height:820}});
  pg.on('pageerror',e=>console.log('PAGEERROR',e.message));
  await pg.goto(`http://127.0.0.1:${port}/demo.html`,{waitUntil:'load'});
  await pg.selectOption('#model','armtestchar'); await pg.click('#load');
  await pg.waitForFunction(()=>document.getElementById('log').textContent.includes('ready=true'),null,{timeout:90000});
  await pg.waitForTimeout(1200);
  await pg.selectOption('#bgsel','white'); await pg.waitForTimeout(300);
  await pg.evaluate(()=>{const c=document.getElementById('pause'); c.checked=true; c.dispatchEvent(new Event('change',{bubbles:true}));}); await pg.waitForTimeout(500);

  // 冻结 + 列出全部参数（id / min / max / default / 当前）
  const info = await pg.evaluate(()=>{
    const h=window.__host, m=h.userModel.getModel();
    m.getMotionManager?.() ; h.userModel.getMotionManager().stopAllMotions();
    const n=m.getParameterCount();
    // CubismModel 的 ids 数组
    const ids = m._parameterIds || m.parameterIds || null;
    const out=[];
    for(let i=0;i<n;i++){
      let id=null;
      try{ id = ids? ids[i] : (m.getParameterId? m.getParameterId(i): null); }catch(e){}
      out.push({i, id,
        min:(()=>{try{return m.getParameterMinimumValue(i)}catch(e){return 'ERR'}})(),
        max:(()=>{try{return m.getParameterMaximumValue(i)}catch(e){return 'ERR'}})(),
        dflt:(()=>{try{return m.getParameterDefaultValue(i)}catch(e){return 'ERR'}})()});
    }
    // 模型运行时的参数名（权威）
    let runtimeIds=[];
    try{ runtimeIds = (m._parameterIds||[]).map(x=> (x&&x._id) ? x._id : String(x)); }catch(e){ runtimeIds=['ERR '+e.message]; }
    return {count:n, hasIdsArray: !!ids, runtimeIds,
            hasArm: runtimeIds.filter(x=>/Arm/i.test(String(x))),
            hasLeg: runtimeIds.filter(x=>/Leg/i.test(String(x)))};
  });
  console.log('参数总数:', info.count);
  console.log('运行时参数名('+info.runtimeIds.length+'):', info.runtimeIds.join(' '));
  console.log('含 Arm 的:', JSON.stringify(info.hasArm));
  console.log('含 Leg 的:', JSON.stringify(info.hasLeg));

  // 直接写值（不走 min/max 查询）
  const shot=async(v,name)=>{
    await pg.evaluate((val)=>{
      const h=window.__host, m=h.userModel.getModel();
      // 🔴 按**索引**写。getParameterIndex('ParamArmLA') 返回 32，但模型只有 30 个参数
      //    （真实索引 20..23）—— 用 id 写会命中错位/落空，画面当然不动。
      const ARM_IDX = [20,21,22,23];   // ParamArmLA, ParamArmLB, ParamArmRA, ParamArmRB
      for(const i of ARM_IDX){
        try{ m.setParameterValueByIndex(i, val); }catch(e){}
      }
      m.update(); h.draw();
    }, v);
    await pg.waitForTimeout(450);
    await pg.locator('#stagewrap').screenshot({path:`/tmp/arm_${name}.png`});
  };
  await shot(0,'lo'); await shot(10,'hi'); await shot(0,'lo2');
  console.log('截图完成');
  await b.close(); s.close();
})();
