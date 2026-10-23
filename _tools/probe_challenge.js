// probe_challenge.js —— 离线走一遍：拿挑战 -> 下图片 -> 算缺口 -> 得到答案 x
// 用法: node _tools/probe_challenge.js [输出目录]
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const OUT = process.argv[2] || path.join(__dirname, '..', '_tmp', 'challenge');
fs.mkdirSync(OUT, { recursive: true });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
const REF = 'https://www.dingxiang-inc.com/business/captcha';
const AK = '99de95ad1f23597c23b3558d932ded3c';
const C = '6ad7147ck7swOQgPxDDLO3KaEaIebxwzJu1kTRF1';
const CID = '17119188';
const IMG_BASE = 'https://static4.dingxiang-inc.com/picture';

const rnd = (n) => Math.floor(Math.random() * Math.pow(10, n));
const aid = 'dx-' + Date.now() + '-' + rnd(7) + '-' + Math.floor(Math.random() * 9 + 1);

function get(url, binary) {
  return new Promise((res, rej) => {
    https.get(url, {
      headers: {
        'User-Agent': UA, Referer: REF, Accept: '*/*',
        Origin: 'https://www.dingxiang-inc.com',
      },
    }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => res({ status: r.statusCode, body: binary ? Buffer.concat(chunks) : Buffer.concat(chunks).toString('utf8') }));
    }).on('error', rej);
  });
}

(async () => {
  /* 1) 拿挑战。t 空着就行（实测服务端不校验） */
  const url = 'https://cap.dingxiang-inc.com/api/a'
    + '?w=380&h=165&s=50'
    + '&ak=' + AK + '&c=' + C + '&jsv=5.1.53'
    + '&aid=' + encodeURIComponent(aid)
    + '&wp=1&de=0&uid=&lf=0&tpc=&t='
    + '&cid=' + CID + '&_r=' + Math.random();
  const r = await get(url);
  const j = JSON.parse(r.body);
  console.log('=== 挑战 ===');
  console.log('http=' + r.status + '  success=' + j.success + '  sid=' + j.sid + '  y=' + j.y);
  if (!j.success || !j.sid) { console.log(j); process.exit(1); }

  /* 2) 下载背景 + 拼图块 */
  const p1 = j.p1, p2 = j.p2;
  const bgPath = path.join(OUT, 'bg.webp');
  const pcPath = path.join(OUT, 'piece.webp');
  fs.writeFileSync(bgPath, (await get(IMG_BASE + p1, true)).body);
  fs.writeFileSync(pcPath, (await get(IMG_BASE + p2, true)).body);
  console.log('bg  :', p1, fs.statSync(bgPath).size, 'bytes');
  console.log('pc  :', p2, fs.statSync(pcPath).size, 'bytes');

  /* 3) 跑缺口.py */
  const infor = path.join(OUT, 'infor.json');
  fs.writeFileSync(infor, JSON.stringify({ p1, p2, y: j.y, sid: j.sid }));
  const py = spawnSync('python', [path.join(__dirname, '..', '缺口.py'),
    '--bg', bgPath, '--piece', pcPath, '--infor', infor,
    '--out', path.join(OUT, 'gap.png')], { encoding: 'utf8', cwd: path.join(__dirname, '..') });
  const out = (py.stdout || '') + (py.stderr || '');

  // 只取 y 带内那一段的第一个候选
  const band = out.split('只在 y 带内搜')[1] || out;
  const m = band.match(/块=\(\s*(\d+),\s*(\d+)\)/);
  const all = band.match(/块=\(\s*(\d+),\s*(\d+)\)/g) || [];
  console.log('\n=== 缺口 ===');
  console.log(all.slice(0, 3).join('   '));
  if (!m) { console.log(out.slice(0, 600)); process.exit(1); }

  const px = +m[1], py2 = +m[2];
  const ansX = Math.round(px * (380 / 400));   // 图片 400 宽 -> 显示 380 宽
  console.log(`拼图块左边 x=${px}  ->  答案 x = round(${px} * 0.95) = ${ansX}`);
  console.log(`答案 y = ${j.y}（原样回传服务端给的 y）`);

  fs.writeFileSync(path.join(OUT, 'answer.json'), JSON.stringify({
    sid: j.sid, y: j.y, p1, p2, pieceX: px, pieceY: py2, ansX, aid,
  }, null, 1));
  console.log('\n已写 ' + path.join(OUT, 'answer.json'));
})();
