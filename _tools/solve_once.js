// solve_once.js —— 用 probe_challenge.js 拿到的挑战，本地拼 ac，直接 POST /api/v1
// 用法: node _tools/solve_once.js [challenge目录]
const fs = require('fs');
const path = require('path');
const https = require('https');

const DIR = process.argv[2] || path.join(__dirname, '..', '_tmp', 'challenge');
const A = JSON.parse(fs.readFileSync(path.join(DIR, 'answer.json'), 'utf8'));
if (process.argv[3] !== undefined) A.ansX = parseInt(process.argv[3], 10);   // 手动指定答案 x
console.log('挑战:', JSON.stringify({ sid: A.sid, y: A.y, ansX: A.ansX, pieceX: A.pieceX }));

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
const REF = 'https://www.dingxiang-inc.com/business/captcha';
const AK = '99de95ad1f23597c23b3558d932ded3c';
const C = '6ad7147ck7swOQgPxDDLO3KaEaIebxwzJu1kTRF1';
const CID = '17119188';
const SCREEN = [1707, 1067, 1707, 1019, 0, 0, 1707, 932, 1707, 1019];

/* ---- 1. 造轨迹：拿真机那条按比例缩放到本次需要的位移 ---- */
const tpl = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '_tmp', 'trajectory_success.json'), 'utf8'));
const PRESS_X = 700, PRESS_Y = 596;              // 随便定的页面坐标（服务端只能查增量）
const MOVE = A.ansX - 20;                        // 位移 = 答案 - 20（手柄中心）
const t0 = tpl[0], tN = tpl[tpl.length - 1];
const span = tN.x - t0.x;
const traj = tpl.map((p) => ({
  dt: p.dt - t0.dt,
  x: Math.round(PRESS_X + (p.x - t0.x) * (MOVE / span)),
  y: PRESS_Y + Math.round((p.y - t0.y) * 0.3),
}));
console.log(`轨迹 ${traj.length} 点, 位移 ${MOVE}px, dt 0→${traj[traj.length - 1].dt}ms`);

/* ---- 2. 本地拼 ac ---- */
const v = require(path.join(__dirname, '..', '主要算法.js'));
v.init_value(A.sid, SCREEN, REF);
const D = 3000;
v.getMM_fixed({ target: '', time_diff: D - 400, PageX: PRESS_X - 60, PageY: PRESS_Y - 4 });
v.getMM_fixed({ target: '', time_diff: D - 250, PageX: PRESS_X - 20, PageY: PRESS_Y - 1 });
v.getMD_fixed({ target: '', time_diff: D, PageX: PRESS_X, PageY: PRESS_Y, button: 0 });
v.sendSA_fixed(traj.map((p) => ({ dt: D + p.dt + 8, x: p.x, y: p.y })));

/* sendTemp：页面指纹。fragment 原文长度必须等于 (tm & 127) + 50 */
const ST = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '_tmp', 'sendtemp_tpl.json'), 'utf8'));
const PREFIX = fs.readFileSync(path.join(__dirname, '..', '_tmp', 'html_prefix.txt'), 'utf8').replace(/\n$/, '');
const N = (v.tm & 127) + 50;
const stObj = {
  title: ST.title, keywords: ST.keywords, description: ST.description, viewport: ST.viewport,
  bodyLength: ST.bodyLength, headLength: ST.headLength, xpath: ST.xpath,
  x: A.ansX, y: A.y,
  fragment: encodeURIComponent(PREFIX.substr(0, N)),
};
const stJson = JSON.stringify(stObj);
v.appRaw('sendTemp', String.fromCharCode((stJson.length >> 8) & 255, stJson.length & 255) + stJson);
console.log(`sendTemp: json ${stJson.length} 字节, fragment 原文 ${N} 字符`);

const ac = v.ua;
console.log(`ac: ${ac.length} 字符, ${v._ua.length} 字节, 块数见下`);

/* ---- 3. POST /api/v1 ---- */
const body = new URLSearchParams({
  ac, ak: AK, c: C, uid: '', jsv: '5.1.53', sid: A.sid, aid: A.aid,
  x: String(A.ansX), y: String(A.y), w: '380', h: '165',
}).toString();

function post(url, data, headers) {
  return new Promise((res, rej) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) }, headers),
    }, (r) => {
      let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res({ status: r.statusCode, body: d }));
    });
    req.on('error', rej);
    req.write(data); req.end();
  });
}

(async () => {
  const r = await post('https://cap.dingxiang-inc.com/api/v1', body, {
    'User-Agent': UA, Referer: REF, Origin: 'https://www.dingxiang-inc.com', Accept: '*/*',
  });
  console.log('\n=== 提交结果 ===');
  console.log('http', r.status);
  let j; try { j = JSON.parse(r.body); } catch (e) { console.log(r.body.slice(0, 400)); return; }
  console.log(JSON.stringify(j, null, 1));
  if (j.success) {
    console.log('\n✅ 成功！token =', j.token);
    fs.writeFileSync(path.join(DIR, 'ac_win.txt'), ac);
    fs.writeFileSync(path.join(DIR, 'token.txt'), String(j.token));
  } else {
    console.log('\n❌ 失败:', j.msg);
  }
})();
