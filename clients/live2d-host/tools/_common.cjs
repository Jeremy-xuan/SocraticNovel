/**
 * _common.js —— 四个 Playwright 取证脚本共用的路径/参数解析。
 *
 * 🔴 为什么要放 tools/ 而不是项目根：
 *   playwright 装在**项目根**的 node_modules，Node 的模块解析是「从脚本所在目录往上找」，
 *   所以放项目根能 require 到；同时脚本自身路径无关（用 --host= 或默认上一级），
 *   便于整包搬走后在别处复跑。
 */
const { resolve } = require('node:path');

/** 产出目录：--host=<path> 覆盖，默认取本脚本所在目录的上一级 */
function hostDir() {
  const a = process.argv.find((x) => x.startsWith('--host='));
  return a ? resolve(a.slice(7)) : resolve(__dirname, '..');
}

/** 位置参数（跳过 node/脚本路径与所有 --flag） */
function positional() {
  return process.argv.filter((x, i) => i >= 2 && !x.startsWith('--'));
}

module.exports = { hostDir, positional };
