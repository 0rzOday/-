# 顶象 greenseer 各 build 对比记录

> 本文替代已删除的历史产物（旧 `greenseer*.js`、旧 `dx_config_*.json`、一次性探针脚本）。
> 目的：以后想回答"这个字段跨 build 到底变不变"，不用再留一堆文件，看这张表。
>
> 生成方式：`node _tools/dump_build.js <greenseer.js> dx_config.json`，
> 表里所有数字都是从对应 build 的 dump 结果里直接取的，不是手工记的。

---

## 1. 五个 build 的元信息

| 版本 | 构建时间(文件头) | sha256 前 16 | 文件名 | jsv | cfCipher 前 12 |
|---|---|---|---|---|---|
| 5976 | 2026-10-19 19:00:02 | `3ed8bc948fcdc517` | greenseer.js | 1 | `6d6666601677` |
| 5977 | 2026-10-20 10:00:02 | `1e5dbbe92990f6cb` | greenseer_new.js | —（旧版 dump 未记） | `f7fcfcfa8ced` |
| 5980 | 2026-10-21 19:00:02 | `8a92a023ab2fc95e` | greenseer_new_322.js | 1 | `858e8e88fe9f` |
| 5981 | 2026-10-22 10:00:02 | `811733bc19f6fb95` | greenseer_20261022.js | 1 | `383d67611b59` |
| 5983 | 2026-10-23 10:00:02 | `7c785e64efb6b237` | greenseer_10_23.js | 1 | `373c3c3a4c2d` |

另：2026-10-22 当天还短暂出现过 **5979**，没有留存配置。

**构建时间很有规律**：`10:00:02` 和 `19:00:02` —— 一天两次定时构建，不是按请求随机。

---

## 2. type 号对比（每块 wire format 里的第一个字节）

| 语义 | 5976 | 5977 | 5980 | 5981 | 5983 |
|---|---|---|---|---|---|
| getTM | 18 | 5 | 11 | 7 | 12 |
| getBR | 13 | 1 | 6 | 13 | 17 |
| getSC | 14 | 11 | 15 | 11 | 16 |
| getLO | 4 | 8 | 12 | 17 | 9 |
| getCF | 16 | 3 | 7 | 6 | 14 |
| getDI | 12 | 14 | 4 | 15 | 1 |
| getEM | 3 | 16 | 17 | 5 | 11 |
| getJSV | 15 | 13 | 5 | 16 | 4 |
| getTK | 2 | 18 | 16 | 2 | 7 |
| getMM | 9 | 2 | 1 | 14 | 6 |
| getMD | 6 | 15 | 13 | 18 | 8 |
| getKD | 1 | 6 | 3 | 12 | 5 |
| getFO | 17 | 12 | 18 | 4 | 3 |
| getTC | 7 | 7 | 10 | 8 | 10 |
| getTMV | 11 | 9 | 2 | 10 | 13 |
| sendSA | 10 | 17 | 14 | 9 | 2 |
| sendCA | 8 | 4 | 8 | 3 | 15 |
| sendTemp | 5 | 10 | 9 | 1 | 18 |

- 18 个号在 **1..18 上的一个置换**，每 build 重洗。
- 实际重复只有零星几次（`getTC` 5976=5977=7、`getBR` 5976=5981=13、`getTK` 5976=5981=2、`sendCA` 5976=5980=8）—— 是巧合，不是规律。
- **语义层的顺序永远不变**：init 8 块恒为
  `getTM → getBR → getLO → getCF → getDI → getEM → getJSV → getTK`，往后接 `getSC`。
  变的只有第 0 字节那个号。

---

## 3. 加密族对比

| 语义 | 5976 | 5977 | 5980 | 5981 | 5983 |
|---|---|---|---|---|---|
| getTM | chain | xor | perm | xor | perm |
| getBR | chain | chain | chain | chain | perm |
| getSC | perm | xor | xor | xor | xor |
| getLO | xor | xor | perm | xor | perm |
| getCF | chain | chain | chain | xor | chain |
| getDI | chain | perm | chain | chain | xor |
| getEM | perm | perm | xor | perm | chain |
| getJSV | chain | chain | perm | xor | chain |
| getTK | perm | perm | xor | xor | xor |
| getMM | xor | xor | perm | xor | chain |
| getMD | perm | xor | xor | xor | chain |
| getKD | perm | perm | xor | chain | xor |
| getFO | xor | chain | chain | xor | xor |
| getTC | xor | chain | perm | perm | xor |
| getTMV | xor | perm | chain | xor | xor |
| sendSA | xor | xor | xor | xor | **xor**（5 次全 xor） |
| sendCA | xor | chain | xor | chain | xor |
| sendTemp | xor | xor | xor | perm | perm |

三族定义（`dump_build.js` 的分类依据）：

| 族 | 形态 | 逆运算 |
|---|---|---|
| `xor` | `c[i] = p[i] ^ K[i]`，K 与明文无关 | 再异或一遍同一 K |
| `chain` | `c[0]=p[0]^seed`，`c[i]=p[i]^c[i-1]` | 从 seed 逐字节往前解 |
| `perm` | 256 字节置换表，逐字节 | 用逆表 |

`xor` 的 K 可能是周期重复的（`period>0`，存一个周期），也可能是**状态递推的非周期流**
（`period=0`，存 2048 字节前缀 —— 实测 `sendTemp` 最长 754 字节，2048 够用）。

**已验证：18 个加密函数都没有跨调用状态**，每次调用都从 keystream 头部开始
（`_tools/probe_mm_stateful.js`：同一输入重放两次，密文完全相同）。
所以 `sendSA` 那 250 条样本每条都按**块内偏移**查 key，不用累加全局偏移。

---

## 4. 加密函数名对比（`encrypt_` 前缀已去掉）

| 语义 | 5976 | 5977 | 5980 | 5981 | 5983 |
|---|---|---|---|---|---|
| getTM | oef256zj7ciff2vzrhs6 | f68wsgxm7dtzkirh3eb0 | 963h3an0f3t32ujquyrc | vy9al8gt74ksjgtq005q | 7kocqbr47bcxh0n69qi1 |
| getBR | a7zwthn7pody3yw4j7mt | vnlkvkpihtl5ad1av4wg | vx07vkqvq19oqodlii9u | 55jxftgt7dq56nism2eo | no379zvhwuambn56xzkk |
| getSC | vca0pr0exjcoihc903yz | a9mb6zqga8cblecklzml | 7sbxnwnmuf4jkvjybg2m | 219lpgb5vk9xo0bkyt7i | o2sr5bbfegac1obe2k69 |
| getLO | yej13g1huqa3uio3hpvo | y35zd60dcle1qkf6vicu | 2li60iod9519ci28u22b | hao23dh6shebjll8zs9c | sr7mmzewnajgff7omy3h |
| getCF | ilbx0uayvkf98202rvs0 | g4mz8twyqddcwgrtpig8 | g4ssechpf1absnelmf2g | d27ntb1icicowh2jv18o | qjqgff1t7k761z02lt1c |
| getDI | rh2jk3bcmvc59jtlowum | eh9eef3rtepba9pc50wc | 2vhci52tv56jb8w0uqmt | uo0e7hd84ysylcnaf9sq | nkus106057vwyydkj1pa |
| getEM | up53nwt3a5yo3le25pyj | 4or1vy53ix8wbbg660nk | cxmqzdoujdf7et7l2wym | u3u29n2zz4c1n8q87dfp | 4mfvyz29dkwgvdm5woln |
| getJSV | by11a1sttbsa5grztoue | k8z2f5mzp0tnvq1fntob | qcsw229yy8pnuwh3ozzx | 93dl9ckzu9bsg3ouzjs8 | bkxcmxxih4ui36wl7vhi |
| getTK | jz0pq5ew32p1m0qdbyxh | lfxaajhtueejjqwfle2t | lo2ts42icgmgjw6i6t8v | vgvn0zyua2hnj2gb4jbd | lf3d56lsksh06hwy6aww |
| getMM | 9z1ow6ffc2np4ln79j1d | kqxcai0y54pauzrdrlyh | i0yhxj6alp1ikflqt8z1 | 6c6dmzwo59m4d7nx80s4 | bnwxvuyb885nxbjlc2v6 |
| getMD | gb8wpa7m0r8jdmwhuc1b | z505nux7era4ar477h3o | lx2alyxl3ogap8ia7h64 | u6izl46ef2m4a1eqznb5 | o9c7umq17dneym3t7gdz |
| getKD | 3df1qzasrsblewaky98e | cfoxdup3y1b0na1ncs0q | 87ncxzfxhcnrhimchkl6 | ygb0xukpvbbpz4auqrzz | mydwa88cilo3lz2t4pid |
| getFO | 05gsp9ydpjyk3ae7z0bx | z6l0j53wmai1l942wjc0 | r24qre6z92a6gvjborfp | 89e1lh3gvzx00ejox8iw | 211xbq6wcg9g1ztjuk4o |
| getTC | tnrdbujyl6dmjvx8jsdh | q1b2jn0u9yx5ronj2r9a | hyg8xh13a5wyt4f2pnxp | p4ssh786hm9jft8za1py | b0fe3wmjpb98yzeuimjc |
| getTMV | wsn7pbtuzktumqxxt44s | o9olpm1p1doq5uu0esml | 3ihmt1prtx68nail6ueo | 1nbijs71prp7y67undfa | u2v40v4kmnqypsyi1j6h |
| sendSA | ybhwioj26bxq8uuyn9xh | pls8qnebra8q6y7nxwtn | lttymek3zc804rzpozuf | 582nbvb84audjo14w4ie | 6qgmo1pb7hpmlq430gq2 |
| sendCA | iefb7e9u3v9dlp3tcmrb | b0cq0gfjehubtmdjms74 | bhpeolzj7dnkbcszspig | dtb65vmt6l96e0zh2rle | qdggaf9axq3o0fkeb47a |
| sendTemp | h7ieyg8as6hfjbiebufm | eicg0nv5it8itx10hwtu | lj0hcnyemjeqs8lpxe2o | 08gziezuchfuo693fwaj | 4jit64optjd3ecjhg8td |

函数名也是每 build 全新的随机串，**必须用 `prototype` 方法名（getTM/getBR/…）当锚点
反查，不能靠函数名匹配** —— 这正是 `dump_build.js` 用运行时打标而不是静态搜索的原因。

---

## 5. 5983 的加密参数明细

| 语义 | 族 | 参数 |
|---|---|---|
| getTM | perm | 规则置换 `rotateRight=3, add=229` |
| getBR | perm | 无规则，存整张 256 表 |
| getSC | xor | `period=3` |
| getLO | perm | 无规则，存整张 256 表 |
| getCF | chain | `seed=55` |
| getDI | xor | `period=0`（非周期，存 2048 字节前缀） |
| getEM | chain | `seed=151` |
| getJSV | chain | `seed=53` |
| getTK | xor | `period=10` |
| getMM | chain | `seed=171` |
| getMD | chain | `seed=161` |
| getKD | xor | `period=11` |
| getFO | xor | `period=0` |
| getTC | xor | `period=10` |
| getTMV | xor | `period=0` |
| sendSA | xor | `period=9` |
| sendCA | xor | `period=4` |
| sendTemp | perm | 无规则，存整张 256 表 |

---

## 6. 结论：什么稳定，什么每 build 变

### 每次 build 必变

1. **version** —— `ua` 前缀里的整数，5976→5977→5980→5981→5983。
2. **18 个 type 号** —— 每次全洗。
3. **18 个加密函数** —— 名字、所属族、key/seed/table 全换。
4. **cfCipher** —— `getCF` 那份写死切片对应的密文。

### 一直没变（5 个 build）

1. **base64 表** —— 恒为 `XmYj3u1PnvisIZUF8ThR…`（65 字符），5976 到 5983 一次没动。
   **所以不能用 base64 表判断"是不是新 build"**，要看版本号或文件 hash。
2. **jsv** —— 恒为 `1`（5977 那份配置是旧版 dump 没记，不代表变了）。
3. **32 个 `prototype` 方法名** —— 语义层完全稳定，这是整套自动化的立足点。
4. **块的语义顺序与明文字段布局** —— 例如 init 8 块的顺序、getMM 的
   `[bs4(time_diff)][bs2(PageX)][bs2(PageY)][bs2(target_len)][bss(target)]`。
5. **三种加密族的形态** —— 只在 xor/chain/perm 之间换，没出现过第四种。

### 对使用者的含义

换 build 只需要一条命令：

```
node _tools/dump_build.js <新greenseer.js> dx_config.json
```

`主要算法.js` 一行不用改。轨迹模板、sendTemp 模板、HTML 前缀也都不用动（与 build 无关）。

---

## 7. 验证记录

| 日期 | build | 验证内容 | 结果 |
|---|---|---|---|
| 2026-10-20 | 5976 / 5977 | `compare_ua.js` SDK vs 本地，init 块逐字节 | 7/8 一致，getCF 按设计跳过 |
| 2026-10-22 | 5980 | `replay_ac.js` 用真实抓包整串重建 | **77/77 块、1872 字节逐字节一致** |
| 2026-10-23 | 5983 | `compare_ua.js` 换配置后 7 块 | **7/7 一致** |
| 2026-10-23 | 5983 | `solve_once.js` 真发一次 POST | **`success:true`**，拿到 token |

累计成功提交 **7 次**（2026-10-22 两次真机手拖 + 五次本地离线拼，其中 5983 一次）。

---

## 8. 已删除的一次性探针（用途备查）

早期摸清结构时写过、跑完就退役的脚本，删掉前记一下它们分别证明了什么：

| 脚本 | 当时用来干什么 |
|---|---|
| `probe_gettm.js` / `probe_getcf.js` / `probe_encrypt.js` / `list_encrypts.js` / `find_encrypt.js` | 最早的探针：定位 `encrypt_*` 模块、确认 getTM 用哪个加密函数 |
| `classify_encrypts.js` | 把 18 个加密函数分成 xor/chain/perm 三族（后来并进 `dump_build.js`） |
| `dump_cf_sources.js` / `_tools/cf_sources/` | 抓 `getCF` 的 4 份源码切片（`toCodeArray`/`getBrowserAndVersion`/`getScreenInfo`/`Promise`），确认它们每 build 变标识符名和数组下标，因此必须整段写死 |
| `diff_builds.js` / `compare_blocks.js` / `crosscheck.js` / `map_types_b.js` | 逐 build 对比 type 号与块长，验证"语义顺序不变、只有标签洗牌" |
| `decrypt_ac.js` / `decrypt_ac2.js` / `decode_ac.js` / `decode_sample.js` | 早期解 ac 的尝试，后来收敛成 `decode_ac_live.js` |
| `replay_ac2.js` / `replay_sample.js` | 早期整串重放，后来收敛成 `replay_ac.js` |
| `verify_config.js` / `verify_encrypt.js` / `verify_cf.js` / `verify_*.json` | 配置自检与抓包比对 |
| `run_sdk.js` / `debug_process.js` / `extract_app_map.js` / `test_type_perm.js` / `dump_listeners.js` | 直接跑 SDK / 调 `process` / 抽 app 映射 / 验证 type 是置换 / 扒事件监听器 |
| `config_buildA.json`(5976) / `config_buildB.json`(5977) | 最早两份 dump 结果，数据已并入本文第 2~4 节 |
| `cap_a_127.json` / `cap_a_135.json` | 两次 `/api/a` 响应快照 |

### 第二批（2026-10-23，只保留"构造 ac"链路后退役的验证/研究工具）

`_tools/` 最终只留 6 个**构造 ac 必需**的脚本：`dump_build.js`、`probe_challenge.js`、
`gap_candidates.py`、`gap_rim.py`、`solve_once.js`、`solve_auto.js`。
下面这些是验证/研究性质，已删除，但它们证明过的事实留在本文里：

| 脚本 | 当时用来干什么 | 结论 / 替代方式 |
|---|---|---|
| `replay_ac.js` | 真机 ac 拆成事件脚本 → 本地重放 → 逐字节比 | 5980 那次 77/77 块、1872 字节完全一致（见第 7 节）。**这是最有力的整体正确性证据** |
| `compare_ua.js` | 同 build 同 tm，SDK vs 本地逐块比 | 5976/5977/5983 均 7 块一致（getCF 按设计跳过）。**新 build 若不放心，只能直接打一次 POST 验证** |
| `decode_ac_live.js` | 拆块 + 解密 + 解释明文 | 用来肉眼确认每块明文对不对（例如 getTK 里确实是 sid） |
| `probe_mm_stateful.js` | 验 getMM 明文布局 + 加密函数跨调用是否有状态 | 明文布局见第 6 节；**18 个加密函数全部无状态**，每次从 keystream 头部开始 |
| `_probe_em_env.js` | 同一 SDK 只换环境，看 getEM 6 位怎么变 | 干净浏览器 6 位全 0；Playwright 下会变 2/3/8/16。因此 getEM 直接写死 0 |
| `compare_browser_ua.js` | 浏览器真实 ua vs 本地逐块比（含密文） | 28/28 语义对齐 |
| `run_mm_trajectory.js` | init + 灌一条轨迹，看最终 ua | 用来生成/验证轨迹注入 |
| `replay_sample.js` | 硬编码 5977 样本当标准答案 | 与 build 绑定，5983 下必然 0/9 一致，已无意义 |
| `verify_config.js` | 按配置重建抓包 ua/ac 逐字节比 | 能力已被 `replay_ac.js` 完全覆盖且更强 |
