// solve_auto.js —— 全自动：拿挑战 -> 三检测器出候选 -> 逐个拼 ac 提交，直到 success
// 用法: node _tools/solve_auto.js [跑几次]
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RUNS = parseInt(process.argv[2] || '1', 10);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
const REF = 'https://www.dingxiang-inc.com/business/captcha';
const AK = '99de95ad1f23597c23b3558d932ded3c';
const C = '6ad7147ck7swOQgPxDDLO3KaEaIebxwzJu1kTRF1';
const SCREEN = [1707, 1067, 1707, 1019, 0, 0, 1707, 932, 1707, 1019];

const TPL = JSON.parse(fs.readFileSync(path.join(ROOT, '_tmp', 'trajectory_success.json'), 'utf8'));
const ST = JSON.parse(fs.readFileSync(path.join(ROOT, '_tmp', 'sendtemp_tpl.json'), 'utf8'));
const PREFIX = fs.readFileSync(path.join(ROOT, '_tmp', 'html_prefix.txt'), 'utf8').replace(/\n$/, '');

const PRESS_X = 700, PRESS_Y = 596;

function buildAc(sid, ansX, y) {
  const v = require(path.join(ROOT, '主要算法.js'));
  v.init_value(sid, SCREEN, REF);

  const MOVE = Math.max(1, ansX - 20);
  const t0 = TPL[0], tN = TPL[TPL.length - 1];
  const span = tN.x - t0.x;
  const D = 3000;
  v.getMM_fixed({ target: '', time_diff: D - 400, PageX: PRESS_X - 60, PageY: PRESS_Y - 4 });
  v.getMM_fixed({ target: '', time_diff: D - 250, PageX: PRESS_X - 20, PageY: PRESS_Y - 1 });
  v.getMD_fixed({ target: '', time_diff: D, PageX: PRESS_X, PageY: PRESS_Y, button: 0 });
  v.sendSA_fixed(TPL.map((p) => ({
    dt: D + (p.dt - t0.dt) + 8,
    x: Math.round(PRESS_X + (p.x - t0.x) * (MOVE / span)),
    y: PRESS_Y + Math.round((p.y - t0.y) * 0.3),
  })));

  const N = (v.tm & 127) + 50;
  const obj = {
    title: ST.title, keywords: ST.keywords, description: ST.description, viewport: ST.viewport,
    bodyLength: ST.bodyLength, headLength: ST.headLength, xpath: ST.xpath,
    x: ansX, y: y,
    fragment: encodeURIComponent(PREFIX.substr(0, N)),
  };
  const js = JSON.stringify(obj);
  v.appRaw('sendTemp', String.fromCharCode((js.length >> 8) & 255, js.length & 255) + js);
  return v.ua;
}

function post(data, headers) {
  return new Promise((res, rej) => {
    const req = https.request({
      hostname: 'cap.dingxiang-inc.com', path: '/api/v1', method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) }, headers),
    }, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res({ status: r.statusCode, body: d })); });
    req.on('error', rej); req.write(data); req.end();
  });
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd: ROOT, maxBuffer: 1 << 24 });
  return { out: r.stdout || '', err: r.stderr || '', code: r.status };
}

(async () => {
  let ok = 0, totalTries = 0;
  for (let n = 1; n <= RUNS; n++) {
    const dir = path.join(ROOT, '_tmp', 'auto' + n);
    fs.mkdirSync(dir, { recursive: true });
    const p = run('node', [path.join(__dirname, 'probe_challenge.js'), dir]);
    if (!fs.existsSync(path.join(dir, 'answer.json'))) { console.log(`#${n} 拿挑战失败`); console.log(p.out.slice(0, 300)); continue; }
    const A = JSON.parse(fs.readFileSync(path.join(dir, 'answer.json'), 'utf8'));

    const c = run('python', [path.join(__dirname, 'gap_candidates.py'),
      '--bg', path.join(dir, 'bg.webp'), '--piece', path.join(dir, 'piece.webp'), '--infor', path.join(dir, 'infor.json')]);
    let cands = [];
    try { cands = JSON.parse(c.out.trim().split('\n').filter(Boolean).pop()); }
    catch (e) { console.log(`#${n} 候选解析失败:`, c.out.slice(0, 200), c.err.slice(0, 200)); continue; }

    console.log(`\n=== 第 ${n} 次  sid=${A.sid} y=${A.y}  候选 ${cands.length} 个 ===`);
    let hit = null, tries = 0;
    for (const cand of cands) {
      tries++;
      const ac = buildAc(A.sid, cand.ansX, A.y);
      const body = new URLSearchParams({
        ac, ak: AK, c: C, uid: '', jsv: '5.1.53', sid: A.sid, aid: A.aid,
        x: String(cand.ansX), y: String(A.y), w: '380', h: '165',
      }).toString();
      const r = await post(body, { 'User-Agent': UA, Referer: REF, Origin: 'https://www.dingxiang-inc.com', Accept: '*/*' });
      let j = {}; try { j = JSON.parse(r.body); } catch (e) { }
      const tag = j.success ? '✅ success' : '❌ ' + (j.msg || r.status);
      console.log(`  试 x=${String(cand.ansX).padStart(3)} (${cand.src}#${cand.rank})  ->  ${tag}`);
      if (j.success) { hit = { cand, token: j.token }; break; }
    }
    totalTries += tries;
    if (hit) {
      ok++;
      fs.writeFileSync(path.join(dir, 'win.json'), JSON.stringify(hit, null, 1));
    }
  }
  console.log(`\n结果: ${ok}/${RUNS} 成功, 平均尝试 ${(totalTries / RUNS).toFixed(1)} 次`);
})();
