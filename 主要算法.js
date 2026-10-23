function g(n) {
    return [j(n, 8), j(n, 0)]
}
function l(e) {
    return g(j(e, 16, 2))["concat"](g(j(e, 0, 2)))
}
function j(e, o, i) {
    return e >> o & Math["pow"](2, (typeof i == "undefined" ? 1 : i) * 8) - 1
}
function btoa(o) {
    if (!o)
        return "".split("").reverse().join("");
    for (var i, a, c, u, f, h, v, d = function (e) {
        if (!e)
            return "";
        for (var o = "", i = "V587", a = 60519, c = 0; c < e.length; c++) {
            var u = e.charCodeAt(c);
            a = (a + 1) % i.length,
                u ^= i.charCodeAt(a),
                o += String.fromCharCode(u)
        }
        return o
    }(""), g = 0; g < o["length"];)
        i = o["charCodeAt"](g++),
            a = o["charCodeAt"](g++),
            c = o["charCodeAt"](g++),
            u = i >> 2,
            f = (i & 3) << 4 | a >> 4,
            h = (a & 15) << 2 | c >> 6,
            v = c & 63,
            isNaN(a) ? h = v = 64 : isNaN(c) && (v = 64),
            d = d + s["charAt"](u) + s["charAt"](f) + s["charAt"](h) + s["charAt"](v);
    return d
}

// ============================================================
// 每个 build 的差异（版本号 / jsv / 块 type 号 / 每块加密函数 / base64 表）
// 全部来自这份配置，由 _tools/dump_build.js 对 greenseer.js 跑一次生成。
// 换 build 时只需要重新生成 dx_config.json，本文件不用改。
// ============================================================
var CFG = (function () {
    if (typeof globalThis !== "undefined" && globalThis.__DX_CONFIG) return globalThis.__DX_CONFIG;
    try { return require("./dx_config.json"); } catch (e) { }
    throw new Error("缺少 dx_config.json：先运行 node _tools/dump_build.js <greenseer.js> dx_config.json");
})();

var s = CFG.base64;
// 字节数组 → 字符串，原始 SDK 里的 ye.toStr。别用 String()：
//   String([18,0,23]) -> "18,0,23"（8 个字符）
//   toStr([18,0,23])  -> "\x12\x00\x17"（3 个字节）
function toStr(n) {
    return String["fromCharCode"]["apply"](String, n)
}
function random(r, t) {
    return r + Math["floor"](Math["random"]() * (t - r + 1))
}

// ---- 字节序列化 ----
function bs2(n) {
    return [j(n, 8), j(n, 0)]
}
// bs4 就是 l：32 位整数 → 4 字节
function bs4(r) {
    return l(r)
}
function bs8(o) {
    var f = Math["floor"](o / Math["pow"](2, 32));
    var u = o - f * Math["pow"](2, 32);
    return l(f)["concat"](l(u))
}
function bss(r) {
    var t = [];
    if (!r)
        return t;
    for (var o = 0; o < r["length"]; o++)
        t["push"](r["charCodeAt"](o));
    return t
}
function rn(o, i, a) {
    if (!o)
        return;
    var f = 0;
    var s = o["length"];
    if (s === +s)
        for (; f < s && i["call"](a, o[f], f, o) !== false; f++);
}
function flatten(n) {
    var o = [];
    rn(n, (function (n) {
        typeof n !== "undefined" && (Array.isArray(n) ? o = o["concat"](n) : o["push"](n))
    }
    )),
        o
    return o
}

// ---- 浏览器信息（getBR 用）----
// 注意：Node 里 navigator 是全局的，读到的是 Node 自己的 UA；浏览器里读真实 UA。
function getOS() {
    var A = 0;
    var S = [[7, /Android/i], [4, /iPhone/i], [5, /iPod/i], [6, /iPad/i],
    [2, /Linux/i], [3, /Mac/i], [1, /Win/i]];
    var w = (typeof navigator !== "undefined" && navigator["platform"]) || "";
    var b = (typeof navigator !== "undefined" && navigator["userAgent"]) || "";
    rn(S, function (o) {
        if ((w || b)["match"](o[1])) {
            A = o[0];
            return false
        }
    });
    return A
}
function getBrowserAndVersion() {
    var f = 0, u = "0";
    var s = [
        [15, /(?:SogouMSE|SogouMobileBrowser)\/([\d.]+)/i],
        [6, /qqbrowser\/([\d.]+)/i],
        [7, /edge?\/([\d.]+)/i],
        [8, /360se/i],
        [9, /360ee/i],
        [13, /micromessenger\/([\d.]+)/i],
        [11, /taobrowser\/([\d.]+)/i],
        [12, /(?:ba?idubrowser|baiduhd)[\/ ]?([\d.x]+)/i],
        [14, /miuibrowser\/([\d.]+)/i],
        [2, /(?:MSIE |Trident\/.*; rv:)(\d+)/],
        [5, /opr\/([\d.]+)/i],
        [10, /uc?browser\/([\d.]+)/i],
        [10, /uc\/([\d.]+)/i],
        [1, /chrome\/([\d.]+)/i],
        [4, /version\/([\d.]+).*safari/i],
        [3, /firefox\/([\d.]+)/i]
    ];
    var b = (typeof navigator !== "undefined" && navigator["userAgent"]) || "";
    rn(s, function (n) {
        var o = b["match"](n[1]);
        if (o) {
            f = n[0];
            u = o[1] || "0";
            return false
        }
    });
    u = u["split"](".")[0];
    return [f, u]
}

// ---- 三族加密（覆盖全部 18 个块）----
//   xor   : c[i] = p[i] ^ K[i]        K 可能按周期重复，也可能是状态递推出的长流
//   chain : c[0] = p[0]^seed          c[i] = p[i]^c[i-1]
//   perm  : c[i] = table[p[i]]
function encryptBlock(spec, plain) {
    var out = "", i, c, prev;
    if (spec["family"] === "xor") {
        for (i = 0; i < plain["length"]; i++) {
            c = spec["period"]
                ? spec["key"][i % spec["period"]]
                : spec["key"][i];
            if (c === undefined) throw new Error("xor key 不够长: " + i);
            out += String["fromCharCode"]((plain["charCodeAt"](i) ^ c) & 255);
        }
    } else if (spec["family"] === "chain") {
        prev = spec["seed"];
        for (i = 0; i < plain["length"]; i++) {
            c = (plain["charCodeAt"](i) ^ prev) & 255;
            out += String["fromCharCode"](c);
            prev = c;
        }
    } else if (spec["family"] === "perm") {
        for (i = 0; i < plain["length"]; i++)
            out += String["fromCharCode"](spec["table"][plain["charCodeAt"](i)]);
    } else {
        throw new Error("未知加密族: " + spec["family"]);
    }
    return out
}

function main() {

    function process(i) {
        var a = []["slice"]["call"](arguments);
        i = a["length"] === 1 && (0, Array.isArray)(i) ? i : a;
        // 别写成 (0, flatten(i), String(i)) —— 逗号运算符会把 flatten 的结果丢掉
        i = (0, flatten)(i);
        return (0, toStr)(i)
    };
    // 用语义名开块：type 号和加密表都从配置里查
    function app(sem, i) {
        var o = CFG["types"][sem];
        if (o === undefined) throw new Error("配置里没有语义 " + sem);
        var c = (0,
            toStr)([o]["concat"]((0,
                bs2)(i["length"])));
        this["_ua"] += [c, i]["join"](""),
            this["ua"] = [CFG["version"], "#", (0,
                btoa)(this["_ua"])]["join"](""),
            this["option"]["form"] && this["syncToForm"](this["ua"])
    };
    // 直接追加一个块：语义 + 明文（不经过结构化构造）。
    // sendTemp 那种内容完全来自页面（HTML 片段）的块用这个塞。
    function appRaw(sem, plain) {
        if (CFG["types"][sem] === undefined) throw new Error("配置里没有语义 " + sem);
        this["app"](sem, encryptBlock(CFG["encrypt"][sem], plain));
    };
    function getTM() {
        var o = this["process"]((0,
            bs8)(this["tm"]));
        this["app"]("getTM", encryptBlock(CFG["encrypt"]["getTM"], o))
    };
    function getBR() {
        var o = getOS()
            , i = getBrowserAndVersion()
            , a = i[0]
            , c = i[1]
            , u = this["process"](o, a, (0,
                bs2)(c["length"]), (0,
                    bss)(c));
        this["app"]("getBR", encryptBlock(CFG["encrypt"]["getBR"], u))
    };
    // ref 传了就优先用它（本地重放时要带真实 referrer），不传才读 document.referrer
    function getLO(ref) {
        var o = (ref !== undefined) ? ref
            : ((typeof document !== "undefined" && document["referrer"]) || "")
            , i = (typeof location !== "undefined" && location["href"])
                || "https://www.dingxiang-inc.com/business/captcha";
        var a = this["process"]((0,
            bs2)(i["length"]), (0,
                bss)(i), (0,
                    bs2)(o["length"]), (0,
                        bss)(o));
        this["app"]("getLO", encryptBlock(CFG["encrypt"]["getLO"], a))
    }
    // 服务端不校验这一段切片（2026-10-20 实测：乱码 / 写死片段都能过），
    // 默认发 offset=11, len=6, 切片 "var r="。
    // 要和真机逐字节对拍时传 (offset, len, slice) 复刻真机那一次。
    function getCF(o, l, s) {
        var off = (typeof o === "number") ? o : 11;
        var len = (typeof l === "number") ? l : 6;
        var sl = (typeof s === "string") ? s : "var r=";
        var t = this["process"]((0, bs2)(off), (0, bs2)(len), (0, bss)(sl));
        this["app"]("getCF", encryptBlock(CFG["encrypt"]["getCF"], t))
    }
    // ---- 两个"自报身份"的块：直接写死值，不补环境去算 ----
    //
    // getDI 真实逻辑（deob 1254-1261）：
    //   "__IE_DEVTOOLBAR_CONSOLE_COMMAND_LINE" in window  → 4
    //   outerHeight-innerHeight > 250 且非跨域           → 8   ← 开了 devtools / 自动化窗口
    //   outerWidth -innerWidth  > 200 且非跨域           → 8
    //   否则                                             → 1   ← 正常用户
    // 注意 process 直接收数字、不包 bs2，所以这个块恒 1 字节。
    // 2026-10-22 MCP 实测（干净窗口、没开 DevTools）：
    //   outerWidth-innerWidth = 0、outerHeight-innerHeight = 87 → 两个条件都不满足 → 1
    // 所以按真实逻辑算，不再写死 8。要强制指定就 getDI(值)。
    function getDI(v) {
        var w = (typeof window !== "undefined" && window) ? window : {};
        var cross = !!(w["top"] && w["self"] && w["top"] !== w["self"]);
        var i = 1;
        if (typeof v === "number") i = v;
        else if ("__IE_DEVTOOLBAR_CONSOLE_COMMAND_LINE" in w) i = 4;
        else if (w["outerHeight"] && w["innerHeight"] && w["outerHeight"] - w["innerHeight"] > 250 && !cross) i = 8;
        else if (w["outerWidth"] && w["innerWidth"] && w["outerWidth"] - w["innerWidth"] > 200 && !cross) i = 8;
        var c = this["process"](i);
        this["app"]("getDI", encryptBlock(CFG["encrypt"]["getDI"], c))
    }
    //
    // getEM 真实逻辑（deob 1262-1296）：6 个自动化探针拼成 6 位二进制，左补 0 到 32 位再 bs4。
    //   1 window 上有没有 phantom/_phantom/callPhantom/webdriver/_Selenium_IDE_Recorder/_selenium/callSelenium
    //   2 document 上有没有 __driver_evaluate/__webdriver_evaluate/…/__webdriver_script_fn
    //   3 document.documentElement.getAttribute("selenium"|"webdriver"|"driver")
    //   4 /PhantomJS/i.test(navigator.userAgent)
    //   5 isHeadless()：navigator.webdriver、UA 含 Headless、再塞个沙箱 iframe 查 contentWindow.navigator.webdriver
    //   6 navigator/screen 的 webdriver/platform/language/languages/cookieEnabled/width/height/colorDepth
    //     是不是"自有属性"（真实浏览器里都挂在原型上，所以恒 false）
    // 干净浏览器下 6 位全 0。实测：Playwright 下会变 2 / 3 / 8 / 16。
    // 如实计算既要补一整套 window/document/navigator/screen + iframe 探针，补错还会算出错的值；
    // 而这块本来就是"自报是不是机器人"，如实算等于自己举手。所以固定发干净答案。
    function getEM() {
        var CLEAN = 0;
        var w = this["process"]((0, bs4)(CLEAN));
        this["app"]("getEM", encryptBlock(CFG["encrypt"]["getEM"], w))
    }
    function getJSV() {
        var t = this["process"]((0,
            bs4)(CFG["jsv"]));
        this["app"]("getJSV", encryptBlock(CFG["encrypt"]["getJSV"], t));
    }
    function getTK() {
        var r = this["option"]["token"];
        r && (r = this["process"]((0,
            bs2)(r["length"]), (0,
                bss)(r)),
            this["app"]("getTK", encryptBlock(CFG["encrypt"]["getTK"], r)));
    }
    // 用一条"钉死"的轨迹发 getMM 块。
    // n = { target, time_diff, PageX, PageY }
    //   target    → target.id（元素 id 字符串，没 id 传 ""）
    //   time_diff → 相对 tm 的毫秒数，直接进 bs4（真 SDK 里是 now() - tm）
    // 明文 = bs4(dt) + bs2(x) + bs2(y) + bs2(idLen) + bss(id)
    function getMM_fixed(n) {
        var target = n["target"];
        var time_diff = n["time_diff"];
        var PageX = n["PageX"];
        var PageY = n["PageY"];
        var value = this["process"]((0,
            bs4)(time_diff), (0,
                bs2)(PageX), (0,
                    bs2)(PageY), (0,
                        bs2)(target["length"]), (0,
                            bss)(target));
        this.app("getMM", encryptBlock(CFG["encrypt"]["getMM"], value));
    }
    // getSC：10 个 16 位值，顺序固定（deob 里是 Me.getScreenInfo()）
    //   screen.width, screen.height, screen.availWidth, screen.availHeight,
    //   |screenLeft|, |screenTop|, innerWidth, innerHeight, outerWidth, outerHeight
    // 不传 arr 就读当前环境；传了就发那 10 个数（本地重放/写死用）。
    function getSC(arr) {
        var V = arr;
        if (!V || V["length"] !== 10) {
            var sc = (typeof screen !== "undefined" && screen) || {};
            var w = (typeof window !== "undefined" && window) || {};
            V = [sc["width"] || 0, sc["height"] || 0,
                sc["availWidth"] || 0, sc["availHeight"] || 0,
                Math["abs"](w["screenLeft"] || w["screenX"] || 0),
                Math["abs"](w["screenTop"] || w["screenY"] || 0),
                w["innerWidth"] || 0, w["innerHeight"] || 0,
                w["outerWidth"] || 0, w["outerHeight"] || 0];
        }
        var t = this["process"](V["map"](function (v) { return (0, bs2)(v >>> 0); }));
        this["app"]("getSC", encryptBlock(CFG["encrypt"]["getSC"], t));
    }
    // getMD：按下那一刻。
    // 明文 = bs4(dt) + bs2(x) + bs2(y) + button(裸 1 字节) + bs2(idLen) + bss(id)
    // 发完如果 counters.md <= 2 还要补一个 getDI —— 真 SDK 只给前两次 mousedown。
    // n = { target, time_diff, PageX, PageY, button }
    function getMD_fixed(n) {
        var target = n["target"];
        var time_diff = n["time_diff"];
        var value = this["process"]((0,
            bs4)(time_diff), (0,
                bs2)(n["PageX"]), (0,
                    bs2)(n["PageY"]),
            n["button"], (0,
                bs2)(target["length"]), (0,
                    bss)(target));
        this["counters"]["md"] += 1;
        this["app"]("getMD", encryptBlock(CFG["encrypt"]["getMD"], value));
        if (this["counters"]["md"] <= 2) this["getDI"]();
    }
    // sendSA：拖拽轨迹。真 SDK 在 recordSA 时就把每条样本加密好塞进 _sa，
    // sendSA 只是 forEach 里逐条 app —— 所以这里也是"先加密再 app"，不要套两层。
    // list = [{ dt, x, y }, ...]
    function sendSA_fixed(list) {
        var self = this;
        for (var k = 0; k < list["length"]; k++) {
            var e = list[k];
            var s = self["process"]((0, bs4)(e["dt"]), (0, bs2)(e["x"]), (0, bs2)(e["y"]));
            self["app"]("sendSA", encryptBlock(CFG["encrypt"]["sendSA"], s));
        }
    }
    // getFO：focus / blur。明文 = bs4(dt) + flag(1字节) + bs2(idLen) + bss(id)
    // n = { time_diff, focus: 1|0, target }
    function getFO_fixed(n) {
        var target = n["target"];
        var v = this["process"]((0, bs4)(n["time_diff"]), n["focus"],
            (0, bs2)(target["length"]), (0, bss)(target));
        this["app"]("getFO", encryptBlock(CFG["encrypt"]["getFO"], v));
    }





    function init_option(token) {
        return {
            "token": token,
            "form": "",
            "inputName": "ua",
            "maxMDLog": 10,
            "maxMMLog": 20,
            "maxSALog": 250,
            "maxKDLog": 10,
            "maxFocusLog": 6,
            "maxTCLog": 10,
            "maxTMVLog": 20,
            "MMInterval": 50,
            "TMVInterval": 50
        }
    };
    function init_value(token, screenInfo, referrer, cf) {
        this.ua = "";
        this._ua = "";
        this._sa = [];
        this._ca = [];
        this.tm = Date.now();
        this.counters = {
            "sa": 0,
            "mm": 0,
            "md": 0,
            "kd": 0,
            "fo": 0,
            "tc": 0,
            "tmv": 0,
            "mmInterval": 0,
            "tmvInterval": 0
        };
        this.option = init_option(token);
        this.getTM();
        this.getBR();
        this.getLO(referrer);
        this.getCF(cf && cf[0], cf && cf[1], cf && cf[2]);
        this.getDI();
        this.getEM();
        this.getJSV();
        this.getTK();
        this.getSC(screenInfo);
        return this;
    }

    return {
        "process": process,
        "app": app,
        "appRaw": appRaw,
        "getTM": getTM,
        "getBR": getBR,
        "getLO": getLO,
        "getCF": getCF,
        "getDI": getDI,
        "getEM": getEM,
        "getJSV": getJSV,
        "getTK": getTK,
        "getMM_fixed": getMM_fixed,
        "getMD_fixed": getMD_fixed,
        "getFO_fixed": getFO_fixed,
        "sendSA_fixed": sendSA_fixed,
        "getSC": getSC,
        "init_option": init_option,
        "init_value": init_value
    }
}
var value = main().init_value("a4cdc74378b442c455900a2e19399938")
//value.init_value("a4cdc74378b442c455900a2e19399938");
if (typeof module !== "undefined" && module.exports) module.exports = value;
if (typeof require !== "undefined" && require.main === module) console.log(value);
