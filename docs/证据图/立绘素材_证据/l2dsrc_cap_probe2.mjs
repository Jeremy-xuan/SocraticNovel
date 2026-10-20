const HOST = "/Users/wujunjie/Documents/ChatGPT/大学申请/开源线/DSH定制/code/clients/live2d-host";
const cap = await import("file://" + HOST + "/src/capability.js");

function show(title, model3, cdi) {
  const c = cap.parseCapability(model3, { displayInfo: cdi });
  console.log(`\n=== ${title} ===`);
  console.log("  status   :", c.lipSync.status);
  console.log("  source   :", c.lipSync.source);
  console.log("  parameter:", c.lipSync.parameter);
  console.log("  candidates:", JSON.stringify(c.lipSync.candidates));
  console.log("  detail   :", c.lipSync.detail);
}

// ① 自声明了「不在已知风格列表里」的嘴参数，但 cdi3 参数全集里确实存在它
show("甲｜自声明非标准名 + cdi3 里存在",
  { Version:3, FileReferences:{Moc:"a.moc3",Textures:[],Motions:{Idle:[{File:"i.motion3.json"}]}},
    Groups:[{Name:"LipSync",Ids:["ParamMouthOpenY2"]}] },
  { Parameters:[{Id:"ParamMouthOpenY2",GroupId:"g1"}], ParameterGroups:[{Id:"g1",Name:"口"}] });

// ② 自声明非标准名，且 cdi3 里没有它（声明与全集不一致）
show("乙｜自声明非标准名 + cdi3 里没有它",
  { Version:3, FileReferences:{Moc:"a.moc3",Textures:[],Motions:{Idle:[{File:"i.motion3.json"}]}},
    Groups:[{Name:"LipSync",Ids:["MyMouth"]}] },
  { Parameters:[{Id:"ParamAngleX",GroupId:"g1"}], ParameterGroups:[{Id:"g1",Name:"顔"}] });

// ③ 完全没有任何 cdi3（L2b 未验证）
show("丙｜无 cdi3、LipSync 是空数组",
  { Version:3, FileReferences:{Moc:"a.moc3",Textures:[],Motions:{Idle:[{File:"i.motion3.json"}]}},
    Groups:[{Name:"LipSync",Ids:[]}] }, null);

// ④ 没有 Groups 字段（老模型）
show("丁｜连 Groups 字段都没有 + 无 cdi3",
  { Version:3, FileReferences:{Moc:"a.moc3",Textures:[],Motions:{Idle:[{File:"i.motion3.json"}]}} }, null);
