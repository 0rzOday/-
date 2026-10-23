// dump_build.js —— 吃一份 greenseer.js，吐出这个 build 的完整"外壳配置"
//
// 输出（JSON）:
//   header    文件头里的构建时间 + hash
//   sha256    整文件 sha256
//   version   ua 前缀里的版本号
//   base64    自定义 base64 表
//   types     { 语义名: 块 type 号 }
//   encrypt   { 语义名: { name, family, ...参数 } }
//   cfCipher  CF 块用写死片段 f=11/s=6/"var r=" 加密后的密文（hex）
//
// 用法: node dump_build.js <greenseer.js> [输出.json]
const fs = require('fs');
const crypto = require('crypto');

/* ---------------- 浏览器桩 ---------------- */
function mk(name) {
  const f = function () { return mk(name + '()'); };
  return new Proxy(f, {
    get(t, p) {
      if (p === Symbol.toPrimitive) return () => '';
      if (p === 'toString' || p === 'valueOf') return () => '';
      if (typeof p === 'symbol') return undefined;
      if (!(p in t)) t[p] = mk(name + '.' + String(p));
      return t[p];
    },
    set(t, p, v) { t[p] = v; return true; },
    has() { return false; },
    apply() { return mk(name + '()'); },
    construct() { return mk('new ' + name); },
  });
}
for (const g of ['window', 'document', 'navigator', 'location', 'screen', 'self', 'top',
  'parent', 'frames', 'history', 'localStorage', 'sessionStorage', 'XMLHttpRequest',
  'Image', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'MutationObserver',
  'performance', 'chrome', 'external', 'DOMParser', 'CSS', 'getComputedStyle']) {
  globalThis[g] = mk(g);
}
globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

const bytes = (s) => Array.from(s).map(ch => ch.charCodeAt(0));
const toStr = (a) => a.map(b => String.fromCharCode(b & 255)).join('');
const rndStr = (n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(Math.floor(Math.random() * 256)); return s; };
const hexs = (a) => a.map(b => b.toString(16).padStart(2, '0')).join('');
const hex = (s) => hexs(bytes(s));

/* ---------------- 加密族分类 ---------------- */
const CL = 96;        // 分类探测长度
const KEYLEN = 2048;  // XOR 流实际采集长度（sendTemp 块实测最大 754 字节）
function classify(f) {
  // 1) XOR 流：c[i] = p[i] ^ K[i]（K 与明文无关，可以是状态递推出来的）
  try {
    const inv = (c) => { const K = bytes(f('\u0000'.repeat(c.length))); return c.map((b, i) => b ^ K[i]); };
    let ok = true;
    for (let t = 0; t < 3 && ok; t++) { const p = rndStr(CL); if (hex(toStr(inv(bytes(f(p))))) !== hex(p)) ok = false; }
    if (ok) {
      // 长明文再验一次，确认 K 一直有效
      const p2 = rndStr(KEYLEN);
      const K2 = bytes(f('\u0000'.repeat(KEYLEN)));
      const back = bytes(f(p2)).map((b, i) => b ^ K2[i]);
      if (hex(toStr(back)) !== hex(p2)) return { family: 'unknown' };
      let period = KEYLEN;
      for (let q = 1; q <= 64; q++) { let g = true; for (let i = q; i < KEYLEN; i++) if (K2[i] !== K2[i - q]) { g = false; break; } if (g) { period = q; break; } }
      // period>0：keystream 按周期重复，只存一个周期；period=0：非周期，存整个前缀
      return { family: 'xor', key: K2.slice(0, period), period: period === KEYLEN ? 0 : period, keyLen: KEYLEN };
    }
  } catch (e) { }
  // 2) 自链式：c[0] = p[0]^seed, c[i] = p[i]^c[i-1]
  try {
    const seed = bytes(f('\u0000'))[0];
    const inv = (c) => c.map((b, i) => b ^ (i === 0 ? seed : c[i - 1]));
    let ok = true;
    for (let t = 0; t < 3 && ok; t++) { const p = rndStr(CL); if (hex(toStr(inv(bytes(f(p))))) !== hex(p)) ok = false; }
    if (ok) return { family: 'chain', seed };
  } catch (e) { }
  // 3) 逐字节置换
  try {
    const T = []; for (let b = 0; b < 256; b++) T.push(bytes(f(String.fromCharCode(b)))[0]);
    if (new Set(T).size === 256) {
      const iT = new Array(256); for (let b = 0; b < 256; b++) iT[T[b]] = b;
      const inv = (c) => c.map(b => iT[b]);
      let ok = true;
      for (let t = 0; t < 3 && ok; t++) { const p = rndStr(CL); if (hex(toStr(inv(bytes(f(p))))) !== hex(p)) ok = false; }
      if (ok) {
        const out = { family: 'perm', table: T };
        for (let k = 0; k < 8; k++) {
          const off = T[0];
          let g = true;
          for (let b = 0; b < 256; b++) if (T[b] !== (((((b >> k) | (b << (8 - k))) & 255) + off) & 255)) { g = false; break; }
          if (g) { out.pattern = { rotateRight: k, add: off }; break; }
        }
        return out;
      }
    }
  } catch (e) { }
  return { family: 'unknown' };
}

/* ---------------- 主流程 ---------------- */
const P = process.argv[2];
let src = fs.readFileSync(P, 'utf8');
const sha = crypto.createHash('sha256').update(src).digest('hex');
const hm = src.match(/\/\*!\s*greenseer\s+([\d\-: ]+?)\s+([0-9a-f]{40})\s*\*\//);
const header = hm ? { time: hm[1], hash: hm[2] } : null;

src = src.replace(/([A-Za-z_$][\w$]*)\(\1\.s\s*=\s*[^)]*\)\s*;?\s*(?=\}\(\[)/, 'globalThis.__c=$1;');
(0, eval)(src);
const c = globalThis.__c;

const mods = [];
for (let id = 0; id < 2500; id++) { let m; try { m = c(id); } catch (e) { continue; } if (m && typeof m === 'object') mods.push(m); }
let Xt;
for (const m of mods) for (const k of Object.keys(m)) { const v = m[k]; if (v && v.prototype && typeof v.prototype.getTM === 'function') Xt = v; }
if (!Xt) { console.error('!! 找不到 Xt'); process.exit(1); }

// SDK 常量模块 { version, jsv }（源码里 module.exports = {version, jsv}）。
// app() 用它拼 ua 前缀；getJSV() 发 bs4(jsv)。属性是普通可枚举数据属性，两版都读得到。
function findConsts(mods) {
  const cands = [];
  for (const m of mods) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) continue;
    const ks = Object.keys(m);
    if (!ks.includes('version') || !ks.includes('jsv')) continue;
    if (typeof m.version !== 'number') continue;
    cands.push({ m, exact: ks.length === 2 });
  }
  cands.sort((a, b) => Number(b.exact) - Number(a.exact));
  return cands.length ? cands[0].m : null;
}
const consts = findConsts(mods);

// 收集加密函数（原始引用）
const encFns = new Map();
for (const m of mods) for (const k of Object.keys(m)) {
  const f = m[k];
  if (typeof f === 'function' && /^encrypt_/.test(k) && f.length <= 1) encFns.set(k, f);
}
const encSpec = new Map();
for (const [k, f] of encFns) encSpec.set(k, classify(f));

// 打标，让 app 能记录"刚用了谁"
let lastEnc = null;
for (const m of mods) for (const k of Object.keys(m)) {
  const f = m[k];
  if (typeof f !== 'function' || !/^encrypt_/.test(k) || f.length > 1) continue;
  m[k] = function () { lastEnc = k; return f.apply(this, arguments); };
}

// hook app
let rec = null;
const oa = Xt.prototype.app;
Xt.prototype.app = function (type, cip) {
  if (rec && rec.length === 0) rec.push({ type, enc: lastEnc });
  return oa.call(this, type, cip);
};
const op = Xt.prototype.process;

// 每个 get* 都吃一个"事件对象"；touch 系（getTC/getTMV）必须带 touches[0]
function mkEvent() {
  const node = mk('node');
  return {
    type: 'evt', target: node, srcElement: node,
    touches: [{ pageX: 10, pageY: 20, identifier: 1 }],
    button: 0, keyCode: 65, key: 'a', charCode: 65,
    clientX: 10, clientY: 20, pageX: 10, pageY: 20,
    offsetX: 5, offsetY: 5, preventDefault() { }, stopPropagation() { },
  };
}

function mkEventCA() {
  const e = mkEvent();
  const t = mk('target');
  t.className = 'captcha_clickword_hits';
  e.target = t; e.srcElement = t;
  return e;
}

function newInst() {
  const inst = Object.create(Xt.prototype);
  inst.ua = ''; inst._ua = ''; inst.option = { form: '', token: 'a0000000000000000000000000000000' };
  inst.tm = 1792466645817;
  // counters 全部拉高，避免 getKD/getMD 内部级联调用别的 get*
  inst.counters = { sa: 0, mm: 0, md: 99, kd: 99, fo: 0, tc: 0, tmv: 0, mmInterval: 0, tmvInterval: 0 };
  inst._sa = []; inst._ca = [];
  return inst;
}

const SEM = ['getTM', 'getBR', 'getSC', 'getLO', 'getCF', 'getDI', 'getEM', 'getJSV',
  'getTK', 'getMM', 'getMD', 'getKD', 'getFO', 'getTC', 'getTMV', 'sendSA', 'sendCA', 'sendTemp'];

const types = {}, encrypt = {};
let uaVersion = null;
for (const name of SEM) {
  if (typeof Xt.prototype[name] !== 'function') { console.error(`  !! 缺方法 ${name}`); continue; }
  const inst = newInst();
  lastEnc = null; rec = [];
  let err = null;
  if (name === 'sendSA' || name === 'sendCA') {
    // sendSA/sendCA 只是把 recordSA/recordCA 攒好的密文塞进 app()，
    // 加密发生在 record* 里，所以先跑 record* 拿到加密函数名。
    try { Xt.prototype[name === 'sendSA' ? 'recordSA' : 'recordCA'].call(inst, mkEventCA()); } catch (e) { err = e; }
    const encForSend = lastEnc;
    try { Xt.prototype[name].call(inst); } catch (e) { err = e; }
    if (rec.length) rec[0].enc = encForSend;
  } else {
    // sendTemp 收字符串；其余 get* 收事件对象
    const arg = name === 'sendTemp' ? 'evt' : mkEvent();
    try { Xt.prototype[name].call(inst, arg); } catch (e) { err = e; }
  }
  if (!rec.length) { console.error(`  !! ${name} 没有触发 app()${err ? '  ' + err.message : ''}`); rec = null; continue; }
  types[name] = rec[0].type;
  const spec = encSpec.get(rec[0].enc) || { family: 'unknown' };
  encrypt[name] = Object.assign({ name: rec[0].enc }, spec);
  if (uaVersion === null) { const m = String(inst.ua).match(/^(\d+)#/); if (m) uaVersion = Number(m[1]); }
  rec = null;
}

// 版本号兜底：单独跑一次 getTM 读 ua 前缀
if (uaVersion === null) {
  const inst = newInst(); rec = null;
  try { Xt.prototype.getTM.call(inst); } catch (e) { }
  const m = String(inst.ua).match(/^(\d+)#/);
  if (m) uaVersion = Number(m[1]);
}

// 两条路交叉验证：常量模块直读 vs ua 前缀。不一致就是出了新情况，要人看。
const version = consts ? consts.version : uaVersion;
if (consts && uaVersion !== null && consts.version !== uaVersion) {
  console.error(`!! 版本号对不上: 常量模块=${consts.version}  ua前缀=${uaVersion}`);
  process.exitCode = 2;
}
if (!consts) console.error('  ?? 没找到 {version, jsv} 常量模块，版本号退回 ua 前缀');

// base64 表：优先行为探测（表可能被拆成多段字符串，正则抓不到）
function probeBase64(mods) {
  let enc = null;
  for (const m of mods) for (const k of Object.keys(m)) {
    const f = m[k];
    if (typeof f !== 'function' || f.length !== 1) continue;
    try {
      if (f('') !== '') continue;
      const one = f('A');
      if (typeof one !== 'string' || one.length !== 4 || one[2] !== one[3]) continue;
      const z = f('\u0000\u0000\u0000');
      if (typeof z !== 'string' || z.length !== 4 || new Set(z).size !== 1) continue;
      enc = f; break;
    } catch (e) { }
  }
  if (!enc) return null;
  const AL = [];
  for (let v = 0; v < 64; v++) AL.push(enc(String.fromCharCode(v << 2, 0, 0))[0]);
  AL.push(enc('A')[2]);
  const alpha = AL.join('');
  // 自检：用 3 字节输入按标准 base64 分组，看是否与探测到的表一致
  const t = String.fromCharCode(1, 2, 3);
  const g = [t.charCodeAt(0) >> 2,
  ((t.charCodeAt(0) & 3) << 4) | (t.charCodeAt(1) >> 4),
  ((t.charCodeAt(1) & 15) << 2) | (t.charCodeAt(2) >> 6),
  t.charCodeAt(2) & 63];
  if (enc(t) !== g.map(v => AL[v]).join('')) return null;
  return alpha;
}
const b64 = probeBase64(mods) || (src.match(/"([A-Za-z0-9+\/]{64}=)"/) || [])[1] || null;

// CF 密文：f=11, s=6, "var r="
let cfCipher = null;
const cfEncName = encrypt.getCF && encrypt.getCF.name;
if (cfEncName && encFns.has(cfEncName)) {
  const plain = toStr([0, 11, 0, 6, ...bytes('var r=')]);
  cfCipher = hex(encFns.get(cfEncName)(plain));
}

// 还原
Xt.prototype.app = oa; Xt.prototype.process = op;

const cfg = {
  file: P.split(/[\\/]/).pop(),
  header,
  sha256: sha,
  version,
  jsv: consts ? consts.jsv : null,
  base64: b64,
  types,
  encrypt,
  cfCipher,
};

// 无法归类的加密函数 = 配置不完整，直接大声失败
const bad = Object.entries(encrypt).filter(([, v]) => v.family === 'unknown').map(([k]) => k);
const missing = SEM.filter(n => !(n in types));
if (bad.length || missing.length) {
  if (bad.length) console.error(`!! 无法归类的加密: ${bad.join(', ')}`);
  if (missing.length) console.error(`!! 未探到 type 的语义: ${missing.join(', ')}`);
  process.exitCode = 2;
}

const json = JSON.stringify(cfg, null, 2);
if (process.argv[3]) {
  fs.writeFileSync(process.argv[3], json);
  console.log(`已写出 ${process.argv[3]}`);
}
console.log(json);
