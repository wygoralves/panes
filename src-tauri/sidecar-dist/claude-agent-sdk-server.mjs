#!/usr/bin/env node
#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// node_modules/.pnpm/@anthropic-ai+claude-agent-sdk@0.2.69_zod@4.3.6/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs
var sdk_exports = {};
__export(sdk_exports, {
  AbortError: () => m0,
  DirectConnectError: () => D1,
  DirectConnectTransport: () => hK,
  EXIT_REASONS: () => qV,
  HOOK_EVENTS: () => VV,
  createSdkMcpServer: () => cb,
  getSessionMessages: () => zg,
  listSessions: () => Kg,
  parseDirectConnectUrl: () => db,
  query: () => Wg,
  tool: () => lb,
  unstable_v2_createSession: () => Gg,
  unstable_v2_prompt: () => Bg,
  unstable_v2_resumeSession: () => Hg
});
import { join as fK } from "path";
import { fileURLToPath as nb } from "url";
import { setMaxListeners as zV } from "events";
import { spawn as XU } from "child_process";
import { createInterface as YU } from "readline";
import { randomUUID as FV } from "crypto";
import { appendFile as OV, mkdir as NV } from "fs/promises";
import { join as l7 } from "path";
import { join as UV } from "path";
import { homedir as LV } from "os";
import * as u from "fs";
import { stat as kq, readdir as vq, readFile as R5, unlink as Tq, rmdir as xq, rm as yq, mkdir as gq, rename as hq, open as fq } from "fs/promises";
import { dirname as S5, join as C5 } from "path";
import { cwd as lq } from "process";
import { realpathSync as I5 } from "fs";
import { randomUUID as cq } from "crypto";
import { randomUUID as JU } from "crypto";
import { join as x5 } from "path";
import { fileURLToPath as WU } from "url";
import { readFile as wU, readdir as MU, stat as AU } from "fs/promises";
import { join as d5 } from "path";
import { open as f5, readdir as g5, readFile as HU, realpath as BU } from "fs/promises";
import { join as hQ } from "path";
import { execFile as OU } from "child_process";
import { promisify as NU } from "util";
import { basename as PU, join as mQ } from "path";
import { readdir as lQ } from "fs/promises";
function YV(Q) {
  return this[Q];
}
function GV(Q, X) {
  this[Q] = WV.bind(null, X);
}
function k6(Q = KV) {
  let X = new AbortController();
  return zV(Q, X.signal), X;
}
function v6() {
  return process.versions.bun !== void 0;
}
function T6() {
  return (process.env.CLAUDE_CONFIG_DIR ?? UV(LV(), ".claude")).normalize("NFC");
}
function S9(Q) {
  if (!Q) return false;
  if (typeof Q === "boolean") return Q;
  let X = Q.toLowerCase().trim();
  return ["1", "true", "yes", "on"].includes(X);
}
function DV() {
  if (x6) return x6;
  if (!process.env.DEBUG_CLAUDE_AGENT_SDK) return y6 = null, x6 = Promise.resolve(), x6;
  let Q = l7(T6(), "debug");
  return y6 = l7(Q, `sdk-${FV()}.txt`), process.stderr.write(`SDK debug logs: ${y6}
`), x6 = NV(Q, { recursive: true }).then(() => {
  }).catch(() => {
  }), x6;
}
function i0(Q) {
  if (y6 === null) return;
  let Y = `${(/* @__PURE__ */ new Date()).toISOString()} ${Q}
`;
  DV().then(() => {
    if (y6) OV(y6, Y).catch(() => {
    });
  });
}
function bV(Q) {
  var X = RV.call(Q, C9), Y = Q[C9];
  try {
    Q[C9] = void 0;
    var $ = true;
  } catch (W) {
  }
  var J = IV.call(Q);
  if ($) if (X) Q[C9] = Y;
  else delete Q[C9];
  return J;
}
function ZV(Q) {
  return PV.call(Q);
}
function _V(Q) {
  if (Q == null) return Q === void 0 ? CV : SV;
  return n7 && n7 in Object(Q) ? d7(Q) : i7(Q);
}
function kV(Q) {
  var X = typeof Q;
  return Q != null && (X == "object" || X == "function");
}
function gV(Q) {
  if (!f4(Q)) return false;
  var X = o7(Q);
  return X == TV || X == xV || X == vV || X == yV;
}
function fV(Q) {
  return !!t7 && t7 in Q;
}
function lV(Q) {
  if (Q != null) {
    try {
      return mV.call(Q);
    } catch (X) {
    }
    try {
      return Q + "";
    } catch (X) {
    }
  }
  return "";
}
function tV(Q) {
  if (!f4(Q) || a7(Q)) return false;
  var X = r7(Q) ? rV : pV;
  return X.test(s7(Q));
}
function aV(Q, X) {
  return Q == null ? void 0 : Q[X];
}
function sV(Q, X) {
  var Y = Q5(Q, X);
  return e7(Y) ? Y : void 0;
}
function Qq() {
  this.__data__ = M1 ? M1(null) : {}, this.size = 0;
}
function Xq(Q) {
  var X = this.has(Q) && delete this.__data__[Q];
  return this.size -= X ? 1 : 0, X;
}
function Wq(Q) {
  var X = this.__data__;
  if (M1) {
    var Y = X[Q];
    return Y === Yq ? void 0 : Y;
  }
  return Jq.call(X, Q) ? X[Q] : void 0;
}
function Bq(Q) {
  var X = this.__data__;
  return M1 ? X[Q] !== void 0 : Hq.call(X, Q);
}
function Kq(Q, X) {
  var Y = this.__data__;
  return this.size += this.has(Q) ? 0 : 1, Y[Q] = M1 && X === void 0 ? zq : X, this;
}
function f6(Q) {
  var X = -1, Y = Q == null ? 0 : Q.length;
  this.clear();
  while (++X < Y) {
    var $ = Q[X];
    this.set($[0], $[1]);
  }
}
function Vq() {
  this.__data__ = [], this.size = 0;
}
function qq(Q, X) {
  return Q === X || Q !== Q && X !== X;
}
function Uq(Q, X) {
  var Y = Q.length;
  while (Y--) if (H5(Q[Y][0], X)) return Y;
  return -1;
}
function Oq(Q) {
  var X = this.__data__, Y = k1(X, Q);
  if (Y < 0) return false;
  var $ = X.length - 1;
  if (Y == $) X.pop();
  else Fq.call(X, Y, 1);
  return --this.size, true;
}
function Nq(Q) {
  var X = this.__data__, Y = k1(X, Q);
  return Y < 0 ? void 0 : X[Y][1];
}
function Dq(Q) {
  return k1(this.__data__, Q) > -1;
}
function wq(Q, X) {
  var Y = this.__data__, $ = k1(Y, Q);
  if ($ < 0) ++this.size, Y.push([Q, X]);
  else Y[$][1] = X;
  return this;
}
function u6(Q) {
  var X = -1, Y = Q == null ? 0 : Q.length;
  this.clear();
  while (++X < Y) {
    var $ = Q[X];
    this.set($[0], $[1]);
  }
}
function Aq() {
  this.size = 0, this.__data__ = { hash: new kQ(), map: new (U5 || q5)(), string: new kQ() };
}
function jq(Q) {
  var X = typeof Q;
  return X == "string" || X == "number" || X == "symbol" || X == "boolean" ? Q !== "__proto__" : Q === null;
}
function Rq(Q, X) {
  var Y = Q.__data__;
  return F5(X) ? Y[typeof X == "string" ? "string" : "hash"] : Y.map;
}
function Iq(Q) {
  var X = v1(this, Q).delete(Q);
  return this.size -= X ? 1 : 0, X;
}
function bq(Q) {
  return v1(this, Q).get(Q);
}
function Eq(Q) {
  return v1(this, Q).has(Q);
}
function Pq(Q, X) {
  var Y = v1(this, Q), $ = Y.size;
  return Y.set(Q, X), this.size += Y.size == $ ? 0 : 1, this;
}
function m6(Q) {
  var X = -1, Y = Q == null ? 0 : Q.length;
  this.clear();
  while (++X < Y) {
    var $ = Q[X];
    this.set($[0], $[1]);
  }
}
function TQ(Q, X) {
  if (typeof Q != "function" || X != null && typeof X != "function") throw TypeError(Zq);
  var Y = function() {
    var $ = arguments, J = X ? X.apply(this, $) : $[0], W = Y.cache;
    if (W.has(J)) return W.get(J);
    var G = Q.apply(this, $);
    return Y.cache = W.set(J, G) || W, G;
  };
  return Y.cache = new (TQ.Cache || vQ)(), Y;
}
function Sq(Q, X) {
  if (Q.destroyed) return;
  Q.write(X);
}
function M5(Q) {
  Sq(process.stderr, Q);
}
function Cq(Q) {
  let X = [], Y = Q.match(/^MCP server ["']([^"']+)["']/);
  if (Y && Y[1]) X.push("mcp"), X.push(Y[1].toLowerCase());
  else {
    let W = Q.match(/^([^:[]+):/);
    if (W && W[1]) X.push(W[1].trim().toLowerCase());
  }
  let $ = Q.match(/^\[([^\]]+)]/);
  if ($ && $[1]) X.push($[1].trim().toLowerCase());
  if (Q.toLowerCase().includes("1p event:")) X.push("1p");
  let J = Q.match(/:\s*([^:]+?)(?:\s+(?:type|mode|status|event))?:/);
  if (J && J[1]) {
    let W = J[1].trim().toLowerCase();
    if (W.length < 30 && !W.includes(" ")) X.push(W);
  }
  return Array.from(new Set(X));
}
function _q(Q, X) {
  if (!X) return true;
  if (Q.length === 0) return false;
  if (X.isExclusive) return !Q.some((Y) => X.exclude.includes(Y));
  else return Q.some((Y) => X.include.includes(Y));
}
function j5(Q, X) {
  if (!X) return true;
  let Y = Cq(Q);
  return _q(Y, X);
}
function l6() {
  return mq;
}
function pq() {
  let Q = "";
  if (typeof process < "u" && typeof process.cwd === "function" && typeof I5 === "function") Q = I5(lq()).normalize("NFC");
  return { originalCwd: Q, projectRoot: Q, totalCostUSD: 0, totalAPIDuration: 0, totalAPIDurationWithoutRetries: 0, totalToolDuration: 0, turnHookDurationMs: 0, turnToolDurationMs: 0, turnClassifierDurationMs: 0, turnToolCount: 0, turnHookCount: 0, turnClassifierCount: 0, startTime: Date.now(), lastInteractionTime: Date.now(), totalLinesAdded: 0, totalLinesRemoved: 0, hasUnknownModelCost: false, cwd: Q, modelUsage: {}, mainLoopModelOverride: void 0, initialMainLoopModel: null, modelStrings: null, isInteractive: false, clientType: "cli", sessionSource: void 0, questionPreviewFormat: void 0, sessionIngressToken: void 0, oauthTokenFromFd: void 0, apiKeyFromFd: void 0, flagSettingsPath: void 0, flagSettingsInline: null, allowedSettingSources: ["userSettings", "projectSettings", "localSettings", "flagSettings", "policySettings"], meter: null, sessionCounter: null, locCounter: null, prCounter: null, commitCounter: null, costCounter: null, tokenCounter: null, codeEditToolDecisionCounter: null, activeTimeCounter: null, statsStore: null, sessionId: cq(), parentSessionId: void 0, loggerProvider: null, eventLogger: null, meterProvider: null, tracerProvider: null, agentColorMap: /* @__PURE__ */ new Map(), agentColorIndex: 0, lastAPIRequest: null, inMemoryErrorLog: [], inlinePlugins: [], chromeFlagOverride: void 0, useCoworkPlugins: false, sessionBypassPermissionsMode: false, scheduledTasksEnabled: false, sessionCronTasks: [], sessionTrustAccepted: false, sessionPersistenceDisabled: false, hasExitedPlanMode: false, needsPlanModeExitAttachment: false, lspRecommendationShownThisSession: false, initJsonSchema: null, registeredHooks: null, planSlugCache: /* @__PURE__ */ new Map(), teleportedSessionInfo: null, invokedSkills: /* @__PURE__ */ new Map(), slowOperations: [], sdkBetas: void 0, mainThreadAgentType: void 0, isRemoteMode: false, isInWorktree: false, ...{}, directConnectServerUrl: void 0, systemPromptSectionCache: /* @__PURE__ */ new Map(), lastEmittedDate: null, additionalDirectoriesForClaudeMd: [], sessionProjectDir: null, promptCache1hAllowlist: null, promptId: null };
}
function b5() {
  return dq.sessionId;
}
function E5({ writeFn: Q, flushIntervalMs: X = 1e3, maxBufferSize: Y = 100, maxBufferBytes: $ = 1 / 0, immediateMode: J = false }) {
  let W = [], G = 0, H = null, B = null;
  function z() {
    if (H) clearTimeout(H), H = null;
  }
  function K() {
    if (B) Q(B.join("")), B = null;
    if (W.length === 0) return;
    Q(W.join("")), W = [], G = 0, z();
  }
  function q() {
    if (!H) H = setTimeout(K, X);
  }
  function U() {
    if (B) {
      B.push(...W), W = [], G = 0, z();
      return;
    }
    let V = W;
    W = [], G = 0, z(), B = V, setImmediate(() => {
      let L = B;
      if (B = null, L) Q(L.join(""));
    });
  }
  return { write(V) {
    if (J) {
      Q(V);
      return;
    }
    if (W.push(V), G += V.length, q(), W.length >= Y || G >= $) U();
  }, flush: K, dispose() {
    K();
  } };
}
function Z5(Q) {
  return P5.add(Q), () => P5.delete(Q);
}
function oq(Q) {
  if (typeof process > "u" || typeof process.versions > "u" || typeof process.versions.node > "u") return false;
  let X = nq();
  return j5(Q, X);
}
function tq() {
  if (!l4) {
    let Q = null;
    l4 = E5({ writeFn: (X) => {
      let Y = v5(), $ = S5(Y);
      if (Q !== $) {
        try {
          l6().mkdirSync($);
        } catch {
        }
        Q = $;
      }
      l6().appendFileSync(Y, X), aq();
    }, flushIntervalMs: 1e3, maxBufferSize: 100, immediateMode: iq() }), Z5(async () => l4?.dispose());
  }
  return l4;
}
function A1(Q, { level: X } = { level: "debug" }) {
  if (!oq(Q)) return;
  if (rq && Q.includes(`
`)) Q = w0(Q);
  let $ = `${(/* @__PURE__ */ new Date()).toISOString()} [${X.toUpperCase()}] ${Q.trim()}
`;
  if (_5()) {
    M5($);
    return;
  }
  tq().write($);
}
function v5() {
  return k5() ?? process.env.CLAUDE_CODE_DEBUG_LOGS_DIR ?? C5(T6(), "debug", `${b5()}.txt`);
}
function eq() {
  return sq;
}
function w0(Q, X, Y) {
  let J = [];
  try {
    const $ = Y0(J, q0`JSON.stringify(${Q})`, 0);
    return JSON.stringify(Q, X, Y);
  } catch (W) {
    var G = W, H = 1;
  } finally {
    $0(J, G, H);
  }
}
function QU(Q) {
  let X = Q.trim();
  return X.startsWith("{") && X.endsWith("}");
}
function T5(Q, X) {
  let Y = { ...Q };
  if (X) {
    let $ = Y.settings;
    if ($ && !QU($)) throw Error("Cannot use both a settings file path and the sandbox option. Include the sandbox configuration in your settings file instead.");
    let J = { sandbox: X };
    if ($) try {
      J = { ...x1($), sandbox: X };
    } catch {
    }
    Y.settings = w0(J);
  }
  return Y;
}
function $U(Q) {
  return ![".js", ".mjs", ".tsx", ".ts", ".jsx"].some((Y) => Q.endsWith(Y));
}
function gQ(Q) {
  return new yQ(Q);
}
function y5(Q, X) {
  return new yQ({ ...X, resume: Q });
}
function p4(Q) {
  if (typeof Q !== "string") return null;
  return zU.test(Q) ? Q : null;
}
function u5(Q) {
  if (!Q.includes("\\")) return Q;
  try {
    return JSON.parse(`"${Q}"`);
  } catch {
    return Q;
  }
}
function fQ(Q, X) {
  let Y = [`"${X}":"`, `"${X}": "`];
  for (let $ of Y) {
    let J = Q.indexOf($);
    if (J < 0) continue;
    let W = J + $.length, G = W;
    while (G < Q.length) {
      if (Q[G] === "\\") {
        G += 2;
        continue;
      }
      if (Q[G] === '"') return u5(Q.slice(W, G));
      G++;
    }
  }
  return;
}
function T9(Q, X) {
  let Y = [`"${X}":"`, `"${X}": "`], $;
  for (let J of Y) {
    let W = 0;
    while (true) {
      let G = Q.indexOf(J, W);
      if (G < 0) break;
      let H = G + J.length, B = H;
      while (B < Q.length) {
        if (Q[B] === "\\") {
          B += 2;
          continue;
        }
        if (Q[B] === '"') {
          $ = u5(Q.slice(H, B));
          break;
        }
        B++;
      }
      W = B + 1;
    }
  }
  return $;
}
function m5(Q) {
  let X = 0, Y = "";
  while (X < Q.length) {
    let $ = Q.indexOf(`
`, X), J = $ >= 0 ? Q.slice(X, $) : Q.slice(X);
    if (X = $ >= 0 ? $ + 1 : Q.length, !J.includes('"type":"user"') && !J.includes('"type": "user"')) continue;
    if (J.includes('"tool_result"')) continue;
    if (J.includes('"isMeta":true') || J.includes('"isMeta": true')) continue;
    if (J.includes('"isCompactSummary":true') || J.includes('"isCompactSummary": true')) continue;
    try {
      let W = JSON.parse(J);
      if (W.type !== "user") continue;
      let G = W.message;
      if (!G) continue;
      let H = G.content, B = [];
      if (typeof H === "string") B.push(H);
      else if (Array.isArray(H)) {
        for (let z of H) if (z.type === "text" && typeof z.text === "string") B.push(z.text);
      }
      for (let z of B) {
        let K = z.replace(/\n/g, " ").trim();
        if (!K) continue;
        let q = VU.exec(K);
        if (q) {
          if (!Y) Y = q[1];
          continue;
        }
        if (KU.test(K)) continue;
        if (K.length > 200) K = K.slice(0, 200).trim() + "\u2026";
        return K;
      }
    } catch {
      continue;
    }
  }
  if (Y) return Y;
  return "";
}
async function l5(Q) {
  try {
    let X = await f5(Q, "r");
    try {
      let Y = await X.stat(), $ = Buffer.allocUnsafe(c4), J = await X.read($, 0, c4, 0);
      if (J.bytesRead === 0) return null;
      let W = $.toString("utf8", 0, J.bytesRead), G = Math.max(0, Y.size - c4), H = W;
      if (G > 0) {
        let B = await X.read($, 0, c4, G);
        H = $.toString("utf8", 0, B.bytesRead);
      }
      return { mtime: Y.mtime.getTime(), size: Y.size, head: W, tail: H };
    } finally {
      await X.close();
    }
  } catch {
    return null;
  }
}
function qU(Q) {
  let X = 0;
  for (let Y = 0; Y < Q.length; Y++) {
    let $ = Q.charCodeAt(Y);
    X = (X << 5) - X + $, X |= 0;
  }
  return Math.abs(X).toString(36);
}
function d4(Q) {
  let X = Q.replace(/[^a-zA-Z0-9]/g, "-");
  if (X.length <= c6) return X;
  let Y = typeof Bun < "u" ? Bun.hash(Q).toString(36) : qU(Q);
  return `${X.slice(0, c6)}-${Y}`;
}
function B6() {
  return hQ(T6(), "projects");
}
function UU(Q) {
  return hQ(B6(), d4(Q));
}
async function i4(Q) {
  try {
    return (await BU(Q)).normalize("NFC");
  } catch {
    return Q.normalize("NFC");
  }
}
async function z6(Q) {
  let X = UU(Q);
  try {
    return await g5(X), X;
  } catch {
    let Y = d4(Q);
    if (Y.length <= c6) return;
    let $ = Y.slice(0, c6), J = B6();
    try {
      let G = (await g5(J, { withFileTypes: true })).find((H) => H.isDirectory() && H.name.startsWith($ + "-"));
      return G ? hQ(J, G.name) : void 0;
    } catch {
      return;
    }
  }
}
function FU(Q) {
  let X = Buffer.from('"compact_boundary"'), Y = 10, $ = Q.lastIndexOf(X);
  while ($ >= 0) {
    let J = Q.lastIndexOf(10, $) + 1, W = Q.indexOf(10, $);
    if (W === -1) W = Q.length;
    let G = Q.toString("utf-8", J, W);
    try {
      let H = JSON.parse(G);
      if (H.type === "system" && H.subtype === "compact_boundary") return W + 1;
    } catch {
    }
    $ = $ > 0 ? Q.lastIndexOf(X, $ - 1) : -1;
  }
  return -1;
}
async function p5(Q, X) {
  if (X <= h5) {
    let q = await HU(Q), U = FU(q);
    if (U < 0) return { boundaryEndOffset: 0, postBoundaryBuf: q };
    return { boundaryEndOffset: U, postBoundaryBuf: Buffer.from(q.subarray(U)) };
  }
  let Y = Buffer.from('"compact_boundary"'), $ = 10, J = 1024, W = h5, G = Buffer.allocUnsafe(W), H = W, B = X, z = W, K = await f5(Q, "r");
  try {
    while (H > 0) {
      let q = Math.min(LU, H), U = H - q, V = B - q, L = U, F = q, w = V;
      while (F > 0) {
        let { bytesRead: Z } = await K.read(G, L, F, w);
        if (Z === 0) break;
        L += Z, F -= Z, w += Z;
      }
      H = U, B = V;
      let N = G.subarray(H), j = Math.min(z + J - H, N.length), R = N.subarray(0, j);
      z = H;
      let C = R.lastIndexOf(Y);
      while (C >= 0) {
        let Z = N.lastIndexOf($, C) + 1;
        if (Z === 0 && B > 0) break;
        let X0 = N.indexOf($, C);
        if (X0 === -1) X0 = N.length;
        let O0 = N.toString("utf-8", Z, X0);
        try {
          let S0 = JSON.parse(O0);
          if (S0.type === "system" && S0.subtype === "compact_boundary") return { boundaryEndOffset: B + X0 + 1, postBoundaryBuf: Buffer.from(N.subarray(X0 + 1)) };
        } catch {
        }
        C = C > 0 ? R.lastIndexOf(Y, C - 1) : -1;
      }
    }
    return null;
  } finally {
    await K.close();
  }
}
async function n4(Q) {
  try {
    let { stdout: X } = await DU("git", ["worktree", "list", "--porcelain"], { cwd: Q, timeout: 5e3 });
    if (!X) return [];
    return X.split(`
`).filter((Y) => Y.startsWith("worktree ")).map((Y) => Y.slice(9).normalize("NFC"));
  } catch {
    return [];
  }
}
async function uQ(Q, X) {
  let Y = d5(Q, X);
  try {
    let $ = (await AU(Y)).size;
    if ($ === 0) return null;
    if ($ > c5 && !S9(process.env.CLAUDE_CODE_DISABLE_PRECOMPACT_SKIP)) {
      let J = await p5(Y, $);
      if (J) return J.postBoundaryBuf;
    }
    return await wU(Y);
  } catch {
    return null;
  }
}
async function jU(Q, X) {
  let Y = `${Q}.jsonl`;
  if (X) {
    let W = await i4(X), G = await z6(W);
    if (G) {
      let B = await uQ(G, Y);
      if (B) return B;
    }
    let H;
    try {
      H = await n4(W);
    } catch {
      H = [];
    }
    for (let B of H) {
      if (B === W) continue;
      let z = await z6(B);
      if (z) {
        let K = await uQ(z, Y);
        if (K) return K;
      }
    }
    return null;
  }
  let $ = B6(), J;
  try {
    J = await MU($);
  } catch {
    return null;
  }
  for (let W of J) {
    let G = await uQ(d5($, W), Y);
    if (G) return G;
  }
  return null;
}
function RU(Q) {
  let X = [], Y = 10, $ = Q.length, J = 0;
  while (J < $) {
    let W = Q.indexOf(10, J);
    if (W === -1) W = $;
    let G = J;
    while (G < W && Q[G] <= 32) G++;
    if (J = W + 1, G >= W) continue;
    let H = Q.toString("utf-8", G, W);
    try {
      let B = x1(H), z = B.type;
      if ((z === "user" || z === "assistant" || z === "progress" || z === "system" || z === "attachment") && typeof B.uuid === "string") X.push(B);
    } catch {
    }
  }
  return X;
}
function IU(Q) {
  let X = /* @__PURE__ */ new Map();
  for (let U of Q) X.set(U.uuid, U);
  let Y = /* @__PURE__ */ new Map();
  for (let U = 0; U < Q.length; U++) Y.set(Q[U].uuid, U);
  let $ = /* @__PURE__ */ new Set();
  for (let U of Q) if (U.parentUuid) $.add(U.parentUuid);
  let J = Q.filter((U) => !$.has(U.uuid)), W = [];
  for (let U of J) {
    let V = U, L = /* @__PURE__ */ new Set();
    while (V) {
      if (L.has(V.uuid)) break;
      if (L.add(V.uuid), V.type === "user" || V.type === "assistant") {
        W.push(V);
        break;
      }
      V = V.parentUuid ? X.get(V.parentUuid) : void 0;
    }
  }
  if (W.length === 0) return [];
  let G = W.filter((U) => !U.isSidechain && !U.teamName && !U.isMeta), H = (U) => U.reduce((V, L) => (Y.get(L.uuid) ?? -1) > (Y.get(V.uuid) ?? -1) ? L : V), B = G.length > 0 ? H(G) : H(W), z = [], K = /* @__PURE__ */ new Set(), q = B;
  while (q) {
    if (K.has(q.uuid)) break;
    K.add(q.uuid), z.push(q), q = q.parentUuid ? X.get(q.parentUuid) : void 0;
  }
  return z.reverse();
}
function bU(Q) {
  if (Q.type !== "user" && Q.type !== "assistant") return false;
  if (Q.isMeta) return false;
  if (Q.isSidechain) return false;
  if (Q.teamName) return false;
  return true;
}
function EU(Q) {
  return { type: Q.type, uuid: Q.uuid, session_id: Q.sessionId, message: Q.message, parent_tool_use_id: null };
}
async function i5(Q, X) {
  if (!p4(Q)) return [];
  let Y = await jU(Q, X?.dir);
  if (!Y) return [];
  let $ = RU(Y), G = IU($).filter(bU).map(EU), H = X?.offset ?? 0;
  if (X?.limit !== void 0 && X.limit > 0) return G.slice(H, H + X.limit);
  if (H > 0) return G.slice(H);
  return G;
}
async function x9(Q, X) {
  let Y;
  try {
    Y = await lQ(Q);
  } catch {
    return [];
  }
  return (await Promise.all(Y.map(async (J) => {
    if (!J.endsWith(".jsonl")) return null;
    let W = p4(J.slice(0, -6));
    if (!W) return null;
    let G = await l5(mQ(Q, J));
    if (!G) return null;
    let { head: H, tail: B, mtime: z, size: K } = G, q = H.indexOf(`
`), U = q >= 0 ? H.slice(0, q) : H;
    if (U.includes('"isSidechain":true') || U.includes('"isSidechain": true')) return null;
    let V = T9(B, "customTitle") || void 0, L = m5(H) || void 0, F = V || T9(B, "lastPrompt") || T9(B, "summary") || L;
    if (!F) return null;
    let w = T9(B, "gitBranch") || fQ(H, "gitBranch") || void 0, N = fQ(H, "cwd") || X || void 0;
    return { sessionId: W, summary: F, lastModified: z, fileSize: K, customTitle: V, firstPrompt: L, gitBranch: w, cwd: N };
  }))).filter((J) => J !== null);
}
function n5(Q) {
  let X = /* @__PURE__ */ new Map();
  for (let Y of Q) {
    let $ = X.get(Y.sessionId);
    if (!$ || Y.lastModified > $.lastModified) X.set(Y.sessionId, Y);
  }
  return [...X.values()];
}
async function ZU(Q, X, Y = true) {
  let $ = await i4(Q), J;
  if (Y) try {
    J = await n4($);
  } catch {
    J = [];
  }
  else J = [];
  if (J.length <= 1) {
    let V = await z6($);
    if (!V) return [];
    let L = await x9(V, $);
    return y9(L, X);
  }
  let W = B6(), G = process.platform === "win32", H = J.map((V) => {
    let L = d4(V);
    return { path: V, prefix: G ? L.toLowerCase() : L };
  });
  H.sort((V, L) => L.prefix.length - V.prefix.length);
  let B;
  try {
    B = await lQ(W, { withFileTypes: true });
  } catch {
    let V = await z6($);
    if (!V) return y9([], X);
    let L = await x9(V, $);
    return y9(L, X);
  }
  let z = [], K = /* @__PURE__ */ new Set(), q = await z6($);
  if (q) {
    let V = PU(q);
    K.add(G ? V.toLowerCase() : V);
    let L = await x9(q, $);
    z.push(...L);
  }
  for (let V of B) {
    if (!V.isDirectory()) continue;
    let L = G ? V.name.toLowerCase() : V.name;
    if (K.has(L)) continue;
    for (let { path: F, prefix: w } of H) if (L === w || w.length >= c6 && L.startsWith(w + "-")) {
      K.add(L);
      let j = await x9(mQ(W, V.name), F);
      z.push(...j);
      break;
    }
  }
  let U = n5(z);
  return y9(U, X);
}
async function SU(Q) {
  let X = B6(), Y;
  try {
    Y = await lQ(X, { withFileTypes: true });
  } catch {
    return [];
  }
  let $ = Y.filter((G) => G.isDirectory()).map((G) => mQ(X, G.name)), J = await Promise.all($.map((G) => x9(G))), W = n5(J.flat());
  return y9(W, Q);
}
function y9(Q, X) {
  if (Q.sort((Y, $) => $.lastModified - Y.lastModified), X !== void 0 && X > 0) return Q.slice(0, X);
  return Q;
}
async function o5(Q) {
  let { dir: X, limit: Y, includeWorktrees: $ } = Q ?? {};
  if (X) return ZU(X, Y, $);
  return SU(Y);
}
function kU(Q) {
  r5 = Q;
}
function p6() {
  return r5;
}
function b(Q, X) {
  let Y = p6(), $ = g9({ issueData: X, data: Q.data, path: Q.path, errorMaps: [Q.common.contextualErrorMap, Q.schemaErrorMap, Y, Y === j1 ? void 0 : j1].filter((J) => !!J) });
  Q.common.issues.push($);
}
function m(Q) {
  if (!Q) return {};
  let { errorMap: X, invalid_type_error: Y, required_error: $, description: J } = Q;
  if (X && (Y || $)) throw Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  if (X) return { errorMap: X, description: J };
  return { errorMap: (G, H) => {
    let { message: B } = Q;
    if (G.code === "invalid_enum_value") return { message: B ?? H.defaultError };
    if (typeof H.data > "u") return { message: B ?? $ ?? H.defaultError };
    if (G.code !== "invalid_type") return { message: H.defaultError };
    return { message: B ?? Y ?? H.defaultError };
  }, description: J };
}
function e5(Q) {
  let X = "[0-5]\\d";
  if (Q.precision) X = `${X}\\.\\d{${Q.precision}}`;
  else if (Q.precision == null) X = `${X}(\\.\\d+)?`;
  let Y = Q.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${X})${Y}`;
}
function tU(Q) {
  return new RegExp(`^${e5(Q)}$`);
}
function QJ(Q) {
  let X = `${s5}T${e5(Q)}`, Y = [];
  if (Y.push(Q.local ? "Z?" : "Z"), Q.offset) Y.push("([+-]\\d{2}:?\\d{2})");
  return X = `${X}(${Y.join("|")})`, new RegExp(`^${X}$`);
}
function aU(Q, X) {
  if ((X === "v4" || !X) && cU.test(Q)) return true;
  if ((X === "v6" || !X) && dU.test(Q)) return true;
  return false;
}
function sU(Q, X) {
  if (!fU.test(Q)) return false;
  try {
    let [Y] = Q.split(".");
    if (!Y) return false;
    let $ = Y.replace(/-/g, "+").replace(/_/g, "/").padEnd(Y.length + (4 - Y.length % 4) % 4, "="), J = JSON.parse(atob($));
    if (typeof J !== "object" || J === null) return false;
    if ("typ" in J && J?.typ !== "JWT") return false;
    if (!J.alg) return false;
    if (X && J.alg !== X) return false;
    return true;
  } catch {
    return false;
  }
}
function eU(Q, X) {
  if ((X === "v4" || !X) && pU.test(Q)) return true;
  if ((X === "v6" || !X) && iU.test(Q)) return true;
  return false;
}
function QL(Q, X) {
  let Y = (Q.toString().split(".")[1] || "").length, $ = (X.toString().split(".")[1] || "").length, J = Y > $ ? Y : $, W = Number.parseInt(Q.toFixed(J).replace(".", "")), G = Number.parseInt(X.toFixed(J).replace(".", ""));
  return W % G / 10 ** J;
}
function i6(Q) {
  if (Q instanceof U0) {
    let X = {};
    for (let Y in Q.shape) {
      let $ = Q.shape[Y];
      X[Y] = l0.create(i6($));
    }
    return new U0({ ...Q._def, shape: () => X });
  } else if (Q instanceof e0) return new e0({ ...Q._def, type: i6(Q.element) });
  else if (Q instanceof l0) return l0.create(i6(Q.unwrap()));
  else if (Q instanceof I1) return I1.create(i6(Q.unwrap()));
  else if (Q instanceof U1) return U1.create(Q.items.map((X) => i6(X)));
  else return Q;
}
function dQ(Q, X) {
  let Y = V1(Q), $ = V1(X);
  if (Q === X) return { valid: true, data: Q };
  else if (Y === I.object && $ === I.object) {
    let J = d.objectKeys(X), W = d.objectKeys(Q).filter((H) => J.indexOf(H) !== -1), G = { ...Q, ...X };
    for (let H of W) {
      let B = dQ(Q[H], X[H]);
      if (!B.valid) return { valid: false };
      G[H] = B.data;
    }
    return { valid: true, data: G };
  } else if (Y === I.array && $ === I.array) {
    if (Q.length !== X.length) return { valid: false };
    let J = [];
    for (let W = 0; W < Q.length; W++) {
      let G = Q[W], H = X[W], B = dQ(G, H);
      if (!B.valid) return { valid: false };
      J.push(B.data);
    }
    return { valid: true, data: J };
  } else if (Y === I.date && $ === I.date && +Q === +X) return { valid: true, data: Q };
  else return { valid: false };
}
function XJ(Q, X) {
  return new u1({ values: Q, typeName: A.ZodEnum, ...m(X) });
}
function a5(Q, X) {
  let Y = typeof Q === "function" ? Q(X) : typeof Q === "string" ? { message: Q } : Q;
  return typeof Y === "string" ? { message: Y } : Y;
}
function YJ(Q, X = {}, Y) {
  if (Q) return q6.create().superRefine(($, J) => {
    let W = Q($);
    if (W instanceof Promise) return W.then((G) => {
      if (!G) {
        let H = a5(X, $), B = H.fatal ?? Y ?? true;
        J.addIssue({ code: "custom", ...H, fatal: B });
      }
    });
    if (!W) {
      let G = a5(X, $), H = G.fatal ?? Y ?? true;
      J.addIssue({ code: "custom", ...G, fatal: H });
    }
    return;
  });
  return q6.create();
}
function D(Q, X, Y) {
  function $(H, B) {
    var z;
    Object.defineProperty(H, "_zod", { value: H._zod ?? {}, enumerable: false }), (z = H._zod).traits ?? (z.traits = /* @__PURE__ */ new Set()), H._zod.traits.add(Q), X(H, B);
    for (let K in G.prototype) if (!(K in H)) Object.defineProperty(H, K, { value: G.prototype[K].bind(H) });
    H._zod.constr = G, H._zod.def = B;
  }
  let J = Y?.Parent ?? Object;
  class W extends J {
  }
  Object.defineProperty(W, "name", { value: Q });
  function G(H) {
    var B;
    let z = Y?.Parent ? new W() : this;
    $(z, H), (B = z._zod).deferred ?? (B.deferred = []);
    for (let K of z._zod.deferred) K();
    return z;
  }
  return Object.defineProperty(G, "init", { value: $ }), Object.defineProperty(G, Symbol.hasInstance, { value: (H) => {
    if (Y?.Parent && H instanceof Y.Parent) return true;
    return H?._zod?.traits?.has(Q);
  } }), Object.defineProperty(G, "name", { value: Q }), G;
}
function c0(Q) {
  if (Q) Object.assign(s4, Q);
  return s4;
}
function mL(Q) {
  return Q;
}
function lL(Q) {
  return Q;
}
function cL(Q) {
}
function pL(Q) {
  throw Error();
}
function dL(Q) {
}
function d9(Q) {
  let X = Object.values(Q).filter(($) => typeof $ === "number");
  return Object.entries(Q).filter(([$, J]) => X.indexOf(+$) === -1).map(([$, J]) => J);
}
function e4(Q, X = "|") {
  return Q.map((Y) => X8(Y)).join(X);
}
function oQ(Q, X) {
  if (typeof X === "bigint") return X.toString();
  return X;
}
function i9(Q) {
  return { get value() {
    {
      let Y = Q();
      return Object.defineProperty(this, "value", { value: Y }), Y;
    }
    throw Error("cached value already set");
  } };
}
function n9(Q) {
  return Q === null || Q === void 0;
}
function o9(Q) {
  let X = Q.startsWith("^") ? 1 : 0, Y = Q.endsWith("$") ? Q.length - 1 : Q.length;
  return Q.slice(X, Y);
}
function rQ(Q, X) {
  let Y = (Q.toString().split(".")[1] || "").length, $ = (X.toString().split(".")[1] || "").length, J = Y > $ ? Y : $, W = Number.parseInt(Q.toFixed(J).replace(".", "")), G = Number.parseInt(X.toFixed(J).replace(".", ""));
  return W % G / 10 ** J;
}
function J0(Q, X, Y) {
  Object.defineProperty(Q, X, { get() {
    {
      let J = Y();
      return Q[X] = J, J;
    }
    throw Error("cached value already set");
  }, set(J) {
    Object.defineProperty(Q, X, { value: J });
  }, configurable: true });
}
function tQ(Q, X, Y) {
  Object.defineProperty(Q, X, { value: Y, writable: true, enumerable: true, configurable: true });
}
function iL(Q, X) {
  if (!X) return Q;
  return X.reduce((Y, $) => Y?.[$], Q);
}
function nL(Q) {
  let X = Object.keys(Q), Y = X.map(($) => Q[$]);
  return Promise.all(Y).then(($) => {
    let J = {};
    for (let W = 0; W < X.length; W++) J[X[W]] = $[W];
    return J;
  });
}
function oL(Q = 10) {
  let Y = "";
  for (let $ = 0; $ < Q; $++) Y += "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)];
  return Y;
}
function F6(Q) {
  return JSON.stringify(Q);
}
function W9(Q) {
  return typeof Q === "object" && Q !== null && !Array.isArray(Q);
}
function G9(Q) {
  if (W9(Q) === false) return false;
  let X = Q.constructor;
  if (X === void 0) return true;
  let Y = X.prototype;
  if (W9(Y) === false) return false;
  if (Object.prototype.hasOwnProperty.call(Y, "isPrototypeOf") === false) return false;
  return true;
}
function rL(Q) {
  let X = 0;
  for (let Y in Q) if (Object.prototype.hasOwnProperty.call(Q, Y)) X++;
  return X;
}
function c1(Q) {
  return Q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function p0(Q, X, Y) {
  let $ = new Q._zod.constr(X ?? Q._zod.def);
  if (!X || Y?.parent) $._zod.parent = Q;
  return $;
}
function y(Q) {
  let X = Q;
  if (!X) return {};
  if (typeof X === "string") return { error: () => X };
  if (X?.message !== void 0) {
    if (X?.error !== void 0) throw Error("Cannot specify both `message` and `error` params");
    X.error = X.message;
  }
  if (delete X.message, typeof X.error === "string") return { ...X, error: () => X.error };
  return X;
}
function aL(Q) {
  let X;
  return new Proxy({}, { get(Y, $, J) {
    return X ?? (X = Q()), Reflect.get(X, $, J);
  }, set(Y, $, J, W) {
    return X ?? (X = Q()), Reflect.set(X, $, J, W);
  }, has(Y, $) {
    return X ?? (X = Q()), Reflect.has(X, $);
  }, deleteProperty(Y, $) {
    return X ?? (X = Q()), Reflect.deleteProperty(X, $);
  }, ownKeys(Y) {
    return X ?? (X = Q()), Reflect.ownKeys(X);
  }, getOwnPropertyDescriptor(Y, $) {
    return X ?? (X = Q()), Reflect.getOwnPropertyDescriptor(X, $);
  }, defineProperty(Y, $, J) {
    return X ?? (X = Q()), Reflect.defineProperty(X, $, J);
  } });
}
function X8(Q) {
  if (typeof Q === "bigint") return Q.toString() + "n";
  if (typeof Q === "string") return `"${Q}"`;
  return `${Q}`;
}
function eQ(Q) {
  return Object.keys(Q).filter((X) => {
    return Q[X]._zod.optin === "optional" && Q[X]._zod.optout === "optional";
  });
}
function sL(Q, X) {
  let Y = {}, $ = Q._zod.def;
  for (let J in X) {
    if (!(J in $.shape)) throw Error(`Unrecognized key: "${J}"`);
    if (!X[J]) continue;
    Y[J] = $.shape[J];
  }
  return p0(Q, { ...Q._zod.def, shape: Y, checks: [] });
}
function eL(Q, X) {
  let Y = { ...Q._zod.def.shape }, $ = Q._zod.def;
  for (let J in X) {
    if (!(J in $.shape)) throw Error(`Unrecognized key: "${J}"`);
    if (!X[J]) continue;
    delete Y[J];
  }
  return p0(Q, { ...Q._zod.def, shape: Y, checks: [] });
}
function QF(Q, X) {
  if (!G9(X)) throw Error("Invalid input to extend: expected a plain object");
  let Y = { ...Q._zod.def, get shape() {
    let $ = { ...Q._zod.def.shape, ...X };
    return tQ(this, "shape", $), $;
  }, checks: [] };
  return p0(Q, Y);
}
function XF(Q, X) {
  return p0(Q, { ...Q._zod.def, get shape() {
    let Y = { ...Q._zod.def.shape, ...X._zod.def.shape };
    return tQ(this, "shape", Y), Y;
  }, catchall: X._zod.def.catchall, checks: [] });
}
function YF(Q, X, Y) {
  let $ = X._zod.def.shape, J = { ...$ };
  if (Y) for (let W in Y) {
    if (!(W in $)) throw Error(`Unrecognized key: "${W}"`);
    if (!Y[W]) continue;
    J[W] = Q ? new Q({ type: "optional", innerType: $[W] }) : $[W];
  }
  else for (let W in $) J[W] = Q ? new Q({ type: "optional", innerType: $[W] }) : $[W];
  return p0(X, { ...X._zod.def, shape: J, checks: [] });
}
function $F(Q, X, Y) {
  let $ = X._zod.def.shape, J = { ...$ };
  if (Y) for (let W in Y) {
    if (!(W in J)) throw Error(`Unrecognized key: "${W}"`);
    if (!Y[W]) continue;
    J[W] = new Q({ type: "nonoptional", innerType: $[W] });
  }
  else for (let W in $) J[W] = new Q({ type: "nonoptional", innerType: $[W] });
  return p0(X, { ...X._zod.def, shape: J, checks: [] });
}
function O6(Q, X = 0) {
  for (let Y = X; Y < Q.issues.length; Y++) if (Q.issues[Y]?.continue !== true) return true;
  return false;
}
function L1(Q, X) {
  return X.map((Y) => {
    var $;
    return ($ = Y).path ?? ($.path = []), Y.path.unshift(Q), Y;
  });
}
function p9(Q) {
  return typeof Q === "string" ? Q : Q?.message;
}
function Y1(Q, X, Y) {
  let $ = { ...Q, path: Q.path ?? [] };
  if (!Q.message) {
    let J = p9(Q.inst?._zod.def?.error?.(Q)) ?? p9(X?.error?.(Q)) ?? p9(Y.customError?.(Q)) ?? p9(Y.localeError?.(Q)) ?? "Invalid input";
    $.message = J;
  }
  if (delete $.inst, delete $.continue, !X?.reportInput) delete $.input;
  return $;
}
function BJ(Q) {
  if (Q instanceof Set) return "set";
  if (Q instanceof Map) return "map";
  if (Q instanceof File) return "file";
  return "unknown";
}
function r9(Q) {
  if (Array.isArray(Q)) return "array";
  if (typeof Q === "string") return "string";
  return "unknown";
}
function XX(...Q) {
  let [X, Y, $] = Q;
  if (typeof X === "string") return { message: X, code: "custom", input: Y, inst: $ };
  return { ...X };
}
function JF(Q) {
  return Object.entries(Q).filter(([X, Y]) => {
    return Number.isNaN(Number.parseInt(X, 10));
  }).map((X) => X[1]);
}
function YX(Q, X = (Y) => Y.message) {
  let Y = {}, $ = [];
  for (let J of Q.issues) if (J.path.length > 0) Y[J.path[0]] = Y[J.path[0]] || [], Y[J.path[0]].push(X(J));
  else $.push(X(J));
  return { formErrors: $, fieldErrors: Y };
}
function $X(Q, X) {
  let Y = X || function(W) {
    return W.message;
  }, $ = { _errors: [] }, J = (W) => {
    for (let G of W.issues) if (G.code === "invalid_union" && G.errors.length) G.errors.map((H) => J({ issues: H }));
    else if (G.code === "invalid_key") J({ issues: G.issues });
    else if (G.code === "invalid_element") J({ issues: G.issues });
    else if (G.path.length === 0) $._errors.push(Y(G));
    else {
      let H = $, B = 0;
      while (B < G.path.length) {
        let z = G.path[B];
        if (B !== G.path.length - 1) H[z] = H[z] || { _errors: [] };
        else H[z] = H[z] || { _errors: [] }, H[z]._errors.push(Y(G));
        H = H[z], B++;
      }
    }
  };
  return J(Q), $;
}
function MJ() {
  return new RegExp("^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$", "u");
}
function CJ(Q) {
  return typeof Q.precision === "number" ? Q.precision === -1 ? "(?:[01]\\d|2[0-3]):[0-5]\\d" : Q.precision === 0 ? "(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d" : `(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d\\.\\d{${Q.precision}}` : "(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?";
}
function _J(Q) {
  return new RegExp(`^${CJ(Q)}$`);
}
function kJ(Q) {
  let X = CJ({ precision: Q.precision }), Y = ["Z"];
  if (Q.local) Y.push("");
  if (Q.offset) Y.push("([+-]\\d{2}:\\d{2})");
  let $ = `${X}(?:${Y.join("|")})`;
  return new RegExp(`^${ZJ}T(?:${$})$`);
}
function LW(Q) {
  if (Q === "") return true;
  if (Q.length % 4 !== 0) return false;
  try {
    return atob(Q), true;
  } catch {
    return false;
  }
}
function GF(Q) {
  if (!VX.test(Q)) return false;
  let X = Q.replace(/[-_]/g, ($) => $ === "-" ? "+" : "/"), Y = X.padEnd(Math.ceil(X.length / 4) * 4, "=");
  return LW(Y);
}
function HF(Q, X = null) {
  try {
    let Y = Q.split(".");
    if (Y.length !== 3) return false;
    let [$] = Y;
    if (!$) return false;
    let J = JSON.parse(atob($));
    if ("typ" in J && J?.typ !== "JWT") return false;
    if (!J.alg) return false;
    if (X && (!("alg" in J) || J.alg !== X)) return false;
    return true;
  } catch {
    return false;
  }
}
function XW(Q, X, Y) {
  if (Q.issues.length) X.issues.push(...L1(Y, Q.issues));
  X.value[Y] = Q.value;
}
function J8(Q, X, Y) {
  if (Q.issues.length) X.issues.push(...L1(Y, Q.issues));
  X.value[Y] = Q.value;
}
function YW(Q, X, Y, $) {
  if (Q.issues.length) if ($[Y] === void 0) if (Y in $) X.value[Y] = void 0;
  else X.value[Y] = Q.value;
  else X.issues.push(...L1(Y, Q.issues));
  else if (Q.value === void 0) {
    if (Y in $) X.value[Y] = void 0;
  } else X.value[Y] = Q.value;
}
function $W(Q, X, Y, $) {
  for (let J of Q) if (J.issues.length === 0) return X.value = J.value, X;
  return X.issues.push({ code: "invalid_union", input: X.value, inst: Y, errors: Q.map((J) => J.issues.map((W) => Y1(W, $, c0()))) }), X;
}
function FX(Q, X) {
  if (Q === X) return { valid: true, data: Q };
  if (Q instanceof Date && X instanceof Date && +Q === +X) return { valid: true, data: Q };
  if (G9(Q) && G9(X)) {
    let Y = Object.keys(X), $ = Object.keys(Q).filter((W) => Y.indexOf(W) !== -1), J = { ...Q, ...X };
    for (let W of $) {
      let G = FX(Q[W], X[W]);
      if (!G.valid) return { valid: false, mergeErrorPath: [W, ...G.mergeErrorPath] };
      J[W] = G.data;
    }
    return { valid: true, data: J };
  }
  if (Array.isArray(Q) && Array.isArray(X)) {
    if (Q.length !== X.length) return { valid: false, mergeErrorPath: [] };
    let Y = [];
    for (let $ = 0; $ < Q.length; $++) {
      let J = Q[$], W = X[$], G = FX(J, W);
      if (!G.valid) return { valid: false, mergeErrorPath: [$, ...G.mergeErrorPath] };
      Y.push(G.data);
    }
    return { valid: true, data: Y };
  }
  return { valid: false, mergeErrorPath: [] };
}
function JW(Q, X, Y) {
  if (X.issues.length) Q.issues.push(...X.issues);
  if (Y.issues.length) Q.issues.push(...Y.issues);
  if (O6(Q)) return Q;
  let $ = FX(X.value, Y.value);
  if (!$.valid) throw Error(`Unmergable intersection. Error path: ${JSON.stringify($.mergeErrorPath)}`);
  return Q.value = $.data, Q;
}
function WW(Q, X) {
  if (Q.value === void 0) Q.value = X.defaultValue;
  return Q;
}
function GW(Q, X) {
  if (!Q.issues.length && Q.value === void 0) Q.issues.push({ code: "invalid_type", expected: "nonoptional", input: Q.value, inst: X });
  return Q;
}
function HW(Q, X, Y) {
  if (O6(Q)) return Q;
  return X.out._zod.run({ value: Q.value, issues: Q.issues }, Y);
}
function BW(Q) {
  return Q.value = Object.freeze(Q.value), Q;
}
function zW(Q, X, Y, $) {
  if (!Q) {
    let J = { code: "custom", input: Y, inst: $, path: [...$._zod.def.path ?? []], continue: !$._zod.def.abort };
    if ($._zod.def.params) J.params = $._zod.def.params;
    X.issues.push(XX(J));
  }
}
function YY() {
  return { localeError: zF() };
}
function FW() {
  return new B8();
}
function $Y(Q, X) {
  return new Q({ type: "string", ...y(X) });
}
function JY(Q, X) {
  return new Q({ type: "string", format: "email", check: "string_format", abort: false, ...y(X) });
}
function z8(Q, X) {
  return new Q({ type: "string", format: "guid", check: "string_format", abort: false, ...y(X) });
}
function WY(Q, X) {
  return new Q({ type: "string", format: "uuid", check: "string_format", abort: false, ...y(X) });
}
function GY(Q, X) {
  return new Q({ type: "string", format: "uuid", check: "string_format", abort: false, version: "v4", ...y(X) });
}
function HY(Q, X) {
  return new Q({ type: "string", format: "uuid", check: "string_format", abort: false, version: "v6", ...y(X) });
}
function BY(Q, X) {
  return new Q({ type: "string", format: "uuid", check: "string_format", abort: false, version: "v7", ...y(X) });
}
function zY(Q, X) {
  return new Q({ type: "string", format: "url", check: "string_format", abort: false, ...y(X) });
}
function KY(Q, X) {
  return new Q({ type: "string", format: "emoji", check: "string_format", abort: false, ...y(X) });
}
function VY(Q, X) {
  return new Q({ type: "string", format: "nanoid", check: "string_format", abort: false, ...y(X) });
}
function qY(Q, X) {
  return new Q({ type: "string", format: "cuid", check: "string_format", abort: false, ...y(X) });
}
function UY(Q, X) {
  return new Q({ type: "string", format: "cuid2", check: "string_format", abort: false, ...y(X) });
}
function LY(Q, X) {
  return new Q({ type: "string", format: "ulid", check: "string_format", abort: false, ...y(X) });
}
function FY(Q, X) {
  return new Q({ type: "string", format: "xid", check: "string_format", abort: false, ...y(X) });
}
function OY(Q, X) {
  return new Q({ type: "string", format: "ksuid", check: "string_format", abort: false, ...y(X) });
}
function NY(Q, X) {
  return new Q({ type: "string", format: "ipv4", check: "string_format", abort: false, ...y(X) });
}
function DY(Q, X) {
  return new Q({ type: "string", format: "ipv6", check: "string_format", abort: false, ...y(X) });
}
function wY(Q, X) {
  return new Q({ type: "string", format: "cidrv4", check: "string_format", abort: false, ...y(X) });
}
function MY(Q, X) {
  return new Q({ type: "string", format: "cidrv6", check: "string_format", abort: false, ...y(X) });
}
function AY(Q, X) {
  return new Q({ type: "string", format: "base64", check: "string_format", abort: false, ...y(X) });
}
function jY(Q, X) {
  return new Q({ type: "string", format: "base64url", check: "string_format", abort: false, ...y(X) });
}
function RY(Q, X) {
  return new Q({ type: "string", format: "e164", check: "string_format", abort: false, ...y(X) });
}
function IY(Q, X) {
  return new Q({ type: "string", format: "jwt", check: "string_format", abort: false, ...y(X) });
}
function OW(Q, X) {
  return new Q({ type: "string", format: "datetime", check: "string_format", offset: false, local: false, precision: null, ...y(X) });
}
function NW(Q, X) {
  return new Q({ type: "string", format: "date", check: "string_format", ...y(X) });
}
function DW(Q, X) {
  return new Q({ type: "string", format: "time", check: "string_format", precision: null, ...y(X) });
}
function wW(Q, X) {
  return new Q({ type: "string", format: "duration", check: "string_format", ...y(X) });
}
function bY(Q, X) {
  return new Q({ type: "number", checks: [], ...y(X) });
}
function EY(Q, X) {
  return new Q({ type: "number", check: "number_format", abort: false, format: "safeint", ...y(X) });
}
function PY(Q, X) {
  return new Q({ type: "boolean", ...y(X) });
}
function ZY(Q, X) {
  return new Q({ type: "null", ...y(X) });
}
function SY(Q) {
  return new Q({ type: "unknown" });
}
function CY(Q, X) {
  return new Q({ type: "never", ...y(X) });
}
function K8(Q, X) {
  return new qX({ check: "less_than", ...y(X), value: Q, inclusive: false });
}
function e9(Q, X) {
  return new qX({ check: "less_than", ...y(X), value: Q, inclusive: true });
}
function V8(Q, X) {
  return new UX({ check: "greater_than", ...y(X), value: Q, inclusive: false });
}
function Q4(Q, X) {
  return new UX({ check: "greater_than", ...y(X), value: Q, inclusive: true });
}
function q8(Q, X) {
  return new mJ({ check: "multiple_of", ...y(X), value: Q });
}
function U8(Q, X) {
  return new cJ({ check: "max_length", ...y(X), maximum: Q });
}
function H9(Q, X) {
  return new pJ({ check: "min_length", ...y(X), minimum: Q });
}
function L8(Q, X) {
  return new dJ({ check: "length_equals", ...y(X), length: Q });
}
function _Y(Q, X) {
  return new iJ({ check: "string_format", format: "regex", ...y(X), pattern: Q });
}
function kY(Q) {
  return new nJ({ check: "string_format", format: "lowercase", ...y(Q) });
}
function vY(Q) {
  return new oJ({ check: "string_format", format: "uppercase", ...y(Q) });
}
function TY(Q, X) {
  return new rJ({ check: "string_format", format: "includes", ...y(X), includes: Q });
}
function xY(Q, X) {
  return new tJ({ check: "string_format", format: "starts_with", ...y(X), prefix: Q });
}
function yY(Q, X) {
  return new aJ({ check: "string_format", format: "ends_with", ...y(X), suffix: Q });
}
function w6(Q) {
  return new sJ({ check: "overwrite", tx: Q });
}
function gY(Q) {
  return w6((X) => X.normalize(Q));
}
function hY() {
  return w6((Q) => Q.trim());
}
function fY() {
  return w6((Q) => Q.toLowerCase());
}
function uY() {
  return w6((Q) => Q.toUpperCase());
}
function MW(Q, X, Y) {
  return new Q({ type: "array", element: X, ...y(Y) });
}
function mY(Q, X, Y) {
  let $ = y(Y);
  return $.abort ?? ($.abort = true), new Q({ type: "custom", check: "custom", fn: X, ...$ });
}
function lY(Q, X, Y) {
  return new Q({ type: "custom", check: "custom", fn: X, ...y(Y) });
}
function pY(Q, X) {
  if (Q instanceof B8) {
    let $ = new cY(X), J = {};
    for (let H of Q._idmap.entries()) {
      let [B, z] = H;
      $.process(z);
    }
    let W = {}, G = { registry: Q, uri: X?.uri || ((H) => H), defs: J };
    for (let H of Q._idmap.entries()) {
      let [B, z] = H;
      W[B] = $.emit(z, { ...X, external: G });
    }
    if (Object.keys(J).length > 0) {
      let H = $.target === "draft-2020-12" ? "$defs" : "definitions";
      W.__shared = { [H]: J };
    }
    return { schemas: W };
  }
  let Y = new cY(X);
  return Y.process(Q), Y.emit(Q, X);
}
function D0(Q, X) {
  let Y = X ?? { seen: /* @__PURE__ */ new Set() };
  if (Y.seen.has(Q)) return false;
  Y.seen.add(Q);
  let J = Q._zod.def;
  switch (J.type) {
    case "string":
    case "number":
    case "bigint":
    case "boolean":
    case "date":
    case "symbol":
    case "undefined":
    case "null":
    case "any":
    case "unknown":
    case "never":
    case "void":
    case "literal":
    case "enum":
    case "nan":
    case "file":
    case "template_literal":
      return false;
    case "array":
      return D0(J.element, Y);
    case "object": {
      for (let W in J.shape) if (D0(J.shape[W], Y)) return true;
      return false;
    }
    case "union": {
      for (let W of J.options) if (D0(W, Y)) return true;
      return false;
    }
    case "intersection":
      return D0(J.left, Y) || D0(J.right, Y);
    case "tuple": {
      for (let W of J.items) if (D0(W, Y)) return true;
      if (J.rest && D0(J.rest, Y)) return true;
      return false;
    }
    case "record":
      return D0(J.keyType, Y) || D0(J.valueType, Y);
    case "map":
      return D0(J.keyType, Y) || D0(J.valueType, Y);
    case "set":
      return D0(J.valueType, Y);
    case "promise":
    case "optional":
    case "nonoptional":
    case "nullable":
    case "readonly":
      return D0(J.innerType, Y);
    case "lazy":
      return D0(J.getter(), Y);
    case "default":
      return D0(J.innerType, Y);
    case "prefault":
      return D0(J.innerType, Y);
    case "custom":
      return false;
    case "transform":
      return true;
    case "pipe":
      return D0(J.in, Y) || D0(J.out, Y);
    case "success":
      return false;
    case "catch":
      return false;
    default:
  }
  throw Error(`Unknown schema type: ${J.type}`);
}
function dY(Q, X) {
  let Y = { type: "object", get shape() {
    return i.assignProp(this, "shape", { ...Q }), this.shape;
  }, ...i.normalizeParams(X) };
  return new nF(Y);
}
function n0(Q) {
  return !!Q._zod;
}
function A6(Q) {
  let X = Object.values(Q);
  if (X.length === 0) return dY({});
  let Y = X.every(n0), $ = X.every((J) => !n0(J));
  if (Y) return dY(Q);
  if ($) return iQ(Q);
  throw Error("Mixed Zod versions detected in object shape.");
}
function d1(Q, X) {
  if (n0(Q)) return N6(Q, X);
  return Q.safeParse(X);
}
async function F8(Q, X) {
  if (n0(Q)) return await D6(Q, X);
  return await Q.safeParseAsync(X);
}
function i1(Q) {
  if (!Q) return;
  let X;
  if (n0(Q)) X = Q._zod?.def?.shape;
  else X = Q.shape;
  if (!X) return;
  if (typeof X === "function") try {
    return X();
  } catch {
    return;
  }
  return X;
}
function B9(Q) {
  if (!Q) return;
  if (typeof Q === "object") {
    let X = Q, Y = Q;
    if (!X._def && !Y._zod) {
      let $ = Object.values(Q);
      if ($.length > 0 && $.every((J) => typeof J === "object" && J !== null && (J._def !== void 0 || J._zod !== void 0 || typeof J.parse === "function"))) return A6(Q);
    }
  }
  if (n0(Q)) {
    let Y = Q._zod?.def;
    if (Y && (Y.type === "object" || Y.shape !== void 0)) return Q;
  } else if (Q.shape !== void 0) return Q;
  return;
}
function O8(Q) {
  if (Q && typeof Q === "object") {
    if ("message" in Q && typeof Q.message === "string") return Q.message;
    if ("issues" in Q && Array.isArray(Q.issues) && Q.issues.length > 0) {
      let X = Q.issues[0];
      if (X && typeof X === "object" && "message" in X) return String(X.message);
    }
    try {
      return JSON.stringify(Q);
    } catch {
      return String(Q);
    }
  }
  return String(Q);
}
function jW(Q) {
  return Q.description;
}
function RW(Q) {
  if (n0(Q)) return Q._zod?.def?.type === "optional";
  let X = Q;
  if (typeof Q.isOptional === "function") return Q.isOptional();
  return X._def?.typeName === "ZodOptional";
}
function N8(Q) {
  if (n0(Q)) {
    let W = Q._zod?.def;
    if (W) {
      if (W.value !== void 0) return W.value;
      if (Array.isArray(W.values) && W.values.length > 0) return W.values[0];
    }
  }
  let Y = Q._def;
  if (Y) {
    if (Y.value !== void 0) return Y.value;
    if (Array.isArray(Y.values) && Y.values.length > 0) return Y.values[0];
  }
  let $ = Q.value;
  if ($ !== void 0) return $;
  return;
}
function iY(Q) {
  return OW(IW, Q);
}
function nY(Q) {
  return NW(bW, Q);
}
function oY(Q) {
  return DW(EW, Q);
}
function rY(Q) {
  return wW(PW, Q);
}
function O(Q) {
  return $Y(YO, Q);
}
function s(Q) {
  return bY(gW, Q);
}
function TW(Q) {
  return EY(MO, Q);
}
function M0(Q) {
  return PY(AO, Q);
}
function sY(Q) {
  return ZY(jO, Q);
}
function z0() {
  return SY(RO);
}
function bO(Q) {
  return CY(IO, Q);
}
function n(Q, X) {
  return MW(EO, Q, X);
}
function P(Q, X) {
  let Y = { type: "object", get shape() {
    return i.assignProp(this, "shape", { ...Q }), this.shape;
  }, ...i.normalizeParams(X) };
  return new hW(Y);
}
function _0(Q, X) {
  return new hW({ type: "object", get shape() {
    return i.assignProp(this, "shape", { ...Q }), this.shape;
  }, catchall: z0(), ...i.normalizeParams(X) });
}
function G0(Q, X) {
  return new fW({ type: "union", options: Q, ...i.normalizeParams(X) });
}
function eY(Q, X, Y) {
  return new PO({ type: "union", options: X, discriminator: Q, ...i.normalizeParams(Y) });
}
function w8(Q, X) {
  return new ZO({ type: "intersection", left: Q, right: X });
}
function K0(Q, X, Y) {
  return new SO({ type: "record", keyType: Q, valueType: X, ...i.normalizeParams(Y) });
}
function y0(Q, X) {
  let Y = Array.isArray(Q) ? Object.fromEntries(Q.map(($) => [$, $])) : Q;
  return new tY({ type: "enum", entries: Y, ...i.normalizeParams(X) });
}
function k(Q, X) {
  return new CO({ type: "literal", values: Array.isArray(Q) ? Q : [Q], ...i.normalizeParams(X) });
}
function uW(Q) {
  return new _O({ type: "transform", transform: Q });
}
function L0(Q) {
  return new mW({ type: "optional", innerType: Q });
}
function xW(Q) {
  return new kO({ type: "nullable", innerType: Q });
}
function TO(Q, X) {
  return new vO({ type: "default", innerType: Q, get defaultValue() {
    return typeof X === "function" ? X() : X;
  } });
}
function yO(Q, X) {
  return new xO({ type: "prefault", innerType: Q, get defaultValue() {
    return typeof X === "function" ? X() : X;
  } });
}
function gO(Q, X) {
  return new lW({ type: "nonoptional", innerType: Q, ...i.normalizeParams(X) });
}
function fO(Q, X) {
  return new hO({ type: "catch", innerType: Q, catchValue: typeof X === "function" ? X : () => X });
}
function aY(Q, X) {
  return new uO({ type: "pipe", in: Q, out: X });
}
function lO(Q) {
  return new mO({ type: "readonly", innerType: Q });
}
function cO(Q, X) {
  let Y = new j0({ check: "custom", ...i.normalizeParams(X) });
  return Y._zod.check = Q, Y;
}
function pW(Q, X) {
  return mY(cW, Q ?? (() => true), X);
}
function pO(Q, X = {}) {
  return lY(cW, Q, X);
}
function dO(Q, X) {
  let Y = cO(($) => {
    return $.addIssue = (J) => {
      if (typeof J === "string") $.issues.push(i.issue(J, $.value, Y._zod.def));
      else {
        let W = J;
        if (W.fatal) W.continue = false;
        W.code ?? (W.code = "custom"), W.input ?? (W.input = $.value), W.inst ?? (W.inst = Y), W.continue ?? (W.continue = !Y._zod.def.abort), $.issues.push(i.issue(W));
      }
    }, Q($.value, $);
  }, X);
  return Y;
}
function Q$(Q, X) {
  return aY(uW(Q), X);
}
function GG(Q) {
  if (Q.params.ref.type !== "ref/prompt") throw TypeError(`Expected CompleteRequestPrompt, but got ${Q.params.ref.type}`);
}
function HG(Q) {
  if (Q.params.ref.type !== "ref/resource") throw TypeError(`Expected CompleteRequestResourceTemplate, but got ${Q.params.ref.type}`);
}
function o1(Q) {
  return Q === "completed" || Q === "failed" || Q === "cancelled";
}
function N$(Q, X, Y, $) {
  if (!$?.errorMessages) return;
  if (Y) Q.errorMessage = { ...Q.errorMessage, [X]: Y };
}
function o(Q, X, Y, $, J) {
  Q[X] = Y, N$(Q, X, $, J);
}
function V0(Q) {
  if (Q.target !== "openAi") return {};
  let X = [...Q.basePath, Q.definitionPath, Q.openAiAnyTypeName];
  return Q.flags.hasReferencedOpenAiAnyType = true, { $ref: Q.$refStrategy === "relative" ? m8(X, Q.currentPath) : X.join("/") };
}
function UG(Q, X) {
  let Y = { type: "array" };
  if (Q.type?._def && Q.type?._def?.typeName !== A.ZodAny) Y.items = g(Q.type._def, { ...X, currentPath: [...X.currentPath, "items"] });
  if (Q.minLength) o(Y, "minItems", Q.minLength.value, Q.minLength.message, X);
  if (Q.maxLength) o(Y, "maxItems", Q.maxLength.value, Q.maxLength.message, X);
  if (Q.exactLength) o(Y, "minItems", Q.exactLength.value, Q.exactLength.message, X), o(Y, "maxItems", Q.exactLength.value, Q.exactLength.message, X);
  return Y;
}
function LG(Q, X) {
  let Y = { type: "integer", format: "int64" };
  if (!Q.checks) return Y;
  for (let $ of Q.checks) switch ($.kind) {
    case "min":
      if (X.target === "jsonSchema7") if ($.inclusive) o(Y, "minimum", $.value, $.message, X);
      else o(Y, "exclusiveMinimum", $.value, $.message, X);
      else {
        if (!$.inclusive) Y.exclusiveMinimum = true;
        o(Y, "minimum", $.value, $.message, X);
      }
      break;
    case "max":
      if (X.target === "jsonSchema7") if ($.inclusive) o(Y, "maximum", $.value, $.message, X);
      else o(Y, "exclusiveMaximum", $.value, $.message, X);
      else {
        if (!$.inclusive) Y.exclusiveMaximum = true;
        o(Y, "maximum", $.value, $.message, X);
      }
      break;
    case "multipleOf":
      o(Y, "multipleOf", $.value, $.message, X);
      break;
  }
  return Y;
}
function FG() {
  return { type: "boolean" };
}
function l8(Q, X) {
  return g(Q.type._def, X);
}
function D$(Q, X, Y) {
  let $ = Y ?? X.dateStrategy;
  if (Array.isArray($)) return { anyOf: $.map((J, W) => D$(Q, X, J)) };
  switch ($) {
    case "string":
    case "format:date-time":
      return { type: "string", format: "date-time" };
    case "format:date":
      return { type: "string", format: "date" };
    case "integer":
      return DD(Q, X);
  }
}
function NG(Q, X) {
  return { ...g(Q.innerType._def, X), default: Q.defaultValue() };
}
function DG(Q, X) {
  return X.effectStrategy === "input" ? g(Q.schema._def, X) : V0(X);
}
function wG(Q) {
  return { type: "string", enum: Array.from(Q.values) };
}
function MG(Q, X) {
  let Y = [g(Q.left._def, { ...X, currentPath: [...X.currentPath, "allOf", "0"] }), g(Q.right._def, { ...X, currentPath: [...X.currentPath, "allOf", "1"] })].filter((W) => !!W), $ = X.target === "jsonSchema2019-09" ? { unevaluatedProperties: false } : void 0, J = [];
  return Y.forEach((W) => {
    if (wD(W)) {
      if (J.push(...W.allOf), W.unevaluatedProperties === void 0) $ = void 0;
    } else {
      let G = W;
      if ("additionalProperties" in W && W.additionalProperties === false) {
        let { additionalProperties: H, ...B } = W;
        G = B;
      } else $ = void 0;
      J.push(G);
    }
  }), J.length ? { allOf: J, ...$ } : void 0;
}
function AG(Q, X) {
  let Y = typeof Q.value;
  if (Y !== "bigint" && Y !== "number" && Y !== "boolean" && Y !== "string") return { type: Array.isArray(Q.value) ? "array" : "object" };
  if (X.target === "openApi3") return { type: Y === "bigint" ? "integer" : Y, enum: [Q.value] };
  return { type: Y === "bigint" ? "integer" : Y, const: Q.value };
}
function c8(Q, X) {
  let Y = { type: "string" };
  if (Q.checks) for (let $ of Q.checks) switch ($.kind) {
    case "min":
      o(Y, "minLength", typeof Y.minLength === "number" ? Math.max(Y.minLength, $.value) : $.value, $.message, X);
      break;
    case "max":
      o(Y, "maxLength", typeof Y.maxLength === "number" ? Math.min(Y.maxLength, $.value) : $.value, $.message, X);
      break;
    case "email":
      switch (X.emailStrategy) {
        case "format:email":
          J1(Y, "email", $.message, X);
          break;
        case "format:idn-email":
          J1(Y, "idn-email", $.message, X);
          break;
        case "pattern:zod":
          k0(Y, $1.email, $.message, X);
          break;
      }
      break;
    case "url":
      J1(Y, "uri", $.message, X);
      break;
    case "uuid":
      J1(Y, "uuid", $.message, X);
      break;
    case "regex":
      k0(Y, $.regex, $.message, X);
      break;
    case "cuid":
      k0(Y, $1.cuid, $.message, X);
      break;
    case "cuid2":
      k0(Y, $1.cuid2, $.message, X);
      break;
    case "startsWith":
      k0(Y, RegExp(`^${M$($.value, X)}`), $.message, X);
      break;
    case "endsWith":
      k0(Y, RegExp(`${M$($.value, X)}$`), $.message, X);
      break;
    case "datetime":
      J1(Y, "date-time", $.message, X);
      break;
    case "date":
      J1(Y, "date", $.message, X);
      break;
    case "time":
      J1(Y, "time", $.message, X);
      break;
    case "duration":
      J1(Y, "duration", $.message, X);
      break;
    case "length":
      o(Y, "minLength", typeof Y.minLength === "number" ? Math.max(Y.minLength, $.value) : $.value, $.message, X), o(Y, "maxLength", typeof Y.maxLength === "number" ? Math.min(Y.maxLength, $.value) : $.value, $.message, X);
      break;
    case "includes": {
      k0(Y, RegExp(M$($.value, X)), $.message, X);
      break;
    }
    case "ip": {
      if ($.version !== "v6") J1(Y, "ipv4", $.message, X);
      if ($.version !== "v4") J1(Y, "ipv6", $.message, X);
      break;
    }
    case "base64url":
      k0(Y, $1.base64url, $.message, X);
      break;
    case "jwt":
      k0(Y, $1.jwt, $.message, X);
      break;
    case "cidr": {
      if ($.version !== "v6") k0(Y, $1.ipv4Cidr, $.message, X);
      if ($.version !== "v4") k0(Y, $1.ipv6Cidr, $.message, X);
      break;
    }
    case "emoji":
      k0(Y, $1.emoji(), $.message, X);
      break;
    case "ulid": {
      k0(Y, $1.ulid, $.message, X);
      break;
    }
    case "base64": {
      switch (X.base64Strategy) {
        case "format:binary": {
          J1(Y, "binary", $.message, X);
          break;
        }
        case "contentEncoding:base64": {
          o(Y, "contentEncoding", "base64", $.message, X);
          break;
        }
        case "pattern:zod": {
          k0(Y, $1.base64, $.message, X);
          break;
        }
      }
      break;
    }
    case "nanoid":
      k0(Y, $1.nanoid, $.message, X);
    case "toLowerCase":
    case "toUpperCase":
    case "trim":
      break;
    default:
      /* @__PURE__ */ ((J) => {
      })($);
  }
  return Y;
}
function M$(Q, X) {
  return X.patternStrategy === "escape" ? AD(Q) : Q;
}
function AD(Q) {
  let X = "";
  for (let Y = 0; Y < Q.length; Y++) {
    if (!MD.has(Q[Y])) X += "\\";
    X += Q[Y];
  }
  return X;
}
function J1(Q, X, Y, $) {
  if (Q.format || Q.anyOf?.some((J) => J.format)) {
    if (!Q.anyOf) Q.anyOf = [];
    if (Q.format) {
      if (Q.anyOf.push({ format: Q.format, ...Q.errorMessage && $.errorMessages && { errorMessage: { format: Q.errorMessage.format } } }), delete Q.format, Q.errorMessage) {
        if (delete Q.errorMessage.format, Object.keys(Q.errorMessage).length === 0) delete Q.errorMessage;
      }
    }
    Q.anyOf.push({ format: X, ...Y && $.errorMessages && { errorMessage: { format: Y } } });
  } else o(Q, "format", X, Y, $);
}
function k0(Q, X, Y, $) {
  if (Q.pattern || Q.allOf?.some((J) => J.pattern)) {
    if (!Q.allOf) Q.allOf = [];
    if (Q.pattern) {
      if (Q.allOf.push({ pattern: Q.pattern, ...Q.errorMessage && $.errorMessages && { errorMessage: { pattern: Q.errorMessage.pattern } } }), delete Q.pattern, Q.errorMessage) {
        if (delete Q.errorMessage.pattern, Object.keys(Q.errorMessage).length === 0) delete Q.errorMessage;
      }
    }
    Q.allOf.push({ pattern: jG(X, $), ...Y && $.errorMessages && { errorMessage: { pattern: Y } } });
  } else o(Q, "pattern", jG(X, $), Y, $);
}
function jG(Q, X) {
  if (!X.applyRegexFlags || !Q.flags) return Q.source;
  let Y = { i: Q.flags.includes("i"), m: Q.flags.includes("m"), s: Q.flags.includes("s") }, $ = Y.i ? Q.source.toLowerCase() : Q.source, J = "", W = false, G = false, H = false;
  for (let B = 0; B < $.length; B++) {
    if (W) {
      J += $[B], W = false;
      continue;
    }
    if (Y.i) {
      if (G) {
        if ($[B].match(/[a-z]/)) {
          if (H) J += $[B], J += `${$[B - 2]}-${$[B]}`.toUpperCase(), H = false;
          else if ($[B + 1] === "-" && $[B + 2]?.match(/[a-z]/)) J += $[B], H = true;
          else J += `${$[B]}${$[B].toUpperCase()}`;
          continue;
        }
      } else if ($[B].match(/[a-z]/)) {
        J += `[${$[B]}${$[B].toUpperCase()}]`;
        continue;
      }
    }
    if (Y.m) {
      if ($[B] === "^") {
        J += `(^|(?<=[\r
]))`;
        continue;
      } else if ($[B] === "$") {
        J += `($|(?=[\r
]))`;
        continue;
      }
    }
    if (Y.s && $[B] === ".") {
      J += G ? `${$[B]}\r
` : `[${$[B]}\r
]`;
      continue;
    }
    if (J += $[B], $[B] === "\\") W = true;
    else if (G && $[B] === "]") G = false;
    else if (!G && $[B] === "[") G = true;
  }
  try {
    new RegExp(J);
  } catch {
    return console.warn(`Could not convert regex pattern at ${X.currentPath.join("/")} to a flag-independent form! Falling back to the flag-ignorant source`), Q.source;
  }
  return J;
}
function p8(Q, X) {
  if (X.target === "openAi") console.warn("Warning: OpenAI may not support records in schemas! Try an array of key-value pairs instead.");
  if (X.target === "openApi3" && Q.keyType?._def.typeName === A.ZodEnum) return { type: "object", required: Q.keyType._def.values, properties: Q.keyType._def.values.reduce(($, J) => ({ ...$, [J]: g(Q.valueType._def, { ...X, currentPath: [...X.currentPath, "properties", J] }) ?? V0(X) }), {}), additionalProperties: X.rejectedAdditionalProperties };
  let Y = { type: "object", additionalProperties: g(Q.valueType._def, { ...X, currentPath: [...X.currentPath, "additionalProperties"] }) ?? X.allowedAdditionalProperties };
  if (X.target === "openApi3") return Y;
  if (Q.keyType?._def.typeName === A.ZodString && Q.keyType._def.checks?.length) {
    let { type: $, ...J } = c8(Q.keyType._def, X);
    return { ...Y, propertyNames: J };
  } else if (Q.keyType?._def.typeName === A.ZodEnum) return { ...Y, propertyNames: { enum: Q.keyType._def.values } };
  else if (Q.keyType?._def.typeName === A.ZodBranded && Q.keyType._def.type._def.typeName === A.ZodString && Q.keyType._def.type._def.checks?.length) {
    let { type: $, ...J } = l8(Q.keyType._def, X);
    return { ...Y, propertyNames: J };
  }
  return Y;
}
function RG(Q, X) {
  if (X.mapStrategy === "record") return p8(Q, X);
  let Y = g(Q.keyType._def, { ...X, currentPath: [...X.currentPath, "items", "items", "0"] }) || V0(X), $ = g(Q.valueType._def, { ...X, currentPath: [...X.currentPath, "items", "items", "1"] }) || V0(X);
  return { type: "array", maxItems: 125, items: { type: "array", items: [Y, $], minItems: 2, maxItems: 2 } };
}
function IG(Q) {
  let X = Q.values, $ = Object.keys(Q.values).filter((W) => {
    return typeof X[X[W]] !== "number";
  }).map((W) => X[W]), J = Array.from(new Set($.map((W) => typeof W)));
  return { type: J.length === 1 ? J[0] === "string" ? "string" : "number" : ["string", "number"], enum: $ };
}
function bG(Q) {
  return Q.target === "openAi" ? void 0 : { not: V0({ ...Q, currentPath: [...Q.currentPath, "not"] }) };
}
function EG(Q) {
  return Q.target === "openApi3" ? { enum: ["null"], nullable: true } : { type: "null" };
}
function ZG(Q, X) {
  if (X.target === "openApi3") return PG(Q, X);
  let Y = Q.options instanceof Map ? Array.from(Q.options.values()) : Q.options;
  if (Y.every(($) => $._def.typeName in U4 && (!$._def.checks || !$._def.checks.length))) {
    let $ = Y.reduce((J, W) => {
      let G = U4[W._def.typeName];
      return G && !J.includes(G) ? [...J, G] : J;
    }, []);
    return { type: $.length > 1 ? $ : $[0] };
  } else if (Y.every(($) => $._def.typeName === "ZodLiteral" && !$.description)) {
    let $ = Y.reduce((J, W) => {
      let G = typeof W._def.value;
      switch (G) {
        case "string":
        case "number":
        case "boolean":
          return [...J, G];
        case "bigint":
          return [...J, "integer"];
        case "object":
          if (W._def.value === null) return [...J, "null"];
        case "symbol":
        case "undefined":
        case "function":
        default:
          return J;
      }
    }, []);
    if ($.length === Y.length) {
      let J = $.filter((W, G, H) => H.indexOf(W) === G);
      return { type: J.length > 1 ? J : J[0], enum: Y.reduce((W, G) => {
        return W.includes(G._def.value) ? W : [...W, G._def.value];
      }, []) };
    }
  } else if (Y.every(($) => $._def.typeName === "ZodEnum")) return { type: "string", enum: Y.reduce(($, J) => [...$, ...J._def.values.filter((W) => !$.includes(W))], []) };
  return PG(Q, X);
}
function SG(Q, X) {
  if (["ZodString", "ZodNumber", "ZodBigInt", "ZodBoolean", "ZodNull"].includes(Q.innerType._def.typeName) && (!Q.innerType._def.checks || !Q.innerType._def.checks.length)) {
    if (X.target === "openApi3") return { type: U4[Q.innerType._def.typeName], nullable: true };
    return { type: [U4[Q.innerType._def.typeName], "null"] };
  }
  if (X.target === "openApi3") {
    let $ = g(Q.innerType._def, { ...X, currentPath: [...X.currentPath] });
    if ($ && "$ref" in $) return { allOf: [$], nullable: true };
    return $ && { ...$, nullable: true };
  }
  let Y = g(Q.innerType._def, { ...X, currentPath: [...X.currentPath, "anyOf", "0"] });
  return Y && { anyOf: [Y, { type: "null" }] };
}
function CG(Q, X) {
  let Y = { type: "number" };
  if (!Q.checks) return Y;
  for (let $ of Q.checks) switch ($.kind) {
    case "int":
      Y.type = "integer", N$(Y, "type", $.message, X);
      break;
    case "min":
      if (X.target === "jsonSchema7") if ($.inclusive) o(Y, "minimum", $.value, $.message, X);
      else o(Y, "exclusiveMinimum", $.value, $.message, X);
      else {
        if (!$.inclusive) Y.exclusiveMinimum = true;
        o(Y, "minimum", $.value, $.message, X);
      }
      break;
    case "max":
      if (X.target === "jsonSchema7") if ($.inclusive) o(Y, "maximum", $.value, $.message, X);
      else o(Y, "exclusiveMaximum", $.value, $.message, X);
      else {
        if (!$.inclusive) Y.exclusiveMaximum = true;
        o(Y, "maximum", $.value, $.message, X);
      }
      break;
    case "multipleOf":
      o(Y, "multipleOf", $.value, $.message, X);
      break;
  }
  return Y;
}
function _G(Q, X) {
  let Y = X.target === "openAi", $ = { type: "object", properties: {} }, J = [], W = Q.shape();
  for (let H in W) {
    let B = W[H];
    if (B === void 0 || B._def === void 0) continue;
    let z = RD(B);
    if (z && Y) {
      if (B._def.typeName === "ZodOptional") B = B._def.innerType;
      if (!B.isNullable()) B = B.nullable();
      z = false;
    }
    let K = g(B._def, { ...X, currentPath: [...X.currentPath, "properties", H], propertyPath: [...X.currentPath, "properties", H] });
    if (K === void 0) continue;
    if ($.properties[H] = K, !z) J.push(H);
  }
  if (J.length) $.required = J;
  let G = jD(Q, X);
  if (G !== void 0) $.additionalProperties = G;
  return $;
}
function jD(Q, X) {
  if (Q.catchall._def.typeName !== "ZodNever") return g(Q.catchall._def, { ...X, currentPath: [...X.currentPath, "additionalProperties"] });
  switch (Q.unknownKeys) {
    case "passthrough":
      return X.allowedAdditionalProperties;
    case "strict":
      return X.rejectedAdditionalProperties;
    case "strip":
      return X.removeAdditionalStrategy === "strict" ? X.allowedAdditionalProperties : X.rejectedAdditionalProperties;
  }
}
function RD(Q) {
  try {
    return Q.isOptional();
  } catch {
    return true;
  }
}
function TG(Q, X) {
  return g(Q.type._def, X);
}
function xG(Q, X) {
  let $ = { type: "array", uniqueItems: true, items: g(Q.valueType._def, { ...X, currentPath: [...X.currentPath, "items"] }) };
  if (Q.minSize) o($, "minItems", Q.minSize.value, Q.minSize.message, X);
  if (Q.maxSize) o($, "maxItems", Q.maxSize.value, Q.maxSize.message, X);
  return $;
}
function yG(Q, X) {
  if (Q.rest) return { type: "array", minItems: Q.items.length, items: Q.items.map((Y, $) => g(Y._def, { ...X, currentPath: [...X.currentPath, "items", `${$}`] })).reduce((Y, $) => $ === void 0 ? Y : [...Y, $], []), additionalItems: g(Q.rest._def, { ...X, currentPath: [...X.currentPath, "additionalItems"] }) };
  else return { type: "array", minItems: Q.items.length, maxItems: Q.items.length, items: Q.items.map((Y, $) => g(Y._def, { ...X, currentPath: [...X.currentPath, "items", `${$}`] })).reduce((Y, $) => $ === void 0 ? Y : [...Y, $], []) };
}
function gG(Q) {
  return { not: V0(Q) };
}
function hG(Q) {
  return V0(Q);
}
function g(Q, X, Y = false) {
  let $ = X.seen.get(Q);
  if (X.override) {
    let H = X.override?.(Q, X, $, Y);
    if (H !== KG) return H;
  }
  if ($ && !Y) {
    let H = ID($, X);
    if (H !== void 0) return H;
  }
  let J = { def: Q, path: X.currentPath, jsonSchema: void 0 };
  X.seen.set(Q, J);
  let W = uG(Q, Q.typeName, X), G = typeof W === "function" ? g(W(), X) : W;
  if (G) bD(Q, X, G);
  if (X.postProcess) {
    let H = X.postProcess(G, Q, X);
    return J.jsonSchema = G, H;
  }
  return J.jsonSchema = G, G;
}
function ED(Q) {
  if (!Q) return "draft-7";
  if (Q === "jsonSchema7" || Q === "draft-7") return "draft-7";
  if (Q === "jsonSchema2019-09" || Q === "draft-2020-12") return "draft-2020-12";
  return "draft-7";
}
function j$(Q, X) {
  if (n0(Q)) return pY(Q, { target: ED(X?.target), io: X?.pipeStrategy ?? "input" });
  return A$(Q, { strictUnions: X?.strictUnions ?? true, pipeStrategy: X?.pipeStrategy ?? "input" });
}
function R$(Q) {
  let Y = i1(Q)?.method;
  if (!Y) throw Error("Schema is missing a method literal");
  let $ = N8(Y);
  if (typeof $ !== "string") throw Error("Schema method literal must be a string");
  return $;
}
function I$(Q, X) {
  let Y = d1(Q, X);
  if (!Y.success) throw Y.error;
  return Y.data;
}
function mG(Q) {
  return Q !== null && typeof Q === "object" && !Array.isArray(Q);
}
function lG(Q, X) {
  let Y = { ...Q };
  for (let $ in X) {
    let J = $, W = X[J];
    if (W === void 0) continue;
    let G = Y[J];
    if (mG(G) && mG(W)) Y[J] = { ...G, ...W };
    else Y[J] = W;
  }
  return Y;
}
function xb() {
  let Q = new bK.default({ strict: false, validateFormats: true, validateSchema: false, allErrors: true });
  return EK.default(Q), Q;
}
function PK(Q, X, Y) {
  if (!Q) throw Error(`${Y} does not support task creation (required for ${X})`);
  switch (X) {
    case "tools/call":
      if (!Q.tools?.call) throw Error(`${Y} does not support task creation for tools/call (required for ${X})`);
      break;
    default:
      break;
  }
}
function ZK(Q, X, Y) {
  if (!Q) throw Error(`${Y} does not support task creation (required for ${X})`);
  switch (X) {
    case "sampling/createMessage":
      if (!Q.sampling?.createMessage) throw Error(`${Y} does not support task creation for sampling/createMessage (required for ${X})`);
      break;
    case "elicitation/create":
      if (!Q.elicitation?.create) throw Error(`${Y} does not support task creation for elicitation/create (required for ${X})`);
      break;
    default:
      break;
  }
}
function _7(Q) {
  return !!Q && typeof Q === "object" && CK in Q;
}
function _K(Q) {
  return Q[CK]?.complete;
}
function gb(Q) {
  let X = [];
  if (Q.length === 0) return { isValid: false, warnings: ["Tool name cannot be empty"] };
  if (Q.length > 128) return { isValid: false, warnings: [`Tool name exceeds maximum length of 128 characters (current: ${Q.length})`] };
  if (Q.includes(" ")) X.push("Tool name contains spaces, which may cause parsing issues");
  if (Q.includes(",")) X.push("Tool name contains commas, which may cause parsing issues");
  if (Q.startsWith("-") || Q.endsWith("-")) X.push("Tool name starts or ends with a dash, which may cause parsing issues in some contexts");
  if (Q.startsWith(".") || Q.endsWith(".")) X.push("Tool name starts or ends with a dot, which may cause parsing issues in some contexts");
  if (!yb.test(Q)) {
    let Y = Q.split("").filter(($) => !/[A-Za-z0-9._-]/.test($)).filter(($, J, W) => W.indexOf($) === J);
    return X.push(`Tool name contains invalid characters: ${Y.map(($) => `"${$}"`).join(", ")}`, "Allowed characters are: A-Z, a-z, 0-9, underscore (_), dash (-), and dot (.)"), { isValid: false, warnings: X };
  }
  return { isValid: true, warnings: X };
}
function hb(Q, X) {
  if (X.length > 0) {
    console.warn(`Tool name validation warning for "${Q}":`);
    for (let Y of X) console.warn(`  - ${Y}`);
    console.warn("Tool registration will proceed, but this may cause compatibility issues."), console.warn("Consider updating the tool name to conform to the MCP tool naming standard."), console.warn("See SEP: Specify Format for Tool Names (https://github.com/modelcontextprotocol/modelcontextprotocol/issues/986) for more details.");
  }
}
function k7(Q) {
  let X = gb(Q);
  return hb(Q, X.warnings), X.isValid;
}
function TK(Q) {
  return Q !== null && typeof Q === "object" && "parse" in Q && typeof Q.parse === "function" && "safeParse" in Q && typeof Q.safeParse === "function";
}
function ub(Q) {
  return "_def" in Q || "_zod" in Q || TK(Q);
}
function T7(Q) {
  if (typeof Q !== "object" || Q === null) return false;
  if (ub(Q)) return false;
  if (Object.keys(Q).length === 0) return true;
  return Object.values(Q).some(TK);
}
function kK(Q) {
  if (!Q) return;
  if (T7(Q)) return A6(Q);
  return Q;
}
function mb(Q) {
  let X = i1(Q);
  if (!X) return [];
  return Object.entries(X).map(([Y, $]) => {
    let J = jW($), W = RW($);
    return { name: Y, description: J, required: !W };
  });
}
function Y6(Q) {
  let Y = i1(Q)?.method;
  if (!Y) throw Error("Schema is missing a method literal");
  let $ = N8(Y);
  if (typeof $ === "string") return $;
  throw Error("Schema method literal must be a string");
}
function vK(Q) {
  return { completion: { values: Q.slice(0, 100), total: Q.length, hasMore: Q.length > 100 } };
}
function lb(Q, X, Y, $, J) {
  return { name: Q, description: X, inputSchema: Y, handler: $, annotations: J?.annotations };
}
function cb(Q) {
  let X = new x7({ name: Q.name, version: Q.version ?? "1.0.0" }, { capabilities: { tools: Q.tools ? {} : void 0 } });
  if (Q.tools) Q.tools.forEach((Y) => {
    X.registerTool(Y.name, { description: Y.description, inputSchema: Y.inputSchema, annotations: Y.annotations }, Y.handler);
  });
  return { type: "sdk", name: Q.name, instance: X };
}
function xK(Q) {
  let X;
  return () => X ??= Q();
}
function db(Q) {
  if (Q.startsWith("cc://")) {
    let $ = Q.slice(5), J = new URL(`http://${$}`), W = J.pathname.slice(1) || void 0;
    return { serverUrl: `http://${J.host}`, authToken: W };
  }
  if (Q.startsWith("cc+unix://")) throw new D1("Unix socket connect (cc+unix://) is not supported by the SDK transport");
  let X = /^https?:\/\//i.test(Q) ? Q : `http://${Q}`, Y = new URL(X);
  return { serverUrl: `${Y.protocol}//${Y.host}`, authToken: void 0 };
}
async function ib(Q) {
  let X = { "content-type": "application/json" };
  if (Q.authToken) X.authorization = `Bearer ${Q.authToken}`;
  let Y = {};
  if (Q.cwd) Y.cwd = Q.cwd;
  if (Q.sessionKey) Y.session_key = Q.sessionKey;
  if (Q.permissionMode) Y.permission_mode = Q.permissionMode;
  let $;
  try {
    $ = await fetch(`${Q.serverUrl}/sessions`, { method: "POST", headers: X, body: w0(Y) });
  } catch (W) {
    throw new D1(`Failed to connect to server at ${Q.serverUrl}: ${W instanceof Error ? W.message : String(W)}`);
  }
  if (!$.ok) {
    let W = await $.text().catch(() => "");
    throw new D1(`Failed to create session: ${$.status} ${$.statusText}${W ? ` \u2014 ${W}` : ""}`);
  }
  let J = pb().safeParse(await $.json());
  if (!J.success) throw new D1(`Invalid session response: ${J.error.message}`);
  return { sessionId: J.data.session_id, wsUrl: J.data.ws_url, workDir: J.data.work_dir };
}
async function gK(Q, X, Y) {
  let $ = {};
  if (Y) $.authorization = `Bearer ${Y}`;
  try {
    await fetch(`${Q}/sessions/${X}`, { method: "DELETE", headers: $ });
  } catch {
  }
}
function Wg({ prompt: Q, options: X }) {
  let { systemPrompt: Y, settings: $, settingSources: J, sandbox: W, ...G } = X ?? {}, H, B;
  if (Y === void 0) H = "";
  else if (typeof Y === "string") H = Y;
  else if (Y.type === "preset") B = Y.append;
  let z = G.pathToClaudeCodeExecutable;
  if (!z) {
    let C6 = nb(import.meta.url), _6 = fK(C6, "..");
    z = fK(_6, "cli.js");
  }
  process.env.CLAUDE_AGENT_SDK_VERSION = "0.2.69";
  let { abortController: K = k6(), additionalDirectories: q = [], agent: U, agents: V, allowedTools: L = [], betas: F, canUseTool: w, continue: N, cwd: j, debug: R, debugFile: C, disallowedTools: Z = [], tools: X0, env: O0, executable: S0 = v6() ? "bun" : "node", executableArgs: $6 = [], extraArgs: w1 = {}, fallbackModel: J6, enableFileCheckpointing: C1, toolConfig: W6, forkSession: h, hooks: b9, includePartialMessages: ZQ, onElicitation: E9, persistSession: P9, thinking: G6, effort: h4, maxThinkingTokens: Z6, maxTurns: C0, maxBudgetUsd: _1, mcpServers: S6, model: uK, outputFormat: y7, permissionMode: mK = "default", allowDangerouslySkipPermissions: lK = false, permissionPromptToolName: cK, plugins: pK, resume: dK, resumeSessionAt: iK, sessionId: nK, stderr: oK, strictMcpConfig: rK } = G, g7 = y7?.type === "json_schema" ? y7.schema : void 0, H6 = O0;
  if (!H6) H6 = { ...process.env };
  if (!H6.CLAUDE_CODE_ENTRYPOINT) H6.CLAUDE_CODE_ENTRYPOINT = "sdk-ts";
  if (C1) H6.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING = "true";
  if (W6?.askUserQuestion?.previewFormat) H6.CLAUDE_CODE_QUESTION_PREVIEW_FORMAT = W6.askUserQuestion.previewFormat;
  if (!z) throw Error("pathToClaudeCodeExecutable is required");
  let SQ = {}, h7 = /* @__PURE__ */ new Map();
  if (S6) for (let [C6, _6] of Object.entries(S6)) if (_6.type === "sdk" && "instance" in _6) h7.set(C6, _6.instance), SQ[C6] = { type: "sdk", name: C6 };
  else SQ[C6] = _6;
  let tK = typeof Q === "string", Z9;
  if (G6) switch (G6.type) {
    case "adaptive":
      Z9 = { type: "adaptive" };
      break;
    case "enabled":
      Z9 = { type: "enabled", budgetTokens: G6.budgetTokens };
      break;
    case "disabled":
      Z9 = { type: "disabled" };
      break;
  }
  else if (Z6 !== void 0) Z9 = Z6 === 0 ? { type: "disabled" } : { type: "enabled", budgetTokens: Z6 };
  let f7 = new _9({ abortController: K, additionalDirectories: q, agent: U, betas: F, cwd: j, debug: R, debugFile: C, executable: S0, executableArgs: $6, extraArgs: w1, pathToClaudeCodeExecutable: z, env: H6, forkSession: h, stderr: oK, thinkingConfig: Z9, effort: h4, maxTurns: C0, maxBudgetUsd: _1, model: uK, fallbackModel: J6, jsonSchema: g7, permissionMode: mK, allowDangerouslySkipPermissions: lK, permissionPromptToolName: cK, continueConversation: N, resume: dK, resumeSessionAt: iK, sessionId: nK, settings: typeof $ === "object" ? w0($) : $, settingSources: J ?? [], allowedTools: L, disallowedTools: Z, tools: X0, mcpServers: SQ, strictMcpConfig: rK, canUseTool: !!w, hooks: !!b9, includePartialMessages: ZQ, persistSession: P9, plugins: pK, sandbox: W, spawnClaudeCodeProcess: G.spawnClaudeCodeProcess }), aK = { systemPrompt: H, appendSystemPrompt: B, agents: V, promptSuggestions: G.promptSuggestions }, u7 = new v9(f7, tK, w, b9, K, h7, g7, aK, E9);
  if (typeof Q === "string") f7.write(w0({ type: "user", session_id: "", message: { role: "user", content: [{ type: "text", text: Q }] }, parent_tool_use_id: null }) + `
`);
  else u7.streamInput(Q);
  return u7;
}
function Gg(Q) {
  return gQ(Q);
}
function Hg(Q, X) {
  return y5(Q, X);
}
async function Bg(Q, X) {
  let $ = [];
  try {
    const Y = Y0($, gQ(X), 1);
    await Y.send(Q);
    for await (let B of Y.stream()) if (B.type === "result") return B;
    throw Error("Session ended without result message");
  } catch (J) {
    var W = J, G = 1;
  } finally {
    var H = $0($, W, G);
    H && await H;
  }
}
async function zg(Q, X) {
  return i5(Q, X);
}
async function Kg(Q) {
  return o5(Q);
}
var sK, eK, CQ, QV, XV, $V, JV, m7, E, WV, _Q, HV, BV, Y0, $0, F4, _$, c, a, E1, N4, S3, f$, u$, D4, p3, t0, e3, $H, n$, GH, w4, j4, WQ, R4, HQ, yH, hH, iH, sH, QB, $B, VB, UB, wB, AB, RB, bB, ZB, CB, kB, TB, yB, hB, DQ, lB, pB, iB, oB, V7, q7, $z, Gz, Bz, Lz, Nz, L7, jz, Pz, Sz, _z, vz, xz, fz, mz, cz, dz, nz, tz, ez, $K, GK, HK, D7, DK, MK, IK, KV, VV, qV, m0, y6, x6, wV, c7, MV, AV, g6, jV, h6, p7, RV, IV, C9, d7, EV, PV, i7, SV, CV, n7, o7, f4, vV, TV, xV, yV, r7, hV, u4, t7, a7, uV, mV, s7, cV, pV, dV, iV, nV, oV, rV, e7, Q5, m4, eV, M1, X5, Y5, Yq, $q, Jq, $5, Gq, Hq, J5, zq, W5, kQ, G5, H5, k1, Lq, Fq, B5, z5, K5, V5, q5, Mq, U5, L5, F5, v1, O5, N5, D5, w5, vQ, Zq, T1, A5, uq, mq, dq, P5, iq, nq, _5, k5, rq, l4, aq, PZ, sq, q0, x1, _9, k9, xQ, v9, GU, yQ, c4, zU, KU, VU, c6, LU, h5, c5, DU, m1, d, cQ, I, V1, M, CU, x0, _U, j1, r5, g9, vU, A0, x, K6, P0, o4, r4, y1, d6, S, Q1, t5, p, TU, xU, yU, gU, hU, fU, uU, mU, lU, pQ, cU, pU, dU, iU, nU, oU, s5, rU, s0, h1, f1, o6, V6, h9, r6, t6, q6, g1, q1, f9, e0, U0, a6, R1, t4, s6, U1, u9, m9, U6, n6, e6, Q9, u1, X9, L6, X1, l0, I1, Y9, $9, l9, XL, a4, c9, J9, YL, A, $L, $J, JJ, JL, WL, WJ, GL, HL, BL, zL, KL, VL, qL, UL, LL, iQ, FL, OL, NL, DL, wL, ML, AL, jL, RL, IL, bL, EL, PL, ZL, SL, CL, _L, kL, vL, TL, xL, yL, gL, hL, fL, uL, l1, s4, i, Q8, aQ, tL, sQ, GJ, QX, HJ, zJ, KJ, Y8, t9, JX, WX, GX, HX, BX, N6, zX, D6, VJ, qJ, UJ, LJ, FJ, OJ, NJ, DJ, KX, wJ, AJ, jJ, RJ, IJ, bJ, VX, EJ, PJ, ZJ, SJ, vJ, TJ, xJ, yJ, gJ, hJ, fJ, j0, uJ, qX, UX, mJ, lJ, cJ, pJ, dJ, a9, iJ, nJ, oJ, rJ, tJ, aJ, sJ, LX, QW, e, s9, W0, OX, NX, DX, wX, MX, AX, jX, RX, IX, bX, EX, KW, VW, qW, UW, PX, ZX, SX, CX, _X, kX, vX, TX, W8, xX, yX, gX, hX, fX, uX, G8, H8, mX, lX, cX, pX, dX, iX, nX, oX, rX, tX, aX, sX, eX, QY, XY, BF, zF, KF, VF, B8, p1, cY, iF, nF, X4, IW, bW, EW, PW, ZW, aC, Y4, SW, CW, _W, kW, F0, yW, YO, B0, $O, vW, D8, JO, WO, GO, HO, BO, zO, KO, VO, qO, UO, LO, FO, OO, NO, DO, wO, gW, MO, AO, jO, RO, IO, EO, hW, fW, PO, ZO, SO, tY, CO, _O, mW, kO, vO, xO, lW, hO, uO, mO, cW, X$, dW, n1, A8, R0, iW, nW, V_, iO, nO, Y$, d0, $4, oW, I0, o0, r0, b0, j8, rW, $$, tW, aW, J$, J4, T, W$, sW, q_, U_, R8, oO, I8, rO, W4, z9, eW, tO, aO, sO, eO, QN, XN, G$, YN, $N, H$, b8, JN, WN, E8, GN, G4, H4, HN, B4, K9, BN, z4, P8, Z8, S8, L_, C8, _8, k8, QG, XG, YG, B$, $G, K4, V9, JG, zN, v8, KN, T8, VN, z$, qN, x8, UN, LN, FN, ON, NN, DN, wN, MN, AN, jN, y8, RN, IN, g8, K$, V$, q$, bN, EN, PN, U$, ZN, SN, CN, _N, kN, WG, h8, vN, f8, F_, TN, q9, xN, O_, V4, yN, L$, gN, hN, fN, uN, mN, lN, cN, M8, pN, dN, iN, q4, F$, nN, oN, rN, tN, aN, sN, eN, QD, XD, YD, $D, JD, WD, GD, HD, BD, zD, KD, U9, VD, qD, UD, u8, LD, FD, OD, O$, ND, N_, D_, w_, M_, A_, j_, _, BG, KG, zG, VG, qG, m8, OG, DD, wD, w$, $1, MD, U4, PG, kG, vG, fG, uG, ID, bD, A$, PD, b$, bK, EK, Z7, S7, C7, CK, SK, yb, v7, x7, fb, g4, yK, pb, D1, hK;
var init_sdk = __esm({
  "node_modules/.pnpm/@anthropic-ai+claude-agent-sdk@0.2.69_zod@4.3.6/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs"() {
    sK = Object.create;
    ({ getPrototypeOf: eK, defineProperty: CQ, getOwnPropertyNames: QV } = Object);
    XV = Object.prototype.hasOwnProperty;
    m7 = (Q, X, Y) => {
      var $ = Q != null && typeof Q === "object";
      if ($) {
        var J = X ? $V ??= /* @__PURE__ */ new WeakMap() : JV ??= /* @__PURE__ */ new WeakMap(), W = J.get(Q);
        if (W) return W;
      }
      Y = Q != null ? sK(eK(Q)) : {};
      let G = X || !Q || !Q.__esModule ? CQ(Y, "default", { value: Q, enumerable: true }) : Y;
      for (let H of QV(Q)) if (!XV.call(G, H)) CQ(G, H, { get: YV.bind(Q, H), enumerable: true });
      if ($) J.set(Q, G);
      return G;
    };
    E = (Q, X) => () => (X || Q((X = { exports: {} }).exports, X), X.exports);
    WV = (Q) => Q;
    _Q = (Q, X) => {
      for (var Y in X) CQ(Q, Y, { get: X[Y], enumerable: true, configurable: true, set: GV.bind(X, Y) });
    };
    HV = Symbol.dispose || Symbol.for("Symbol.dispose");
    BV = Symbol.asyncDispose || Symbol.for("Symbol.asyncDispose");
    Y0 = (Q, X, Y) => {
      if (X != null) {
        if (typeof X !== "object" && typeof X !== "function") throw TypeError('Object expected to be assigned to "using" declaration');
        var $;
        if (Y) $ = X[BV];
        if ($ === void 0) $ = X[HV];
        if (typeof $ !== "function") throw TypeError("Object not disposable");
        Q.push([Y, $, X]);
      } else if (Y) Q.push([Y]);
      return X;
    };
    $0 = (Q, X, Y) => {
      var $ = typeof SuppressedError === "function" ? SuppressedError : function(G, H, B, z) {
        return z = Error(B), z.name = "SuppressedError", z.error = G, z.suppressed = H, z;
      }, J = (G) => X = Y ? new $(G, X, "An error was suppressed during disposal") : (Y = true, G), W = (G) => {
        while (G = Q.pop()) try {
          var H = G[1] && G[1].call(G[2]);
          if (G[0]) return Promise.resolve(H).then(W, (B) => (J(B), W()));
        } catch (B) {
          J(B);
        }
        if (Y) throw X;
      };
      return W();
    };
    F4 = E((dG) => {
      Object.defineProperty(dG, "__esModule", { value: true });
      dG.regexpCode = dG.getEsmExportName = dG.getProperty = dG.safeStringify = dG.stringify = dG.strConcat = dG.addCodeArg = dG.str = dG._ = dG.nil = dG._Code = dG.Name = dG.IDENTIFIER = dG._CodeOrName = void 0;
      class d8 {
      }
      dG._CodeOrName = d8;
      dG.IDENTIFIER = /^[a-z$_][a-z$_0-9]*$/i;
      class L9 extends d8 {
        constructor(Q) {
          super();
          if (!dG.IDENTIFIER.test(Q)) throw Error("CodeGen: name must be a valid identifier");
          this.str = Q;
        }
        toString() {
          return this.str;
        }
        emptyStr() {
          return false;
        }
        get names() {
          return { [this.str]: 1 };
        }
      }
      dG.Name = L9;
      class W1 extends d8 {
        constructor(Q) {
          super();
          this._items = typeof Q === "string" ? [Q] : Q;
        }
        toString() {
          return this.str;
        }
        emptyStr() {
          if (this._items.length > 1) return false;
          let Q = this._items[0];
          return Q === "" || Q === '""';
        }
        get str() {
          var Q;
          return (Q = this._str) !== null && Q !== void 0 ? Q : this._str = this._items.reduce((X, Y) => `${X}${Y}`, "");
        }
        get names() {
          var Q;
          return (Q = this._names) !== null && Q !== void 0 ? Q : this._names = this._items.reduce((X, Y) => {
            if (Y instanceof L9) X[Y.str] = (X[Y.str] || 0) + 1;
            return X;
          }, {});
        }
      }
      dG._Code = W1;
      dG.nil = new W1("");
      function cG(Q, ...X) {
        let Y = [Q[0]], $ = 0;
        while ($ < X.length) P$(Y, X[$]), Y.push(Q[++$]);
        return new W1(Y);
      }
      dG._ = cG;
      var E$ = new W1("+");
      function pG(Q, ...X) {
        let Y = [L4(Q[0])], $ = 0;
        while ($ < X.length) Y.push(E$), P$(Y, X[$]), Y.push(E$, L4(Q[++$]));
        return ZD(Y), new W1(Y);
      }
      dG.str = pG;
      function P$(Q, X) {
        if (X instanceof W1) Q.push(...X._items);
        else if (X instanceof L9) Q.push(X);
        else Q.push(_D(X));
      }
      dG.addCodeArg = P$;
      function ZD(Q) {
        let X = 1;
        while (X < Q.length - 1) {
          if (Q[X] === E$) {
            let Y = SD(Q[X - 1], Q[X + 1]);
            if (Y !== void 0) {
              Q.splice(X - 1, 3, Y);
              continue;
            }
            Q[X++] = "+";
          }
          X++;
        }
      }
      function SD(Q, X) {
        if (X === '""') return Q;
        if (Q === '""') return X;
        if (typeof Q == "string") {
          if (X instanceof L9 || Q[Q.length - 1] !== '"') return;
          if (typeof X != "string") return `${Q.slice(0, -1)}${X}"`;
          if (X[0] === '"') return Q.slice(0, -1) + X.slice(1);
          return;
        }
        if (typeof X == "string" && X[0] === '"' && !(Q instanceof L9)) return `"${Q}${X.slice(1)}`;
        return;
      }
      function CD(Q, X) {
        return X.emptyStr() ? Q : Q.emptyStr() ? X : pG`${Q}${X}`;
      }
      dG.strConcat = CD;
      function _D(Q) {
        return typeof Q == "number" || typeof Q == "boolean" || Q === null ? Q : L4(Array.isArray(Q) ? Q.join(",") : Q);
      }
      function kD(Q) {
        return new W1(L4(Q));
      }
      dG.stringify = kD;
      function L4(Q) {
        return JSON.stringify(Q).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
      }
      dG.safeStringify = L4;
      function vD(Q) {
        return typeof Q == "string" && dG.IDENTIFIER.test(Q) ? new W1(`.${Q}`) : cG`[${Q}]`;
      }
      dG.getProperty = vD;
      function TD(Q) {
        if (typeof Q == "string" && dG.IDENTIFIER.test(Q)) return new W1(`${Q}`);
        throw Error(`CodeGen: invalid export name: ${Q}, use explicit $id name mapping`);
      }
      dG.getEsmExportName = TD;
      function xD(Q) {
        return new W1(Q.toString());
      }
      dG.regexpCode = xD;
    });
    _$ = E((rG) => {
      Object.defineProperty(rG, "__esModule", { value: true });
      rG.ValueScope = rG.ValueScopeName = rG.Scope = rG.varKinds = rG.UsedValueState = void 0;
      var g0 = F4();
      class nG extends Error {
        constructor(Q) {
          super(`CodeGen: "code" for ${Q} not defined`);
          this.value = Q.value;
        }
      }
      var n8;
      (function(Q) {
        Q[Q.Started = 0] = "Started", Q[Q.Completed = 1] = "Completed";
      })(n8 || (rG.UsedValueState = n8 = {}));
      rG.varKinds = { const: new g0.Name("const"), let: new g0.Name("let"), var: new g0.Name("var") };
      class S$ {
        constructor({ prefixes: Q, parent: X } = {}) {
          this._names = {}, this._prefixes = Q, this._parent = X;
        }
        toName(Q) {
          return Q instanceof g0.Name ? Q : this.name(Q);
        }
        name(Q) {
          return new g0.Name(this._newName(Q));
        }
        _newName(Q) {
          let X = this._names[Q] || this._nameGroup(Q);
          return `${Q}${X.index++}`;
        }
        _nameGroup(Q) {
          var X, Y;
          if (((Y = (X = this._parent) === null || X === void 0 ? void 0 : X._prefixes) === null || Y === void 0 ? void 0 : Y.has(Q)) || this._prefixes && !this._prefixes.has(Q)) throw Error(`CodeGen: prefix "${Q}" is not allowed in this scope`);
          return this._names[Q] = { prefix: Q, index: 0 };
        }
      }
      rG.Scope = S$;
      class C$ extends g0.Name {
        constructor(Q, X) {
          super(X);
          this.prefix = Q;
        }
        setValue(Q, { property: X, itemIndex: Y }) {
          this.value = Q, this.scopePath = g0._`.${new g0.Name(X)}[${Y}]`;
        }
      }
      rG.ValueScopeName = C$;
      var oD = g0._`\n`;
      class oG extends S$ {
        constructor(Q) {
          super(Q);
          this._values = {}, this._scope = Q.scope, this.opts = { ...Q, _n: Q.lines ? oD : g0.nil };
        }
        get() {
          return this._scope;
        }
        name(Q) {
          return new C$(Q, this._newName(Q));
        }
        value(Q, X) {
          var Y;
          if (X.ref === void 0) throw Error("CodeGen: ref must be passed in value");
          let $ = this.toName(Q), { prefix: J } = $, W = (Y = X.key) !== null && Y !== void 0 ? Y : X.ref, G = this._values[J];
          if (G) {
            let z = G.get(W);
            if (z) return z;
          } else G = this._values[J] = /* @__PURE__ */ new Map();
          G.set(W, $);
          let H = this._scope[J] || (this._scope[J] = []), B = H.length;
          return H[B] = X.ref, $.setValue(X, { property: J, itemIndex: B }), $;
        }
        getValue(Q, X) {
          let Y = this._values[Q];
          if (!Y) return;
          return Y.get(X);
        }
        scopeRefs(Q, X = this._values) {
          return this._reduceValues(X, (Y) => {
            if (Y.scopePath === void 0) throw Error(`CodeGen: name "${Y}" has no value`);
            return g0._`${Q}${Y.scopePath}`;
          });
        }
        scopeCode(Q = this._values, X, Y) {
          return this._reduceValues(Q, ($) => {
            if ($.value === void 0) throw Error(`CodeGen: name "${$}" has no value`);
            return $.value.code;
          }, X, Y);
        }
        _reduceValues(Q, X, Y = {}, $) {
          let J = g0.nil;
          for (let W in Q) {
            let G = Q[W];
            if (!G) continue;
            let H = Y[W] = Y[W] || /* @__PURE__ */ new Map();
            G.forEach((B) => {
              if (H.has(B)) return;
              H.set(B, n8.Started);
              let z = X(B);
              if (z) {
                let K = this.opts.es5 ? rG.varKinds.var : rG.varKinds.const;
                J = g0._`${J}${K} ${B} = ${z};${this.opts._n}`;
              } else if (z = $ === null || $ === void 0 ? void 0 : $(B)) J = g0._`${J}${z}${this.opts._n}`;
              else throw new nG(B);
              H.set(B, n8.Completed);
            });
          }
          return J;
        }
      }
      rG.ValueScope = oG;
    });
    c = E((h0) => {
      Object.defineProperty(h0, "__esModule", { value: true });
      h0.or = h0.and = h0.not = h0.CodeGen = h0.operators = h0.varKinds = h0.ValueScopeName = h0.ValueScope = h0.Scope = h0.Name = h0.regexpCode = h0.stringify = h0.getProperty = h0.nil = h0.strConcat = h0.str = h0._ = void 0;
      var r = F4(), G1 = _$(), r1 = F4();
      Object.defineProperty(h0, "_", { enumerable: true, get: function() {
        return r1._;
      } });
      Object.defineProperty(h0, "str", { enumerable: true, get: function() {
        return r1.str;
      } });
      Object.defineProperty(h0, "strConcat", { enumerable: true, get: function() {
        return r1.strConcat;
      } });
      Object.defineProperty(h0, "nil", { enumerable: true, get: function() {
        return r1.nil;
      } });
      Object.defineProperty(h0, "getProperty", { enumerable: true, get: function() {
        return r1.getProperty;
      } });
      Object.defineProperty(h0, "stringify", { enumerable: true, get: function() {
        return r1.stringify;
      } });
      Object.defineProperty(h0, "regexpCode", { enumerable: true, get: function() {
        return r1.regexpCode;
      } });
      Object.defineProperty(h0, "Name", { enumerable: true, get: function() {
        return r1.Name;
      } });
      var e8 = _$();
      Object.defineProperty(h0, "Scope", { enumerable: true, get: function() {
        return e8.Scope;
      } });
      Object.defineProperty(h0, "ValueScope", { enumerable: true, get: function() {
        return e8.ValueScope;
      } });
      Object.defineProperty(h0, "ValueScopeName", { enumerable: true, get: function() {
        return e8.ValueScopeName;
      } });
      Object.defineProperty(h0, "varKinds", { enumerable: true, get: function() {
        return e8.varKinds;
      } });
      h0.operators = { GT: new r._Code(">"), GTE: new r._Code(">="), LT: new r._Code("<"), LTE: new r._Code("<="), EQ: new r._Code("==="), NEQ: new r._Code("!=="), NOT: new r._Code("!"), OR: new r._Code("||"), AND: new r._Code("&&"), ADD: new r._Code("+") };
      class t1 {
        optimizeNodes() {
          return this;
        }
        optimizeNames(Q, X) {
          return this;
        }
      }
      class aG extends t1 {
        constructor(Q, X, Y) {
          super();
          this.varKind = Q, this.name = X, this.rhs = Y;
        }
        render({ es5: Q, _n: X }) {
          let Y = Q ? G1.varKinds.var : this.varKind, $ = this.rhs === void 0 ? "" : ` = ${this.rhs}`;
          return `${Y} ${this.name}${$};` + X;
        }
        optimizeNames(Q, X) {
          if (!Q[this.name.str]) return;
          if (this.rhs) this.rhs = O9(this.rhs, Q, X);
          return this;
        }
        get names() {
          return this.rhs instanceof r._CodeOrName ? this.rhs.names : {};
        }
      }
      class T$ extends t1 {
        constructor(Q, X, Y) {
          super();
          this.lhs = Q, this.rhs = X, this.sideEffects = Y;
        }
        render({ _n: Q }) {
          return `${this.lhs} = ${this.rhs};` + Q;
        }
        optimizeNames(Q, X) {
          if (this.lhs instanceof r.Name && !Q[this.lhs.str] && !this.sideEffects) return;
          return this.rhs = O9(this.rhs, Q, X), this;
        }
        get names() {
          let Q = this.lhs instanceof r.Name ? {} : { ...this.lhs.names };
          return s8(Q, this.rhs);
        }
      }
      class sG extends T$ {
        constructor(Q, X, Y, $) {
          super(Q, Y, $);
          this.op = X;
        }
        render({ _n: Q }) {
          return `${this.lhs} ${this.op}= ${this.rhs};` + Q;
        }
      }
      class eG extends t1 {
        constructor(Q) {
          super();
          this.label = Q, this.names = {};
        }
        render({ _n: Q }) {
          return `${this.label}:` + Q;
        }
      }
      class Q3 extends t1 {
        constructor(Q) {
          super();
          this.label = Q, this.names = {};
        }
        render({ _n: Q }) {
          return `break${this.label ? ` ${this.label}` : ""};` + Q;
        }
      }
      class X3 extends t1 {
        constructor(Q) {
          super();
          this.error = Q;
        }
        render({ _n: Q }) {
          return `throw ${this.error};` + Q;
        }
        get names() {
          return this.error.names;
        }
      }
      class Y3 extends t1 {
        constructor(Q) {
          super();
          this.code = Q;
        }
        render({ _n: Q }) {
          return `${this.code};` + Q;
        }
        optimizeNodes() {
          return `${this.code}` ? this : void 0;
        }
        optimizeNames(Q, X) {
          return this.code = O9(this.code, Q, X), this;
        }
        get names() {
          return this.code instanceof r._CodeOrName ? this.code.names : {};
        }
      }
      class QQ extends t1 {
        constructor(Q = []) {
          super();
          this.nodes = Q;
        }
        render(Q) {
          return this.nodes.reduce((X, Y) => X + Y.render(Q), "");
        }
        optimizeNodes() {
          let { nodes: Q } = this, X = Q.length;
          while (X--) {
            let Y = Q[X].optimizeNodes();
            if (Array.isArray(Y)) Q.splice(X, 1, ...Y);
            else if (Y) Q[X] = Y;
            else Q.splice(X, 1);
          }
          return Q.length > 0 ? this : void 0;
        }
        optimizeNames(Q, X) {
          let { nodes: Y } = this, $ = Y.length;
          while ($--) {
            let J = Y[$];
            if (J.optimizeNames(Q, X)) continue;
            sD(Q, J.names), Y.splice($, 1);
          }
          return Y.length > 0 ? this : void 0;
        }
        get names() {
          return this.nodes.reduce((Q, X) => j6(Q, X.names), {});
        }
      }
      class a1 extends QQ {
        render(Q) {
          return "{" + Q._n + super.render(Q) + "}" + Q._n;
        }
      }
      class $3 extends QQ {
      }
      class O4 extends a1 {
      }
      O4.kind = "else";
      class b1 extends a1 {
        constructor(Q, X) {
          super(X);
          this.condition = Q;
        }
        render(Q) {
          let X = `if(${this.condition})` + super.render(Q);
          if (this.else) X += "else " + this.else.render(Q);
          return X;
        }
        optimizeNodes() {
          super.optimizeNodes();
          let Q = this.condition;
          if (Q === true) return this.nodes;
          let X = this.else;
          if (X) {
            let Y = X.optimizeNodes();
            X = this.else = Array.isArray(Y) ? new O4(Y) : Y;
          }
          if (X) {
            if (Q === false) return X instanceof b1 ? X : X.nodes;
            if (this.nodes.length) return this;
            return new b1(B3(Q), X instanceof b1 ? [X] : X.nodes);
          }
          if (Q === false || !this.nodes.length) return;
          return this;
        }
        optimizeNames(Q, X) {
          var Y;
          if (this.else = (Y = this.else) === null || Y === void 0 ? void 0 : Y.optimizeNames(Q, X), !(super.optimizeNames(Q, X) || this.else)) return;
          return this.condition = O9(this.condition, Q, X), this;
        }
        get names() {
          let Q = super.names;
          if (s8(Q, this.condition), this.else) j6(Q, this.else.names);
          return Q;
        }
      }
      b1.kind = "if";
      class F9 extends a1 {
      }
      F9.kind = "for";
      class J3 extends F9 {
        constructor(Q) {
          super();
          this.iteration = Q;
        }
        render(Q) {
          return `for(${this.iteration})` + super.render(Q);
        }
        optimizeNames(Q, X) {
          if (!super.optimizeNames(Q, X)) return;
          return this.iteration = O9(this.iteration, Q, X), this;
        }
        get names() {
          return j6(super.names, this.iteration.names);
        }
      }
      class W3 extends F9 {
        constructor(Q, X, Y, $) {
          super();
          this.varKind = Q, this.name = X, this.from = Y, this.to = $;
        }
        render(Q) {
          let X = Q.es5 ? G1.varKinds.var : this.varKind, { name: Y, from: $, to: J } = this;
          return `for(${X} ${Y}=${$}; ${Y}<${J}; ${Y}++)` + super.render(Q);
        }
        get names() {
          let Q = s8(super.names, this.from);
          return s8(Q, this.to);
        }
      }
      class k$ extends F9 {
        constructor(Q, X, Y, $) {
          super();
          this.loop = Q, this.varKind = X, this.name = Y, this.iterable = $;
        }
        render(Q) {
          return `for(${this.varKind} ${this.name} ${this.loop} ${this.iterable})` + super.render(Q);
        }
        optimizeNames(Q, X) {
          if (!super.optimizeNames(Q, X)) return;
          return this.iterable = O9(this.iterable, Q, X), this;
        }
        get names() {
          return j6(super.names, this.iterable.names);
        }
      }
      class o8 extends a1 {
        constructor(Q, X, Y) {
          super();
          this.name = Q, this.args = X, this.async = Y;
        }
        render(Q) {
          return `${this.async ? "async " : ""}function ${this.name}(${this.args})` + super.render(Q);
        }
      }
      o8.kind = "func";
      class r8 extends QQ {
        render(Q) {
          return "return " + super.render(Q);
        }
      }
      r8.kind = "return";
      class G3 extends a1 {
        render(Q) {
          let X = "try" + super.render(Q);
          if (this.catch) X += this.catch.render(Q);
          if (this.finally) X += this.finally.render(Q);
          return X;
        }
        optimizeNodes() {
          var Q, X;
          return super.optimizeNodes(), (Q = this.catch) === null || Q === void 0 || Q.optimizeNodes(), (X = this.finally) === null || X === void 0 || X.optimizeNodes(), this;
        }
        optimizeNames(Q, X) {
          var Y, $;
          return super.optimizeNames(Q, X), (Y = this.catch) === null || Y === void 0 || Y.optimizeNames(Q, X), ($ = this.finally) === null || $ === void 0 || $.optimizeNames(Q, X), this;
        }
        get names() {
          let Q = super.names;
          if (this.catch) j6(Q, this.catch.names);
          if (this.finally) j6(Q, this.finally.names);
          return Q;
        }
      }
      class t8 extends a1 {
        constructor(Q) {
          super();
          this.error = Q;
        }
        render(Q) {
          return `catch(${this.error})` + super.render(Q);
        }
      }
      t8.kind = "catch";
      class a8 extends a1 {
        render(Q) {
          return "finally" + super.render(Q);
        }
      }
      a8.kind = "finally";
      class H3 {
        constructor(Q, X = {}) {
          this._values = {}, this._blockStarts = [], this._constants = {}, this.opts = { ...X, _n: X.lines ? `
` : "" }, this._extScope = Q, this._scope = new G1.Scope({ parent: Q }), this._nodes = [new $3()];
        }
        toString() {
          return this._root.render(this.opts);
        }
        name(Q) {
          return this._scope.name(Q);
        }
        scopeName(Q) {
          return this._extScope.name(Q);
        }
        scopeValue(Q, X) {
          let Y = this._extScope.value(Q, X);
          return (this._values[Y.prefix] || (this._values[Y.prefix] = /* @__PURE__ */ new Set())).add(Y), Y;
        }
        getScopeValue(Q, X) {
          return this._extScope.getValue(Q, X);
        }
        scopeRefs(Q) {
          return this._extScope.scopeRefs(Q, this._values);
        }
        scopeCode() {
          return this._extScope.scopeCode(this._values);
        }
        _def(Q, X, Y, $) {
          let J = this._scope.toName(X);
          if (Y !== void 0 && $) this._constants[J.str] = Y;
          return this._leafNode(new aG(Q, J, Y)), J;
        }
        const(Q, X, Y) {
          return this._def(G1.varKinds.const, Q, X, Y);
        }
        let(Q, X, Y) {
          return this._def(G1.varKinds.let, Q, X, Y);
        }
        var(Q, X, Y) {
          return this._def(G1.varKinds.var, Q, X, Y);
        }
        assign(Q, X, Y) {
          return this._leafNode(new T$(Q, X, Y));
        }
        add(Q, X) {
          return this._leafNode(new sG(Q, h0.operators.ADD, X));
        }
        code(Q) {
          if (typeof Q == "function") Q();
          else if (Q !== r.nil) this._leafNode(new Y3(Q));
          return this;
        }
        object(...Q) {
          let X = ["{"];
          for (let [Y, $] of Q) {
            if (X.length > 1) X.push(",");
            if (X.push(Y), Y !== $ || this.opts.es5) X.push(":"), (0, r.addCodeArg)(X, $);
          }
          return X.push("}"), new r._Code(X);
        }
        if(Q, X, Y) {
          if (this._blockNode(new b1(Q)), X && Y) this.code(X).else().code(Y).endIf();
          else if (X) this.code(X).endIf();
          else if (Y) throw Error('CodeGen: "else" body without "then" body');
          return this;
        }
        elseIf(Q) {
          return this._elseNode(new b1(Q));
        }
        else() {
          return this._elseNode(new O4());
        }
        endIf() {
          return this._endBlockNode(b1, O4);
        }
        _for(Q, X) {
          if (this._blockNode(Q), X) this.code(X).endFor();
          return this;
        }
        for(Q, X) {
          return this._for(new J3(Q), X);
        }
        forRange(Q, X, Y, $, J = this.opts.es5 ? G1.varKinds.var : G1.varKinds.let) {
          let W = this._scope.toName(Q);
          return this._for(new W3(J, W, X, Y), () => $(W));
        }
        forOf(Q, X, Y, $ = G1.varKinds.const) {
          let J = this._scope.toName(Q);
          if (this.opts.es5) {
            let W = X instanceof r.Name ? X : this.var("_arr", X);
            return this.forRange("_i", 0, r._`${W}.length`, (G) => {
              this.var(J, r._`${W}[${G}]`), Y(J);
            });
          }
          return this._for(new k$("of", $, J, X), () => Y(J));
        }
        forIn(Q, X, Y, $ = this.opts.es5 ? G1.varKinds.var : G1.varKinds.const) {
          if (this.opts.ownProperties) return this.forOf(Q, r._`Object.keys(${X})`, Y);
          let J = this._scope.toName(Q);
          return this._for(new k$("in", $, J, X), () => Y(J));
        }
        endFor() {
          return this._endBlockNode(F9);
        }
        label(Q) {
          return this._leafNode(new eG(Q));
        }
        break(Q) {
          return this._leafNode(new Q3(Q));
        }
        return(Q) {
          let X = new r8();
          if (this._blockNode(X), this.code(Q), X.nodes.length !== 1) throw Error('CodeGen: "return" should have one node');
          return this._endBlockNode(r8);
        }
        try(Q, X, Y) {
          if (!X && !Y) throw Error('CodeGen: "try" without "catch" and "finally"');
          let $ = new G3();
          if (this._blockNode($), this.code(Q), X) {
            let J = this.name("e");
            this._currNode = $.catch = new t8(J), X(J);
          }
          if (Y) this._currNode = $.finally = new a8(), this.code(Y);
          return this._endBlockNode(t8, a8);
        }
        throw(Q) {
          return this._leafNode(new X3(Q));
        }
        block(Q, X) {
          if (this._blockStarts.push(this._nodes.length), Q) this.code(Q).endBlock(X);
          return this;
        }
        endBlock(Q) {
          let X = this._blockStarts.pop();
          if (X === void 0) throw Error("CodeGen: not in self-balancing block");
          let Y = this._nodes.length - X;
          if (Y < 0 || Q !== void 0 && Y !== Q) throw Error(`CodeGen: wrong number of nodes: ${Y} vs ${Q} expected`);
          return this._nodes.length = X, this;
        }
        func(Q, X = r.nil, Y, $) {
          if (this._blockNode(new o8(Q, X, Y)), $) this.code($).endFunc();
          return this;
        }
        endFunc() {
          return this._endBlockNode(o8);
        }
        optimize(Q = 1) {
          while (Q-- > 0) this._root.optimizeNodes(), this._root.optimizeNames(this._root.names, this._constants);
        }
        _leafNode(Q) {
          return this._currNode.nodes.push(Q), this;
        }
        _blockNode(Q) {
          this._currNode.nodes.push(Q), this._nodes.push(Q);
        }
        _endBlockNode(Q, X) {
          let Y = this._currNode;
          if (Y instanceof Q || X && Y instanceof X) return this._nodes.pop(), this;
          throw Error(`CodeGen: not in block "${X ? `${Q.kind}/${X.kind}` : Q.kind}"`);
        }
        _elseNode(Q) {
          let X = this._currNode;
          if (!(X instanceof b1)) throw Error('CodeGen: "else" without "if"');
          return this._currNode = X.else = Q, this;
        }
        get _root() {
          return this._nodes[0];
        }
        get _currNode() {
          let Q = this._nodes;
          return Q[Q.length - 1];
        }
        set _currNode(Q) {
          let X = this._nodes;
          X[X.length - 1] = Q;
        }
      }
      h0.CodeGen = H3;
      function j6(Q, X) {
        for (let Y in X) Q[Y] = (Q[Y] || 0) + (X[Y] || 0);
        return Q;
      }
      function s8(Q, X) {
        return X instanceof r._CodeOrName ? j6(Q, X.names) : Q;
      }
      function O9(Q, X, Y) {
        if (Q instanceof r.Name) return $(Q);
        if (!J(Q)) return Q;
        return new r._Code(Q._items.reduce((W, G) => {
          if (G instanceof r.Name) G = $(G);
          if (G instanceof r._Code) W.push(...G._items);
          else W.push(G);
          return W;
        }, []));
        function $(W) {
          let G = Y[W.str];
          if (G === void 0 || X[W.str] !== 1) return W;
          return delete X[W.str], G;
        }
        function J(W) {
          return W instanceof r._Code && W._items.some((G) => G instanceof r.Name && X[G.str] === 1 && Y[G.str] !== void 0);
        }
      }
      function sD(Q, X) {
        for (let Y in X) Q[Y] = (Q[Y] || 0) - (X[Y] || 0);
      }
      function B3(Q) {
        return typeof Q == "boolean" || typeof Q == "number" || Q === null ? !Q : r._`!${v$(Q)}`;
      }
      h0.not = B3;
      var eD = z3(h0.operators.AND);
      function Qw(...Q) {
        return Q.reduce(eD);
      }
      h0.and = Qw;
      var Xw = z3(h0.operators.OR);
      function Yw(...Q) {
        return Q.reduce(Xw);
      }
      h0.or = Yw;
      function z3(Q) {
        return (X, Y) => X === r.nil ? Y : Y === r.nil ? X : r._`${v$(X)} ${Q} ${v$(Y)}`;
      }
      function v$(Q) {
        return Q instanceof r.Name ? Q : r._`(${Q})`;
      }
    });
    a = E((D3) => {
      Object.defineProperty(D3, "__esModule", { value: true });
      D3.checkStrictMode = D3.getErrorPath = D3.Type = D3.useFunc = D3.setEvaluated = D3.evaluatedPropsToName = D3.mergeEvaluated = D3.eachItem = D3.unescapeJsonPointer = D3.escapeJsonPointer = D3.escapeFragment = D3.unescapeFragment = D3.schemaRefOrVal = D3.schemaHasRulesButRef = D3.schemaHasRules = D3.checkUnknownRules = D3.alwaysValidSchema = D3.toHash = void 0;
      var Q0 = c(), Gw = F4();
      function Hw(Q) {
        let X = {};
        for (let Y of Q) X[Y] = true;
        return X;
      }
      D3.toHash = Hw;
      function Bw(Q, X) {
        if (typeof X == "boolean") return X;
        if (Object.keys(X).length === 0) return true;
        return U3(Q, X), !L3(X, Q.self.RULES.all);
      }
      D3.alwaysValidSchema = Bw;
      function U3(Q, X = Q.schema) {
        let { opts: Y, self: $ } = Q;
        if (!Y.strictSchema) return;
        if (typeof X === "boolean") return;
        let J = $.RULES.keywords;
        for (let W in X) if (!J[W]) N3(Q, `unknown keyword: "${W}"`);
      }
      D3.checkUnknownRules = U3;
      function L3(Q, X) {
        if (typeof Q == "boolean") return !Q;
        for (let Y in Q) if (X[Y]) return true;
        return false;
      }
      D3.schemaHasRules = L3;
      function zw(Q, X) {
        if (typeof Q == "boolean") return !Q;
        for (let Y in Q) if (Y !== "$ref" && X.all[Y]) return true;
        return false;
      }
      D3.schemaHasRulesButRef = zw;
      function Kw({ topSchemaRef: Q, schemaPath: X }, Y, $, J) {
        if (!J) {
          if (typeof Y == "number" || typeof Y == "boolean") return Y;
          if (typeof Y == "string") return Q0._`${Y}`;
        }
        return Q0._`${Q}${X}${(0, Q0.getProperty)($)}`;
      }
      D3.schemaRefOrVal = Kw;
      function Vw(Q) {
        return F3(decodeURIComponent(Q));
      }
      D3.unescapeFragment = Vw;
      function qw(Q) {
        return encodeURIComponent(y$(Q));
      }
      D3.escapeFragment = qw;
      function y$(Q) {
        if (typeof Q == "number") return `${Q}`;
        return Q.replace(/~/g, "~0").replace(/\//g, "~1");
      }
      D3.escapeJsonPointer = y$;
      function F3(Q) {
        return Q.replace(/~1/g, "/").replace(/~0/g, "~");
      }
      D3.unescapeJsonPointer = F3;
      function Uw(Q, X) {
        if (Array.isArray(Q)) for (let Y of Q) X(Y);
        else X(Q);
      }
      D3.eachItem = Uw;
      function V3({ mergeNames: Q, mergeToName: X, mergeValues: Y, resultToName: $ }) {
        return (J, W, G, H) => {
          let B = G === void 0 ? W : G instanceof Q0.Name ? (W instanceof Q0.Name ? Q(J, W, G) : X(J, W, G), G) : W instanceof Q0.Name ? (X(J, G, W), W) : Y(W, G);
          return H === Q0.Name && !(B instanceof Q0.Name) ? $(J, B) : B;
        };
      }
      D3.mergeEvaluated = { props: V3({ mergeNames: (Q, X, Y) => Q.if(Q0._`${Y} !== true && ${X} !== undefined`, () => {
        Q.if(Q0._`${X} === true`, () => Q.assign(Y, true), () => Q.assign(Y, Q0._`${Y} || {}`).code(Q0._`Object.assign(${Y}, ${X})`));
      }), mergeToName: (Q, X, Y) => Q.if(Q0._`${Y} !== true`, () => {
        if (X === true) Q.assign(Y, true);
        else Q.assign(Y, Q0._`${Y} || {}`), g$(Q, Y, X);
      }), mergeValues: (Q, X) => Q === true ? true : { ...Q, ...X }, resultToName: O3 }), items: V3({ mergeNames: (Q, X, Y) => Q.if(Q0._`${Y} !== true && ${X} !== undefined`, () => Q.assign(Y, Q0._`${X} === true ? true : ${Y} > ${X} ? ${Y} : ${X}`)), mergeToName: (Q, X, Y) => Q.if(Q0._`${Y} !== true`, () => Q.assign(Y, X === true ? true : Q0._`${Y} > ${X} ? ${Y} : ${X}`)), mergeValues: (Q, X) => Q === true ? true : Math.max(Q, X), resultToName: (Q, X) => Q.var("items", X) }) };
      function O3(Q, X) {
        if (X === true) return Q.var("props", true);
        let Y = Q.var("props", Q0._`{}`);
        if (X !== void 0) g$(Q, Y, X);
        return Y;
      }
      D3.evaluatedPropsToName = O3;
      function g$(Q, X, Y) {
        Object.keys(Y).forEach(($) => Q.assign(Q0._`${X}${(0, Q0.getProperty)($)}`, true));
      }
      D3.setEvaluated = g$;
      var q3 = {};
      function Lw(Q, X) {
        return Q.scopeValue("func", { ref: X, code: q3[X.code] || (q3[X.code] = new Gw._Code(X.code)) });
      }
      D3.useFunc = Lw;
      var x$;
      (function(Q) {
        Q[Q.Num = 0] = "Num", Q[Q.Str = 1] = "Str";
      })(x$ || (D3.Type = x$ = {}));
      function Fw(Q, X, Y) {
        if (Q instanceof Q0.Name) {
          let $ = X === x$.Num;
          return Y ? $ ? Q0._`"[" + ${Q} + "]"` : Q0._`"['" + ${Q} + "']"` : $ ? Q0._`"/" + ${Q}` : Q0._`"/" + ${Q}.replace(/~/g, "~0").replace(/\\//g, "~1")`;
        }
        return Y ? (0, Q0.getProperty)(Q).toString() : "/" + y$(Q);
      }
      D3.getErrorPath = Fw;
      function N3(Q, X, Y = Q.opts.strictSchema) {
        if (!Y) return;
        if (X = `strict mode: ${X}`, Y === true) throw Error(X);
        Q.self.logger.warn(X);
      }
      D3.checkStrictMode = N3;
    });
    E1 = E((M3) => {
      Object.defineProperty(M3, "__esModule", { value: true });
      var Z0 = c(), vw = { data: new Z0.Name("data"), valCxt: new Z0.Name("valCxt"), instancePath: new Z0.Name("instancePath"), parentData: new Z0.Name("parentData"), parentDataProperty: new Z0.Name("parentDataProperty"), rootData: new Z0.Name("rootData"), dynamicAnchors: new Z0.Name("dynamicAnchors"), vErrors: new Z0.Name("vErrors"), errors: new Z0.Name("errors"), this: new Z0.Name("this"), self: new Z0.Name("self"), scope: new Z0.Name("scope"), json: new Z0.Name("json"), jsonPos: new Z0.Name("jsonPos"), jsonLen: new Z0.Name("jsonLen"), jsonPart: new Z0.Name("jsonPart") };
      M3.default = vw;
    });
    N4 = E((I3) => {
      Object.defineProperty(I3, "__esModule", { value: true });
      I3.extendErrors = I3.resetErrorsCount = I3.reportExtraError = I3.reportError = I3.keyword$DataError = I3.keywordError = void 0;
      var t = c(), YQ = a(), v0 = E1();
      I3.keywordError = { message: ({ keyword: Q }) => t.str`must pass "${Q}" keyword validation` };
      I3.keyword$DataError = { message: ({ keyword: Q, schemaType: X }) => X ? t.str`"${Q}" keyword must be ${X} ($data)` : t.str`"${Q}" keyword is invalid ($data)` };
      function xw(Q, X = I3.keywordError, Y, $) {
        let { it: J } = Q, { gen: W, compositeRule: G, allErrors: H } = J, B = R3(Q, X, Y);
        if ($ !== null && $ !== void 0 ? $ : G || H) A3(W, B);
        else j3(J, t._`[${B}]`);
      }
      I3.reportError = xw;
      function yw(Q, X = I3.keywordError, Y) {
        let { it: $ } = Q, { gen: J, compositeRule: W, allErrors: G } = $, H = R3(Q, X, Y);
        if (A3(J, H), !(W || G)) j3($, v0.default.vErrors);
      }
      I3.reportExtraError = yw;
      function gw(Q, X) {
        Q.assign(v0.default.errors, X), Q.if(t._`${v0.default.vErrors} !== null`, () => Q.if(X, () => Q.assign(t._`${v0.default.vErrors}.length`, X), () => Q.assign(v0.default.vErrors, null)));
      }
      I3.resetErrorsCount = gw;
      function hw({ gen: Q, keyword: X, schemaValue: Y, data: $, errsCount: J, it: W }) {
        if (J === void 0) throw Error("ajv implementation error");
        let G = Q.name("err");
        Q.forRange("i", J, v0.default.errors, (H) => {
          if (Q.const(G, t._`${v0.default.vErrors}[${H}]`), Q.if(t._`${G}.instancePath === undefined`, () => Q.assign(t._`${G}.instancePath`, (0, t.strConcat)(v0.default.instancePath, W.errorPath))), Q.assign(t._`${G}.schemaPath`, t.str`${W.errSchemaPath}/${X}`), W.opts.verbose) Q.assign(t._`${G}.schema`, Y), Q.assign(t._`${G}.data`, $);
        });
      }
      I3.extendErrors = hw;
      function A3(Q, X) {
        let Y = Q.const("err", X);
        Q.if(t._`${v0.default.vErrors} === null`, () => Q.assign(v0.default.vErrors, t._`[${Y}]`), t._`${v0.default.vErrors}.push(${Y})`), Q.code(t._`${v0.default.errors}++`);
      }
      function j3(Q, X) {
        let { gen: Y, validateName: $, schemaEnv: J } = Q;
        if (J.$async) Y.throw(t._`new ${Q.ValidationError}(${X})`);
        else Y.assign(t._`${$}.errors`, X), Y.return(false);
      }
      var R6 = { keyword: new t.Name("keyword"), schemaPath: new t.Name("schemaPath"), params: new t.Name("params"), propertyName: new t.Name("propertyName"), message: new t.Name("message"), schema: new t.Name("schema"), parentSchema: new t.Name("parentSchema") };
      function R3(Q, X, Y) {
        let { createErrors: $ } = Q.it;
        if ($ === false) return t._`{}`;
        return fw(Q, X, Y);
      }
      function fw(Q, X, Y = {}) {
        let { gen: $, it: J } = Q, W = [uw(J, Y), mw(Q, Y)];
        return lw(Q, X, W), $.object(...W);
      }
      function uw({ errorPath: Q }, { instancePath: X }) {
        let Y = X ? t.str`${Q}${(0, YQ.getErrorPath)(X, YQ.Type.Str)}` : Q;
        return [v0.default.instancePath, (0, t.strConcat)(v0.default.instancePath, Y)];
      }
      function mw({ keyword: Q, it: { errSchemaPath: X } }, { schemaPath: Y, parentSchema: $ }) {
        let J = $ ? X : t.str`${X}/${Q}`;
        if (Y) J = t.str`${J}${(0, YQ.getErrorPath)(Y, YQ.Type.Str)}`;
        return [R6.schemaPath, J];
      }
      function lw(Q, { params: X, message: Y }, $) {
        let { keyword: J, data: W, schemaValue: G, it: H } = Q, { opts: B, propertyName: z, topSchemaRef: K, schemaPath: q } = H;
        if ($.push([R6.keyword, J], [R6.params, typeof X == "function" ? X(Q) : X || t._`{}`]), B.messages) $.push([R6.message, typeof Y == "function" ? Y(Q) : Y]);
        if (B.verbose) $.push([R6.schema, G], [R6.parentSchema, t._`${K}${q}`], [v0.default.data, W]);
        if (z) $.push([R6.propertyName, z]);
      }
    });
    S3 = E((P3) => {
      Object.defineProperty(P3, "__esModule", { value: true });
      P3.boolOrEmptySchema = P3.topBoolOrEmptySchema = void 0;
      var nw = N4(), ow = c(), rw = E1(), tw = { message: "boolean schema is false" };
      function aw(Q) {
        let { gen: X, schema: Y, validateName: $ } = Q;
        if (Y === false) E3(Q, false);
        else if (typeof Y == "object" && Y.$async === true) X.return(rw.default.data);
        else X.assign(ow._`${$}.errors`, null), X.return(true);
      }
      P3.topBoolOrEmptySchema = aw;
      function sw(Q, X) {
        let { gen: Y, schema: $ } = Q;
        if ($ === false) Y.var(X, false), E3(Q);
        else Y.var(X, true);
      }
      P3.boolOrEmptySchema = sw;
      function E3(Q, X) {
        let { gen: Y, data: $ } = Q, J = { gen: Y, keyword: "false schema", data: $, schema: false, schemaCode: false, schemaValue: false, params: {}, it: Q };
        (0, nw.reportError)(J, tw, void 0, X);
      }
    });
    f$ = E((C3) => {
      Object.defineProperty(C3, "__esModule", { value: true });
      C3.getRules = C3.isJSONType = void 0;
      var QM = ["string", "number", "integer", "boolean", "null", "object", "array"], XM = new Set(QM);
      function YM(Q) {
        return typeof Q == "string" && XM.has(Q);
      }
      C3.isJSONType = YM;
      function $M() {
        let Q = { number: { type: "number", rules: [] }, string: { type: "string", rules: [] }, array: { type: "array", rules: [] }, object: { type: "object", rules: [] } };
        return { types: { ...Q, integer: true, boolean: true, null: true }, rules: [{ rules: [] }, Q.number, Q.string, Q.array, Q.object], post: { rules: [] }, all: {}, keywords: {} };
      }
      C3.getRules = $M;
    });
    u$ = E((T3) => {
      Object.defineProperty(T3, "__esModule", { value: true });
      T3.shouldUseRule = T3.shouldUseGroup = T3.schemaHasRulesForType = void 0;
      function WM({ schema: Q, self: X }, Y) {
        let $ = X.RULES.types[Y];
        return $ && $ !== true && k3(Q, $);
      }
      T3.schemaHasRulesForType = WM;
      function k3(Q, X) {
        return X.rules.some((Y) => v3(Q, Y));
      }
      T3.shouldUseGroup = k3;
      function v3(Q, X) {
        var Y;
        return Q[X.keyword] !== void 0 || ((Y = X.definition.implements) === null || Y === void 0 ? void 0 : Y.some(($) => Q[$] !== void 0));
      }
      T3.shouldUseRule = v3;
    });
    D4 = E((f3) => {
      Object.defineProperty(f3, "__esModule", { value: true });
      f3.reportTypeError = f3.checkDataTypes = f3.checkDataType = f3.coerceAndCheckDataType = f3.getJSONTypes = f3.getSchemaTypes = f3.DataType = void 0;
      var BM = f$(), zM = u$(), KM = N4(), l = c(), y3 = a(), N9;
      (function(Q) {
        Q[Q.Correct = 0] = "Correct", Q[Q.Wrong = 1] = "Wrong";
      })(N9 || (f3.DataType = N9 = {}));
      function VM(Q) {
        let X = g3(Q.type);
        if (X.includes("null")) {
          if (Q.nullable === false) throw Error("type: null contradicts nullable: false");
        } else {
          if (!X.length && Q.nullable !== void 0) throw Error('"nullable" cannot be used without "type"');
          if (Q.nullable === true) X.push("null");
        }
        return X;
      }
      f3.getSchemaTypes = VM;
      function g3(Q) {
        let X = Array.isArray(Q) ? Q : Q ? [Q] : [];
        if (X.every(BM.isJSONType)) return X;
        throw Error("type must be JSONType or JSONType[]: " + X.join(","));
      }
      f3.getJSONTypes = g3;
      function qM(Q, X) {
        let { gen: Y, data: $, opts: J } = Q, W = UM(X, J.coerceTypes), G = X.length > 0 && !(W.length === 0 && X.length === 1 && (0, zM.schemaHasRulesForType)(Q, X[0]));
        if (G) {
          let H = l$(X, $, J.strictNumbers, N9.Wrong);
          Y.if(H, () => {
            if (W.length) LM(Q, X, W);
            else c$(Q);
          });
        }
        return G;
      }
      f3.coerceAndCheckDataType = qM;
      var h3 = /* @__PURE__ */ new Set(["string", "number", "integer", "boolean", "null"]);
      function UM(Q, X) {
        return X ? Q.filter((Y) => h3.has(Y) || X === "array" && Y === "array") : [];
      }
      function LM(Q, X, Y) {
        let { gen: $, data: J, opts: W } = Q, G = $.let("dataType", l._`typeof ${J}`), H = $.let("coerced", l._`undefined`);
        if (W.coerceTypes === "array") $.if(l._`${G} == 'object' && Array.isArray(${J}) && ${J}.length == 1`, () => $.assign(J, l._`${J}[0]`).assign(G, l._`typeof ${J}`).if(l$(X, J, W.strictNumbers), () => $.assign(H, J)));
        $.if(l._`${H} !== undefined`);
        for (let z of Y) if (h3.has(z) || z === "array" && W.coerceTypes === "array") B(z);
        $.else(), c$(Q), $.endIf(), $.if(l._`${H} !== undefined`, () => {
          $.assign(J, H), FM(Q, H);
        });
        function B(z) {
          switch (z) {
            case "string":
              $.elseIf(l._`${G} == "number" || ${G} == "boolean"`).assign(H, l._`"" + ${J}`).elseIf(l._`${J} === null`).assign(H, l._`""`);
              return;
            case "number":
              $.elseIf(l._`${G} == "boolean" || ${J} === null
              || (${G} == "string" && ${J} && ${J} == +${J})`).assign(H, l._`+${J}`);
              return;
            case "integer":
              $.elseIf(l._`${G} === "boolean" || ${J} === null
              || (${G} === "string" && ${J} && ${J} == +${J} && !(${J} % 1))`).assign(H, l._`+${J}`);
              return;
            case "boolean":
              $.elseIf(l._`${J} === "false" || ${J} === 0 || ${J} === null`).assign(H, false).elseIf(l._`${J} === "true" || ${J} === 1`).assign(H, true);
              return;
            case "null":
              $.elseIf(l._`${J} === "" || ${J} === 0 || ${J} === false`), $.assign(H, null);
              return;
            case "array":
              $.elseIf(l._`${G} === "string" || ${G} === "number"
              || ${G} === "boolean" || ${J} === null`).assign(H, l._`[${J}]`);
          }
        }
      }
      function FM({ gen: Q, parentData: X, parentDataProperty: Y }, $) {
        Q.if(l._`${X} !== undefined`, () => Q.assign(l._`${X}[${Y}]`, $));
      }
      function m$(Q, X, Y, $ = N9.Correct) {
        let J = $ === N9.Correct ? l.operators.EQ : l.operators.NEQ, W;
        switch (Q) {
          case "null":
            return l._`${X} ${J} null`;
          case "array":
            W = l._`Array.isArray(${X})`;
            break;
          case "object":
            W = l._`${X} && typeof ${X} == "object" && !Array.isArray(${X})`;
            break;
          case "integer":
            W = G(l._`!(${X} % 1) && !isNaN(${X})`);
            break;
          case "number":
            W = G();
            break;
          default:
            return l._`typeof ${X} ${J} ${Q}`;
        }
        return $ === N9.Correct ? W : (0, l.not)(W);
        function G(H = l.nil) {
          return (0, l.and)(l._`typeof ${X} == "number"`, H, Y ? l._`isFinite(${X})` : l.nil);
        }
      }
      f3.checkDataType = m$;
      function l$(Q, X, Y, $) {
        if (Q.length === 1) return m$(Q[0], X, Y, $);
        let J, W = (0, y3.toHash)(Q);
        if (W.array && W.object) {
          let G = l._`typeof ${X} != "object"`;
          J = W.null ? G : l._`!${X} || ${G}`, delete W.null, delete W.array, delete W.object;
        } else J = l.nil;
        if (W.number) delete W.integer;
        for (let G in W) J = (0, l.and)(J, m$(G, X, Y, $));
        return J;
      }
      f3.checkDataTypes = l$;
      var OM = { message: ({ schema: Q }) => `must be ${Q}`, params: ({ schema: Q, schemaValue: X }) => typeof Q == "string" ? l._`{type: ${Q}}` : l._`{type: ${X}}` };
      function c$(Q) {
        let X = NM(Q);
        (0, KM.reportError)(X, OM);
      }
      f3.reportTypeError = c$;
      function NM(Q) {
        let { gen: X, data: Y, schema: $ } = Q, J = (0, y3.schemaRefOrVal)(Q, $, "type");
        return { gen: X, keyword: "type", data: Y, schema: $.type, schemaCode: J, schemaValue: J, parentSchema: $, params: {}, it: Q };
      }
    });
    p3 = E((l3) => {
      Object.defineProperty(l3, "__esModule", { value: true });
      l3.assignDefaults = void 0;
      var D9 = c(), IM = a();
      function bM(Q, X) {
        let { properties: Y, items: $ } = Q.schema;
        if (X === "object" && Y) for (let J in Y) m3(Q, J, Y[J].default);
        else if (X === "array" && Array.isArray($)) $.forEach((J, W) => m3(Q, W, J.default));
      }
      l3.assignDefaults = bM;
      function m3(Q, X, Y) {
        let { gen: $, compositeRule: J, data: W, opts: G } = Q;
        if (Y === void 0) return;
        let H = D9._`${W}${(0, D9.getProperty)(X)}`;
        if (J) {
          (0, IM.checkStrictMode)(Q, `default is ignored for: ${H}`);
          return;
        }
        let B = D9._`${H} === undefined`;
        if (G.useDefaults === "empty") B = D9._`${B} || ${H} === null || ${H} === ""`;
        $.if(B, D9._`${H} = ${(0, D9.stringify)(Y)}`);
      }
    });
    t0 = E((n3) => {
      Object.defineProperty(n3, "__esModule", { value: true });
      n3.validateUnion = n3.validateArray = n3.usePattern = n3.callValidateCode = n3.schemaProperties = n3.allSchemaProperties = n3.noPropertyInData = n3.propertyInData = n3.isOwnProperty = n3.hasPropFunc = n3.reportMissingProp = n3.checkMissingProp = n3.checkReportMissingProp = void 0;
      var H0 = c(), p$ = a(), s1 = E1(), EM = a();
      function PM(Q, X) {
        let { gen: Y, data: $, it: J } = Q;
        Y.if(i$(Y, $, X, J.opts.ownProperties), () => {
          Q.setParams({ missingProperty: H0._`${X}` }, true), Q.error();
        });
      }
      n3.checkReportMissingProp = PM;
      function ZM({ gen: Q, data: X, it: { opts: Y } }, $, J) {
        return (0, H0.or)(...$.map((W) => (0, H0.and)(i$(Q, X, W, Y.ownProperties), H0._`${J} = ${W}`)));
      }
      n3.checkMissingProp = ZM;
      function SM(Q, X) {
        Q.setParams({ missingProperty: X }, true), Q.error();
      }
      n3.reportMissingProp = SM;
      function d3(Q) {
        return Q.scopeValue("func", { ref: Object.prototype.hasOwnProperty, code: H0._`Object.prototype.hasOwnProperty` });
      }
      n3.hasPropFunc = d3;
      function d$(Q, X, Y) {
        return H0._`${d3(Q)}.call(${X}, ${Y})`;
      }
      n3.isOwnProperty = d$;
      function CM(Q, X, Y, $) {
        let J = H0._`${X}${(0, H0.getProperty)(Y)} !== undefined`;
        return $ ? H0._`${J} && ${d$(Q, X, Y)}` : J;
      }
      n3.propertyInData = CM;
      function i$(Q, X, Y, $) {
        let J = H0._`${X}${(0, H0.getProperty)(Y)} === undefined`;
        return $ ? (0, H0.or)(J, (0, H0.not)(d$(Q, X, Y))) : J;
      }
      n3.noPropertyInData = i$;
      function i3(Q) {
        return Q ? Object.keys(Q).filter((X) => X !== "__proto__") : [];
      }
      n3.allSchemaProperties = i3;
      function _M(Q, X) {
        return i3(X).filter((Y) => !(0, p$.alwaysValidSchema)(Q, X[Y]));
      }
      n3.schemaProperties = _M;
      function kM({ schemaCode: Q, data: X, it: { gen: Y, topSchemaRef: $, schemaPath: J, errorPath: W }, it: G }, H, B, z) {
        let K = z ? H0._`${Q}, ${X}, ${$}${J}` : X, q = [[s1.default.instancePath, (0, H0.strConcat)(s1.default.instancePath, W)], [s1.default.parentData, G.parentData], [s1.default.parentDataProperty, G.parentDataProperty], [s1.default.rootData, s1.default.rootData]];
        if (G.opts.dynamicRef) q.push([s1.default.dynamicAnchors, s1.default.dynamicAnchors]);
        let U = H0._`${K}, ${Y.object(...q)}`;
        return B !== H0.nil ? H0._`${H}.call(${B}, ${U})` : H0._`${H}(${U})`;
      }
      n3.callValidateCode = kM;
      var vM = H0._`new RegExp`;
      function TM({ gen: Q, it: { opts: X } }, Y) {
        let $ = X.unicodeRegExp ? "u" : "", { regExp: J } = X.code, W = J(Y, $);
        return Q.scopeValue("pattern", { key: W.toString(), ref: W, code: H0._`${J.code === "new RegExp" ? vM : (0, EM.useFunc)(Q, J)}(${Y}, ${$})` });
      }
      n3.usePattern = TM;
      function xM(Q) {
        let { gen: X, data: Y, keyword: $, it: J } = Q, W = X.name("valid");
        if (J.allErrors) {
          let H = X.let("valid", true);
          return G(() => X.assign(H, false)), H;
        }
        return X.var(W, true), G(() => X.break()), W;
        function G(H) {
          let B = X.const("len", H0._`${Y}.length`);
          X.forRange("i", 0, B, (z) => {
            Q.subschema({ keyword: $, dataProp: z, dataPropType: p$.Type.Num }, W), X.if((0, H0.not)(W), H);
          });
        }
      }
      n3.validateArray = xM;
      function yM(Q) {
        let { gen: X, schema: Y, keyword: $, it: J } = Q;
        if (!Array.isArray(Y)) throw Error("ajv implementation error");
        if (Y.some((B) => (0, p$.alwaysValidSchema)(J, B)) && !J.opts.unevaluated) return;
        let G = X.let("valid", false), H = X.name("_valid");
        X.block(() => Y.forEach((B, z) => {
          let K = Q.subschema({ keyword: $, schemaProp: z, compositeRule: true }, H);
          if (X.assign(G, H0._`${G} || ${H}`), !Q.mergeValidEvaluated(K, H)) X.if((0, H0.not)(G));
        })), Q.result(G, () => Q.reset(), () => Q.error(true));
      }
      n3.validateUnion = yM;
    });
    e3 = E((a3) => {
      Object.defineProperty(a3, "__esModule", { value: true });
      a3.validateKeywordUsage = a3.validSchemaType = a3.funcKeywordCode = a3.macroKeywordCode = void 0;
      var T0 = c(), I6 = E1(), rM = t0(), tM = N4();
      function aM(Q, X) {
        let { gen: Y, keyword: $, schema: J, parentSchema: W, it: G } = Q, H = X.macro.call(G.self, J, W, G), B = t3(Y, $, H);
        if (G.opts.validateSchema !== false) G.self.validateSchema(H, true);
        let z = Y.name("valid");
        Q.subschema({ schema: H, schemaPath: T0.nil, errSchemaPath: `${G.errSchemaPath}/${$}`, topSchemaRef: B, compositeRule: true }, z), Q.pass(z, () => Q.error(true));
      }
      a3.macroKeywordCode = aM;
      function sM(Q, X) {
        var Y;
        let { gen: $, keyword: J, schema: W, parentSchema: G, $data: H, it: B } = Q;
        QA(B, X);
        let z = !H && X.compile ? X.compile.call(B.self, W, G, B) : X.validate, K = t3($, J, z), q = $.let("valid");
        Q.block$data(q, U), Q.ok((Y = X.valid) !== null && Y !== void 0 ? Y : q);
        function U() {
          if (X.errors === false) {
            if (F(), X.modifying) r3(Q);
            w(() => Q.error());
          } else {
            let N = X.async ? V() : L();
            if (X.modifying) r3(Q);
            w(() => eM(Q, N));
          }
        }
        function V() {
          let N = $.let("ruleErrs", null);
          return $.try(() => F(T0._`await `), (j) => $.assign(q, false).if(T0._`${j} instanceof ${B.ValidationError}`, () => $.assign(N, T0._`${j}.errors`), () => $.throw(j))), N;
        }
        function L() {
          let N = T0._`${K}.errors`;
          return $.assign(N, null), F(T0.nil), N;
        }
        function F(N = X.async ? T0._`await ` : T0.nil) {
          let j = B.opts.passContext ? I6.default.this : I6.default.self, R = !("compile" in X && !H || X.schema === false);
          $.assign(q, T0._`${N}${(0, rM.callValidateCode)(Q, K, j, R)}`, X.modifying);
        }
        function w(N) {
          var j;
          $.if((0, T0.not)((j = X.valid) !== null && j !== void 0 ? j : q), N);
        }
      }
      a3.funcKeywordCode = sM;
      function r3(Q) {
        let { gen: X, data: Y, it: $ } = Q;
        X.if($.parentData, () => X.assign(Y, T0._`${$.parentData}[${$.parentDataProperty}]`));
      }
      function eM(Q, X) {
        let { gen: Y } = Q;
        Y.if(T0._`Array.isArray(${X})`, () => {
          Y.assign(I6.default.vErrors, T0._`${I6.default.vErrors} === null ? ${X} : ${I6.default.vErrors}.concat(${X})`).assign(I6.default.errors, T0._`${I6.default.vErrors}.length`), (0, tM.extendErrors)(Q);
        }, () => Q.error());
      }
      function QA({ schemaEnv: Q }, X) {
        if (X.async && !Q.$async) throw Error("async keyword in sync schema");
      }
      function t3(Q, X, Y) {
        if (Y === void 0) throw Error(`keyword "${X}" failed to compile`);
        return Q.scopeValue("keyword", typeof Y == "function" ? { ref: Y } : { ref: Y, code: (0, T0.stringify)(Y) });
      }
      function XA(Q, X, Y = false) {
        return !X.length || X.some(($) => $ === "array" ? Array.isArray(Q) : $ === "object" ? Q && typeof Q == "object" && !Array.isArray(Q) : typeof Q == $ || Y && typeof Q > "u");
      }
      a3.validSchemaType = XA;
      function YA({ schema: Q, opts: X, self: Y, errSchemaPath: $ }, J, W) {
        if (Array.isArray(J.keyword) ? !J.keyword.includes(W) : J.keyword !== W) throw Error("ajv implementation error");
        let G = J.dependencies;
        if (G === null || G === void 0 ? void 0 : G.some((H) => !Object.prototype.hasOwnProperty.call(Q, H))) throw Error(`parent schema must have dependencies of ${W}: ${G.join(",")}`);
        if (J.validateSchema) {
          if (!J.validateSchema(Q[W])) {
            let B = `keyword "${W}" value is invalid at path "${$}": ` + Y.errorsText(J.validateSchema.errors);
            if (X.validateSchema === "log") Y.logger.error(B);
            else throw Error(B);
          }
        }
      }
      a3.validateKeywordUsage = YA;
    });
    $H = E((XH) => {
      Object.defineProperty(XH, "__esModule", { value: true });
      XH.extendSubschemaMode = XH.extendSubschemaData = XH.getSubschema = void 0;
      var F1 = c(), QH = a();
      function GA(Q, { keyword: X, schemaProp: Y, schema: $, schemaPath: J, errSchemaPath: W, topSchemaRef: G }) {
        if (X !== void 0 && $ !== void 0) throw Error('both "keyword" and "schema" passed, only one allowed');
        if (X !== void 0) {
          let H = Q.schema[X];
          return Y === void 0 ? { schema: H, schemaPath: F1._`${Q.schemaPath}${(0, F1.getProperty)(X)}`, errSchemaPath: `${Q.errSchemaPath}/${X}` } : { schema: H[Y], schemaPath: F1._`${Q.schemaPath}${(0, F1.getProperty)(X)}${(0, F1.getProperty)(Y)}`, errSchemaPath: `${Q.errSchemaPath}/${X}/${(0, QH.escapeFragment)(Y)}` };
        }
        if ($ !== void 0) {
          if (J === void 0 || W === void 0 || G === void 0) throw Error('"schemaPath", "errSchemaPath" and "topSchemaRef" are required with "schema"');
          return { schema: $, schemaPath: J, topSchemaRef: G, errSchemaPath: W };
        }
        throw Error('either "keyword" or "schema" must be passed');
      }
      XH.getSubschema = GA;
      function HA(Q, X, { dataProp: Y, dataPropType: $, data: J, dataTypes: W, propertyName: G }) {
        if (J !== void 0 && Y !== void 0) throw Error('both "data" and "dataProp" passed, only one allowed');
        let { gen: H } = X;
        if (Y !== void 0) {
          let { errorPath: z, dataPathArr: K, opts: q } = X, U = H.let("data", F1._`${X.data}${(0, F1.getProperty)(Y)}`, true);
          B(U), Q.errorPath = F1.str`${z}${(0, QH.getErrorPath)(Y, $, q.jsPropertySyntax)}`, Q.parentDataProperty = F1._`${Y}`, Q.dataPathArr = [...K, Q.parentDataProperty];
        }
        if (J !== void 0) {
          let z = J instanceof F1.Name ? J : H.let("data", J, true);
          if (B(z), G !== void 0) Q.propertyName = G;
        }
        if (W) Q.dataTypes = W;
        function B(z) {
          Q.data = z, Q.dataLevel = X.dataLevel + 1, Q.dataTypes = [], X.definedProperties = /* @__PURE__ */ new Set(), Q.parentData = X.data, Q.dataNames = [...X.dataNames, z];
        }
      }
      XH.extendSubschemaData = HA;
      function BA(Q, { jtdDiscriminator: X, jtdMetadata: Y, compositeRule: $, createErrors: J, allErrors: W }) {
        if ($ !== void 0) Q.compositeRule = $;
        if (J !== void 0) Q.createErrors = J;
        if (W !== void 0) Q.allErrors = W;
        Q.jtdDiscriminator = X, Q.jtdMetadata = Y;
      }
      XH.extendSubschemaMode = BA;
    });
    n$ = E((tT, JH) => {
      JH.exports = function Q(X, Y) {
        if (X === Y) return true;
        if (X && Y && typeof X == "object" && typeof Y == "object") {
          if (X.constructor !== Y.constructor) return false;
          var $, J, W;
          if (Array.isArray(X)) {
            if ($ = X.length, $ != Y.length) return false;
            for (J = $; J-- !== 0; ) if (!Q(X[J], Y[J])) return false;
            return true;
          }
          if (X.constructor === RegExp) return X.source === Y.source && X.flags === Y.flags;
          if (X.valueOf !== Object.prototype.valueOf) return X.valueOf() === Y.valueOf();
          if (X.toString !== Object.prototype.toString) return X.toString() === Y.toString();
          if (W = Object.keys(X), $ = W.length, $ !== Object.keys(Y).length) return false;
          for (J = $; J-- !== 0; ) if (!Object.prototype.hasOwnProperty.call(Y, W[J])) return false;
          for (J = $; J-- !== 0; ) {
            var G = W[J];
            if (!Q(X[G], Y[G])) return false;
          }
          return true;
        }
        return X !== X && Y !== Y;
      };
    });
    GH = E((aT, WH) => {
      var e1 = WH.exports = function(Q, X, Y) {
        if (typeof X == "function") Y = X, X = {};
        Y = X.cb || Y;
        var $ = typeof Y == "function" ? Y : Y.pre || function() {
        }, J = Y.post || function() {
        };
        $Q(X, $, J, Q, "", Q);
      };
      e1.keywords = { additionalItems: true, items: true, contains: true, additionalProperties: true, propertyNames: true, not: true, if: true, then: true, else: true };
      e1.arrayKeywords = { items: true, allOf: true, anyOf: true, oneOf: true };
      e1.propsKeywords = { $defs: true, definitions: true, properties: true, patternProperties: true, dependencies: true };
      e1.skipKeywords = { default: true, enum: true, const: true, required: true, maximum: true, minimum: true, exclusiveMaximum: true, exclusiveMinimum: true, multipleOf: true, maxLength: true, minLength: true, pattern: true, format: true, maxItems: true, minItems: true, uniqueItems: true, maxProperties: true, minProperties: true };
      function $Q(Q, X, Y, $, J, W, G, H, B, z) {
        if ($ && typeof $ == "object" && !Array.isArray($)) {
          X($, J, W, G, H, B, z);
          for (var K in $) {
            var q = $[K];
            if (Array.isArray(q)) {
              if (K in e1.arrayKeywords) for (var U = 0; U < q.length; U++) $Q(Q, X, Y, q[U], J + "/" + K + "/" + U, W, J, K, $, U);
            } else if (K in e1.propsKeywords) {
              if (q && typeof q == "object") for (var V in q) $Q(Q, X, Y, q[V], J + "/" + K + "/" + VA(V), W, J, K, $, V);
            } else if (K in e1.keywords || Q.allKeys && !(K in e1.skipKeywords)) $Q(Q, X, Y, q, J + "/" + K, W, J, K, $);
          }
          Y($, J, W, G, H, B, z);
        }
      }
      function VA(Q) {
        return Q.replace(/~/g, "~0").replace(/\//g, "~1");
      }
    });
    w4 = E((KH) => {
      Object.defineProperty(KH, "__esModule", { value: true });
      KH.getSchemaRefs = KH.resolveUrl = KH.normalizeId = KH._getFullPath = KH.getFullPath = KH.inlineRef = void 0;
      var qA = a(), UA = n$(), LA = GH(), FA = /* @__PURE__ */ new Set(["type", "format", "pattern", "maxLength", "minLength", "maxProperties", "minProperties", "maxItems", "minItems", "maximum", "minimum", "uniqueItems", "multipleOf", "required", "enum", "const"]);
      function OA(Q, X = true) {
        if (typeof Q == "boolean") return true;
        if (X === true) return !o$(Q);
        if (!X) return false;
        return HH(Q) <= X;
      }
      KH.inlineRef = OA;
      var NA = /* @__PURE__ */ new Set(["$ref", "$recursiveRef", "$recursiveAnchor", "$dynamicRef", "$dynamicAnchor"]);
      function o$(Q) {
        for (let X in Q) {
          if (NA.has(X)) return true;
          let Y = Q[X];
          if (Array.isArray(Y) && Y.some(o$)) return true;
          if (typeof Y == "object" && o$(Y)) return true;
        }
        return false;
      }
      function HH(Q) {
        let X = 0;
        for (let Y in Q) {
          if (Y === "$ref") return 1 / 0;
          if (X++, FA.has(Y)) continue;
          if (typeof Q[Y] == "object") (0, qA.eachItem)(Q[Y], ($) => X += HH($));
          if (X === 1 / 0) return 1 / 0;
        }
        return X;
      }
      function BH(Q, X = "", Y) {
        if (Y !== false) X = w9(X);
        let $ = Q.parse(X);
        return zH(Q, $);
      }
      KH.getFullPath = BH;
      function zH(Q, X) {
        return Q.serialize(X).split("#")[0] + "#";
      }
      KH._getFullPath = zH;
      var DA = /#\/?$/;
      function w9(Q) {
        return Q ? Q.replace(DA, "") : "";
      }
      KH.normalizeId = w9;
      function wA(Q, X, Y) {
        return Y = w9(Y), Q.resolve(X, Y);
      }
      KH.resolveUrl = wA;
      var MA = /^[a-z_][-a-z0-9._]*$/i;
      function AA(Q, X) {
        if (typeof Q == "boolean") return {};
        let { schemaId: Y, uriResolver: $ } = this.opts, J = w9(Q[Y] || X), W = { "": J }, G = BH($, J, false), H = {}, B = /* @__PURE__ */ new Set();
        return LA(Q, { allKeys: true }, (q, U, V, L) => {
          if (L === void 0) return;
          let F = G + U, w = W[L];
          if (typeof q[Y] == "string") w = N.call(this, q[Y]);
          j.call(this, q.$anchor), j.call(this, q.$dynamicAnchor), W[U] = w;
          function N(R) {
            let C = this.opts.uriResolver.resolve;
            if (R = w9(w ? C(w, R) : R), B.has(R)) throw K(R);
            B.add(R);
            let Z = this.refs[R];
            if (typeof Z == "string") Z = this.refs[Z];
            if (typeof Z == "object") z(q, Z.schema, R);
            else if (R !== w9(F)) if (R[0] === "#") z(q, H[R], R), H[R] = q;
            else this.refs[R] = F;
            return R;
          }
          function j(R) {
            if (typeof R == "string") {
              if (!MA.test(R)) throw Error(`invalid anchor "${R}"`);
              N.call(this, `#${R}`);
            }
          }
        }), H;
        function z(q, U, V) {
          if (U !== void 0 && !UA(q, U)) throw K(V);
        }
        function K(q) {
          return Error(`reference "${q}" resolves to more than one schema`);
        }
      }
      KH.getSchemaRefs = AA;
    });
    j4 = E((EH) => {
      Object.defineProperty(EH, "__esModule", { value: true });
      EH.getData = EH.KeywordCxt = EH.validateFunctionCode = void 0;
      var OH = S3(), qH = D4(), t$ = u$(), JQ = D4(), PA = p3(), A4 = e3(), r$ = $H(), v = c(), f = E1(), ZA = w4(), P1 = a(), M4 = N4();
      function SA(Q) {
        if (wH(Q)) {
          if (MH(Q), DH(Q)) {
            kA(Q);
            return;
          }
        }
        NH(Q, () => (0, OH.topBoolOrEmptySchema)(Q));
      }
      EH.validateFunctionCode = SA;
      function NH({ gen: Q, validateName: X, schema: Y, schemaEnv: $, opts: J }, W) {
        if (J.code.es5) Q.func(X, v._`${f.default.data}, ${f.default.valCxt}`, $.$async, () => {
          Q.code(v._`"use strict"; ${UH(Y, J)}`), _A(Q, J), Q.code(W);
        });
        else Q.func(X, v._`${f.default.data}, ${CA(J)}`, $.$async, () => Q.code(UH(Y, J)).code(W));
      }
      function CA(Q) {
        return v._`{${f.default.instancePath}="", ${f.default.parentData}, ${f.default.parentDataProperty}, ${f.default.rootData}=${f.default.data}${Q.dynamicRef ? v._`, ${f.default.dynamicAnchors}={}` : v.nil}}={}`;
      }
      function _A(Q, X) {
        Q.if(f.default.valCxt, () => {
          if (Q.var(f.default.instancePath, v._`${f.default.valCxt}.${f.default.instancePath}`), Q.var(f.default.parentData, v._`${f.default.valCxt}.${f.default.parentData}`), Q.var(f.default.parentDataProperty, v._`${f.default.valCxt}.${f.default.parentDataProperty}`), Q.var(f.default.rootData, v._`${f.default.valCxt}.${f.default.rootData}`), X.dynamicRef) Q.var(f.default.dynamicAnchors, v._`${f.default.valCxt}.${f.default.dynamicAnchors}`);
        }, () => {
          if (Q.var(f.default.instancePath, v._`""`), Q.var(f.default.parentData, v._`undefined`), Q.var(f.default.parentDataProperty, v._`undefined`), Q.var(f.default.rootData, f.default.data), X.dynamicRef) Q.var(f.default.dynamicAnchors, v._`{}`);
        });
      }
      function kA(Q) {
        let { schema: X, opts: Y, gen: $ } = Q;
        NH(Q, () => {
          if (Y.$comment && X.$comment) jH(Q);
          if (gA(Q), $.let(f.default.vErrors, null), $.let(f.default.errors, 0), Y.unevaluated) vA(Q);
          AH(Q), uA(Q);
        });
        return;
      }
      function vA(Q) {
        let { gen: X, validateName: Y } = Q;
        Q.evaluated = X.const("evaluated", v._`${Y}.evaluated`), X.if(v._`${Q.evaluated}.dynamicProps`, () => X.assign(v._`${Q.evaluated}.props`, v._`undefined`)), X.if(v._`${Q.evaluated}.dynamicItems`, () => X.assign(v._`${Q.evaluated}.items`, v._`undefined`));
      }
      function UH(Q, X) {
        let Y = typeof Q == "object" && Q[X.schemaId];
        return Y && (X.code.source || X.code.process) ? v._`/*# sourceURL=${Y} */` : v.nil;
      }
      function TA(Q, X) {
        if (wH(Q)) {
          if (MH(Q), DH(Q)) {
            xA(Q, X);
            return;
          }
        }
        (0, OH.boolOrEmptySchema)(Q, X);
      }
      function DH({ schema: Q, self: X }) {
        if (typeof Q == "boolean") return !Q;
        for (let Y in Q) if (X.RULES.all[Y]) return true;
        return false;
      }
      function wH(Q) {
        return typeof Q.schema != "boolean";
      }
      function xA(Q, X) {
        let { schema: Y, gen: $, opts: J } = Q;
        if (J.$comment && Y.$comment) jH(Q);
        hA(Q), fA(Q);
        let W = $.const("_errs", f.default.errors);
        AH(Q, W), $.var(X, v._`${W} === ${f.default.errors}`);
      }
      function MH(Q) {
        (0, P1.checkUnknownRules)(Q), yA(Q);
      }
      function AH(Q, X) {
        if (Q.opts.jtd) return LH(Q, [], false, X);
        let Y = (0, qH.getSchemaTypes)(Q.schema), $ = (0, qH.coerceAndCheckDataType)(Q, Y);
        LH(Q, Y, !$, X);
      }
      function yA(Q) {
        let { schema: X, errSchemaPath: Y, opts: $, self: J } = Q;
        if (X.$ref && $.ignoreKeywordsWithRef && (0, P1.schemaHasRulesButRef)(X, J.RULES)) J.logger.warn(`$ref: keywords ignored in schema at path "${Y}"`);
      }
      function gA(Q) {
        let { schema: X, opts: Y } = Q;
        if (X.default !== void 0 && Y.useDefaults && Y.strictSchema) (0, P1.checkStrictMode)(Q, "default is ignored in the schema root");
      }
      function hA(Q) {
        let X = Q.schema[Q.opts.schemaId];
        if (X) Q.baseId = (0, ZA.resolveUrl)(Q.opts.uriResolver, Q.baseId, X);
      }
      function fA(Q) {
        if (Q.schema.$async && !Q.schemaEnv.$async) throw Error("async schema in sync schema");
      }
      function jH({ gen: Q, schemaEnv: X, schema: Y, errSchemaPath: $, opts: J }) {
        let W = Y.$comment;
        if (J.$comment === true) Q.code(v._`${f.default.self}.logger.log(${W})`);
        else if (typeof J.$comment == "function") {
          let G = v.str`${$}/$comment`, H = Q.scopeValue("root", { ref: X.root });
          Q.code(v._`${f.default.self}.opts.$comment(${W}, ${G}, ${H}.schema)`);
        }
      }
      function uA(Q) {
        let { gen: X, schemaEnv: Y, validateName: $, ValidationError: J, opts: W } = Q;
        if (Y.$async) X.if(v._`${f.default.errors} === 0`, () => X.return(f.default.data), () => X.throw(v._`new ${J}(${f.default.vErrors})`));
        else {
          if (X.assign(v._`${$}.errors`, f.default.vErrors), W.unevaluated) mA(Q);
          X.return(v._`${f.default.errors} === 0`);
        }
      }
      function mA({ gen: Q, evaluated: X, props: Y, items: $ }) {
        if (Y instanceof v.Name) Q.assign(v._`${X}.props`, Y);
        if ($ instanceof v.Name) Q.assign(v._`${X}.items`, $);
      }
      function LH(Q, X, Y, $) {
        let { gen: J, schema: W, data: G, allErrors: H, opts: B, self: z } = Q, { RULES: K } = z;
        if (W.$ref && (B.ignoreKeywordsWithRef || !(0, P1.schemaHasRulesButRef)(W, K))) {
          J.block(() => IH(Q, "$ref", K.all.$ref.definition));
          return;
        }
        if (!B.jtd) lA(Q, X);
        J.block(() => {
          for (let U of K.rules) q(U);
          q(K.post);
        });
        function q(U) {
          if (!(0, t$.shouldUseGroup)(W, U)) return;
          if (U.type) {
            if (J.if((0, JQ.checkDataType)(U.type, G, B.strictNumbers)), FH(Q, U), X.length === 1 && X[0] === U.type && Y) J.else(), (0, JQ.reportTypeError)(Q);
            J.endIf();
          } else FH(Q, U);
          if (!H) J.if(v._`${f.default.errors} === ${$ || 0}`);
        }
      }
      function FH(Q, X) {
        let { gen: Y, schema: $, opts: { useDefaults: J } } = Q;
        if (J) (0, PA.assignDefaults)(Q, X.type);
        Y.block(() => {
          for (let W of X.rules) if ((0, t$.shouldUseRule)($, W)) IH(Q, W.keyword, W.definition, X.type);
        });
      }
      function lA(Q, X) {
        if (Q.schemaEnv.meta || !Q.opts.strictTypes) return;
        if (cA(Q, X), !Q.opts.allowUnionTypes) pA(Q, X);
        dA(Q, Q.dataTypes);
      }
      function cA(Q, X) {
        if (!X.length) return;
        if (!Q.dataTypes.length) {
          Q.dataTypes = X;
          return;
        }
        X.forEach((Y) => {
          if (!RH(Q.dataTypes, Y)) a$(Q, `type "${Y}" not allowed by context "${Q.dataTypes.join(",")}"`);
        }), nA(Q, X);
      }
      function pA(Q, X) {
        if (X.length > 1 && !(X.length === 2 && X.includes("null"))) a$(Q, "use allowUnionTypes to allow union type keyword");
      }
      function dA(Q, X) {
        let Y = Q.self.RULES.all;
        for (let $ in Y) {
          let J = Y[$];
          if (typeof J == "object" && (0, t$.shouldUseRule)(Q.schema, J)) {
            let { type: W } = J.definition;
            if (W.length && !W.some((G) => iA(X, G))) a$(Q, `missing type "${W.join(",")}" for keyword "${$}"`);
          }
        }
      }
      function iA(Q, X) {
        return Q.includes(X) || X === "number" && Q.includes("integer");
      }
      function RH(Q, X) {
        return Q.includes(X) || X === "integer" && Q.includes("number");
      }
      function nA(Q, X) {
        let Y = [];
        for (let $ of Q.dataTypes) if (RH(X, $)) Y.push($);
        else if (X.includes("integer") && $ === "number") Y.push("integer");
        Q.dataTypes = Y;
      }
      function a$(Q, X) {
        let Y = Q.schemaEnv.baseId + Q.errSchemaPath;
        X += ` at "${Y}" (strictTypes)`, (0, P1.checkStrictMode)(Q, X, Q.opts.strictTypes);
      }
      class s$ {
        constructor(Q, X, Y) {
          if ((0, A4.validateKeywordUsage)(Q, X, Y), this.gen = Q.gen, this.allErrors = Q.allErrors, this.keyword = Y, this.data = Q.data, this.schema = Q.schema[Y], this.$data = X.$data && Q.opts.$data && this.schema && this.schema.$data, this.schemaValue = (0, P1.schemaRefOrVal)(Q, this.schema, Y, this.$data), this.schemaType = X.schemaType, this.parentSchema = Q.schema, this.params = {}, this.it = Q, this.def = X, this.$data) this.schemaCode = Q.gen.const("vSchema", bH(this.$data, Q));
          else if (this.schemaCode = this.schemaValue, !(0, A4.validSchemaType)(this.schema, X.schemaType, X.allowUndefined)) throw Error(`${Y} value must be ${JSON.stringify(X.schemaType)}`);
          if ("code" in X ? X.trackErrors : X.errors !== false) this.errsCount = Q.gen.const("_errs", f.default.errors);
        }
        result(Q, X, Y) {
          this.failResult((0, v.not)(Q), X, Y);
        }
        failResult(Q, X, Y) {
          if (this.gen.if(Q), Y) Y();
          else this.error();
          if (X) {
            if (this.gen.else(), X(), this.allErrors) this.gen.endIf();
          } else if (this.allErrors) this.gen.endIf();
          else this.gen.else();
        }
        pass(Q, X) {
          this.failResult((0, v.not)(Q), void 0, X);
        }
        fail(Q) {
          if (Q === void 0) {
            if (this.error(), !this.allErrors) this.gen.if(false);
            return;
          }
          if (this.gen.if(Q), this.error(), this.allErrors) this.gen.endIf();
          else this.gen.else();
        }
        fail$data(Q) {
          if (!this.$data) return this.fail(Q);
          let { schemaCode: X } = this;
          this.fail(v._`${X} !== undefined && (${(0, v.or)(this.invalid$data(), Q)})`);
        }
        error(Q, X, Y) {
          if (X) {
            this.setParams(X), this._error(Q, Y), this.setParams({});
            return;
          }
          this._error(Q, Y);
        }
        _error(Q, X) {
          (Q ? M4.reportExtraError : M4.reportError)(this, this.def.error, X);
        }
        $dataError() {
          (0, M4.reportError)(this, this.def.$dataError || M4.keyword$DataError);
        }
        reset() {
          if (this.errsCount === void 0) throw Error('add "trackErrors" to keyword definition');
          (0, M4.resetErrorsCount)(this.gen, this.errsCount);
        }
        ok(Q) {
          if (!this.allErrors) this.gen.if(Q);
        }
        setParams(Q, X) {
          if (X) Object.assign(this.params, Q);
          else this.params = Q;
        }
        block$data(Q, X, Y = v.nil) {
          this.gen.block(() => {
            this.check$data(Q, Y), X();
          });
        }
        check$data(Q = v.nil, X = v.nil) {
          if (!this.$data) return;
          let { gen: Y, schemaCode: $, schemaType: J, def: W } = this;
          if (Y.if((0, v.or)(v._`${$} === undefined`, X)), Q !== v.nil) Y.assign(Q, true);
          if (J.length || W.validateSchema) {
            if (Y.elseIf(this.invalid$data()), this.$dataError(), Q !== v.nil) Y.assign(Q, false);
          }
          Y.else();
        }
        invalid$data() {
          let { gen: Q, schemaCode: X, schemaType: Y, def: $, it: J } = this;
          return (0, v.or)(W(), G());
          function W() {
            if (Y.length) {
              if (!(X instanceof v.Name)) throw Error("ajv implementation error");
              let H = Array.isArray(Y) ? Y : [Y];
              return v._`${(0, JQ.checkDataTypes)(H, X, J.opts.strictNumbers, JQ.DataType.Wrong)}`;
            }
            return v.nil;
          }
          function G() {
            if ($.validateSchema) {
              let H = Q.scopeValue("validate$data", { ref: $.validateSchema });
              return v._`!${H}(${X})`;
            }
            return v.nil;
          }
        }
        subschema(Q, X) {
          let Y = (0, r$.getSubschema)(this.it, Q);
          (0, r$.extendSubschemaData)(Y, this.it, Q), (0, r$.extendSubschemaMode)(Y, Q);
          let $ = { ...this.it, ...Y, items: void 0, props: void 0 };
          return TA($, X), $;
        }
        mergeEvaluated(Q, X) {
          let { it: Y, gen: $ } = this;
          if (!Y.opts.unevaluated) return;
          if (Y.props !== true && Q.props !== void 0) Y.props = P1.mergeEvaluated.props($, Q.props, Y.props, X);
          if (Y.items !== true && Q.items !== void 0) Y.items = P1.mergeEvaluated.items($, Q.items, Y.items, X);
        }
        mergeValidEvaluated(Q, X) {
          let { it: Y, gen: $ } = this;
          if (Y.opts.unevaluated && (Y.props !== true || Y.items !== true)) return $.if(X, () => this.mergeEvaluated(Q, v.Name)), true;
        }
      }
      EH.KeywordCxt = s$;
      function IH(Q, X, Y, $) {
        let J = new s$(Q, Y, X);
        if ("code" in Y) Y.code(J, $);
        else if (J.$data && Y.validate) (0, A4.funcKeywordCode)(J, Y);
        else if ("macro" in Y) (0, A4.macroKeywordCode)(J, Y);
        else if (Y.compile || Y.validate) (0, A4.funcKeywordCode)(J, Y);
      }
      var oA = /^\/(?:[^~]|~0|~1)*$/, rA = /^([0-9]+)(#|\/(?:[^~]|~0|~1)*)?$/;
      function bH(Q, { dataLevel: X, dataNames: Y, dataPathArr: $ }) {
        let J, W;
        if (Q === "") return f.default.rootData;
        if (Q[0] === "/") {
          if (!oA.test(Q)) throw Error(`Invalid JSON-pointer: ${Q}`);
          J = Q, W = f.default.rootData;
        } else {
          let z = rA.exec(Q);
          if (!z) throw Error(`Invalid JSON-pointer: ${Q}`);
          let K = +z[1];
          if (J = z[2], J === "#") {
            if (K >= X) throw Error(B("property/index", K));
            return $[X - K];
          }
          if (K > X) throw Error(B("data", K));
          if (W = Y[X - K], !J) return W;
        }
        let G = W, H = J.split("/");
        for (let z of H) if (z) W = v._`${W}${(0, v.getProperty)((0, P1.unescapeJsonPointer)(z))}`, G = v._`${G} && ${W}`;
        return G;
        function B(z, K) {
          return `Cannot access ${z} ${K} levels up, current level is ${X}`;
        }
      }
      EH.getData = bH;
    });
    WQ = E((SH) => {
      Object.defineProperty(SH, "__esModule", { value: true });
      class ZH extends Error {
        constructor(Q) {
          super("validation failed");
          this.errors = Q, this.ajv = this.validation = true;
        }
      }
      SH.default = ZH;
    });
    R4 = E((_H) => {
      Object.defineProperty(_H, "__esModule", { value: true });
      var e$ = w4();
      class CH extends Error {
        constructor(Q, X, Y, $) {
          super($ || `can't resolve reference ${Y} from id ${X}`);
          this.missingRef = (0, e$.resolveUrl)(Q, X, Y), this.missingSchema = (0, e$.normalizeId)((0, e$.getFullPath)(Q, this.missingRef));
        }
      }
      _H.default = CH;
    });
    HQ = E((TH) => {
      Object.defineProperty(TH, "__esModule", { value: true });
      TH.resolveSchema = TH.getCompilingSchema = TH.resolveRef = TH.compileSchema = TH.SchemaEnv = void 0;
      var H1 = c(), Qj = WQ(), b6 = E1(), B1 = w4(), kH = a(), Xj = j4();
      class I4 {
        constructor(Q) {
          var X;
          this.refs = {}, this.dynamicAnchors = {};
          let Y;
          if (typeof Q.schema == "object") Y = Q.schema;
          this.schema = Q.schema, this.schemaId = Q.schemaId, this.root = Q.root || this, this.baseId = (X = Q.baseId) !== null && X !== void 0 ? X : (0, B1.normalizeId)(Y === null || Y === void 0 ? void 0 : Y[Q.schemaId || "$id"]), this.schemaPath = Q.schemaPath, this.localRefs = Q.localRefs, this.meta = Q.meta, this.$async = Y === null || Y === void 0 ? void 0 : Y.$async, this.refs = {};
        }
      }
      TH.SchemaEnv = I4;
      function X7(Q) {
        let X = vH.call(this, Q);
        if (X) return X;
        let Y = (0, B1.getFullPath)(this.opts.uriResolver, Q.root.baseId), { es5: $, lines: J } = this.opts.code, { ownProperties: W } = this.opts, G = new H1.CodeGen(this.scope, { es5: $, lines: J, ownProperties: W }), H;
        if (Q.$async) H = G.scopeValue("Error", { ref: Qj.default, code: H1._`require("ajv/dist/runtime/validation_error").default` });
        let B = G.scopeName("validate");
        Q.validateName = B;
        let z = { gen: G, allErrors: this.opts.allErrors, data: b6.default.data, parentData: b6.default.parentData, parentDataProperty: b6.default.parentDataProperty, dataNames: [b6.default.data], dataPathArr: [H1.nil], dataLevel: 0, dataTypes: [], definedProperties: /* @__PURE__ */ new Set(), topSchemaRef: G.scopeValue("schema", this.opts.code.source === true ? { ref: Q.schema, code: (0, H1.stringify)(Q.schema) } : { ref: Q.schema }), validateName: B, ValidationError: H, schema: Q.schema, schemaEnv: Q, rootId: Y, baseId: Q.baseId || Y, schemaPath: H1.nil, errSchemaPath: Q.schemaPath || (this.opts.jtd ? "" : "#"), errorPath: H1._`""`, opts: this.opts, self: this }, K;
        try {
          this._compilations.add(Q), (0, Xj.validateFunctionCode)(z), G.optimize(this.opts.code.optimize);
          let q = G.toString();
          if (K = `${G.scopeRefs(b6.default.scope)}return ${q}`, this.opts.code.process) K = this.opts.code.process(K, Q);
          let V = Function(`${b6.default.self}`, `${b6.default.scope}`, K)(this, this.scope.get());
          if (this.scope.value(B, { ref: V }), V.errors = null, V.schema = Q.schema, V.schemaEnv = Q, Q.$async) V.$async = true;
          if (this.opts.code.source === true) V.source = { validateName: B, validateCode: q, scopeValues: G._values };
          if (this.opts.unevaluated) {
            let { props: L, items: F } = z;
            if (V.evaluated = { props: L instanceof H1.Name ? void 0 : L, items: F instanceof H1.Name ? void 0 : F, dynamicProps: L instanceof H1.Name, dynamicItems: F instanceof H1.Name }, V.source) V.source.evaluated = (0, H1.stringify)(V.evaluated);
          }
          return Q.validate = V, Q;
        } catch (q) {
          if (delete Q.validate, delete Q.validateName, K) this.logger.error("Error compiling schema, function code:", K);
          throw q;
        } finally {
          this._compilations.delete(Q);
        }
      }
      TH.compileSchema = X7;
      function Yj(Q, X, Y) {
        var $;
        Y = (0, B1.resolveUrl)(this.opts.uriResolver, X, Y);
        let J = Q.refs[Y];
        if (J) return J;
        let W = Wj.call(this, Q, Y);
        if (W === void 0) {
          let G = ($ = Q.localRefs) === null || $ === void 0 ? void 0 : $[Y], { schemaId: H } = this.opts;
          if (G) W = new I4({ schema: G, schemaId: H, root: Q, baseId: X });
        }
        if (W === void 0) return;
        return Q.refs[Y] = $j.call(this, W);
      }
      TH.resolveRef = Yj;
      function $j(Q) {
        if ((0, B1.inlineRef)(Q.schema, this.opts.inlineRefs)) return Q.schema;
        return Q.validate ? Q : X7.call(this, Q);
      }
      function vH(Q) {
        for (let X of this._compilations) if (Jj(X, Q)) return X;
      }
      TH.getCompilingSchema = vH;
      function Jj(Q, X) {
        return Q.schema === X.schema && Q.root === X.root && Q.baseId === X.baseId;
      }
      function Wj(Q, X) {
        let Y;
        while (typeof (Y = this.refs[X]) == "string") X = Y;
        return Y || this.schemas[X] || GQ.call(this, Q, X);
      }
      function GQ(Q, X) {
        let Y = this.opts.uriResolver.parse(X), $ = (0, B1._getFullPath)(this.opts.uriResolver, Y), J = (0, B1.getFullPath)(this.opts.uriResolver, Q.baseId, void 0);
        if (Object.keys(Q.schema).length > 0 && $ === J) return Q7.call(this, Y, Q);
        let W = (0, B1.normalizeId)($), G = this.refs[W] || this.schemas[W];
        if (typeof G == "string") {
          let H = GQ.call(this, Q, G);
          if (typeof (H === null || H === void 0 ? void 0 : H.schema) !== "object") return;
          return Q7.call(this, Y, H);
        }
        if (typeof (G === null || G === void 0 ? void 0 : G.schema) !== "object") return;
        if (!G.validate) X7.call(this, G);
        if (W === (0, B1.normalizeId)(X)) {
          let { schema: H } = G, { schemaId: B } = this.opts, z = H[B];
          if (z) J = (0, B1.resolveUrl)(this.opts.uriResolver, J, z);
          return new I4({ schema: H, schemaId: B, root: Q, baseId: J });
        }
        return Q7.call(this, Y, G);
      }
      TH.resolveSchema = GQ;
      var Gj = /* @__PURE__ */ new Set(["properties", "patternProperties", "enum", "dependencies", "definitions"]);
      function Q7(Q, { baseId: X, schema: Y, root: $ }) {
        var J;
        if (((J = Q.fragment) === null || J === void 0 ? void 0 : J[0]) !== "/") return;
        for (let H of Q.fragment.slice(1).split("/")) {
          if (typeof Y === "boolean") return;
          let B = Y[(0, kH.unescapeFragment)(H)];
          if (B === void 0) return;
          Y = B;
          let z = typeof Y === "object" && Y[this.opts.schemaId];
          if (!Gj.has(H) && z) X = (0, B1.resolveUrl)(this.opts.uriResolver, X, z);
        }
        let W;
        if (typeof Y != "boolean" && Y.$ref && !(0, kH.schemaHasRulesButRef)(Y, this.RULES)) {
          let H = (0, B1.resolveUrl)(this.opts.uriResolver, X, Y.$ref);
          W = GQ.call(this, $, H);
        }
        let { schemaId: G } = this.opts;
        if (W = W || new I4({ schema: Y, schemaId: G, root: $, baseId: X }), W.schema !== W.root.schema) return W;
        return;
      }
    });
    yH = E(($x, Vj) => {
      Vj.exports = { $id: "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#", description: "Meta-schema for $data reference (JSON AnySchema extension proposal)", type: "object", required: ["$data"], properties: { $data: { type: "string", anyOf: [{ format: "relative-json-pointer" }, { format: "json-pointer" }] } }, additionalProperties: false };
    });
    hH = E((Jx, gH) => {
      var qj = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, a: 10, A: 10, b: 11, B: 11, c: 12, C: 12, d: 13, D: 13, e: 14, E: 14, f: 15, F: 15 };
      gH.exports = { HEX: qj };
    });
    iH = E((Wx, dH) => {
      var { HEX: Uj } = hH(), Lj = /^(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)$/u;
      function lH(Q) {
        if (pH(Q, ".") < 3) return { host: Q, isIPV4: false };
        let X = Q.match(Lj) || [], [Y] = X;
        if (Y) return { host: Oj(Y, "."), isIPV4: true };
        else return { host: Q, isIPV4: false };
      }
      function Y7(Q, X = false) {
        let Y = "", $ = true;
        for (let J of Q) {
          if (Uj[J] === void 0) return;
          if (J !== "0" && $ === true) $ = false;
          if (!$) Y += J;
        }
        if (X && Y.length === 0) Y = "0";
        return Y;
      }
      function Fj(Q) {
        let X = 0, Y = { error: false, address: "", zone: "" }, $ = [], J = [], W = false, G = false, H = false;
        function B() {
          if (J.length) {
            if (W === false) {
              let z = Y7(J);
              if (z !== void 0) $.push(z);
              else return Y.error = true, false;
            }
            J.length = 0;
          }
          return true;
        }
        for (let z = 0; z < Q.length; z++) {
          let K = Q[z];
          if (K === "[" || K === "]") continue;
          if (K === ":") {
            if (G === true) H = true;
            if (!B()) break;
            if (X++, $.push(":"), X > 7) {
              Y.error = true;
              break;
            }
            if (z - 1 >= 0 && Q[z - 1] === ":") G = true;
            continue;
          } else if (K === "%") {
            if (!B()) break;
            W = true;
          } else {
            J.push(K);
            continue;
          }
        }
        if (J.length) if (W) Y.zone = J.join("");
        else if (H) $.push(J.join(""));
        else $.push(Y7(J));
        return Y.address = $.join(""), Y;
      }
      function cH(Q) {
        if (pH(Q, ":") < 2) return { host: Q, isIPV6: false };
        let X = Fj(Q);
        if (!X.error) {
          let { address: Y, address: $ } = X;
          if (X.zone) Y += "%" + X.zone, $ += "%25" + X.zone;
          return { host: Y, escapedHost: $, isIPV6: true };
        } else return { host: Q, isIPV6: false };
      }
      function Oj(Q, X) {
        let Y = "", $ = true, J = Q.length;
        for (let W = 0; W < J; W++) {
          let G = Q[W];
          if (G === "0" && $) {
            if (W + 1 <= J && Q[W + 1] === X || W + 1 === J) Y += G, $ = false;
          } else {
            if (G === X) $ = true;
            else $ = false;
            Y += G;
          }
        }
        return Y;
      }
      function pH(Q, X) {
        let Y = 0;
        for (let $ = 0; $ < Q.length; $++) if (Q[$] === X) Y++;
        return Y;
      }
      var fH = /^\.\.?\//u, uH = /^\/\.(?:\/|$)/u, mH = /^\/\.\.(?:\/|$)/u, Nj = /^\/?(?:.|\n)*?(?=\/|$)/u;
      function Dj(Q) {
        let X = [];
        while (Q.length) if (Q.match(fH)) Q = Q.replace(fH, "");
        else if (Q.match(uH)) Q = Q.replace(uH, "/");
        else if (Q.match(mH)) Q = Q.replace(mH, "/"), X.pop();
        else if (Q === "." || Q === "..") Q = "";
        else {
          let Y = Q.match(Nj);
          if (Y) {
            let $ = Y[0];
            Q = Q.slice($.length), X.push($);
          } else throw Error("Unexpected dot segment condition");
        }
        return X.join("");
      }
      function wj(Q, X) {
        let Y = X !== true ? escape : unescape;
        if (Q.scheme !== void 0) Q.scheme = Y(Q.scheme);
        if (Q.userinfo !== void 0) Q.userinfo = Y(Q.userinfo);
        if (Q.host !== void 0) Q.host = Y(Q.host);
        if (Q.path !== void 0) Q.path = Y(Q.path);
        if (Q.query !== void 0) Q.query = Y(Q.query);
        if (Q.fragment !== void 0) Q.fragment = Y(Q.fragment);
        return Q;
      }
      function Mj(Q) {
        let X = [];
        if (Q.userinfo !== void 0) X.push(Q.userinfo), X.push("@");
        if (Q.host !== void 0) {
          let Y = unescape(Q.host), $ = lH(Y);
          if ($.isIPV4) Y = $.host;
          else {
            let J = cH($.host);
            if (J.isIPV6 === true) Y = `[${J.escapedHost}]`;
            else Y = Q.host;
          }
          X.push(Y);
        }
        if (typeof Q.port === "number" || typeof Q.port === "string") X.push(":"), X.push(String(Q.port));
        return X.length ? X.join("") : void 0;
      }
      dH.exports = { recomposeAuthority: Mj, normalizeComponentEncoding: wj, removeDotSegments: Dj, normalizeIPv4: lH, normalizeIPv6: cH, stringArrayToHexStripped: Y7 };
    });
    sH = E((Gx, aH) => {
      var Aj = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu, jj = /([\da-z][\d\-a-z]{0,31}):((?:[\w!$'()*+,\-.:;=@]|%[\da-f]{2})+)/iu;
      function nH(Q) {
        return typeof Q.secure === "boolean" ? Q.secure : String(Q.scheme).toLowerCase() === "wss";
      }
      function oH(Q) {
        if (!Q.host) Q.error = Q.error || "HTTP URIs must have a host.";
        return Q;
      }
      function rH(Q) {
        let X = String(Q.scheme).toLowerCase() === "https";
        if (Q.port === (X ? 443 : 80) || Q.port === "") Q.port = void 0;
        if (!Q.path) Q.path = "/";
        return Q;
      }
      function Rj(Q) {
        return Q.secure = nH(Q), Q.resourceName = (Q.path || "/") + (Q.query ? "?" + Q.query : ""), Q.path = void 0, Q.query = void 0, Q;
      }
      function Ij(Q) {
        if (Q.port === (nH(Q) ? 443 : 80) || Q.port === "") Q.port = void 0;
        if (typeof Q.secure === "boolean") Q.scheme = Q.secure ? "wss" : "ws", Q.secure = void 0;
        if (Q.resourceName) {
          let [X, Y] = Q.resourceName.split("?");
          Q.path = X && X !== "/" ? X : void 0, Q.query = Y, Q.resourceName = void 0;
        }
        return Q.fragment = void 0, Q;
      }
      function bj(Q, X) {
        if (!Q.path) return Q.error = "URN can not be parsed", Q;
        let Y = Q.path.match(jj);
        if (Y) {
          let $ = X.scheme || Q.scheme || "urn";
          Q.nid = Y[1].toLowerCase(), Q.nss = Y[2];
          let J = `${$}:${X.nid || Q.nid}`, W = $7[J];
          if (Q.path = void 0, W) Q = W.parse(Q, X);
        } else Q.error = Q.error || "URN can not be parsed.";
        return Q;
      }
      function Ej(Q, X) {
        let Y = X.scheme || Q.scheme || "urn", $ = Q.nid.toLowerCase(), J = `${Y}:${X.nid || $}`, W = $7[J];
        if (W) Q = W.serialize(Q, X);
        let G = Q, H = Q.nss;
        return G.path = `${$ || X.nid}:${H}`, X.skipEscape = true, G;
      }
      function Pj(Q, X) {
        let Y = Q;
        if (Y.uuid = Y.nss, Y.nss = void 0, !X.tolerant && (!Y.uuid || !Aj.test(Y.uuid))) Y.error = Y.error || "UUID is not valid.";
        return Y;
      }
      function Zj(Q) {
        let X = Q;
        return X.nss = (Q.uuid || "").toLowerCase(), X;
      }
      var tH = { scheme: "http", domainHost: true, parse: oH, serialize: rH }, Sj = { scheme: "https", domainHost: tH.domainHost, parse: oH, serialize: rH }, BQ = { scheme: "ws", domainHost: true, parse: Rj, serialize: Ij }, Cj = { scheme: "wss", domainHost: BQ.domainHost, parse: BQ.parse, serialize: BQ.serialize }, _j = { scheme: "urn", parse: bj, serialize: Ej, skipNormalize: true }, kj = { scheme: "urn:uuid", parse: Pj, serialize: Zj, skipNormalize: true }, $7 = { http: tH, https: Sj, ws: BQ, wss: Cj, urn: _j, "urn:uuid": kj };
      aH.exports = $7;
    });
    QB = E((Hx, KQ) => {
      var { normalizeIPv6: vj, normalizeIPv4: Tj, removeDotSegments: b4, recomposeAuthority: xj, normalizeComponentEncoding: zQ } = iH(), J7 = sH();
      function yj(Q, X) {
        if (typeof Q === "string") Q = O1(Z1(Q, X), X);
        else if (typeof Q === "object") Q = Z1(O1(Q, X), X);
        return Q;
      }
      function gj(Q, X, Y) {
        let $ = Object.assign({ scheme: "null" }, Y), J = eH(Z1(Q, $), Z1(X, $), $, true);
        return O1(J, { ...$, skipEscape: true });
      }
      function eH(Q, X, Y, $) {
        let J = {};
        if (!$) Q = Z1(O1(Q, Y), Y), X = Z1(O1(X, Y), Y);
        if (Y = Y || {}, !Y.tolerant && X.scheme) J.scheme = X.scheme, J.userinfo = X.userinfo, J.host = X.host, J.port = X.port, J.path = b4(X.path || ""), J.query = X.query;
        else {
          if (X.userinfo !== void 0 || X.host !== void 0 || X.port !== void 0) J.userinfo = X.userinfo, J.host = X.host, J.port = X.port, J.path = b4(X.path || ""), J.query = X.query;
          else {
            if (!X.path) if (J.path = Q.path, X.query !== void 0) J.query = X.query;
            else J.query = Q.query;
            else {
              if (X.path.charAt(0) === "/") J.path = b4(X.path);
              else {
                if ((Q.userinfo !== void 0 || Q.host !== void 0 || Q.port !== void 0) && !Q.path) J.path = "/" + X.path;
                else if (!Q.path) J.path = X.path;
                else J.path = Q.path.slice(0, Q.path.lastIndexOf("/") + 1) + X.path;
                J.path = b4(J.path);
              }
              J.query = X.query;
            }
            J.userinfo = Q.userinfo, J.host = Q.host, J.port = Q.port;
          }
          J.scheme = Q.scheme;
        }
        return J.fragment = X.fragment, J;
      }
      function hj(Q, X, Y) {
        if (typeof Q === "string") Q = unescape(Q), Q = O1(zQ(Z1(Q, Y), true), { ...Y, skipEscape: true });
        else if (typeof Q === "object") Q = O1(zQ(Q, true), { ...Y, skipEscape: true });
        if (typeof X === "string") X = unescape(X), X = O1(zQ(Z1(X, Y), true), { ...Y, skipEscape: true });
        else if (typeof X === "object") X = O1(zQ(X, true), { ...Y, skipEscape: true });
        return Q.toLowerCase() === X.toLowerCase();
      }
      function O1(Q, X) {
        let Y = { host: Q.host, scheme: Q.scheme, userinfo: Q.userinfo, port: Q.port, path: Q.path, query: Q.query, nid: Q.nid, nss: Q.nss, uuid: Q.uuid, fragment: Q.fragment, reference: Q.reference, resourceName: Q.resourceName, secure: Q.secure, error: "" }, $ = Object.assign({}, X), J = [], W = J7[($.scheme || Y.scheme || "").toLowerCase()];
        if (W && W.serialize) W.serialize(Y, $);
        if (Y.path !== void 0) if (!$.skipEscape) {
          if (Y.path = escape(Y.path), Y.scheme !== void 0) Y.path = Y.path.split("%3A").join(":");
        } else Y.path = unescape(Y.path);
        if ($.reference !== "suffix" && Y.scheme) J.push(Y.scheme, ":");
        let G = xj(Y);
        if (G !== void 0) {
          if ($.reference !== "suffix") J.push("//");
          if (J.push(G), Y.path && Y.path.charAt(0) !== "/") J.push("/");
        }
        if (Y.path !== void 0) {
          let H = Y.path;
          if (!$.absolutePath && (!W || !W.absolutePath)) H = b4(H);
          if (G === void 0) H = H.replace(/^\/\//u, "/%2F");
          J.push(H);
        }
        if (Y.query !== void 0) J.push("?", Y.query);
        if (Y.fragment !== void 0) J.push("#", Y.fragment);
        return J.join("");
      }
      var fj = Array.from({ length: 127 }, (Q, X) => /[^!"$&'()*+,\-.;=_`a-z{}~]/u.test(String.fromCharCode(X)));
      function uj(Q) {
        let X = 0;
        for (let Y = 0, $ = Q.length; Y < $; ++Y) if (X = Q.charCodeAt(Y), X > 126 || fj[X]) return true;
        return false;
      }
      var mj = /^(?:([^#/:?]+):)?(?:\/\/((?:([^#/?@]*)@)?(\[[^#/?\]]+\]|[^#/:?]*)(?::(\d*))?))?([^#?]*)(?:\?([^#]*))?(?:#((?:.|[\n\r])*))?/u;
      function Z1(Q, X) {
        let Y = Object.assign({}, X), $ = { scheme: void 0, userinfo: void 0, host: "", port: void 0, path: "", query: void 0, fragment: void 0 }, J = Q.indexOf("%") !== -1, W = false;
        if (Y.reference === "suffix") Q = (Y.scheme ? Y.scheme + ":" : "") + "//" + Q;
        let G = Q.match(mj);
        if (G) {
          if ($.scheme = G[1], $.userinfo = G[3], $.host = G[4], $.port = parseInt(G[5], 10), $.path = G[6] || "", $.query = G[7], $.fragment = G[8], isNaN($.port)) $.port = G[5];
          if ($.host) {
            let B = Tj($.host);
            if (B.isIPV4 === false) {
              let z = vj(B.host);
              $.host = z.host.toLowerCase(), W = z.isIPV6;
            } else $.host = B.host, W = true;
          }
          if ($.scheme === void 0 && $.userinfo === void 0 && $.host === void 0 && $.port === void 0 && $.query === void 0 && !$.path) $.reference = "same-document";
          else if ($.scheme === void 0) $.reference = "relative";
          else if ($.fragment === void 0) $.reference = "absolute";
          else $.reference = "uri";
          if (Y.reference && Y.reference !== "suffix" && Y.reference !== $.reference) $.error = $.error || "URI is not a " + Y.reference + " reference.";
          let H = J7[(Y.scheme || $.scheme || "").toLowerCase()];
          if (!Y.unicodeSupport && (!H || !H.unicodeSupport)) {
            if ($.host && (Y.domainHost || H && H.domainHost) && W === false && uj($.host)) try {
              $.host = URL.domainToASCII($.host.toLowerCase());
            } catch (B) {
              $.error = $.error || "Host's domain name can not be converted to ASCII: " + B;
            }
          }
          if (!H || H && !H.skipNormalize) {
            if (J && $.scheme !== void 0) $.scheme = unescape($.scheme);
            if (J && $.host !== void 0) $.host = unescape($.host);
            if ($.path) $.path = escape(unescape($.path));
            if ($.fragment) $.fragment = encodeURI(decodeURIComponent($.fragment));
          }
          if (H && H.parse) H.parse($, Y);
        } else $.error = $.error || "URI can not be parsed.";
        return $;
      }
      var W7 = { SCHEMES: J7, normalize: yj, resolve: gj, resolveComponents: eH, equal: hj, serialize: O1, parse: Z1 };
      KQ.exports = W7;
      KQ.exports.default = W7;
      KQ.exports.fastUri = W7;
    });
    $B = E((YB) => {
      Object.defineProperty(YB, "__esModule", { value: true });
      var XB = QB();
      XB.code = 'require("ajv/dist/runtime/uri").default';
      YB.default = XB;
    });
    VB = E((S1) => {
      Object.defineProperty(S1, "__esModule", { value: true });
      S1.CodeGen = S1.Name = S1.nil = S1.stringify = S1.str = S1._ = S1.KeywordCxt = void 0;
      var cj = j4();
      Object.defineProperty(S1, "KeywordCxt", { enumerable: true, get: function() {
        return cj.KeywordCxt;
      } });
      var M9 = c();
      Object.defineProperty(S1, "_", { enumerable: true, get: function() {
        return M9._;
      } });
      Object.defineProperty(S1, "str", { enumerable: true, get: function() {
        return M9.str;
      } });
      Object.defineProperty(S1, "stringify", { enumerable: true, get: function() {
        return M9.stringify;
      } });
      Object.defineProperty(S1, "nil", { enumerable: true, get: function() {
        return M9.nil;
      } });
      Object.defineProperty(S1, "Name", { enumerable: true, get: function() {
        return M9.Name;
      } });
      Object.defineProperty(S1, "CodeGen", { enumerable: true, get: function() {
        return M9.CodeGen;
      } });
      var pj = WQ(), BB = R4(), dj = f$(), E4 = HQ(), ij = c(), P4 = w4(), VQ = D4(), H7 = a(), JB = yH(), nj = $B(), zB = (Q, X) => new RegExp(Q, X);
      zB.code = "new RegExp";
      var oj = ["removeAdditional", "useDefaults", "coerceTypes"], rj = /* @__PURE__ */ new Set(["validate", "serialize", "parse", "wrapper", "root", "schema", "keyword", "pattern", "formats", "validate$data", "func", "obj", "Error"]), tj = { errorDataPath: "", format: "`validateFormats: false` can be used instead.", nullable: '"nullable" keyword is supported by default.', jsonPointers: "Deprecated jsPropertySyntax can be used instead.", extendRefs: "Deprecated ignoreKeywordsWithRef can be used instead.", missingRefs: "Pass empty schema with $id that should be ignored to ajv.addSchema.", processCode: "Use option `code: {process: (code, schemaEnv: object) => string}`", sourceCode: "Use option `code: {source: true}`", strictDefaults: "It is default now, see option `strict`.", strictKeywords: "It is default now, see option `strict`.", uniqueItems: '"uniqueItems" keyword is always validated.', unknownFormats: "Disable strict mode or pass `true` to `ajv.addFormat` (or `formats` option).", cache: "Map is used as cache, schema object as key.", serialize: "Map is used as cache, schema object as key.", ajvErrors: "It is default now." }, aj = { ignoreKeywordsWithRef: "", jsPropertySyntax: "", unicode: '"minLength"/"maxLength" account for unicode characters by default.' }, WB = 200;
      function sj(Q) {
        var X, Y, $, J, W, G, H, B, z, K, q, U, V, L, F, w, N, j, R, C, Z, X0, O0, S0, $6;
        let w1 = Q.strict, J6 = (X = Q.code) === null || X === void 0 ? void 0 : X.optimize, C1 = J6 === true || J6 === void 0 ? 1 : J6 || 0, W6 = ($ = (Y = Q.code) === null || Y === void 0 ? void 0 : Y.regExp) !== null && $ !== void 0 ? $ : zB, h = (J = Q.uriResolver) !== null && J !== void 0 ? J : nj.default;
        return { strictSchema: (G = (W = Q.strictSchema) !== null && W !== void 0 ? W : w1) !== null && G !== void 0 ? G : true, strictNumbers: (B = (H = Q.strictNumbers) !== null && H !== void 0 ? H : w1) !== null && B !== void 0 ? B : true, strictTypes: (K = (z = Q.strictTypes) !== null && z !== void 0 ? z : w1) !== null && K !== void 0 ? K : "log", strictTuples: (U = (q = Q.strictTuples) !== null && q !== void 0 ? q : w1) !== null && U !== void 0 ? U : "log", strictRequired: (L = (V = Q.strictRequired) !== null && V !== void 0 ? V : w1) !== null && L !== void 0 ? L : false, code: Q.code ? { ...Q.code, optimize: C1, regExp: W6 } : { optimize: C1, regExp: W6 }, loopRequired: (F = Q.loopRequired) !== null && F !== void 0 ? F : WB, loopEnum: (w = Q.loopEnum) !== null && w !== void 0 ? w : WB, meta: (N = Q.meta) !== null && N !== void 0 ? N : true, messages: (j = Q.messages) !== null && j !== void 0 ? j : true, inlineRefs: (R = Q.inlineRefs) !== null && R !== void 0 ? R : true, schemaId: (C = Q.schemaId) !== null && C !== void 0 ? C : "$id", addUsedSchema: (Z = Q.addUsedSchema) !== null && Z !== void 0 ? Z : true, validateSchema: (X0 = Q.validateSchema) !== null && X0 !== void 0 ? X0 : true, validateFormats: (O0 = Q.validateFormats) !== null && O0 !== void 0 ? O0 : true, unicodeRegExp: (S0 = Q.unicodeRegExp) !== null && S0 !== void 0 ? S0 : true, int32range: ($6 = Q.int32range) !== null && $6 !== void 0 ? $6 : true, uriResolver: h };
      }
      class qQ {
        constructor(Q = {}) {
          this.schemas = {}, this.refs = {}, this.formats = {}, this._compilations = /* @__PURE__ */ new Set(), this._loading = {}, this._cache = /* @__PURE__ */ new Map(), Q = this.opts = { ...Q, ...sj(Q) };
          let { es5: X, lines: Y } = this.opts.code;
          this.scope = new ij.ValueScope({ scope: {}, prefixes: rj, es5: X, lines: Y }), this.logger = JR(Q.logger);
          let $ = Q.validateFormats;
          if (Q.validateFormats = false, this.RULES = (0, dj.getRules)(), GB.call(this, tj, Q, "NOT SUPPORTED"), GB.call(this, aj, Q, "DEPRECATED", "warn"), this._metaOpts = YR.call(this), Q.formats) QR.call(this);
          if (this._addVocabularies(), this._addDefaultMetaSchema(), Q.keywords) XR.call(this, Q.keywords);
          if (typeof Q.meta == "object") this.addMetaSchema(Q.meta);
          ej.call(this), Q.validateFormats = $;
        }
        _addVocabularies() {
          this.addKeyword("$async");
        }
        _addDefaultMetaSchema() {
          let { $data: Q, meta: X, schemaId: Y } = this.opts, $ = JB;
          if (Y === "id") $ = { ...JB }, $.id = $.$id, delete $.$id;
          if (X && Q) this.addMetaSchema($, $[Y], false);
        }
        defaultMeta() {
          let { meta: Q, schemaId: X } = this.opts;
          return this.opts.defaultMeta = typeof Q == "object" ? Q[X] || Q : void 0;
        }
        validate(Q, X) {
          let Y;
          if (typeof Q == "string") {
            if (Y = this.getSchema(Q), !Y) throw Error(`no schema with key or ref "${Q}"`);
          } else Y = this.compile(Q);
          let $ = Y(X);
          if (!("$async" in Y)) this.errors = Y.errors;
          return $;
        }
        compile(Q, X) {
          let Y = this._addSchema(Q, X);
          return Y.validate || this._compileSchemaEnv(Y);
        }
        compileAsync(Q, X) {
          if (typeof this.opts.loadSchema != "function") throw Error("options.loadSchema should be a function");
          let { loadSchema: Y } = this.opts;
          return $.call(this, Q, X);
          async function $(z, K) {
            await J.call(this, z.$schema);
            let q = this._addSchema(z, K);
            return q.validate || W.call(this, q);
          }
          async function J(z) {
            if (z && !this.getSchema(z)) await $.call(this, { $ref: z }, true);
          }
          async function W(z) {
            try {
              return this._compileSchemaEnv(z);
            } catch (K) {
              if (!(K instanceof BB.default)) throw K;
              return G.call(this, K), await H.call(this, K.missingSchema), W.call(this, z);
            }
          }
          function G({ missingSchema: z, missingRef: K }) {
            if (this.refs[z]) throw Error(`AnySchema ${z} is loaded but ${K} cannot be resolved`);
          }
          async function H(z) {
            let K = await B.call(this, z);
            if (!this.refs[z]) await J.call(this, K.$schema);
            if (!this.refs[z]) this.addSchema(K, z, X);
          }
          async function B(z) {
            let K = this._loading[z];
            if (K) return K;
            try {
              return await (this._loading[z] = Y(z));
            } finally {
              delete this._loading[z];
            }
          }
        }
        addSchema(Q, X, Y, $ = this.opts.validateSchema) {
          if (Array.isArray(Q)) {
            for (let W of Q) this.addSchema(W, void 0, Y, $);
            return this;
          }
          let J;
          if (typeof Q === "object") {
            let { schemaId: W } = this.opts;
            if (J = Q[W], J !== void 0 && typeof J != "string") throw Error(`schema ${W} must be string`);
          }
          return X = (0, P4.normalizeId)(X || J), this._checkUnique(X), this.schemas[X] = this._addSchema(Q, Y, X, $, true), this;
        }
        addMetaSchema(Q, X, Y = this.opts.validateSchema) {
          return this.addSchema(Q, X, true, Y), this;
        }
        validateSchema(Q, X) {
          if (typeof Q == "boolean") return true;
          let Y;
          if (Y = Q.$schema, Y !== void 0 && typeof Y != "string") throw Error("$schema must be a string");
          if (Y = Y || this.opts.defaultMeta || this.defaultMeta(), !Y) return this.logger.warn("meta-schema not available"), this.errors = null, true;
          let $ = this.validate(Y, Q);
          if (!$ && X) {
            let J = "schema is invalid: " + this.errorsText();
            if (this.opts.validateSchema === "log") this.logger.error(J);
            else throw Error(J);
          }
          return $;
        }
        getSchema(Q) {
          let X;
          while (typeof (X = HB.call(this, Q)) == "string") Q = X;
          if (X === void 0) {
            let { schemaId: Y } = this.opts, $ = new E4.SchemaEnv({ schema: {}, schemaId: Y });
            if (X = E4.resolveSchema.call(this, $, Q), !X) return;
            this.refs[Q] = X;
          }
          return X.validate || this._compileSchemaEnv(X);
        }
        removeSchema(Q) {
          if (Q instanceof RegExp) return this._removeAllSchemas(this.schemas, Q), this._removeAllSchemas(this.refs, Q), this;
          switch (typeof Q) {
            case "undefined":
              return this._removeAllSchemas(this.schemas), this._removeAllSchemas(this.refs), this._cache.clear(), this;
            case "string": {
              let X = HB.call(this, Q);
              if (typeof X == "object") this._cache.delete(X.schema);
              return delete this.schemas[Q], delete this.refs[Q], this;
            }
            case "object": {
              let X = Q;
              this._cache.delete(X);
              let Y = Q[this.opts.schemaId];
              if (Y) Y = (0, P4.normalizeId)(Y), delete this.schemas[Y], delete this.refs[Y];
              return this;
            }
            default:
              throw Error("ajv.removeSchema: invalid parameter");
          }
        }
        addVocabulary(Q) {
          for (let X of Q) this.addKeyword(X);
          return this;
        }
        addKeyword(Q, X) {
          let Y;
          if (typeof Q == "string") {
            if (Y = Q, typeof X == "object") this.logger.warn("these parameters are deprecated, see docs for addKeyword"), X.keyword = Y;
          } else if (typeof Q == "object" && X === void 0) {
            if (X = Q, Y = X.keyword, Array.isArray(Y) && !Y.length) throw Error("addKeywords: keyword must be string or non-empty array");
          } else throw Error("invalid addKeywords parameters");
          if (GR.call(this, Y, X), !X) return (0, H7.eachItem)(Y, (J) => G7.call(this, J)), this;
          BR.call(this, X);
          let $ = { ...X, type: (0, VQ.getJSONTypes)(X.type), schemaType: (0, VQ.getJSONTypes)(X.schemaType) };
          return (0, H7.eachItem)(Y, $.type.length === 0 ? (J) => G7.call(this, J, $) : (J) => $.type.forEach((W) => G7.call(this, J, $, W))), this;
        }
        getKeyword(Q) {
          let X = this.RULES.all[Q];
          return typeof X == "object" ? X.definition : !!X;
        }
        removeKeyword(Q) {
          let { RULES: X } = this;
          delete X.keywords[Q], delete X.all[Q];
          for (let Y of X.rules) {
            let $ = Y.rules.findIndex((J) => J.keyword === Q);
            if ($ >= 0) Y.rules.splice($, 1);
          }
          return this;
        }
        addFormat(Q, X) {
          if (typeof X == "string") X = new RegExp(X);
          return this.formats[Q] = X, this;
        }
        errorsText(Q = this.errors, { separator: X = ", ", dataVar: Y = "data" } = {}) {
          if (!Q || Q.length === 0) return "No errors";
          return Q.map(($) => `${Y}${$.instancePath} ${$.message}`).reduce(($, J) => $ + X + J);
        }
        $dataMetaSchema(Q, X) {
          let Y = this.RULES.all;
          Q = JSON.parse(JSON.stringify(Q));
          for (let $ of X) {
            let J = $.split("/").slice(1), W = Q;
            for (let G of J) W = W[G];
            for (let G in Y) {
              let H = Y[G];
              if (typeof H != "object") continue;
              let { $data: B } = H.definition, z = W[G];
              if (B && z) W[G] = KB(z);
            }
          }
          return Q;
        }
        _removeAllSchemas(Q, X) {
          for (let Y in Q) {
            let $ = Q[Y];
            if (!X || X.test(Y)) {
              if (typeof $ == "string") delete Q[Y];
              else if ($ && !$.meta) this._cache.delete($.schema), delete Q[Y];
            }
          }
        }
        _addSchema(Q, X, Y, $ = this.opts.validateSchema, J = this.opts.addUsedSchema) {
          let W, { schemaId: G } = this.opts;
          if (typeof Q == "object") W = Q[G];
          else if (this.opts.jtd) throw Error("schema must be object");
          else if (typeof Q != "boolean") throw Error("schema must be object or boolean");
          let H = this._cache.get(Q);
          if (H !== void 0) return H;
          Y = (0, P4.normalizeId)(W || Y);
          let B = P4.getSchemaRefs.call(this, Q, Y);
          if (H = new E4.SchemaEnv({ schema: Q, schemaId: G, meta: X, baseId: Y, localRefs: B }), this._cache.set(H.schema, H), J && !Y.startsWith("#")) {
            if (Y) this._checkUnique(Y);
            this.refs[Y] = H;
          }
          if ($) this.validateSchema(Q, true);
          return H;
        }
        _checkUnique(Q) {
          if (this.schemas[Q] || this.refs[Q]) throw Error(`schema with key or id "${Q}" already exists`);
        }
        _compileSchemaEnv(Q) {
          if (Q.meta) this._compileMetaSchema(Q);
          else E4.compileSchema.call(this, Q);
          if (!Q.validate) throw Error("ajv implementation error");
          return Q.validate;
        }
        _compileMetaSchema(Q) {
          let X = this.opts;
          this.opts = this._metaOpts;
          try {
            E4.compileSchema.call(this, Q);
          } finally {
            this.opts = X;
          }
        }
      }
      qQ.ValidationError = pj.default;
      qQ.MissingRefError = BB.default;
      S1.default = qQ;
      function GB(Q, X, Y, $ = "error") {
        for (let J in Q) {
          let W = J;
          if (W in X) this.logger[$](`${Y}: option ${J}. ${Q[W]}`);
        }
      }
      function HB(Q) {
        return Q = (0, P4.normalizeId)(Q), this.schemas[Q] || this.refs[Q];
      }
      function ej() {
        let Q = this.opts.schemas;
        if (!Q) return;
        if (Array.isArray(Q)) this.addSchema(Q);
        else for (let X in Q) this.addSchema(Q[X], X);
      }
      function QR() {
        for (let Q in this.opts.formats) {
          let X = this.opts.formats[Q];
          if (X) this.addFormat(Q, X);
        }
      }
      function XR(Q) {
        if (Array.isArray(Q)) {
          this.addVocabulary(Q);
          return;
        }
        this.logger.warn("keywords option as map is deprecated, pass array");
        for (let X in Q) {
          let Y = Q[X];
          if (!Y.keyword) Y.keyword = X;
          this.addKeyword(Y);
        }
      }
      function YR() {
        let Q = { ...this.opts };
        for (let X of oj) delete Q[X];
        return Q;
      }
      var $R = { log() {
      }, warn() {
      }, error() {
      } };
      function JR(Q) {
        if (Q === false) return $R;
        if (Q === void 0) return console;
        if (Q.log && Q.warn && Q.error) return Q;
        throw Error("logger must implement log, warn and error methods");
      }
      var WR = /^[a-z_$][a-z0-9_$:-]*$/i;
      function GR(Q, X) {
        let { RULES: Y } = this;
        if ((0, H7.eachItem)(Q, ($) => {
          if (Y.keywords[$]) throw Error(`Keyword ${$} is already defined`);
          if (!WR.test($)) throw Error(`Keyword ${$} has invalid name`);
        }), !X) return;
        if (X.$data && !("code" in X || "validate" in X)) throw Error('$data keyword must have "code" or "validate" function');
      }
      function G7(Q, X, Y) {
        var $;
        let J = X === null || X === void 0 ? void 0 : X.post;
        if (Y && J) throw Error('keyword with "post" flag cannot have "type"');
        let { RULES: W } = this, G = J ? W.post : W.rules.find(({ type: B }) => B === Y);
        if (!G) G = { type: Y, rules: [] }, W.rules.push(G);
        if (W.keywords[Q] = true, !X) return;
        let H = { keyword: Q, definition: { ...X, type: (0, VQ.getJSONTypes)(X.type), schemaType: (0, VQ.getJSONTypes)(X.schemaType) } };
        if (X.before) HR.call(this, G, H, X.before);
        else G.rules.push(H);
        W.all[Q] = H, ($ = X.implements) === null || $ === void 0 || $.forEach((B) => this.addKeyword(B));
      }
      function HR(Q, X, Y) {
        let $ = Q.rules.findIndex((J) => J.keyword === Y);
        if ($ >= 0) Q.rules.splice($, 0, X);
        else Q.rules.push(X), this.logger.warn(`rule ${Y} is not defined`);
      }
      function BR(Q) {
        let { metaSchema: X } = Q;
        if (X === void 0) return;
        if (Q.$data && this.opts.$data) X = KB(X);
        Q.validateSchema = this.compile(X, true);
      }
      var zR = { $ref: "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#" };
      function KB(Q) {
        return { anyOf: [Q, zR] };
      }
    });
    UB = E((qB) => {
      Object.defineProperty(qB, "__esModule", { value: true });
      var qR = { keyword: "id", code() {
        throw Error('NOT SUPPORTED: keyword "id", use "$id" for schema ID');
      } };
      qB.default = qR;
    });
    wB = E((NB) => {
      Object.defineProperty(NB, "__esModule", { value: true });
      NB.callRef = NB.getValidate = void 0;
      var LR = R4(), LB = t0(), f0 = c(), A9 = E1(), FB = HQ(), UQ = a(), FR = { keyword: "$ref", schemaType: "string", code(Q) {
        let { gen: X, schema: Y, it: $ } = Q, { baseId: J, schemaEnv: W, validateName: G, opts: H, self: B } = $, { root: z } = W;
        if ((Y === "#" || Y === "#/") && J === z.baseId) return q();
        let K = FB.resolveRef.call(B, z, J, Y);
        if (K === void 0) throw new LR.default($.opts.uriResolver, J, Y);
        if (K instanceof FB.SchemaEnv) return U(K);
        return V(K);
        function q() {
          if (W === z) return LQ(Q, G, W, W.$async);
          let L = X.scopeValue("root", { ref: z });
          return LQ(Q, f0._`${L}.validate`, z, z.$async);
        }
        function U(L) {
          let F = OB(Q, L);
          LQ(Q, F, L, L.$async);
        }
        function V(L) {
          let F = X.scopeValue("schema", H.code.source === true ? { ref: L, code: (0, f0.stringify)(L) } : { ref: L }), w = X.name("valid"), N = Q.subschema({ schema: L, dataTypes: [], schemaPath: f0.nil, topSchemaRef: F, errSchemaPath: Y }, w);
          Q.mergeEvaluated(N), Q.ok(w);
        }
      } };
      function OB(Q, X) {
        let { gen: Y } = Q;
        return X.validate ? Y.scopeValue("validate", { ref: X.validate }) : f0._`${Y.scopeValue("wrapper", { ref: X })}.validate`;
      }
      NB.getValidate = OB;
      function LQ(Q, X, Y, $) {
        let { gen: J, it: W } = Q, { allErrors: G, schemaEnv: H, opts: B } = W, z = B.passContext ? A9.default.this : f0.nil;
        if ($) K();
        else q();
        function K() {
          if (!H.$async) throw Error("async schema referenced by sync schema");
          let L = J.let("valid");
          J.try(() => {
            if (J.code(f0._`await ${(0, LB.callValidateCode)(Q, X, z)}`), V(X), !G) J.assign(L, true);
          }, (F) => {
            if (J.if(f0._`!(${F} instanceof ${W.ValidationError})`, () => J.throw(F)), U(F), !G) J.assign(L, false);
          }), Q.ok(L);
        }
        function q() {
          Q.result((0, LB.callValidateCode)(Q, X, z), () => V(X), () => U(X));
        }
        function U(L) {
          let F = f0._`${L}.errors`;
          J.assign(A9.default.vErrors, f0._`${A9.default.vErrors} === null ? ${F} : ${A9.default.vErrors}.concat(${F})`), J.assign(A9.default.errors, f0._`${A9.default.vErrors}.length`);
        }
        function V(L) {
          var F;
          if (!W.opts.unevaluated) return;
          let w = (F = Y === null || Y === void 0 ? void 0 : Y.validate) === null || F === void 0 ? void 0 : F.evaluated;
          if (W.props !== true) if (w && !w.dynamicProps) {
            if (w.props !== void 0) W.props = UQ.mergeEvaluated.props(J, w.props, W.props);
          } else {
            let N = J.var("props", f0._`${L}.evaluated.props`);
            W.props = UQ.mergeEvaluated.props(J, N, W.props, f0.Name);
          }
          if (W.items !== true) if (w && !w.dynamicItems) {
            if (w.items !== void 0) W.items = UQ.mergeEvaluated.items(J, w.items, W.items);
          } else {
            let N = J.var("items", f0._`${L}.evaluated.items`);
            W.items = UQ.mergeEvaluated.items(J, N, W.items, f0.Name);
          }
        }
      }
      NB.callRef = LQ;
      NB.default = FR;
    });
    AB = E((MB) => {
      Object.defineProperty(MB, "__esModule", { value: true });
      var DR = UB(), wR = wB(), MR = ["$schema", "$id", "$defs", "$vocabulary", { keyword: "$comment" }, "definitions", DR.default, wR.default];
      MB.default = MR;
    });
    RB = E((jB) => {
      Object.defineProperty(jB, "__esModule", { value: true });
      var FQ = c(), Q6 = FQ.operators, OQ = { maximum: { okStr: "<=", ok: Q6.LTE, fail: Q6.GT }, minimum: { okStr: ">=", ok: Q6.GTE, fail: Q6.LT }, exclusiveMaximum: { okStr: "<", ok: Q6.LT, fail: Q6.GTE }, exclusiveMinimum: { okStr: ">", ok: Q6.GT, fail: Q6.LTE } }, jR = { message: ({ keyword: Q, schemaCode: X }) => FQ.str`must be ${OQ[Q].okStr} ${X}`, params: ({ keyword: Q, schemaCode: X }) => FQ._`{comparison: ${OQ[Q].okStr}, limit: ${X}}` }, RR = { keyword: Object.keys(OQ), type: "number", schemaType: "number", $data: true, error: jR, code(Q) {
        let { keyword: X, data: Y, schemaCode: $ } = Q;
        Q.fail$data(FQ._`${Y} ${OQ[X].fail} ${$} || isNaN(${Y})`);
      } };
      jB.default = RR;
    });
    bB = E((IB) => {
      Object.defineProperty(IB, "__esModule", { value: true });
      var Z4 = c(), bR = { message: ({ schemaCode: Q }) => Z4.str`must be multiple of ${Q}`, params: ({ schemaCode: Q }) => Z4._`{multipleOf: ${Q}}` }, ER = { keyword: "multipleOf", type: "number", schemaType: "number", $data: true, error: bR, code(Q) {
        let { gen: X, data: Y, schemaCode: $, it: J } = Q, W = J.opts.multipleOfPrecision, G = X.let("res"), H = W ? Z4._`Math.abs(Math.round(${G}) - ${G}) > 1e-${W}` : Z4._`${G} !== parseInt(${G})`;
        Q.fail$data(Z4._`(${$} === 0 || (${G} = ${Y}/${$}, ${H}))`);
      } };
      IB.default = ER;
    });
    ZB = E((PB) => {
      Object.defineProperty(PB, "__esModule", { value: true });
      function EB(Q) {
        let X = Q.length, Y = 0, $ = 0, J;
        while ($ < X) if (Y++, J = Q.charCodeAt($++), J >= 55296 && J <= 56319 && $ < X) {
          if (J = Q.charCodeAt($), (J & 64512) === 56320) $++;
        }
        return Y;
      }
      PB.default = EB;
      EB.code = 'require("ajv/dist/runtime/ucs2length").default';
    });
    CB = E((SB) => {
      Object.defineProperty(SB, "__esModule", { value: true });
      var E6 = c(), SR = a(), CR = ZB(), _R = { message({ keyword: Q, schemaCode: X }) {
        let Y = Q === "maxLength" ? "more" : "fewer";
        return E6.str`must NOT have ${Y} than ${X} characters`;
      }, params: ({ schemaCode: Q }) => E6._`{limit: ${Q}}` }, kR = { keyword: ["maxLength", "minLength"], type: "string", schemaType: "number", $data: true, error: _R, code(Q) {
        let { keyword: X, data: Y, schemaCode: $, it: J } = Q, W = X === "maxLength" ? E6.operators.GT : E6.operators.LT, G = J.opts.unicode === false ? E6._`${Y}.length` : E6._`${(0, SR.useFunc)(Q.gen, CR.default)}(${Y})`;
        Q.fail$data(E6._`${G} ${W} ${$}`);
      } };
      SB.default = kR;
    });
    kB = E((_B) => {
      Object.defineProperty(_B, "__esModule", { value: true });
      var TR = t0(), NQ = c(), xR = { message: ({ schemaCode: Q }) => NQ.str`must match pattern "${Q}"`, params: ({ schemaCode: Q }) => NQ._`{pattern: ${Q}}` }, yR = { keyword: "pattern", type: "string", schemaType: "string", $data: true, error: xR, code(Q) {
        let { data: X, $data: Y, schema: $, schemaCode: J, it: W } = Q, G = W.opts.unicodeRegExp ? "u" : "", H = Y ? NQ._`(new RegExp(${J}, ${G}))` : (0, TR.usePattern)(Q, $);
        Q.fail$data(NQ._`!${H}.test(${X})`);
      } };
      _B.default = yR;
    });
    TB = E((vB) => {
      Object.defineProperty(vB, "__esModule", { value: true });
      var S4 = c(), hR = { message({ keyword: Q, schemaCode: X }) {
        let Y = Q === "maxProperties" ? "more" : "fewer";
        return S4.str`must NOT have ${Y} than ${X} properties`;
      }, params: ({ schemaCode: Q }) => S4._`{limit: ${Q}}` }, fR = { keyword: ["maxProperties", "minProperties"], type: "object", schemaType: "number", $data: true, error: hR, code(Q) {
        let { keyword: X, data: Y, schemaCode: $ } = Q, J = X === "maxProperties" ? S4.operators.GT : S4.operators.LT;
        Q.fail$data(S4._`Object.keys(${Y}).length ${J} ${$}`);
      } };
      vB.default = fR;
    });
    yB = E((xB) => {
      Object.defineProperty(xB, "__esModule", { value: true });
      var C4 = t0(), _4 = c(), mR = a(), lR = { message: ({ params: { missingProperty: Q } }) => _4.str`must have required property '${Q}'`, params: ({ params: { missingProperty: Q } }) => _4._`{missingProperty: ${Q}}` }, cR = { keyword: "required", type: "object", schemaType: "array", $data: true, error: lR, code(Q) {
        let { gen: X, schema: Y, schemaCode: $, data: J, $data: W, it: G } = Q, { opts: H } = G;
        if (!W && Y.length === 0) return;
        let B = Y.length >= H.loopRequired;
        if (G.allErrors) z();
        else K();
        if (H.strictRequired) {
          let V = Q.parentSchema.properties, { definedProperties: L } = Q.it;
          for (let F of Y) if ((V === null || V === void 0 ? void 0 : V[F]) === void 0 && !L.has(F)) {
            let w = G.schemaEnv.baseId + G.errSchemaPath, N = `required property "${F}" is not defined at "${w}" (strictRequired)`;
            (0, mR.checkStrictMode)(G, N, G.opts.strictRequired);
          }
        }
        function z() {
          if (B || W) Q.block$data(_4.nil, q);
          else for (let V of Y) (0, C4.checkReportMissingProp)(Q, V);
        }
        function K() {
          let V = X.let("missing");
          if (B || W) {
            let L = X.let("valid", true);
            Q.block$data(L, () => U(V, L)), Q.ok(L);
          } else X.if((0, C4.checkMissingProp)(Q, Y, V)), (0, C4.reportMissingProp)(Q, V), X.else();
        }
        function q() {
          X.forOf("prop", $, (V) => {
            Q.setParams({ missingProperty: V }), X.if((0, C4.noPropertyInData)(X, J, V, H.ownProperties), () => Q.error());
          });
        }
        function U(V, L) {
          Q.setParams({ missingProperty: V }), X.forOf(V, $, () => {
            X.assign(L, (0, C4.propertyInData)(X, J, V, H.ownProperties)), X.if((0, _4.not)(L), () => {
              Q.error(), X.break();
            });
          }, _4.nil);
        }
      } };
      xB.default = cR;
    });
    hB = E((gB) => {
      Object.defineProperty(gB, "__esModule", { value: true });
      var k4 = c(), dR = { message({ keyword: Q, schemaCode: X }) {
        let Y = Q === "maxItems" ? "more" : "fewer";
        return k4.str`must NOT have ${Y} than ${X} items`;
      }, params: ({ schemaCode: Q }) => k4._`{limit: ${Q}}` }, iR = { keyword: ["maxItems", "minItems"], type: "array", schemaType: "number", $data: true, error: dR, code(Q) {
        let { keyword: X, data: Y, schemaCode: $ } = Q, J = X === "maxItems" ? k4.operators.GT : k4.operators.LT;
        Q.fail$data(k4._`${Y}.length ${J} ${$}`);
      } };
      gB.default = iR;
    });
    DQ = E((uB) => {
      Object.defineProperty(uB, "__esModule", { value: true });
      var fB = n$();
      fB.code = 'require("ajv/dist/runtime/equal").default';
      uB.default = fB;
    });
    lB = E((mB) => {
      Object.defineProperty(mB, "__esModule", { value: true });
      var B7 = D4(), E0 = c(), rR = a(), tR = DQ(), aR = { message: ({ params: { i: Q, j: X } }) => E0.str`must NOT have duplicate items (items ## ${X} and ${Q} are identical)`, params: ({ params: { i: Q, j: X } }) => E0._`{i: ${Q}, j: ${X}}` }, sR = { keyword: "uniqueItems", type: "array", schemaType: "boolean", $data: true, error: aR, code(Q) {
        let { gen: X, data: Y, $data: $, schema: J, parentSchema: W, schemaCode: G, it: H } = Q;
        if (!$ && !J) return;
        let B = X.let("valid"), z = W.items ? (0, B7.getSchemaTypes)(W.items) : [];
        Q.block$data(B, K, E0._`${G} === false`), Q.ok(B);
        function K() {
          let L = X.let("i", E0._`${Y}.length`), F = X.let("j");
          Q.setParams({ i: L, j: F }), X.assign(B, true), X.if(E0._`${L} > 1`, () => (q() ? U : V)(L, F));
        }
        function q() {
          return z.length > 0 && !z.some((L) => L === "object" || L === "array");
        }
        function U(L, F) {
          let w = X.name("item"), N = (0, B7.checkDataTypes)(z, w, H.opts.strictNumbers, B7.DataType.Wrong), j = X.const("indices", E0._`{}`);
          X.for(E0._`;${L}--;`, () => {
            if (X.let(w, E0._`${Y}[${L}]`), X.if(N, E0._`continue`), z.length > 1) X.if(E0._`typeof ${w} == "string"`, E0._`${w} += "_"`);
            X.if(E0._`typeof ${j}[${w}] == "number"`, () => {
              X.assign(F, E0._`${j}[${w}]`), Q.error(), X.assign(B, false).break();
            }).code(E0._`${j}[${w}] = ${L}`);
          });
        }
        function V(L, F) {
          let w = (0, rR.useFunc)(X, tR.default), N = X.name("outer");
          X.label(N).for(E0._`;${L}--;`, () => X.for(E0._`${F} = ${L}; ${F}--;`, () => X.if(E0._`${w}(${Y}[${L}], ${Y}[${F}])`, () => {
            Q.error(), X.assign(B, false).break(N);
          })));
        }
      } };
      mB.default = sR;
    });
    pB = E((cB) => {
      Object.defineProperty(cB, "__esModule", { value: true });
      var z7 = c(), QI = a(), XI = DQ(), YI = { message: "must be equal to constant", params: ({ schemaCode: Q }) => z7._`{allowedValue: ${Q}}` }, $I = { keyword: "const", $data: true, error: YI, code(Q) {
        let { gen: X, data: Y, $data: $, schemaCode: J, schema: W } = Q;
        if ($ || W && typeof W == "object") Q.fail$data(z7._`!${(0, QI.useFunc)(X, XI.default)}(${Y}, ${J})`);
        else Q.fail(z7._`${W} !== ${Y}`);
      } };
      cB.default = $I;
    });
    iB = E((dB) => {
      Object.defineProperty(dB, "__esModule", { value: true });
      var v4 = c(), WI = a(), GI = DQ(), HI = { message: "must be equal to one of the allowed values", params: ({ schemaCode: Q }) => v4._`{allowedValues: ${Q}}` }, BI = { keyword: "enum", schemaType: "array", $data: true, error: HI, code(Q) {
        let { gen: X, data: Y, $data: $, schema: J, schemaCode: W, it: G } = Q;
        if (!$ && J.length === 0) throw Error("enum must have non-empty array");
        let H = J.length >= G.opts.loopEnum, B, z = () => B !== null && B !== void 0 ? B : B = (0, WI.useFunc)(X, GI.default), K;
        if (H || $) K = X.let("valid"), Q.block$data(K, q);
        else {
          if (!Array.isArray(J)) throw Error("ajv implementation error");
          let V = X.const("vSchema", W);
          K = (0, v4.or)(...J.map((L, F) => U(V, F)));
        }
        Q.pass(K);
        function q() {
          X.assign(K, false), X.forOf("v", W, (V) => X.if(v4._`${z()}(${Y}, ${V})`, () => X.assign(K, true).break()));
        }
        function U(V, L) {
          let F = J[L];
          return typeof F === "object" && F !== null ? v4._`${z()}(${Y}, ${V}[${L}])` : v4._`${Y} === ${F}`;
        }
      } };
      dB.default = BI;
    });
    oB = E((nB) => {
      Object.defineProperty(nB, "__esModule", { value: true });
      var KI = RB(), VI = bB(), qI = CB(), UI = kB(), LI = TB(), FI = yB(), OI = hB(), NI = lB(), DI = pB(), wI = iB(), MI = [KI.default, VI.default, qI.default, UI.default, LI.default, FI.default, OI.default, NI.default, { keyword: "type", schemaType: ["string", "array"] }, { keyword: "nullable", schemaType: "boolean" }, DI.default, wI.default];
      nB.default = MI;
    });
    V7 = E((tB) => {
      Object.defineProperty(tB, "__esModule", { value: true });
      tB.validateAdditionalItems = void 0;
      var P6 = c(), K7 = a(), jI = { message: ({ params: { len: Q } }) => P6.str`must NOT have more than ${Q} items`, params: ({ params: { len: Q } }) => P6._`{limit: ${Q}}` }, RI = { keyword: "additionalItems", type: "array", schemaType: ["boolean", "object"], before: "uniqueItems", error: jI, code(Q) {
        let { parentSchema: X, it: Y } = Q, { items: $ } = X;
        if (!Array.isArray($)) {
          (0, K7.checkStrictMode)(Y, '"additionalItems" is ignored when "items" is not an array of schemas');
          return;
        }
        rB(Q, $);
      } };
      function rB(Q, X) {
        let { gen: Y, schema: $, data: J, keyword: W, it: G } = Q;
        G.items = true;
        let H = Y.const("len", P6._`${J}.length`);
        if ($ === false) Q.setParams({ len: X.length }), Q.pass(P6._`${H} <= ${X.length}`);
        else if (typeof $ == "object" && !(0, K7.alwaysValidSchema)(G, $)) {
          let z = Y.var("valid", P6._`${H} <= ${X.length}`);
          Y.if((0, P6.not)(z), () => B(z)), Q.ok(z);
        }
        function B(z) {
          Y.forRange("i", X.length, H, (K) => {
            if (Q.subschema({ keyword: W, dataProp: K, dataPropType: K7.Type.Num }, z), !G.allErrors) Y.if((0, P6.not)(z), () => Y.break());
          });
        }
      }
      tB.validateAdditionalItems = rB;
      tB.default = RI;
    });
    q7 = E((Qz) => {
      Object.defineProperty(Qz, "__esModule", { value: true });
      Qz.validateTuple = void 0;
      var sB = c(), wQ = a(), bI = t0(), EI = { keyword: "items", type: "array", schemaType: ["object", "array", "boolean"], before: "uniqueItems", code(Q) {
        let { schema: X, it: Y } = Q;
        if (Array.isArray(X)) return eB(Q, "additionalItems", X);
        if (Y.items = true, (0, wQ.alwaysValidSchema)(Y, X)) return;
        Q.ok((0, bI.validateArray)(Q));
      } };
      function eB(Q, X, Y = Q.schema) {
        let { gen: $, parentSchema: J, data: W, keyword: G, it: H } = Q;
        if (K(J), H.opts.unevaluated && Y.length && H.items !== true) H.items = wQ.mergeEvaluated.items($, Y.length, H.items);
        let B = $.name("valid"), z = $.const("len", sB._`${W}.length`);
        Y.forEach((q, U) => {
          if ((0, wQ.alwaysValidSchema)(H, q)) return;
          $.if(sB._`${z} > ${U}`, () => Q.subschema({ keyword: G, schemaProp: U, dataProp: U }, B)), Q.ok(B);
        });
        function K(q) {
          let { opts: U, errSchemaPath: V } = H, L = Y.length, F = L === q.minItems && (L === q.maxItems || q[X] === false);
          if (U.strictTuples && !F) {
            let w = `"${G}" is ${L}-tuple, but minItems or maxItems/${X} are not specified or different at path "${V}"`;
            (0, wQ.checkStrictMode)(H, w, U.strictTuples);
          }
        }
      }
      Qz.validateTuple = eB;
      Qz.default = EI;
    });
    $z = E((Yz) => {
      Object.defineProperty(Yz, "__esModule", { value: true });
      var ZI = q7(), SI = { keyword: "prefixItems", type: "array", schemaType: ["array"], before: "uniqueItems", code: (Q) => (0, ZI.validateTuple)(Q, "items") };
      Yz.default = SI;
    });
    Gz = E((Wz) => {
      Object.defineProperty(Wz, "__esModule", { value: true });
      var Jz = c(), _I = a(), kI = t0(), vI = V7(), TI = { message: ({ params: { len: Q } }) => Jz.str`must NOT have more than ${Q} items`, params: ({ params: { len: Q } }) => Jz._`{limit: ${Q}}` }, xI = { keyword: "items", type: "array", schemaType: ["object", "boolean"], before: "uniqueItems", error: TI, code(Q) {
        let { schema: X, parentSchema: Y, it: $ } = Q, { prefixItems: J } = Y;
        if ($.items = true, (0, _I.alwaysValidSchema)($, X)) return;
        if (J) (0, vI.validateAdditionalItems)(Q, J);
        else Q.ok((0, kI.validateArray)(Q));
      } };
      Wz.default = xI;
    });
    Bz = E((Hz) => {
      Object.defineProperty(Hz, "__esModule", { value: true });
      var a0 = c(), MQ = a(), gI = { message: ({ params: { min: Q, max: X } }) => X === void 0 ? a0.str`must contain at least ${Q} valid item(s)` : a0.str`must contain at least ${Q} and no more than ${X} valid item(s)`, params: ({ params: { min: Q, max: X } }) => X === void 0 ? a0._`{minContains: ${Q}}` : a0._`{minContains: ${Q}, maxContains: ${X}}` }, hI = { keyword: "contains", type: "array", schemaType: ["object", "boolean"], before: "uniqueItems", trackErrors: true, error: gI, code(Q) {
        let { gen: X, schema: Y, parentSchema: $, data: J, it: W } = Q, G, H, { minContains: B, maxContains: z } = $;
        if (W.opts.next) G = B === void 0 ? 1 : B, H = z;
        else G = 1;
        let K = X.const("len", a0._`${J}.length`);
        if (Q.setParams({ min: G, max: H }), H === void 0 && G === 0) {
          (0, MQ.checkStrictMode)(W, '"minContains" == 0 without "maxContains": "contains" keyword ignored');
          return;
        }
        if (H !== void 0 && G > H) {
          (0, MQ.checkStrictMode)(W, '"minContains" > "maxContains" is always invalid'), Q.fail();
          return;
        }
        if ((0, MQ.alwaysValidSchema)(W, Y)) {
          let F = a0._`${K} >= ${G}`;
          if (H !== void 0) F = a0._`${F} && ${K} <= ${H}`;
          Q.pass(F);
          return;
        }
        W.items = true;
        let q = X.name("valid");
        if (H === void 0 && G === 1) V(q, () => X.if(q, () => X.break()));
        else if (G === 0) {
          if (X.let(q, true), H !== void 0) X.if(a0._`${J}.length > 0`, U);
        } else X.let(q, false), U();
        Q.result(q, () => Q.reset());
        function U() {
          let F = X.name("_valid"), w = X.let("count", 0);
          V(F, () => X.if(F, () => L(w)));
        }
        function V(F, w) {
          X.forRange("i", 0, K, (N) => {
            Q.subschema({ keyword: "contains", dataProp: N, dataPropType: MQ.Type.Num, compositeRule: true }, F), w();
          });
        }
        function L(F) {
          if (X.code(a0._`${F}++`), H === void 0) X.if(a0._`${F} >= ${G}`, () => X.assign(q, true).break());
          else if (X.if(a0._`${F} > ${H}`, () => X.assign(q, false).break()), G === 1) X.assign(q, true);
          else X.if(a0._`${F} >= ${G}`, () => X.assign(q, true));
        }
      } };
      Hz.default = hI;
    });
    Lz = E((Vz) => {
      Object.defineProperty(Vz, "__esModule", { value: true });
      Vz.validateSchemaDeps = Vz.validatePropertyDeps = Vz.error = void 0;
      var U7 = c(), uI = a(), T4 = t0();
      Vz.error = { message: ({ params: { property: Q, depsCount: X, deps: Y } }) => {
        let $ = X === 1 ? "property" : "properties";
        return U7.str`must have ${$} ${Y} when property ${Q} is present`;
      }, params: ({ params: { property: Q, depsCount: X, deps: Y, missingProperty: $ } }) => U7._`{property: ${Q},
    missingProperty: ${$},
    depsCount: ${X},
    deps: ${Y}}` };
      var mI = { keyword: "dependencies", type: "object", schemaType: "object", error: Vz.error, code(Q) {
        let [X, Y] = lI(Q);
        zz(Q, X), Kz(Q, Y);
      } };
      function lI({ schema: Q }) {
        let X = {}, Y = {};
        for (let $ in Q) {
          if ($ === "__proto__") continue;
          let J = Array.isArray(Q[$]) ? X : Y;
          J[$] = Q[$];
        }
        return [X, Y];
      }
      function zz(Q, X = Q.schema) {
        let { gen: Y, data: $, it: J } = Q;
        if (Object.keys(X).length === 0) return;
        let W = Y.let("missing");
        for (let G in X) {
          let H = X[G];
          if (H.length === 0) continue;
          let B = (0, T4.propertyInData)(Y, $, G, J.opts.ownProperties);
          if (Q.setParams({ property: G, depsCount: H.length, deps: H.join(", ") }), J.allErrors) Y.if(B, () => {
            for (let z of H) (0, T4.checkReportMissingProp)(Q, z);
          });
          else Y.if(U7._`${B} && (${(0, T4.checkMissingProp)(Q, H, W)})`), (0, T4.reportMissingProp)(Q, W), Y.else();
        }
      }
      Vz.validatePropertyDeps = zz;
      function Kz(Q, X = Q.schema) {
        let { gen: Y, data: $, keyword: J, it: W } = Q, G = Y.name("valid");
        for (let H in X) {
          if ((0, uI.alwaysValidSchema)(W, X[H])) continue;
          Y.if((0, T4.propertyInData)(Y, $, H, W.opts.ownProperties), () => {
            let B = Q.subschema({ keyword: J, schemaProp: H }, G);
            Q.mergeValidEvaluated(B, G);
          }, () => Y.var(G, true)), Q.ok(G);
        }
      }
      Vz.validateSchemaDeps = Kz;
      Vz.default = mI;
    });
    Nz = E((Oz) => {
      Object.defineProperty(Oz, "__esModule", { value: true });
      var Fz = c(), dI = a(), iI = { message: "property name must be valid", params: ({ params: Q }) => Fz._`{propertyName: ${Q.propertyName}}` }, nI = { keyword: "propertyNames", type: "object", schemaType: ["object", "boolean"], error: iI, code(Q) {
        let { gen: X, schema: Y, data: $, it: J } = Q;
        if ((0, dI.alwaysValidSchema)(J, Y)) return;
        let W = X.name("valid");
        X.forIn("key", $, (G) => {
          Q.setParams({ propertyName: G }), Q.subschema({ keyword: "propertyNames", data: G, dataTypes: ["string"], propertyName: G, compositeRule: true }, W), X.if((0, Fz.not)(W), () => {
            if (Q.error(true), !J.allErrors) X.break();
          });
        }), Q.ok(W);
      } };
      Oz.default = nI;
    });
    L7 = E((Dz) => {
      Object.defineProperty(Dz, "__esModule", { value: true });
      var AQ = t0(), z1 = c(), rI = E1(), jQ = a(), tI = { message: "must NOT have additional properties", params: ({ params: Q }) => z1._`{additionalProperty: ${Q.additionalProperty}}` }, aI = { keyword: "additionalProperties", type: ["object"], schemaType: ["boolean", "object"], allowUndefined: true, trackErrors: true, error: tI, code(Q) {
        let { gen: X, schema: Y, parentSchema: $, data: J, errsCount: W, it: G } = Q;
        if (!W) throw Error("ajv implementation error");
        let { allErrors: H, opts: B } = G;
        if (G.props = true, B.removeAdditional !== "all" && (0, jQ.alwaysValidSchema)(G, Y)) return;
        let z = (0, AQ.allSchemaProperties)($.properties), K = (0, AQ.allSchemaProperties)($.patternProperties);
        q(), Q.ok(z1._`${W} === ${rI.default.errors}`);
        function q() {
          X.forIn("key", J, (w) => {
            if (!z.length && !K.length) L(w);
            else X.if(U(w), () => L(w));
          });
        }
        function U(w) {
          let N;
          if (z.length > 8) {
            let j = (0, jQ.schemaRefOrVal)(G, $.properties, "properties");
            N = (0, AQ.isOwnProperty)(X, j, w);
          } else if (z.length) N = (0, z1.or)(...z.map((j) => z1._`${w} === ${j}`));
          else N = z1.nil;
          if (K.length) N = (0, z1.or)(N, ...K.map((j) => z1._`${(0, AQ.usePattern)(Q, j)}.test(${w})`));
          return (0, z1.not)(N);
        }
        function V(w) {
          X.code(z1._`delete ${J}[${w}]`);
        }
        function L(w) {
          if (B.removeAdditional === "all" || B.removeAdditional && Y === false) {
            V(w);
            return;
          }
          if (Y === false) {
            if (Q.setParams({ additionalProperty: w }), Q.error(), !H) X.break();
            return;
          }
          if (typeof Y == "object" && !(0, jQ.alwaysValidSchema)(G, Y)) {
            let N = X.name("valid");
            if (B.removeAdditional === "failing") F(w, N, false), X.if((0, z1.not)(N), () => {
              Q.reset(), V(w);
            });
            else if (F(w, N), !H) X.if((0, z1.not)(N), () => X.break());
          }
        }
        function F(w, N, j) {
          let R = { keyword: "additionalProperties", dataProp: w, dataPropType: jQ.Type.Str };
          if (j === false) Object.assign(R, { compositeRule: true, createErrors: false, allErrors: false });
          Q.subschema(R, N);
        }
      } };
      Dz.default = aI;
    });
    jz = E((Az) => {
      Object.defineProperty(Az, "__esModule", { value: true });
      var eI = j4(), wz = t0(), F7 = a(), Mz = L7(), Q2 = { keyword: "properties", type: "object", schemaType: "object", code(Q) {
        let { gen: X, schema: Y, parentSchema: $, data: J, it: W } = Q;
        if (W.opts.removeAdditional === "all" && $.additionalProperties === void 0) Mz.default.code(new eI.KeywordCxt(W, Mz.default, "additionalProperties"));
        let G = (0, wz.allSchemaProperties)(Y);
        for (let q of G) W.definedProperties.add(q);
        if (W.opts.unevaluated && G.length && W.props !== true) W.props = F7.mergeEvaluated.props(X, (0, F7.toHash)(G), W.props);
        let H = G.filter((q) => !(0, F7.alwaysValidSchema)(W, Y[q]));
        if (H.length === 0) return;
        let B = X.name("valid");
        for (let q of H) {
          if (z(q)) K(q);
          else {
            if (X.if((0, wz.propertyInData)(X, J, q, W.opts.ownProperties)), K(q), !W.allErrors) X.else().var(B, true);
            X.endIf();
          }
          Q.it.definedProperties.add(q), Q.ok(B);
        }
        function z(q) {
          return W.opts.useDefaults && !W.compositeRule && Y[q].default !== void 0;
        }
        function K(q) {
          Q.subschema({ keyword: "properties", schemaProp: q, dataProp: q }, B);
        }
      } };
      Az.default = Q2;
    });
    Pz = E((Ez) => {
      Object.defineProperty(Ez, "__esModule", { value: true });
      var Rz = t0(), RQ = c(), Iz = a(), bz = a(), Y2 = { keyword: "patternProperties", type: "object", schemaType: "object", code(Q) {
        let { gen: X, schema: Y, data: $, parentSchema: J, it: W } = Q, { opts: G } = W, H = (0, Rz.allSchemaProperties)(Y), B = H.filter((F) => (0, Iz.alwaysValidSchema)(W, Y[F]));
        if (H.length === 0 || B.length === H.length && (!W.opts.unevaluated || W.props === true)) return;
        let z = G.strictSchema && !G.allowMatchingProperties && J.properties, K = X.name("valid");
        if (W.props !== true && !(W.props instanceof RQ.Name)) W.props = (0, bz.evaluatedPropsToName)(X, W.props);
        let { props: q } = W;
        U();
        function U() {
          for (let F of H) {
            if (z) V(F);
            if (W.allErrors) L(F);
            else X.var(K, true), L(F), X.if(K);
          }
        }
        function V(F) {
          for (let w in z) if (new RegExp(F).test(w)) (0, Iz.checkStrictMode)(W, `property ${w} matches pattern ${F} (use allowMatchingProperties)`);
        }
        function L(F) {
          X.forIn("key", $, (w) => {
            X.if(RQ._`${(0, Rz.usePattern)(Q, F)}.test(${w})`, () => {
              let N = B.includes(F);
              if (!N) Q.subschema({ keyword: "patternProperties", schemaProp: F, dataProp: w, dataPropType: bz.Type.Str }, K);
              if (W.opts.unevaluated && q !== true) X.assign(RQ._`${q}[${w}]`, true);
              else if (!N && !W.allErrors) X.if((0, RQ.not)(K), () => X.break());
            });
          });
        }
      } };
      Ez.default = Y2;
    });
    Sz = E((Zz) => {
      Object.defineProperty(Zz, "__esModule", { value: true });
      var J2 = a(), W2 = { keyword: "not", schemaType: ["object", "boolean"], trackErrors: true, code(Q) {
        let { gen: X, schema: Y, it: $ } = Q;
        if ((0, J2.alwaysValidSchema)($, Y)) {
          Q.fail();
          return;
        }
        let J = X.name("valid");
        Q.subschema({ keyword: "not", compositeRule: true, createErrors: false, allErrors: false }, J), Q.failResult(J, () => Q.reset(), () => Q.error());
      }, error: { message: "must NOT be valid" } };
      Zz.default = W2;
    });
    _z = E((Cz) => {
      Object.defineProperty(Cz, "__esModule", { value: true });
      var H2 = t0(), B2 = { keyword: "anyOf", schemaType: "array", trackErrors: true, code: H2.validateUnion, error: { message: "must match a schema in anyOf" } };
      Cz.default = B2;
    });
    vz = E((kz) => {
      Object.defineProperty(kz, "__esModule", { value: true });
      var IQ = c(), K2 = a(), V2 = { message: "must match exactly one schema in oneOf", params: ({ params: Q }) => IQ._`{passingSchemas: ${Q.passing}}` }, q2 = { keyword: "oneOf", schemaType: "array", trackErrors: true, error: V2, code(Q) {
        let { gen: X, schema: Y, parentSchema: $, it: J } = Q;
        if (!Array.isArray(Y)) throw Error("ajv implementation error");
        if (J.opts.discriminator && $.discriminator) return;
        let W = Y, G = X.let("valid", false), H = X.let("passing", null), B = X.name("_valid");
        Q.setParams({ passing: H }), X.block(z), Q.result(G, () => Q.reset(), () => Q.error(true));
        function z() {
          W.forEach((K, q) => {
            let U;
            if ((0, K2.alwaysValidSchema)(J, K)) X.var(B, true);
            else U = Q.subschema({ keyword: "oneOf", schemaProp: q, compositeRule: true }, B);
            if (q > 0) X.if(IQ._`${B} && ${G}`).assign(G, false).assign(H, IQ._`[${H}, ${q}]`).else();
            X.if(B, () => {
              if (X.assign(G, true), X.assign(H, q), U) Q.mergeEvaluated(U, IQ.Name);
            });
          });
        }
      } };
      kz.default = q2;
    });
    xz = E((Tz) => {
      Object.defineProperty(Tz, "__esModule", { value: true });
      var L2 = a(), F2 = { keyword: "allOf", schemaType: "array", code(Q) {
        let { gen: X, schema: Y, it: $ } = Q;
        if (!Array.isArray(Y)) throw Error("ajv implementation error");
        let J = X.name("valid");
        Y.forEach((W, G) => {
          if ((0, L2.alwaysValidSchema)($, W)) return;
          let H = Q.subschema({ keyword: "allOf", schemaProp: G }, J);
          Q.ok(J), Q.mergeEvaluated(H);
        });
      } };
      Tz.default = F2;
    });
    fz = E((hz) => {
      Object.defineProperty(hz, "__esModule", { value: true });
      var bQ = c(), gz = a(), N2 = { message: ({ params: Q }) => bQ.str`must match "${Q.ifClause}" schema`, params: ({ params: Q }) => bQ._`{failingKeyword: ${Q.ifClause}}` }, D2 = { keyword: "if", schemaType: ["object", "boolean"], trackErrors: true, error: N2, code(Q) {
        let { gen: X, parentSchema: Y, it: $ } = Q;
        if (Y.then === void 0 && Y.else === void 0) (0, gz.checkStrictMode)($, '"if" without "then" and "else" is ignored');
        let J = yz($, "then"), W = yz($, "else");
        if (!J && !W) return;
        let G = X.let("valid", true), H = X.name("_valid");
        if (B(), Q.reset(), J && W) {
          let K = X.let("ifClause");
          Q.setParams({ ifClause: K }), X.if(H, z("then", K), z("else", K));
        } else if (J) X.if(H, z("then"));
        else X.if((0, bQ.not)(H), z("else"));
        Q.pass(G, () => Q.error(true));
        function B() {
          let K = Q.subschema({ keyword: "if", compositeRule: true, createErrors: false, allErrors: false }, H);
          Q.mergeEvaluated(K);
        }
        function z(K, q) {
          return () => {
            let U = Q.subschema({ keyword: K }, H);
            if (X.assign(G, H), Q.mergeValidEvaluated(U, G), q) X.assign(q, bQ._`${K}`);
            else Q.setParams({ ifClause: K });
          };
        }
      } };
      function yz(Q, X) {
        let Y = Q.schema[X];
        return Y !== void 0 && !(0, gz.alwaysValidSchema)(Q, Y);
      }
      hz.default = D2;
    });
    mz = E((uz) => {
      Object.defineProperty(uz, "__esModule", { value: true });
      var M2 = a(), A2 = { keyword: ["then", "else"], schemaType: ["object", "boolean"], code({ keyword: Q, parentSchema: X, it: Y }) {
        if (X.if === void 0) (0, M2.checkStrictMode)(Y, `"${Q}" without "if" is ignored`);
      } };
      uz.default = A2;
    });
    cz = E((lz) => {
      Object.defineProperty(lz, "__esModule", { value: true });
      var R2 = V7(), I2 = $z(), b2 = q7(), E2 = Gz(), P2 = Bz(), Z2 = Lz(), S2 = Nz(), C2 = L7(), _2 = jz(), k2 = Pz(), v2 = Sz(), T2 = _z(), x2 = vz(), y2 = xz(), g2 = fz(), h2 = mz();
      function f2(Q = false) {
        let X = [v2.default, T2.default, x2.default, y2.default, g2.default, h2.default, S2.default, C2.default, Z2.default, _2.default, k2.default];
        if (Q) X.push(I2.default, E2.default);
        else X.push(R2.default, b2.default);
        return X.push(P2.default), X;
      }
      lz.default = f2;
    });
    dz = E((pz) => {
      Object.defineProperty(pz, "__esModule", { value: true });
      var N0 = c(), m2 = { message: ({ schemaCode: Q }) => N0.str`must match format "${Q}"`, params: ({ schemaCode: Q }) => N0._`{format: ${Q}}` }, l2 = { keyword: "format", type: ["number", "string"], schemaType: "string", $data: true, error: m2, code(Q, X) {
        let { gen: Y, data: $, $data: J, schema: W, schemaCode: G, it: H } = Q, { opts: B, errSchemaPath: z, schemaEnv: K, self: q } = H;
        if (!B.validateFormats) return;
        if (J) U();
        else V();
        function U() {
          let L = Y.scopeValue("formats", { ref: q.formats, code: B.code.formats }), F = Y.const("fDef", N0._`${L}[${G}]`), w = Y.let("fType"), N = Y.let("format");
          Y.if(N0._`typeof ${F} == "object" && !(${F} instanceof RegExp)`, () => Y.assign(w, N0._`${F}.type || "string"`).assign(N, N0._`${F}.validate`), () => Y.assign(w, N0._`"string"`).assign(N, F)), Q.fail$data((0, N0.or)(j(), R()));
          function j() {
            if (B.strictSchema === false) return N0.nil;
            return N0._`${G} && !${N}`;
          }
          function R() {
            let C = K.$async ? N0._`(${F}.async ? await ${N}(${$}) : ${N}(${$}))` : N0._`${N}(${$})`, Z = N0._`(typeof ${N} == "function" ? ${C} : ${N}.test(${$}))`;
            return N0._`${N} && ${N} !== true && ${w} === ${X} && !${Z}`;
          }
        }
        function V() {
          let L = q.formats[W];
          if (!L) {
            j();
            return;
          }
          if (L === true) return;
          let [F, w, N] = R(L);
          if (F === X) Q.pass(C());
          function j() {
            if (B.strictSchema === false) {
              q.logger.warn(Z());
              return;
            }
            throw Error(Z());
            function Z() {
              return `unknown format "${W}" ignored in schema at path "${z}"`;
            }
          }
          function R(Z) {
            let X0 = Z instanceof RegExp ? (0, N0.regexpCode)(Z) : B.code.formats ? N0._`${B.code.formats}${(0, N0.getProperty)(W)}` : void 0, O0 = Y.scopeValue("formats", { key: W, ref: Z, code: X0 });
            if (typeof Z == "object" && !(Z instanceof RegExp)) return [Z.type || "string", Z.validate, N0._`${O0}.validate`];
            return ["string", Z, O0];
          }
          function C() {
            if (typeof L == "object" && !(L instanceof RegExp) && L.async) {
              if (!K.$async) throw Error("async format in sync schema");
              return N0._`await ${N}(${$})`;
            }
            return typeof w == "function" ? N0._`${N}(${$})` : N0._`${N}.test(${$})`;
          }
        }
      } };
      pz.default = l2;
    });
    nz = E((iz) => {
      Object.defineProperty(iz, "__esModule", { value: true });
      var p2 = dz(), d2 = [p2.default];
      iz.default = d2;
    });
    tz = E((oz) => {
      Object.defineProperty(oz, "__esModule", { value: true });
      oz.contentVocabulary = oz.metadataVocabulary = void 0;
      oz.metadataVocabulary = ["title", "description", "default", "deprecated", "readOnly", "writeOnly", "examples"];
      oz.contentVocabulary = ["contentMediaType", "contentEncoding", "contentSchema"];
    });
    ez = E((sz) => {
      Object.defineProperty(sz, "__esModule", { value: true });
      var o2 = AB(), r2 = oB(), t2 = cz(), a2 = nz(), az = tz(), s2 = [o2.default, r2.default, (0, t2.default)(), a2.default, az.metadataVocabulary, az.contentVocabulary];
      sz.default = s2;
    });
    $K = E((XK) => {
      Object.defineProperty(XK, "__esModule", { value: true });
      XK.DiscrError = void 0;
      var QK;
      (function(Q) {
        Q.Tag = "tag", Q.Mapping = "mapping";
      })(QK || (XK.DiscrError = QK = {}));
    });
    GK = E((WK) => {
      Object.defineProperty(WK, "__esModule", { value: true });
      var j9 = c(), O7 = $K(), JK = HQ(), Qb = R4(), Xb = a(), Yb = { message: ({ params: { discrError: Q, tagName: X } }) => Q === O7.DiscrError.Tag ? `tag "${X}" must be string` : `value of tag "${X}" must be in oneOf`, params: ({ params: { discrError: Q, tag: X, tagName: Y } }) => j9._`{error: ${Q}, tag: ${Y}, tagValue: ${X}}` }, $b = { keyword: "discriminator", type: "object", schemaType: "object", error: Yb, code(Q) {
        let { gen: X, data: Y, schema: $, parentSchema: J, it: W } = Q, { oneOf: G } = J;
        if (!W.opts.discriminator) throw Error("discriminator: requires discriminator option");
        let H = $.propertyName;
        if (typeof H != "string") throw Error("discriminator: requires propertyName");
        if ($.mapping) throw Error("discriminator: mapping is not supported");
        if (!G) throw Error("discriminator: requires oneOf keyword");
        let B = X.let("valid", false), z = X.const("tag", j9._`${Y}${(0, j9.getProperty)(H)}`);
        X.if(j9._`typeof ${z} == "string"`, () => K(), () => Q.error(false, { discrError: O7.DiscrError.Tag, tag: z, tagName: H })), Q.ok(B);
        function K() {
          let V = U();
          X.if(false);
          for (let L in V) X.elseIf(j9._`${z} === ${L}`), X.assign(B, q(V[L]));
          X.else(), Q.error(false, { discrError: O7.DiscrError.Mapping, tag: z, tagName: H }), X.endIf();
        }
        function q(V) {
          let L = X.name("valid"), F = Q.subschema({ keyword: "oneOf", schemaProp: V }, L);
          return Q.mergeEvaluated(F, j9.Name), L;
        }
        function U() {
          var V;
          let L = {}, F = N(J), w = true;
          for (let C = 0; C < G.length; C++) {
            let Z = G[C];
            if ((Z === null || Z === void 0 ? void 0 : Z.$ref) && !(0, Xb.schemaHasRulesButRef)(Z, W.self.RULES)) {
              let O0 = Z.$ref;
              if (Z = JK.resolveRef.call(W.self, W.schemaEnv.root, W.baseId, O0), Z instanceof JK.SchemaEnv) Z = Z.schema;
              if (Z === void 0) throw new Qb.default(W.opts.uriResolver, W.baseId, O0);
            }
            let X0 = (V = Z === null || Z === void 0 ? void 0 : Z.properties) === null || V === void 0 ? void 0 : V[H];
            if (typeof X0 != "object") throw Error(`discriminator: oneOf subschemas (or referenced schemas) must have "properties/${H}"`);
            w = w && (F || N(Z)), j(X0, C);
          }
          if (!w) throw Error(`discriminator: "${H}" must be required`);
          return L;
          function N({ required: C }) {
            return Array.isArray(C) && C.includes(H);
          }
          function j(C, Z) {
            if (C.const) R(C.const, Z);
            else if (C.enum) for (let X0 of C.enum) R(X0, Z);
            else throw Error(`discriminator: "properties/${H}" must have "const" or "enum"`);
          }
          function R(C, Z) {
            if (typeof C != "string" || C in L) throw Error(`discriminator: "${H}" values must be unique strings`);
            L[C] = Z;
          }
        }
      } };
      WK.default = $b;
    });
    HK = E((Xy, Wb) => {
      Wb.exports = { $schema: "http://json-schema.org/draft-07/schema#", $id: "http://json-schema.org/draft-07/schema#", title: "Core schema meta-schema", definitions: { schemaArray: { type: "array", minItems: 1, items: { $ref: "#" } }, nonNegativeInteger: { type: "integer", minimum: 0 }, nonNegativeIntegerDefault0: { allOf: [{ $ref: "#/definitions/nonNegativeInteger" }, { default: 0 }] }, simpleTypes: { enum: ["array", "boolean", "integer", "null", "number", "object", "string"] }, stringArray: { type: "array", items: { type: "string" }, uniqueItems: true, default: [] } }, type: ["object", "boolean"], properties: { $id: { type: "string", format: "uri-reference" }, $schema: { type: "string", format: "uri" }, $ref: { type: "string", format: "uri-reference" }, $comment: { type: "string" }, title: { type: "string" }, description: { type: "string" }, default: true, readOnly: { type: "boolean", default: false }, examples: { type: "array", items: true }, multipleOf: { type: "number", exclusiveMinimum: 0 }, maximum: { type: "number" }, exclusiveMaximum: { type: "number" }, minimum: { type: "number" }, exclusiveMinimum: { type: "number" }, maxLength: { $ref: "#/definitions/nonNegativeInteger" }, minLength: { $ref: "#/definitions/nonNegativeIntegerDefault0" }, pattern: { type: "string", format: "regex" }, additionalItems: { $ref: "#" }, items: { anyOf: [{ $ref: "#" }, { $ref: "#/definitions/schemaArray" }], default: true }, maxItems: { $ref: "#/definitions/nonNegativeInteger" }, minItems: { $ref: "#/definitions/nonNegativeIntegerDefault0" }, uniqueItems: { type: "boolean", default: false }, contains: { $ref: "#" }, maxProperties: { $ref: "#/definitions/nonNegativeInteger" }, minProperties: { $ref: "#/definitions/nonNegativeIntegerDefault0" }, required: { $ref: "#/definitions/stringArray" }, additionalProperties: { $ref: "#" }, definitions: { type: "object", additionalProperties: { $ref: "#" }, default: {} }, properties: { type: "object", additionalProperties: { $ref: "#" }, default: {} }, patternProperties: { type: "object", additionalProperties: { $ref: "#" }, propertyNames: { format: "regex" }, default: {} }, dependencies: { type: "object", additionalProperties: { anyOf: [{ $ref: "#" }, { $ref: "#/definitions/stringArray" }] } }, propertyNames: { $ref: "#" }, const: true, enum: { type: "array", items: true, minItems: 1, uniqueItems: true }, type: { anyOf: [{ $ref: "#/definitions/simpleTypes" }, { type: "array", items: { $ref: "#/definitions/simpleTypes" }, minItems: 1, uniqueItems: true }] }, format: { type: "string" }, contentMediaType: { type: "string" }, contentEncoding: { type: "string" }, if: { $ref: "#" }, then: { $ref: "#" }, else: { $ref: "#" }, allOf: { $ref: "#/definitions/schemaArray" }, anyOf: { $ref: "#/definitions/schemaArray" }, oneOf: { $ref: "#/definitions/schemaArray" }, not: { $ref: "#" } }, default: true };
    });
    D7 = E((u0, N7) => {
      Object.defineProperty(u0, "__esModule", { value: true });
      u0.MissingRefError = u0.ValidationError = u0.CodeGen = u0.Name = u0.nil = u0.stringify = u0.str = u0._ = u0.KeywordCxt = u0.Ajv = void 0;
      var Gb = VB(), Hb = ez(), Bb = GK(), BK = HK(), zb = ["/properties"], EQ = "http://json-schema.org/draft-07/schema";
      class x4 extends Gb.default {
        _addVocabularies() {
          if (super._addVocabularies(), Hb.default.forEach((Q) => this.addVocabulary(Q)), this.opts.discriminator) this.addKeyword(Bb.default);
        }
        _addDefaultMetaSchema() {
          if (super._addDefaultMetaSchema(), !this.opts.meta) return;
          let Q = this.opts.$data ? this.$dataMetaSchema(BK, zb) : BK;
          this.addMetaSchema(Q, EQ, false), this.refs["http://json-schema.org/schema"] = EQ;
        }
        defaultMeta() {
          return this.opts.defaultMeta = super.defaultMeta() || (this.getSchema(EQ) ? EQ : void 0);
        }
      }
      u0.Ajv = x4;
      N7.exports = u0 = x4;
      N7.exports.Ajv = x4;
      Object.defineProperty(u0, "__esModule", { value: true });
      u0.default = x4;
      var Kb = j4();
      Object.defineProperty(u0, "KeywordCxt", { enumerable: true, get: function() {
        return Kb.KeywordCxt;
      } });
      var R9 = c();
      Object.defineProperty(u0, "_", { enumerable: true, get: function() {
        return R9._;
      } });
      Object.defineProperty(u0, "str", { enumerable: true, get: function() {
        return R9.str;
      } });
      Object.defineProperty(u0, "stringify", { enumerable: true, get: function() {
        return R9.stringify;
      } });
      Object.defineProperty(u0, "nil", { enumerable: true, get: function() {
        return R9.nil;
      } });
      Object.defineProperty(u0, "Name", { enumerable: true, get: function() {
        return R9.Name;
      } });
      Object.defineProperty(u0, "CodeGen", { enumerable: true, get: function() {
        return R9.CodeGen;
      } });
      var Vb = WQ();
      Object.defineProperty(u0, "ValidationError", { enumerable: true, get: function() {
        return Vb.default;
      } });
      var qb = R4();
      Object.defineProperty(u0, "MissingRefError", { enumerable: true, get: function() {
        return qb.default;
      } });
    });
    DK = E((OK) => {
      Object.defineProperty(OK, "__esModule", { value: true });
      OK.formatNames = OK.fastFormats = OK.fullFormats = void 0;
      function N1(Q, X) {
        return { validate: Q, compare: X };
      }
      OK.fullFormats = { date: N1(qK, j7), time: N1(M7(true), R7), "date-time": N1(zK(true), LK), "iso-time": N1(M7(), UK), "iso-date-time": N1(zK(), FK), duration: /^P(?!$)((\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?|(\d+W)?)$/, uri: Mb, "uri-reference": /^(?:[a-z][a-z0-9+\-.]*:)?(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'"()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?(?:\?(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i, "uri-template": /^(?:(?:[^\x00-\x20"'<>%\\^`{|}]|%[0-9a-f]{2})|\{[+#./;?&=,!@|]?(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?(?:,(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?)*\})*$/i, url: /^(?:https?|ftp):\/\/(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)(?:\.(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)*(?:\.(?:[a-z\u{00a1}-\u{ffff}]{2,})))(?::\d{2,5})?(?:\/[^\s]*)?$/iu, email: /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i, hostname: /^(?=.{1,253}\.?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[-0-9a-z]{0,61}[0-9a-z])?)*\.?$/i, ipv4: /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/, ipv6: /^((([0-9a-f]{1,4}:){7}([0-9a-f]{1,4}|:))|(([0-9a-f]{1,4}:){6}(:[0-9a-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){5}(((:[0-9a-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){4}(((:[0-9a-f]{1,4}){1,3})|((:[0-9a-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){3}(((:[0-9a-f]{1,4}){1,4})|((:[0-9a-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){2}(((:[0-9a-f]{1,4}){1,5})|((:[0-9a-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){1}(((:[0-9a-f]{1,4}){1,6})|((:[0-9a-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9a-f]{1,4}){1,7})|((:[0-9a-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))$/i, regex: Pb, uuid: /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i, "json-pointer": /^(?:\/(?:[^~/]|~0|~1)*)*$/, "json-pointer-uri-fragment": /^#(?:\/(?:[a-z0-9_\-.!$&'()*+,;:=@]|%[0-9a-f]{2}|~0|~1)*)*$/i, "relative-json-pointer": /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~0|~1)*)*)$/, byte: Ab, int32: { type: "number", validate: Ib }, int64: { type: "number", validate: bb }, float: { type: "number", validate: VK }, double: { type: "number", validate: VK }, password: true, binary: true };
      OK.fastFormats = { ...OK.fullFormats, date: N1(/^\d\d\d\d-[0-1]\d-[0-3]\d$/, j7), time: N1(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, R7), "date-time": N1(/^\d\d\d\d-[0-1]\d-[0-3]\dt(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, LK), "iso-time": N1(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, UK), "iso-date-time": N1(/^\d\d\d\d-[0-1]\d-[0-3]\d[t\s](?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, FK), uri: /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/)?[^\s]*$/i, "uri-reference": /^(?:(?:[a-z][a-z0-9+\-.]*:)?\/?\/)?(?:[^\\\s#][^\s#]*)?(?:#[^\\\s]*)?$/i, email: /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i };
      OK.formatNames = Object.keys(OK.fullFormats);
      function Fb(Q) {
        return Q % 4 === 0 && (Q % 100 !== 0 || Q % 400 === 0);
      }
      var Ob = /^(\d\d\d\d)-(\d\d)-(\d\d)$/, Nb = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      function qK(Q) {
        let X = Ob.exec(Q);
        if (!X) return false;
        let Y = +X[1], $ = +X[2], J = +X[3];
        return $ >= 1 && $ <= 12 && J >= 1 && J <= ($ === 2 && Fb(Y) ? 29 : Nb[$]);
      }
      function j7(Q, X) {
        if (!(Q && X)) return;
        if (Q > X) return 1;
        if (Q < X) return -1;
        return 0;
      }
      var w7 = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)?$/i;
      function M7(Q) {
        return function(Y) {
          let $ = w7.exec(Y);
          if (!$) return false;
          let J = +$[1], W = +$[2], G = +$[3], H = $[4], B = $[5] === "-" ? -1 : 1, z = +($[6] || 0), K = +($[7] || 0);
          if (z > 23 || K > 59 || Q && !H) return false;
          if (J <= 23 && W <= 59 && G < 60) return true;
          let q = W - K * B, U = J - z * B - (q < 0 ? 1 : 0);
          return (U === 23 || U === -1) && (q === 59 || q === -1) && G < 61;
        };
      }
      function R7(Q, X) {
        if (!(Q && X)) return;
        let Y = (/* @__PURE__ */ new Date("2020-01-01T" + Q)).valueOf(), $ = (/* @__PURE__ */ new Date("2020-01-01T" + X)).valueOf();
        if (!(Y && $)) return;
        return Y - $;
      }
      function UK(Q, X) {
        if (!(Q && X)) return;
        let Y = w7.exec(Q), $ = w7.exec(X);
        if (!(Y && $)) return;
        if (Q = Y[1] + Y[2] + Y[3], X = $[1] + $[2] + $[3], Q > X) return 1;
        if (Q < X) return -1;
        return 0;
      }
      var A7 = /t|\s/i;
      function zK(Q) {
        let X = M7(Q);
        return function($) {
          let J = $.split(A7);
          return J.length === 2 && qK(J[0]) && X(J[1]);
        };
      }
      function LK(Q, X) {
        if (!(Q && X)) return;
        let Y = new Date(Q).valueOf(), $ = new Date(X).valueOf();
        if (!(Y && $)) return;
        return Y - $;
      }
      function FK(Q, X) {
        if (!(Q && X)) return;
        let [Y, $] = Q.split(A7), [J, W] = X.split(A7), G = j7(Y, J);
        if (G === void 0) return;
        return G || R7($, W);
      }
      var Db = /\/|:/, wb = /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)(?:\?(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;
      function Mb(Q) {
        return Db.test(Q) && wb.test(Q);
      }
      var KK = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/gm;
      function Ab(Q) {
        return KK.lastIndex = 0, KK.test(Q);
      }
      var jb = -2147483648, Rb = 2147483647;
      function Ib(Q) {
        return Number.isInteger(Q) && Q <= Rb && Q >= jb;
      }
      function bb(Q) {
        return Number.isInteger(Q);
      }
      function VK() {
        return true;
      }
      var Eb = /[^\\]\\Z/;
      function Pb(Q) {
        if (Eb.test(Q)) return false;
        try {
          return new RegExp(Q), true;
        } catch (X) {
          return false;
        }
      }
    });
    MK = E((wK) => {
      Object.defineProperty(wK, "__esModule", { value: true });
      wK.formatLimitDefinition = void 0;
      var Sb = D7(), K1 = c(), X6 = K1.operators, PQ = { formatMaximum: { okStr: "<=", ok: X6.LTE, fail: X6.GT }, formatMinimum: { okStr: ">=", ok: X6.GTE, fail: X6.LT }, formatExclusiveMaximum: { okStr: "<", ok: X6.LT, fail: X6.GTE }, formatExclusiveMinimum: { okStr: ">", ok: X6.GT, fail: X6.LTE } }, Cb = { message: ({ keyword: Q, schemaCode: X }) => K1.str`should be ${PQ[Q].okStr} ${X}`, params: ({ keyword: Q, schemaCode: X }) => K1._`{comparison: ${PQ[Q].okStr}, limit: ${X}}` };
      wK.formatLimitDefinition = { keyword: Object.keys(PQ), type: "string", schemaType: "string", $data: true, error: Cb, code(Q) {
        let { gen: X, data: Y, schemaCode: $, keyword: J, it: W } = Q, { opts: G, self: H } = W;
        if (!G.validateFormats) return;
        let B = new Sb.KeywordCxt(W, H.RULES.all.format.definition, "format");
        if (B.$data) z();
        else K();
        function z() {
          let U = X.scopeValue("formats", { ref: H.formats, code: G.code.formats }), V = X.const("fmt", K1._`${U}[${B.schemaCode}]`);
          Q.fail$data((0, K1.or)(K1._`typeof ${V} != "object"`, K1._`${V} instanceof RegExp`, K1._`typeof ${V}.compare != "function"`, q(V)));
        }
        function K() {
          let U = B.schema, V = H.formats[U];
          if (!V || V === true) return;
          if (typeof V != "object" || V instanceof RegExp || typeof V.compare != "function") throw Error(`"${J}": format "${U}" does not define "compare" function`);
          let L = X.scopeValue("formats", { key: U, ref: V, code: G.code.formats ? K1._`${G.code.formats}${(0, K1.getProperty)(U)}` : void 0 });
          Q.fail$data(q(L));
        }
        function q(U) {
          return K1._`${U}.compare(${Y}, ${$}) ${PQ[J].fail} 0`;
        }
      }, dependencies: ["format"] };
      var _b = (Q) => {
        return Q.addKeyword(wK.formatLimitDefinition), Q;
      };
      wK.default = _b;
    });
    IK = E((y4, RK) => {
      Object.defineProperty(y4, "__esModule", { value: true });
      var I9 = DK(), vb = MK(), E7 = c(), AK = new E7.Name("fullFormats"), Tb = new E7.Name("fastFormats"), P7 = (Q, X = { keywords: true }) => {
        if (Array.isArray(X)) return jK(Q, X, I9.fullFormats, AK), Q;
        let [Y, $] = X.mode === "fast" ? [I9.fastFormats, Tb] : [I9.fullFormats, AK], J = X.formats || I9.formatNames;
        if (jK(Q, J, Y, $), X.keywords) (0, vb.default)(Q);
        return Q;
      };
      P7.get = (Q, X = "full") => {
        let $ = (X === "fast" ? I9.fastFormats : I9.fullFormats)[Q];
        if (!$) throw Error(`Unknown format "${Q}"`);
        return $;
      };
      function jK(Q, X, Y, $) {
        var J, W;
        (J = (W = Q.opts.code).formats) !== null && J !== void 0 || (W.formats = E7._`require("ajv-formats/dist/formats").${$}`);
        for (let G of X) Q.addFormat(G, Y[G]);
      }
      RK.exports = y4 = P7;
      Object.defineProperty(y4, "__esModule", { value: true });
      y4.default = P7;
    });
    KV = 50;
    VV = ["PreToolUse", "PostToolUse", "PostToolUseFailure", "Notification", "UserPromptSubmit", "SessionStart", "SessionEnd", "Stop", "SubagentStart", "SubagentStop", "PreCompact", "PermissionRequest", "Setup", "TeammateIdle", "TaskCompleted", "Elicitation", "ElicitationResult", "ConfigChange", "WorktreeCreate", "WorktreeRemove", "InstructionsLoaded"];
    qV = ["clear", "logout", "prompt_input_exit", "other", "bypass_permissions_disabled"];
    m0 = class extends Error {
    };
    x6 = null;
    wV = typeof global == "object" && global && global.Object === Object && global;
    c7 = wV;
    MV = typeof self == "object" && self && self.Object === Object && self;
    AV = c7 || MV || Function("return this")();
    g6 = AV;
    jV = g6.Symbol;
    h6 = jV;
    p7 = Object.prototype;
    RV = p7.hasOwnProperty;
    IV = p7.toString;
    C9 = h6 ? h6.toStringTag : void 0;
    d7 = bV;
    EV = Object.prototype;
    PV = EV.toString;
    i7 = ZV;
    SV = "[object Null]";
    CV = "[object Undefined]";
    n7 = h6 ? h6.toStringTag : void 0;
    o7 = _V;
    f4 = kV;
    vV = "[object AsyncFunction]";
    TV = "[object Function]";
    xV = "[object GeneratorFunction]";
    yV = "[object Proxy]";
    r7 = gV;
    hV = g6["__core-js_shared__"];
    u4 = hV;
    t7 = function() {
      var Q = /[^.]+$/.exec(u4 && u4.keys && u4.keys.IE_PROTO || "");
      return Q ? "Symbol(src)_1." + Q : "";
    }();
    a7 = fV;
    uV = Function.prototype;
    mV = uV.toString;
    s7 = lV;
    cV = /[\\^$.*+?()[\]{}|]/g;
    pV = /^\[object .+?Constructor\]$/;
    dV = Function.prototype;
    iV = Object.prototype;
    nV = dV.toString;
    oV = iV.hasOwnProperty;
    rV = RegExp("^" + nV.call(oV).replace(cV, "\\$&").replace(/hasOwnProperty|(function).*?(?=\\\()| for .+?(?=\\\])/g, "$1.*?") + "$");
    e7 = tV;
    Q5 = aV;
    m4 = sV;
    eV = m4(Object, "create");
    M1 = eV;
    X5 = Qq;
    Y5 = Xq;
    Yq = "__lodash_hash_undefined__";
    $q = Object.prototype;
    Jq = $q.hasOwnProperty;
    $5 = Wq;
    Gq = Object.prototype;
    Hq = Gq.hasOwnProperty;
    J5 = Bq;
    zq = "__lodash_hash_undefined__";
    W5 = Kq;
    f6.prototype.clear = X5;
    f6.prototype.delete = Y5;
    f6.prototype.get = $5;
    f6.prototype.has = J5;
    f6.prototype.set = W5;
    kQ = f6;
    G5 = Vq;
    H5 = qq;
    k1 = Uq;
    Lq = Array.prototype;
    Fq = Lq.splice;
    B5 = Oq;
    z5 = Nq;
    K5 = Dq;
    V5 = wq;
    u6.prototype.clear = G5;
    u6.prototype.delete = B5;
    u6.prototype.get = z5;
    u6.prototype.has = K5;
    u6.prototype.set = V5;
    q5 = u6;
    Mq = m4(g6, "Map");
    U5 = Mq;
    L5 = Aq;
    F5 = jq;
    v1 = Rq;
    O5 = Iq;
    N5 = bq;
    D5 = Eq;
    w5 = Pq;
    m6.prototype.clear = L5;
    m6.prototype.delete = O5;
    m6.prototype.get = N5;
    m6.prototype.has = D5;
    m6.prototype.set = w5;
    vQ = m6;
    Zq = "Expected a function";
    TQ.Cache = vQ;
    T1 = TQ;
    A5 = T1((Q) => {
      if (!Q || Q.trim() === "") return null;
      let X = Q.split(",").map((W) => W.trim()).filter(Boolean);
      if (X.length === 0) return null;
      let Y = X.some((W) => W.startsWith("!")), $ = X.some((W) => !W.startsWith("!"));
      if (Y && $) return null;
      let J = X.map((W) => W.replace(/^!/, "").toLowerCase());
      return { include: Y ? [] : J, exclude: Y ? J : [], isExclusive: Y };
    });
    uq = { cwd() {
      return process.cwd();
    }, existsSync(Q) {
      let Y = [];
      try {
        const X = Y0(Y, q0`fs.existsSync(${Q})`, 0);
        return u.existsSync(Q);
      } catch ($) {
        var J = $, W = 1;
      } finally {
        $0(Y, J, W);
      }
    }, async stat(Q) {
      return kq(Q);
    }, async readdir(Q) {
      return vq(Q, { withFileTypes: true });
    }, async unlink(Q) {
      return Tq(Q);
    }, async rmdir(Q) {
      return xq(Q);
    }, async rm(Q, X) {
      return yq(Q, X);
    }, async mkdir(Q, X) {
      await gq(Q, { recursive: true, ...X });
    }, async readFile(Q, X) {
      return R5(Q, { encoding: X.encoding });
    }, async rename(Q, X) {
      return hq(Q, X);
    }, statSync(Q) {
      let Y = [];
      try {
        const X = Y0(Y, q0`fs.statSync(${Q})`, 0);
        return u.statSync(Q);
      } catch ($) {
        var J = $, W = 1;
      } finally {
        $0(Y, J, W);
      }
    }, lstatSync(Q) {
      let Y = [];
      try {
        const X = Y0(Y, q0`fs.lstatSync(${Q})`, 0);
        return u.lstatSync(Q);
      } catch ($) {
        var J = $, W = 1;
      } finally {
        $0(Y, J, W);
      }
    }, readFileSync(Q, X) {
      let $ = [];
      try {
        const Y = Y0($, q0`fs.readFileSync(${Q})`, 0);
        return u.readFileSync(Q, { encoding: X.encoding });
      } catch (J) {
        var W = J, G = 1;
      } finally {
        $0($, W, G);
      }
    }, readFileBytesSync(Q) {
      let Y = [];
      try {
        const X = Y0(Y, q0`fs.readFileBytesSync(${Q})`, 0);
        return u.readFileSync(Q);
      } catch ($) {
        var J = $, W = 1;
      } finally {
        $0(Y, J, W);
      }
    }, readSync(Q, X) {
      let J = [];
      try {
        const Y = Y0(J, q0`fs.readSync(${Q}, ${X.length} bytes)`, 0);
        let $ = void 0;
        try {
          $ = u.openSync(Q, "r");
          let B = Buffer.alloc(X.length), z = u.readSync($, B, 0, X.length, 0);
          return { buffer: B, bytesRead: z };
        } finally {
          if ($) u.closeSync($);
        }
      } catch (W) {
        var G = W, H = 1;
      } finally {
        $0(J, G, H);
      }
    }, appendFileSync(Q, X, Y) {
      let J = [];
      try {
        const $ = Y0(J, q0`fs.appendFileSync(${Q}, ${X.length} chars)`, 0);
        if (Y?.mode !== void 0) try {
          let B = u.openSync(Q, "ax", Y.mode);
          try {
            u.appendFileSync(B, X);
          } finally {
            u.closeSync(B);
          }
          return;
        } catch (B) {
          if (B.code !== "EEXIST") throw B;
        }
        u.appendFileSync(Q, X);
      } catch (W) {
        var G = W, H = 1;
      } finally {
        $0(J, G, H);
      }
    }, copyFileSync(Q, X) {
      let $ = [];
      try {
        const Y = Y0($, q0`fs.copyFileSync(${Q} → ${X})`, 0);
        u.copyFileSync(Q, X);
      } catch (J) {
        var W = J, G = 1;
      } finally {
        $0($, W, G);
      }
    }, unlinkSync(Q) {
      let Y = [];
      try {
        const X = Y0(Y, q0`fs.unlinkSync(${Q})`, 0);
        u.unlinkSync(Q);
      } catch ($) {
        var J = $, W = 1;
      } finally {
        $0(Y, J, W);
      }
    }, renameSync(Q, X) {
      let $ = [];
      try {
        const Y = Y0($, q0`fs.renameSync(${Q} → ${X})`, 0);
        u.renameSync(Q, X);
      } catch (J) {
        var W = J, G = 1;
      } finally {
        $0($, W, G);
      }
    }, linkSync(Q, X) {
      let $ = [];
      try {
        const Y = Y0($, q0`fs.linkSync(${Q} → ${X})`, 0);
        u.linkSync(Q, X);
      } catch (J) {
        var W = J, G = 1;
      } finally {
        $0($, W, G);
      }
    }, symlinkSync(Q, X, Y) {
      let J = [];
      try {
        const $ = Y0(J, q0`fs.symlinkSync(${Q} → ${X})`, 0);
        u.symlinkSync(Q, X, Y);
      } catch (W) {
        var G = W, H = 1;
      } finally {
        $0(J, G, H);
      }
    }, readlinkSync(Q) {
      let Y = [];
      try {
        const X = Y0(Y, q0`fs.readlinkSync(${Q})`, 0);
        return u.readlinkSync(Q);
      } catch ($) {
        var J = $, W = 1;
      } finally {
        $0(Y, J, W);
      }
    }, realpathSync(Q) {
      let Y = [];
      try {
        const X = Y0(Y, q0`fs.realpathSync(${Q})`, 0);
        return u.realpathSync(Q).normalize("NFC");
      } catch ($) {
        var J = $, W = 1;
      } finally {
        $0(Y, J, W);
      }
    }, mkdirSync(Q, X) {
      let J = [];
      try {
        const Y = Y0(J, q0`fs.mkdirSync(${Q})`, 0);
        let $ = { recursive: true };
        if (X?.mode !== void 0) $.mode = X.mode;
        u.mkdirSync(Q, $);
      } catch (W) {
        var G = W, H = 1;
      } finally {
        $0(J, G, H);
      }
    }, readdirSync(Q) {
      let Y = [];
      try {
        const X = Y0(Y, q0`fs.readdirSync(${Q})`, 0);
        return u.readdirSync(Q, { withFileTypes: true });
      } catch ($) {
        var J = $, W = 1;
      } finally {
        $0(Y, J, W);
      }
    }, readdirStringSync(Q) {
      let Y = [];
      try {
        const X = Y0(Y, q0`fs.readdirStringSync(${Q})`, 0);
        return u.readdirSync(Q);
      } catch ($) {
        var J = $, W = 1;
      } finally {
        $0(Y, J, W);
      }
    }, isDirEmptySync(Q) {
      let $ = [];
      try {
        const X = Y0($, q0`fs.isDirEmptySync(${Q})`, 0);
        let Y = this.readdirSync(Q);
        return Y.length === 0;
      } catch (J) {
        var W = J, G = 1;
      } finally {
        $0($, W, G);
      }
    }, rmdirSync(Q) {
      let Y = [];
      try {
        const X = Y0(Y, q0`fs.rmdirSync(${Q})`, 0);
        u.rmdirSync(Q);
      } catch ($) {
        var J = $, W = 1;
      } finally {
        $0(Y, J, W);
      }
    }, rmSync(Q, X) {
      let $ = [];
      try {
        const Y = Y0($, q0`fs.rmSync(${Q})`, 0);
        u.rmSync(Q, X);
      } catch (J) {
        var W = J, G = 1;
      } finally {
        $0($, W, G);
      }
    }, createWriteStream(Q) {
      return u.createWriteStream(Q);
    }, async readFileBytes(Q, X) {
      if (X === void 0) return R5(Q);
      let Y = await fq(Q, "r");
      try {
        let { size: $ } = await Y.stat(), J = Math.min($, X), W = Buffer.allocUnsafe(J), G = 0;
        while (G < J) {
          let { bytesRead: H } = await Y.read(W, G, J - G, G);
          if (H === 0) break;
          G += H;
        }
        return G < J ? W.subarray(0, G) : W;
      } finally {
        await Y.close();
      }
    } };
    mq = uq;
    dq = pq();
    P5 = /* @__PURE__ */ new Set();
    iq = T1(() => {
      return S9(process.env.DEBUG) || S9(process.env.DEBUG_SDK) || process.argv.includes("--debug") || process.argv.includes("-d") || _5() || process.argv.some((Q) => Q.startsWith("--debug=")) || k5() !== null;
    });
    nq = T1(() => {
      let Q = process.argv.find((Y) => Y.startsWith("--debug="));
      if (!Q) return null;
      let X = Q.substring(8);
      return A5(X);
    });
    _5 = T1(() => {
      return process.argv.includes("--debug-to-stderr") || process.argv.includes("-d2e");
    });
    k5 = T1(() => {
      for (let Q = 0; Q < process.argv.length; Q++) {
        let X = process.argv[Q];
        if (X.startsWith("--debug-file=")) return X.substring(13);
        if (X === "--debug-file" && Q + 1 < process.argv.length) return process.argv[Q + 1];
      }
      return null;
    });
    rq = false;
    l4 = null;
    aq = T1(() => {
      if (process.argv[2] === "--ripgrep") return;
      try {
        let Q = v5(), X = S5(Q), Y = C5(X, "latest");
        try {
          l6().mkdirSync(X);
        } catch {
        }
        try {
          l6().unlinkSync(Y);
        } catch {
        }
        l6().symlinkSync(Q, Y);
      } catch {
      }
    });
    PZ = (() => {
      let Q = process.env.CLAUDE_CODE_SLOW_OPERATION_THRESHOLD_MS;
      if (Q !== void 0) {
        let X = Number(Q);
        if (!Number.isNaN(X) && X >= 0) return X;
      }
      return 1 / 0;
    })();
    sq = { [Symbol.dispose]() {
    } };
    q0 = eq;
    x1 = (Q, X) => {
      let $ = [];
      try {
        const Y = Y0($, q0`JSON.parse(${Q})`, 0);
        return typeof X > "u" ? JSON.parse(Q) : JSON.parse(Q, X);
      } catch (J) {
        var W = J, G = 1;
      } finally {
        $0($, W, G);
      }
    };
    _9 = class {
      options;
      process;
      processStdin;
      processStdout;
      ready = false;
      abortController;
      exitError;
      exitListeners = [];
      processExitHandler;
      abortHandler;
      constructor(Q) {
        this.options = Q;
        this.abortController = Q.abortController || k6(), this.initialize();
      }
      getDefaultExecutable() {
        return v6() ? "bun" : "node";
      }
      spawnLocalProcess(Q) {
        let { command: X, args: Y, cwd: $, env: J, signal: W } = Q, G = J.DEBUG_CLAUDE_AGENT_SDK || this.options.stderr ? "pipe" : "ignore", H = XU(X, Y, { cwd: $, stdio: ["pipe", "pipe", G], signal: W, env: J, windowsHide: true });
        if (J.DEBUG_CLAUDE_AGENT_SDK || this.options.stderr) H.stderr.on("data", (z) => {
          let K = z.toString();
          if (i0(K), this.options.stderr) this.options.stderr(K);
        });
        return { stdin: H.stdin, stdout: H.stdout, get killed() {
          return H.killed;
        }, get exitCode() {
          return H.exitCode;
        }, kill: H.kill.bind(H), on: H.on.bind(H), once: H.once.bind(H), off: H.off.bind(H) };
      }
      initialize() {
        try {
          let { additionalDirectories: Q = [], agent: X, betas: Y, cwd: $, executable: J = this.getDefaultExecutable(), executableArgs: W = [], extraArgs: G = {}, pathToClaudeCodeExecutable: H, env: B = { ...process.env }, thinkingConfig: z, maxTurns: K, maxBudgetUsd: q, model: U, fallbackModel: V, jsonSchema: L, permissionMode: F, allowDangerouslySkipPermissions: w, permissionPromptToolName: N, continueConversation: j, resume: R, settingSources: C, allowedTools: Z = [], disallowedTools: X0 = [], tools: O0, mcpServers: S0, strictMcpConfig: $6, canUseTool: w1, includePartialMessages: J6, plugins: C1, sandbox: W6 } = this.options, h = ["--output-format", "stream-json", "--verbose", "--input-format", "stream-json"];
          if (z) switch (z.type) {
            case "enabled":
              if (z.budgetTokens === void 0) h.push("--thinking", "adaptive");
              else h.push("--max-thinking-tokens", z.budgetTokens.toString());
              break;
            case "disabled":
              h.push("--thinking", "disabled");
              break;
            case "adaptive":
              h.push("--thinking", "adaptive");
              break;
          }
          if (this.options.effort) h.push("--effort", this.options.effort);
          if (K) h.push("--max-turns", K.toString());
          if (q !== void 0) h.push("--max-budget-usd", q.toString());
          if (U) h.push("--model", U);
          if (X) h.push("--agent", X);
          if (Y && Y.length > 0) h.push("--betas", Y.join(","));
          if (L) h.push("--json-schema", w0(L));
          if (this.options.debugFile) h.push("--debug-file", this.options.debugFile);
          else if (this.options.debug) h.push("--debug");
          if (B.DEBUG_CLAUDE_AGENT_SDK) h.push("--debug-to-stderr");
          if (w1) {
            if (N) throw Error("canUseTool callback cannot be used with permissionPromptToolName. Please use one or the other.");
            h.push("--permission-prompt-tool", "stdio");
          } else if (N) h.push("--permission-prompt-tool", N);
          if (j) h.push("--continue");
          if (R) h.push("--resume", R);
          if (this.options.proactive) h.push("--proactive");
          if (this.options.assistant) h.push("--assistant");
          if (Z.length > 0) h.push("--allowedTools", Z.join(","));
          if (X0.length > 0) h.push("--disallowedTools", X0.join(","));
          if (O0 !== void 0) if (Array.isArray(O0)) if (O0.length === 0) h.push("--tools", "");
          else h.push("--tools", O0.join(","));
          else h.push("--tools", "default");
          if (S0 && Object.keys(S0).length > 0) h.push("--mcp-config", w0({ mcpServers: S0 }));
          if (C) h.push("--setting-sources", C.join(","));
          if ($6) h.push("--strict-mcp-config");
          if (F) h.push("--permission-mode", F);
          if (w) h.push("--allow-dangerously-skip-permissions");
          if (V) {
            if (U && V === U) throw Error("Fallback model cannot be the same as the main model. Please specify a different model for fallbackModel option.");
            h.push("--fallback-model", V);
          }
          if (J6) h.push("--include-partial-messages");
          for (let C0 of Q) h.push("--add-dir", C0);
          if (C1 && C1.length > 0) for (let C0 of C1) if (C0.type === "local") h.push("--plugin-dir", C0.path);
          else throw Error(`Unsupported plugin type: ${C0.type}`);
          if (this.options.forkSession) h.push("--fork-session");
          if (this.options.resumeSessionAt) h.push("--resume-session-at", this.options.resumeSessionAt);
          if (this.options.sessionId) h.push("--session-id", this.options.sessionId);
          if (this.options.persistSession === false) h.push("--no-session-persistence");
          let b9 = { ...G ?? {} };
          if (this.options.settings) b9.settings = this.options.settings;
          let ZQ = T5(b9, W6);
          for (let [C0, _1] of Object.entries(ZQ)) if (_1 === null) h.push(`--${C0}`);
          else h.push(`--${C0}`, _1);
          if (!B.CLAUDE_CODE_ENTRYPOINT) B.CLAUDE_CODE_ENTRYPOINT = "sdk-ts";
          if (delete B.NODE_OPTIONS, B.DEBUG_CLAUDE_AGENT_SDK) B.DEBUG = "1";
          else delete B.DEBUG;
          let E9 = $U(H), P9 = E9 ? H : J, G6 = E9 ? [...W, ...h] : [...W, H, ...h], h4 = { command: P9, args: G6, cwd: $, env: B, signal: this.abortController.signal };
          if (this.options.spawnClaudeCodeProcess) i0(`Spawning Claude Code (custom): ${P9} ${G6.join(" ")}`), this.process = this.options.spawnClaudeCodeProcess(h4);
          else i0(`Spawning Claude Code: ${P9} ${G6.join(" ")}`), this.process = this.spawnLocalProcess(h4);
          this.processStdin = this.process.stdin, this.processStdout = this.process.stdout;
          let Z6 = () => {
            if (this.process && !this.process.killed) this.process.kill("SIGTERM");
          };
          this.processExitHandler = Z6, this.abortHandler = Z6, process.on("exit", this.processExitHandler), this.abortController.signal.addEventListener("abort", this.abortHandler), this.process.on("error", (C0) => {
            if (this.ready = false, this.abortController.signal.aborted) this.exitError = new m0("Claude Code process aborted by user");
            else if (C0.code === "ENOENT") {
              let _1 = E9 ? `Claude Code native binary not found at ${H}. Please ensure Claude Code is installed via native installer or specify a valid path with options.pathToClaudeCodeExecutable.` : `Claude Code executable not found at ${H}. Is options.pathToClaudeCodeExecutable set?`;
              this.exitError = ReferenceError(_1), i0(this.exitError.message);
            } else this.exitError = Error(`Failed to spawn Claude Code process: ${C0.message}`), i0(this.exitError.message);
          }), this.process.on("exit", (C0, _1) => {
            if (this.ready = false, this.abortController.signal.aborted) this.exitError = new m0("Claude Code process aborted by user");
            else {
              let S6 = this.getProcessExitError(C0, _1);
              if (S6) this.exitError = S6, i0(S6.message);
            }
          }), this.ready = true;
        } catch (Q) {
          throw this.ready = false, Q;
        }
      }
      getProcessExitError(Q, X) {
        if (Q !== 0 && Q !== null) return Error(`Claude Code process exited with code ${Q}`);
        else if (X) return Error(`Claude Code process terminated by signal ${X}`);
        return;
      }
      write(Q) {
        if (this.abortController.signal.aborted) throw new m0("Operation aborted");
        if (!this.ready || !this.processStdin) throw Error("ProcessTransport is not ready for writing");
        if (this.process?.killed || this.process?.exitCode !== null) throw Error("Cannot write to terminated process");
        if (this.exitError) throw Error(`Cannot write to process that exited with error: ${this.exitError.message}`);
        i0(`[ProcessTransport] Writing to stdin: ${Q.substring(0, 100)}`);
        try {
          if (!this.processStdin.write(Q)) i0("[ProcessTransport] Write buffer full, data queued");
        } catch (X) {
          throw this.ready = false, Error(`Failed to write to process stdin: ${X.message}`);
        }
      }
      close() {
        if (this.processStdin) this.processStdin.end(), this.processStdin = void 0;
        if (this.abortHandler) this.abortController.signal.removeEventListener("abort", this.abortHandler), this.abortHandler = void 0;
        for (let { handler: Q } of this.exitListeners) this.process?.off("exit", Q);
        if (this.exitListeners = [], this.process && !this.process.killed && this.process.exitCode === null) this.process.kill("SIGTERM"), setTimeout(() => {
          if (this.process && !this.process.killed) this.process.kill("SIGKILL");
        }, 5e3).unref();
        if (this.ready = false, this.processExitHandler) process.off("exit", this.processExitHandler), this.processExitHandler = void 0;
      }
      isReady() {
        return this.ready;
      }
      async *readMessages() {
        if (!this.processStdout) throw Error("ProcessTransport output stream not available");
        let Q = YU({ input: this.processStdout });
        try {
          for await (let X of Q) if (X.trim()) try {
            yield x1(X);
          } catch (Y) {
            throw i0(`Non-JSON stdout: ${X}`), Error(`CLI output was not valid JSON. This may indicate an error during startup. Output: ${X.slice(0, 200)}${X.length > 200 ? "..." : ""}`);
          }
          await this.waitForExit();
        } catch (X) {
          throw X;
        } finally {
          Q.close();
        }
      }
      endInput() {
        if (this.processStdin) this.processStdin.end();
      }
      getInputStream() {
        return this.processStdin;
      }
      onExit(Q) {
        if (!this.process) return () => {
        };
        let X = (Y, $) => {
          let J = this.getProcessExitError(Y, $);
          Q(J);
        };
        return this.process.on("exit", X), this.exitListeners.push({ callback: Q, handler: X }), () => {
          if (this.process) this.process.off("exit", X);
          let Y = this.exitListeners.findIndex(($) => $.handler === X);
          if (Y !== -1) this.exitListeners.splice(Y, 1);
        };
      }
      async waitForExit() {
        if (!this.process) {
          if (this.exitError) throw this.exitError;
          return;
        }
        if (this.process.exitCode !== null || this.process.killed) {
          if (this.exitError) throw this.exitError;
          return;
        }
        return new Promise((Q, X) => {
          let Y = (J, W) => {
            if (this.abortController.signal.aborted) {
              X(new m0("Operation aborted"));
              return;
            }
            let G = this.getProcessExitError(J, W);
            if (G) X(G);
            else Q();
          };
          this.process.once("exit", Y);
          let $ = (J) => {
            this.process.off("exit", Y), X(J);
          };
          this.process.once("error", $), this.process.once("exit", () => {
            this.process.off("error", $);
          });
        });
      }
    };
    k9 = class {
      returned;
      queue = [];
      readResolve;
      readReject;
      isDone = false;
      hasError;
      started = false;
      constructor(Q) {
        this.returned = Q;
      }
      [Symbol.asyncIterator]() {
        if (this.started) throw Error("Stream can only be iterated once");
        return this.started = true, this;
      }
      next() {
        if (this.queue.length > 0) return Promise.resolve({ done: false, value: this.queue.shift() });
        if (this.isDone) return Promise.resolve({ done: true, value: void 0 });
        if (this.hasError) return Promise.reject(this.hasError);
        return new Promise((Q, X) => {
          this.readResolve = Q, this.readReject = X;
        });
      }
      enqueue(Q) {
        if (this.readResolve) {
          let X = this.readResolve;
          this.readResolve = void 0, this.readReject = void 0, X({ done: false, value: Q });
        } else this.queue.push(Q);
      }
      done() {
        if (this.isDone = true, this.readResolve) {
          let Q = this.readResolve;
          this.readResolve = void 0, this.readReject = void 0, Q({ done: true, value: void 0 });
        }
      }
      error(Q) {
        if (this.hasError = Q, this.readReject) {
          let X = this.readReject;
          this.readResolve = void 0, this.readReject = void 0, X(Q);
        }
      }
      return() {
        if (this.isDone = true, this.returned) this.returned();
        return Promise.resolve({ done: true, value: void 0 });
      }
    };
    xQ = class {
      sendMcpMessage;
      isClosed = false;
      constructor(Q) {
        this.sendMcpMessage = Q;
      }
      onclose;
      onerror;
      onmessage;
      async start() {
      }
      async send(Q) {
        if (this.isClosed) throw Error("Transport is closed");
        this.sendMcpMessage(Q);
      }
      async close() {
        if (this.isClosed) return;
        this.isClosed = true, this.onclose?.();
      }
    };
    v9 = class {
      transport;
      isSingleUserTurn;
      canUseTool;
      hooks;
      abortController;
      jsonSchema;
      initConfig;
      onElicitation;
      pendingControlResponses = /* @__PURE__ */ new Map();
      cleanupPerformed = false;
      sdkMessages;
      inputStream = new k9();
      initialization;
      cancelControllers = /* @__PURE__ */ new Map();
      hookCallbacks = /* @__PURE__ */ new Map();
      nextCallbackId = 0;
      sdkMcpTransports = /* @__PURE__ */ new Map();
      sdkMcpServerInstances = /* @__PURE__ */ new Map();
      pendingMcpResponses = /* @__PURE__ */ new Map();
      firstResultReceivedResolve;
      firstResultReceived = false;
      hasBidirectionalNeeds() {
        return this.sdkMcpTransports.size > 0 || this.hooks !== void 0 && Object.keys(this.hooks).length > 0 || this.canUseTool !== void 0 || this.onElicitation !== void 0;
      }
      constructor(Q, X, Y, $, J, W = /* @__PURE__ */ new Map(), G, H, B) {
        this.transport = Q;
        this.isSingleUserTurn = X;
        this.canUseTool = Y;
        this.hooks = $;
        this.abortController = J;
        this.jsonSchema = G;
        this.initConfig = H;
        this.onElicitation = B;
        for (let [z, K] of W) this.connectSdkMcpServer(z, K);
        this.sdkMessages = this.readSdkMessages(), this.readMessages(), this.initialization = this.initialize(), this.initialization.catch(() => {
        });
      }
      setError(Q) {
        this.inputStream.error(Q);
      }
      async stopTask(Q) {
        await this.request({ subtype: "stop_task", task_id: Q });
      }
      close() {
        this.cleanup();
      }
      cleanup(Q) {
        if (this.cleanupPerformed) return;
        this.cleanupPerformed = true;
        try {
          this.transport.close();
          let X = Error("Query closed before response received");
          for (let { reject: Y } of this.pendingControlResponses.values()) Y(X);
          this.pendingControlResponses.clear();
          for (let { reject: Y } of this.pendingMcpResponses.values()) Y(X);
          this.pendingMcpResponses.clear(), this.cancelControllers.clear(), this.hookCallbacks.clear();
          for (let Y of this.sdkMcpTransports.values()) try {
            Y.close();
          } catch {
          }
          if (this.sdkMcpTransports.clear(), Q) this.inputStream.error(Q);
          else this.inputStream.done();
        } catch (X) {
        }
      }
      next(...[Q]) {
        return this.sdkMessages.next(...[Q]);
      }
      return(Q) {
        return this.sdkMessages.return(Q);
      }
      throw(Q) {
        return this.sdkMessages.throw(Q);
      }
      [Symbol.asyncIterator]() {
        return this.sdkMessages;
      }
      [Symbol.asyncDispose]() {
        return this.sdkMessages[Symbol.asyncDispose]();
      }
      async readMessages() {
        try {
          for await (let Q of this.transport.readMessages()) {
            if (Q.type === "control_response") {
              let X = this.pendingControlResponses.get(Q.response.request_id);
              if (X) X.handler(Q.response);
              continue;
            } else if (Q.type === "control_request") {
              this.handleControlRequest(Q);
              continue;
            } else if (Q.type === "control_cancel_request") {
              this.handleControlCancelRequest(Q);
              continue;
            } else if (Q.type === "keep_alive") continue;
            if (Q.type === "streamlined_text" || Q.type === "streamlined_tool_use_summary") continue;
            if (Q.type === "result") {
              if (this.firstResultReceived = true, this.firstResultReceivedResolve) this.firstResultReceivedResolve();
              if (this.isSingleUserTurn) A1("[Query.readMessages] First result received for single-turn query, closing stdin"), this.transport.endInput();
            }
            this.inputStream.enqueue(Q);
          }
          if (this.firstResultReceivedResolve) this.firstResultReceivedResolve();
          this.inputStream.done(), this.cleanup();
        } catch (Q) {
          if (this.firstResultReceivedResolve) this.firstResultReceivedResolve();
          this.inputStream.error(Q), this.cleanup(Q);
        }
      }
      async handleControlRequest(Q) {
        let X = new AbortController();
        this.cancelControllers.set(Q.request_id, X);
        try {
          let Y = await this.processControlRequest(Q, X.signal), $ = { type: "control_response", response: { subtype: "success", request_id: Q.request_id, response: Y } };
          await Promise.resolve(this.transport.write(w0($) + `
`));
        } catch (Y) {
          let $ = { type: "control_response", response: { subtype: "error", request_id: Q.request_id, error: Y.message || String(Y) } };
          await Promise.resolve(this.transport.write(w0($) + `
`));
        } finally {
          this.cancelControllers.delete(Q.request_id);
        }
      }
      handleControlCancelRequest(Q) {
        let X = this.cancelControllers.get(Q.request_id);
        if (X) X.abort(), this.cancelControllers.delete(Q.request_id);
      }
      async processControlRequest(Q, X) {
        if (Q.request.subtype === "can_use_tool") {
          if (!this.canUseTool) throw Error("canUseTool callback is not provided.");
          return { ...await this.canUseTool(Q.request.tool_name, Q.request.input, { signal: X, suggestions: Q.request.permission_suggestions, blockedPath: Q.request.blocked_path, decisionReason: Q.request.decision_reason, toolUseID: Q.request.tool_use_id, agentID: Q.request.agent_id }), toolUseID: Q.request.tool_use_id };
        } else if (Q.request.subtype === "hook_callback") return await this.handleHookCallbacks(Q.request.callback_id, Q.request.input, Q.request.tool_use_id, X);
        else if (Q.request.subtype === "mcp_message") {
          let Y = Q.request, $ = this.sdkMcpTransports.get(Y.server_name);
          if (!$) throw Error(`SDK MCP server not found: ${Y.server_name}`);
          if ("method" in Y.message && "id" in Y.message && Y.message.id !== null) return { mcp_response: await this.handleMcpControlRequest(Y.server_name, Y, $) };
          else {
            if ($.onmessage) $.onmessage(Y.message);
            return { mcp_response: { jsonrpc: "2.0", result: {}, id: 0 } };
          }
        } else if (Q.request.subtype === "elicitation") {
          let Y = Q.request;
          if (this.onElicitation) return await this.onElicitation({ serverName: Y.mcp_server_name, message: Y.message, mode: Y.mode, url: Y.url, elicitationId: Y.elicitation_id, requestedSchema: Y.requested_schema }, { signal: X });
          return { action: "decline" };
        }
        throw Error("Unsupported control request subtype: " + Q.request.subtype);
      }
      async *readSdkMessages() {
        for await (let Q of this.inputStream) yield Q;
      }
      async initialize() {
        let Q;
        if (this.hooks) {
          Q = {};
          for (let [J, W] of Object.entries(this.hooks)) if (W.length > 0) Q[J] = W.map((G) => {
            let H = [];
            for (let B of G.hooks) {
              let z = `hook_${this.nextCallbackId++}`;
              this.hookCallbacks.set(z, B), H.push(z);
            }
            return { matcher: G.matcher, hookCallbackIds: H, timeout: G.timeout };
          });
        }
        let X = this.sdkMcpTransports.size > 0 ? Array.from(this.sdkMcpTransports.keys()) : void 0, Y = { subtype: "initialize", hooks: Q, sdkMcpServers: X, jsonSchema: this.jsonSchema, systemPrompt: this.initConfig?.systemPrompt, appendSystemPrompt: this.initConfig?.appendSystemPrompt, agents: this.initConfig?.agents, promptSuggestions: this.initConfig?.promptSuggestions };
        return (await this.request(Y)).response;
      }
      async interrupt() {
        await this.request({ subtype: "interrupt" });
      }
      async setPermissionMode(Q) {
        await this.request({ subtype: "set_permission_mode", mode: Q });
      }
      async setModel(Q) {
        await this.request({ subtype: "set_model", model: Q });
      }
      async setMaxThinkingTokens(Q) {
        await this.request({ subtype: "set_max_thinking_tokens", max_thinking_tokens: Q });
      }
      async applyFlagSettings(Q) {
        await this.request({ subtype: "apply_flag_settings", settings: Q });
      }
      async getSettings() {
        return (await this.request({ subtype: "get_settings" })).response;
      }
      async rewindFiles(Q, X) {
        return (await this.request({ subtype: "rewind_files", user_message_id: Q, dry_run: X?.dryRun })).response;
      }
      async enableRemoteControl(Q) {
        return (await this.request({ subtype: "remote_control", enabled: Q })).response;
      }
      async setProactive(Q) {
        await this.request({ subtype: "set_proactive", enabled: Q });
      }
      async processPendingPermissionRequests(Q) {
        for (let X of Q) if (X.request.subtype === "can_use_tool") this.handleControlRequest(X).catch(() => {
        });
      }
      request(Q) {
        let X = Math.random().toString(36).substring(2, 15), Y = { request_id: X, type: "control_request", request: Q };
        return new Promise(($, J) => {
          this.pendingControlResponses.set(X, { handler: (W) => {
            if (this.pendingControlResponses.delete(X), W.subtype === "success") $(W);
            else if (J(Error(W.error)), W.pending_permission_requests) this.processPendingPermissionRequests(W.pending_permission_requests);
          }, reject: J }), Promise.resolve(this.transport.write(w0(Y) + `
`));
        });
      }
      async initializationResult() {
        return this.initialization;
      }
      async supportedCommands() {
        return (await this.initialization).commands;
      }
      async supportedModels() {
        return (await this.initialization).models;
      }
      async supportedAgents() {
        return (await this.initialization).agents;
      }
      async reconnectMcpServer(Q) {
        await this.request({ subtype: "mcp_reconnect", serverName: Q });
      }
      async toggleMcpServer(Q, X) {
        await this.request({ subtype: "mcp_toggle", serverName: Q, enabled: X });
      }
      async mcpAuthenticate(Q) {
        return (await this.request({ subtype: "mcp_authenticate", serverName: Q })).response;
      }
      async mcpClearAuth(Q) {
        return (await this.request({ subtype: "mcp_clear_auth", serverName: Q })).response;
      }
      async mcpSubmitOAuthCallbackUrl(Q, X) {
        return (await this.request({ subtype: "mcp_oauth_callback_url", serverName: Q, callbackUrl: X })).response;
      }
      async mcpServerStatus() {
        return (await this.request({ subtype: "mcp_status" })).response.mcpServers;
      }
      async setMcpServers(Q) {
        let X = {}, Y = {};
        for (let [H, B] of Object.entries(Q)) if (B.type === "sdk" && "instance" in B) X[H] = B.instance;
        else Y[H] = B;
        let $ = new Set(this.sdkMcpServerInstances.keys()), J = new Set(Object.keys(X));
        for (let H of $) if (!J.has(H)) await this.disconnectSdkMcpServer(H);
        for (let [H, B] of Object.entries(X)) if (!$.has(H)) this.connectSdkMcpServer(H, B);
        let W = {};
        for (let H of Object.keys(X)) W[H] = { type: "sdk", name: H };
        return (await this.request({ subtype: "mcp_set_servers", servers: { ...Y, ...W } })).response;
      }
      async accountInfo() {
        return (await this.initialization).account;
      }
      async streamInput(Q) {
        A1("[Query.streamInput] Starting to process input stream");
        try {
          let X = 0;
          for await (let Y of Q) {
            if (X++, A1(`[Query.streamInput] Processing message ${X}: ${Y.type}`), this.abortController?.signal.aborted) break;
            await Promise.resolve(this.transport.write(w0(Y) + `
`));
          }
          if (A1(`[Query.streamInput] Finished processing ${X} messages from input stream`), X > 0 && this.hasBidirectionalNeeds()) A1("[Query.streamInput] Has bidirectional needs, waiting for first result"), await this.waitForFirstResult();
          A1("[Query] Calling transport.endInput() to close stdin to CLI process"), this.transport.endInput();
        } catch (X) {
          if (!(X instanceof m0)) throw X;
        }
      }
      waitForFirstResult() {
        if (this.firstResultReceived) return A1("[Query.waitForFirstResult] Result already received, returning immediately"), Promise.resolve();
        return new Promise((Q) => {
          if (this.abortController?.signal.aborted) {
            Q();
            return;
          }
          this.abortController?.signal.addEventListener("abort", () => Q(), { once: true }), this.firstResultReceivedResolve = Q;
        });
      }
      handleHookCallbacks(Q, X, Y, $) {
        let J = this.hookCallbacks.get(Q);
        if (!J) throw Error(`No hook callback found for ID: ${Q}`);
        return J(X, Y, { signal: $ });
      }
      connectSdkMcpServer(Q, X) {
        let Y = new xQ(($) => this.sendMcpServerMessageToCli(Q, $));
        this.sdkMcpTransports.set(Q, Y), this.sdkMcpServerInstances.set(Q, X), X.connect(Y);
      }
      async disconnectSdkMcpServer(Q) {
        let X = this.sdkMcpTransports.get(Q);
        if (X) await X.close(), this.sdkMcpTransports.delete(Q);
        this.sdkMcpServerInstances.delete(Q);
      }
      sendMcpServerMessageToCli(Q, X) {
        if ("id" in X && X.id !== null && X.id !== void 0) {
          let $ = `${Q}:${X.id}`, J = this.pendingMcpResponses.get($);
          if (J) {
            J.resolve(X), this.pendingMcpResponses.delete($);
            return;
          }
        }
        let Y = { type: "control_request", request_id: JU(), request: { subtype: "mcp_message", server_name: Q, message: X } };
        this.transport.write(w0(Y) + `
`);
      }
      handleMcpControlRequest(Q, X, Y) {
        let $ = "id" in X.message ? X.message.id : null, J = `${Q}:${$}`;
        return new Promise((W, G) => {
          let H = () => {
            this.pendingMcpResponses.delete(J);
          }, B = (K) => {
            H(), W(K);
          }, z = (K) => {
            H(), G(K);
          };
          if (this.pendingMcpResponses.set(J, { resolve: B, reject: z }), Y.onmessage) Y.onmessage(X.message);
          else {
            H(), G(Error("No message handler registered"));
            return;
          }
        });
      }
    };
    GU = 5e3;
    yQ = class {
      closed = false;
      inputStream;
      query;
      queryIterator = null;
      abortController;
      _sessionId = null;
      get sessionId() {
        if (this._sessionId === null) throw Error("Session ID not available until after receiving messages");
        return this._sessionId;
      }
      constructor(Q) {
        if (Q.resume) this._sessionId = Q.resume;
        this.inputStream = new k9();
        let X = Q.pathToClaudeCodeExecutable;
        if (!X) {
          let J = WU(import.meta.url), W = x5(J, "..");
          X = x5(W, "cli.js");
        }
        let Y = { ...Q.env ?? process.env };
        if (!Y.CLAUDE_CODE_ENTRYPOINT) Y.CLAUDE_CODE_ENTRYPOINT = "sdk-ts";
        this.abortController = k6();
        let $ = new _9({ abortController: this.abortController, pathToClaudeCodeExecutable: X, env: Y, executable: Q.executable ?? (v6() ? "bun" : "node"), executableArgs: Q.executableArgs ?? [], extraArgs: {}, thinkingConfig: void 0, maxTurns: void 0, maxBudgetUsd: void 0, model: Q.model, fallbackModel: void 0, permissionMode: Q.permissionMode ?? "default", allowDangerouslySkipPermissions: false, continueConversation: false, resume: Q.resume, settingSources: [], allowedTools: Q.allowedTools ?? [], disallowedTools: Q.disallowedTools ?? [], mcpServers: {}, strictMcpConfig: false, canUseTool: !!Q.canUseTool, hooks: !!Q.hooks, includePartialMessages: false, forkSession: false, resumeSessionAt: void 0 });
        this.query = new v9($, false, Q.canUseTool, Q.hooks, this.abortController, /* @__PURE__ */ new Map()), this.query.streamInput(this.inputStream);
      }
      async send(Q) {
        if (this.closed) throw Error("Cannot send to closed session");
        let X = typeof Q === "string" ? { type: "user", session_id: "", message: { role: "user", content: [{ type: "text", text: Q }] }, parent_tool_use_id: null } : Q;
        this.inputStream.enqueue(X);
      }
      async *stream() {
        if (!this.queryIterator) this.queryIterator = this.query[Symbol.asyncIterator]();
        while (true) {
          let { value: Q, done: X } = await this.queryIterator.next();
          if (X) return;
          if (Q.type === "system" && Q.subtype === "init") this._sessionId = Q.session_id;
          if (yield Q, Q.type === "result") return;
        }
      }
      close() {
        if (this.closed) return;
        this.closed = true, this.inputStream.done(), setTimeout(() => {
          if (!this.abortController.signal.aborted) this.abortController.abort();
        }, GU).unref();
      }
      async [Symbol.asyncDispose]() {
        this.close();
      }
    };
    c4 = 65536;
    zU = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    KU = /^(?:<local-command-stdout>|<session-start-hook>|<tick>|<goal>|\[Request interrupted by user[^\]]*\]|\s*<ide_opened_file>[\s\S]*<\/ide_opened_file>\s*$|\s*<ide_selection>[\s\S]*<\/ide_selection>\s*$)/;
    VU = /<command-name>(.*?)<\/command-name>/;
    c6 = 200;
    LU = 1048576;
    h5 = 67108864;
    c5 = 5242880;
    DU = NU(OU);
    m1 = {};
    _Q(m1, { void: () => UL, util: () => d, unknown: () => VL, union: () => OL, undefined: () => BL, tuple: () => wL, transformer: () => SL, symbol: () => HL, string: () => $J, strictObject: () => FL, setErrorMap: () => kU, set: () => jL, record: () => ML, quotelessJson: () => CU, promise: () => ZL, preprocess: () => kL, pipeline: () => vL, ostring: () => TL, optional: () => CL, onumber: () => xL, oboolean: () => yL, objectUtil: () => cQ, object: () => iQ, number: () => JJ, nullable: () => _L, null: () => zL, never: () => qL, nativeEnum: () => PL, nan: () => JL, map: () => AL, makeIssue: () => g9, literal: () => bL, lazy: () => IL, late: () => YL, isValid: () => y1, isDirty: () => r4, isAsync: () => d6, isAborted: () => o4, intersection: () => DL, instanceof: () => $L, getParsedType: () => V1, getErrorMap: () => p6, function: () => RL, enum: () => EL, effect: () => SL, discriminatedUnion: () => NL, defaultErrorMap: () => j1, datetimeRegex: () => QJ, date: () => GL, custom: () => YJ, coerce: () => gL, boolean: () => WJ, bigint: () => WL, array: () => LL, any: () => KL, addIssueToContext: () => b, ZodVoid: () => f9, ZodUnknown: () => g1, ZodUnion: () => a6, ZodUndefined: () => r6, ZodType: () => p, ZodTuple: () => U1, ZodTransformer: () => X1, ZodSymbol: () => h9, ZodString: () => s0, ZodSet: () => U6, ZodSchema: () => p, ZodRecord: () => u9, ZodReadonly: () => J9, ZodPromise: () => L6, ZodPipeline: () => c9, ZodParsedType: () => I, ZodOptional: () => l0, ZodObject: () => U0, ZodNumber: () => h1, ZodNullable: () => I1, ZodNull: () => t6, ZodNever: () => q1, ZodNativeEnum: () => X9, ZodNaN: () => l9, ZodMap: () => m9, ZodLiteral: () => Q9, ZodLazy: () => e6, ZodIssueCode: () => M, ZodIntersection: () => s6, ZodFunction: () => n6, ZodFirstPartyTypeKind: () => A, ZodError: () => x0, ZodEnum: () => u1, ZodEffects: () => X1, ZodDiscriminatedUnion: () => t4, ZodDefault: () => Y9, ZodDate: () => V6, ZodCatch: () => $9, ZodBranded: () => a4, ZodBoolean: () => o6, ZodBigInt: () => f1, ZodArray: () => e0, ZodAny: () => q6, Schema: () => p, ParseStatus: () => A0, OK: () => P0, NEVER: () => hL, INVALID: () => x, EMPTY_PATH: () => vU, DIRTY: () => K6, BRAND: () => XL });
    (function(Q) {
      Q.assertEqual = (J) => {
      };
      function X(J) {
      }
      Q.assertIs = X;
      function Y(J) {
        throw Error();
      }
      Q.assertNever = Y, Q.arrayToEnum = (J) => {
        let W = {};
        for (let G of J) W[G] = G;
        return W;
      }, Q.getValidEnumValues = (J) => {
        let W = Q.objectKeys(J).filter((H) => typeof J[J[H]] !== "number"), G = {};
        for (let H of W) G[H] = J[H];
        return Q.objectValues(G);
      }, Q.objectValues = (J) => {
        return Q.objectKeys(J).map(function(W) {
          return J[W];
        });
      }, Q.objectKeys = typeof Object.keys === "function" ? (J) => Object.keys(J) : (J) => {
        let W = [];
        for (let G in J) if (Object.prototype.hasOwnProperty.call(J, G)) W.push(G);
        return W;
      }, Q.find = (J, W) => {
        for (let G of J) if (W(G)) return G;
        return;
      }, Q.isInteger = typeof Number.isInteger === "function" ? (J) => Number.isInteger(J) : (J) => typeof J === "number" && Number.isFinite(J) && Math.floor(J) === J;
      function $(J, W = " | ") {
        return J.map((G) => typeof G === "string" ? `'${G}'` : G).join(W);
      }
      Q.joinValues = $, Q.jsonStringifyReplacer = (J, W) => {
        if (typeof W === "bigint") return W.toString();
        return W;
      };
    })(d || (d = {}));
    (function(Q) {
      Q.mergeShapes = (X, Y) => {
        return { ...X, ...Y };
      };
    })(cQ || (cQ = {}));
    I = d.arrayToEnum(["string", "nan", "number", "integer", "float", "boolean", "date", "bigint", "symbol", "function", "undefined", "null", "array", "object", "unknown", "promise", "void", "never", "map", "set"]);
    V1 = (Q) => {
      switch (typeof Q) {
        case "undefined":
          return I.undefined;
        case "string":
          return I.string;
        case "number":
          return Number.isNaN(Q) ? I.nan : I.number;
        case "boolean":
          return I.boolean;
        case "function":
          return I.function;
        case "bigint":
          return I.bigint;
        case "symbol":
          return I.symbol;
        case "object":
          if (Array.isArray(Q)) return I.array;
          if (Q === null) return I.null;
          if (Q.then && typeof Q.then === "function" && Q.catch && typeof Q.catch === "function") return I.promise;
          if (typeof Map < "u" && Q instanceof Map) return I.map;
          if (typeof Set < "u" && Q instanceof Set) return I.set;
          if (typeof Date < "u" && Q instanceof Date) return I.date;
          return I.object;
        default:
          return I.unknown;
      }
    };
    M = d.arrayToEnum(["invalid_type", "invalid_literal", "custom", "invalid_union", "invalid_union_discriminator", "invalid_enum_value", "unrecognized_keys", "invalid_arguments", "invalid_return_type", "invalid_date", "invalid_string", "too_small", "too_big", "invalid_intersection_types", "not_multiple_of", "not_finite"]);
    CU = (Q) => {
      return JSON.stringify(Q, null, 2).replace(/"([^"]+)":/g, "$1:");
    };
    x0 = class _x0 extends Error {
      get errors() {
        return this.issues;
      }
      constructor(Q) {
        super();
        this.issues = [], this.addIssue = (Y) => {
          this.issues = [...this.issues, Y];
        }, this.addIssues = (Y = []) => {
          this.issues = [...this.issues, ...Y];
        };
        let X = new.target.prototype;
        if (Object.setPrototypeOf) Object.setPrototypeOf(this, X);
        else this.__proto__ = X;
        this.name = "ZodError", this.issues = Q;
      }
      format(Q) {
        let X = Q || function(J) {
          return J.message;
        }, Y = { _errors: [] }, $ = (J) => {
          for (let W of J.issues) if (W.code === "invalid_union") W.unionErrors.map($);
          else if (W.code === "invalid_return_type") $(W.returnTypeError);
          else if (W.code === "invalid_arguments") $(W.argumentsError);
          else if (W.path.length === 0) Y._errors.push(X(W));
          else {
            let G = Y, H = 0;
            while (H < W.path.length) {
              let B = W.path[H];
              if (H !== W.path.length - 1) G[B] = G[B] || { _errors: [] };
              else G[B] = G[B] || { _errors: [] }, G[B]._errors.push(X(W));
              G = G[B], H++;
            }
          }
        };
        return $(this), Y;
      }
      static assert(Q) {
        if (!(Q instanceof _x0)) throw Error(`Not a ZodError: ${Q}`);
      }
      toString() {
        return this.message;
      }
      get message() {
        return JSON.stringify(this.issues, d.jsonStringifyReplacer, 2);
      }
      get isEmpty() {
        return this.issues.length === 0;
      }
      flatten(Q = (X) => X.message) {
        let X = {}, Y = [];
        for (let $ of this.issues) if ($.path.length > 0) {
          let J = $.path[0];
          X[J] = X[J] || [], X[J].push(Q($));
        } else Y.push(Q($));
        return { formErrors: Y, fieldErrors: X };
      }
      get formErrors() {
        return this.flatten();
      }
    };
    x0.create = (Q) => {
      return new x0(Q);
    };
    _U = (Q, X) => {
      let Y;
      switch (Q.code) {
        case M.invalid_type:
          if (Q.received === I.undefined) Y = "Required";
          else Y = `Expected ${Q.expected}, received ${Q.received}`;
          break;
        case M.invalid_literal:
          Y = `Invalid literal value, expected ${JSON.stringify(Q.expected, d.jsonStringifyReplacer)}`;
          break;
        case M.unrecognized_keys:
          Y = `Unrecognized key(s) in object: ${d.joinValues(Q.keys, ", ")}`;
          break;
        case M.invalid_union:
          Y = "Invalid input";
          break;
        case M.invalid_union_discriminator:
          Y = `Invalid discriminator value. Expected ${d.joinValues(Q.options)}`;
          break;
        case M.invalid_enum_value:
          Y = `Invalid enum value. Expected ${d.joinValues(Q.options)}, received '${Q.received}'`;
          break;
        case M.invalid_arguments:
          Y = "Invalid function arguments";
          break;
        case M.invalid_return_type:
          Y = "Invalid function return type";
          break;
        case M.invalid_date:
          Y = "Invalid date";
          break;
        case M.invalid_string:
          if (typeof Q.validation === "object") if ("includes" in Q.validation) {
            if (Y = `Invalid input: must include "${Q.validation.includes}"`, typeof Q.validation.position === "number") Y = `${Y} at one or more positions greater than or equal to ${Q.validation.position}`;
          } else if ("startsWith" in Q.validation) Y = `Invalid input: must start with "${Q.validation.startsWith}"`;
          else if ("endsWith" in Q.validation) Y = `Invalid input: must end with "${Q.validation.endsWith}"`;
          else d.assertNever(Q.validation);
          else if (Q.validation !== "regex") Y = `Invalid ${Q.validation}`;
          else Y = "Invalid";
          break;
        case M.too_small:
          if (Q.type === "array") Y = `Array must contain ${Q.exact ? "exactly" : Q.inclusive ? "at least" : "more than"} ${Q.minimum} element(s)`;
          else if (Q.type === "string") Y = `String must contain ${Q.exact ? "exactly" : Q.inclusive ? "at least" : "over"} ${Q.minimum} character(s)`;
          else if (Q.type === "number") Y = `Number must be ${Q.exact ? "exactly equal to " : Q.inclusive ? "greater than or equal to " : "greater than "}${Q.minimum}`;
          else if (Q.type === "bigint") Y = `Number must be ${Q.exact ? "exactly equal to " : Q.inclusive ? "greater than or equal to " : "greater than "}${Q.minimum}`;
          else if (Q.type === "date") Y = `Date must be ${Q.exact ? "exactly equal to " : Q.inclusive ? "greater than or equal to " : "greater than "}${new Date(Number(Q.minimum))}`;
          else Y = "Invalid input";
          break;
        case M.too_big:
          if (Q.type === "array") Y = `Array must contain ${Q.exact ? "exactly" : Q.inclusive ? "at most" : "less than"} ${Q.maximum} element(s)`;
          else if (Q.type === "string") Y = `String must contain ${Q.exact ? "exactly" : Q.inclusive ? "at most" : "under"} ${Q.maximum} character(s)`;
          else if (Q.type === "number") Y = `Number must be ${Q.exact ? "exactly" : Q.inclusive ? "less than or equal to" : "less than"} ${Q.maximum}`;
          else if (Q.type === "bigint") Y = `BigInt must be ${Q.exact ? "exactly" : Q.inclusive ? "less than or equal to" : "less than"} ${Q.maximum}`;
          else if (Q.type === "date") Y = `Date must be ${Q.exact ? "exactly" : Q.inclusive ? "smaller than or equal to" : "smaller than"} ${new Date(Number(Q.maximum))}`;
          else Y = "Invalid input";
          break;
        case M.custom:
          Y = "Invalid input";
          break;
        case M.invalid_intersection_types:
          Y = "Intersection results could not be merged";
          break;
        case M.not_multiple_of:
          Y = `Number must be a multiple of ${Q.multipleOf}`;
          break;
        case M.not_finite:
          Y = "Number must be finite";
          break;
        default:
          Y = X.defaultError, d.assertNever(Q);
      }
      return { message: Y };
    };
    j1 = _U;
    r5 = j1;
    g9 = (Q) => {
      let { data: X, path: Y, errorMaps: $, issueData: J } = Q, W = [...Y, ...J.path || []], G = { ...J, path: W };
      if (J.message !== void 0) return { ...J, path: W, message: J.message };
      let H = "", B = $.filter((z) => !!z).slice().reverse();
      for (let z of B) H = z(G, { data: X, defaultError: H }).message;
      return { ...J, path: W, message: H };
    };
    vU = [];
    A0 = class _A0 {
      constructor() {
        this.value = "valid";
      }
      dirty() {
        if (this.value === "valid") this.value = "dirty";
      }
      abort() {
        if (this.value !== "aborted") this.value = "aborted";
      }
      static mergeArray(Q, X) {
        let Y = [];
        for (let $ of X) {
          if ($.status === "aborted") return x;
          if ($.status === "dirty") Q.dirty();
          Y.push($.value);
        }
        return { status: Q.value, value: Y };
      }
      static async mergeObjectAsync(Q, X) {
        let Y = [];
        for (let $ of X) {
          let J = await $.key, W = await $.value;
          Y.push({ key: J, value: W });
        }
        return _A0.mergeObjectSync(Q, Y);
      }
      static mergeObjectSync(Q, X) {
        let Y = {};
        for (let $ of X) {
          let { key: J, value: W } = $;
          if (J.status === "aborted") return x;
          if (W.status === "aborted") return x;
          if (J.status === "dirty") Q.dirty();
          if (W.status === "dirty") Q.dirty();
          if (J.value !== "__proto__" && (typeof W.value < "u" || $.alwaysSet)) Y[J.value] = W.value;
        }
        return { status: Q.value, value: Y };
      }
    };
    x = Object.freeze({ status: "aborted" });
    K6 = (Q) => ({ status: "dirty", value: Q });
    P0 = (Q) => ({ status: "valid", value: Q });
    o4 = (Q) => Q.status === "aborted";
    r4 = (Q) => Q.status === "dirty";
    y1 = (Q) => Q.status === "valid";
    d6 = (Q) => typeof Promise < "u" && Q instanceof Promise;
    (function(Q) {
      Q.errToObj = (X) => typeof X === "string" ? { message: X } : X || {}, Q.toString = (X) => typeof X === "string" ? X : X?.message;
    })(S || (S = {}));
    Q1 = class {
      constructor(Q, X, Y, $) {
        this._cachedPath = [], this.parent = Q, this.data = X, this._path = Y, this._key = $;
      }
      get path() {
        if (!this._cachedPath.length) if (Array.isArray(this._key)) this._cachedPath.push(...this._path, ...this._key);
        else this._cachedPath.push(...this._path, this._key);
        return this._cachedPath;
      }
    };
    t5 = (Q, X) => {
      if (y1(X)) return { success: true, data: X.value };
      else {
        if (!Q.common.issues.length) throw Error("Validation failed but no issues detected.");
        return { success: false, get error() {
          if (this._error) return this._error;
          let Y = new x0(Q.common.issues);
          return this._error = Y, this._error;
        } };
      }
    };
    p = class {
      get description() {
        return this._def.description;
      }
      _getType(Q) {
        return V1(Q.data);
      }
      _getOrReturnCtx(Q, X) {
        return X || { common: Q.parent.common, data: Q.data, parsedType: V1(Q.data), schemaErrorMap: this._def.errorMap, path: Q.path, parent: Q.parent };
      }
      _processInputParams(Q) {
        return { status: new A0(), ctx: { common: Q.parent.common, data: Q.data, parsedType: V1(Q.data), schemaErrorMap: this._def.errorMap, path: Q.path, parent: Q.parent } };
      }
      _parseSync(Q) {
        let X = this._parse(Q);
        if (d6(X)) throw Error("Synchronous parse encountered promise.");
        return X;
      }
      _parseAsync(Q) {
        let X = this._parse(Q);
        return Promise.resolve(X);
      }
      parse(Q, X) {
        let Y = this.safeParse(Q, X);
        if (Y.success) return Y.data;
        throw Y.error;
      }
      safeParse(Q, X) {
        let Y = { common: { issues: [], async: X?.async ?? false, contextualErrorMap: X?.errorMap }, path: X?.path || [], schemaErrorMap: this._def.errorMap, parent: null, data: Q, parsedType: V1(Q) }, $ = this._parseSync({ data: Q, path: Y.path, parent: Y });
        return t5(Y, $);
      }
      "~validate"(Q) {
        let X = { common: { issues: [], async: !!this["~standard"].async }, path: [], schemaErrorMap: this._def.errorMap, parent: null, data: Q, parsedType: V1(Q) };
        if (!this["~standard"].async) try {
          let Y = this._parseSync({ data: Q, path: [], parent: X });
          return y1(Y) ? { value: Y.value } : { issues: X.common.issues };
        } catch (Y) {
          if (Y?.message?.toLowerCase()?.includes("encountered")) this["~standard"].async = true;
          X.common = { issues: [], async: true };
        }
        return this._parseAsync({ data: Q, path: [], parent: X }).then((Y) => y1(Y) ? { value: Y.value } : { issues: X.common.issues });
      }
      async parseAsync(Q, X) {
        let Y = await this.safeParseAsync(Q, X);
        if (Y.success) return Y.data;
        throw Y.error;
      }
      async safeParseAsync(Q, X) {
        let Y = { common: { issues: [], contextualErrorMap: X?.errorMap, async: true }, path: X?.path || [], schemaErrorMap: this._def.errorMap, parent: null, data: Q, parsedType: V1(Q) }, $ = this._parse({ data: Q, path: Y.path, parent: Y }), J = await (d6($) ? $ : Promise.resolve($));
        return t5(Y, J);
      }
      refine(Q, X) {
        let Y = ($) => {
          if (typeof X === "string" || typeof X > "u") return { message: X };
          else if (typeof X === "function") return X($);
          else return X;
        };
        return this._refinement(($, J) => {
          let W = Q($), G = () => J.addIssue({ code: M.custom, ...Y($) });
          if (typeof Promise < "u" && W instanceof Promise) return W.then((H) => {
            if (!H) return G(), false;
            else return true;
          });
          if (!W) return G(), false;
          else return true;
        });
      }
      refinement(Q, X) {
        return this._refinement((Y, $) => {
          if (!Q(Y)) return $.addIssue(typeof X === "function" ? X(Y, $) : X), false;
          else return true;
        });
      }
      _refinement(Q) {
        return new X1({ schema: this, typeName: A.ZodEffects, effect: { type: "refinement", refinement: Q } });
      }
      superRefine(Q) {
        return this._refinement(Q);
      }
      constructor(Q) {
        this.spa = this.safeParseAsync, this._def = Q, this.parse = this.parse.bind(this), this.safeParse = this.safeParse.bind(this), this.parseAsync = this.parseAsync.bind(this), this.safeParseAsync = this.safeParseAsync.bind(this), this.spa = this.spa.bind(this), this.refine = this.refine.bind(this), this.refinement = this.refinement.bind(this), this.superRefine = this.superRefine.bind(this), this.optional = this.optional.bind(this), this.nullable = this.nullable.bind(this), this.nullish = this.nullish.bind(this), this.array = this.array.bind(this), this.promise = this.promise.bind(this), this.or = this.or.bind(this), this.and = this.and.bind(this), this.transform = this.transform.bind(this), this.brand = this.brand.bind(this), this.default = this.default.bind(this), this.catch = this.catch.bind(this), this.describe = this.describe.bind(this), this.pipe = this.pipe.bind(this), this.readonly = this.readonly.bind(this), this.isNullable = this.isNullable.bind(this), this.isOptional = this.isOptional.bind(this), this["~standard"] = { version: 1, vendor: "zod", validate: (X) => this["~validate"](X) };
      }
      optional() {
        return l0.create(this, this._def);
      }
      nullable() {
        return I1.create(this, this._def);
      }
      nullish() {
        return this.nullable().optional();
      }
      array() {
        return e0.create(this);
      }
      promise() {
        return L6.create(this, this._def);
      }
      or(Q) {
        return a6.create([this, Q], this._def);
      }
      and(Q) {
        return s6.create(this, Q, this._def);
      }
      transform(Q) {
        return new X1({ ...m(this._def), schema: this, typeName: A.ZodEffects, effect: { type: "transform", transform: Q } });
      }
      default(Q) {
        let X = typeof Q === "function" ? Q : () => Q;
        return new Y9({ ...m(this._def), innerType: this, defaultValue: X, typeName: A.ZodDefault });
      }
      brand() {
        return new a4({ typeName: A.ZodBranded, type: this, ...m(this._def) });
      }
      catch(Q) {
        let X = typeof Q === "function" ? Q : () => Q;
        return new $9({ ...m(this._def), innerType: this, catchValue: X, typeName: A.ZodCatch });
      }
      describe(Q) {
        return new this.constructor({ ...this._def, description: Q });
      }
      pipe(Q) {
        return c9.create(this, Q);
      }
      readonly() {
        return J9.create(this);
      }
      isOptional() {
        return this.safeParse(void 0).success;
      }
      isNullable() {
        return this.safeParse(null).success;
      }
    };
    TU = /^c[^\s-]{8,}$/i;
    xU = /^[0-9a-z]+$/;
    yU = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
    gU = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
    hU = /^[a-z0-9_-]{21}$/i;
    fU = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
    uU = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
    mU = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
    lU = "^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$";
    cU = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
    pU = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
    dU = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
    iU = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
    nU = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
    oU = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
    s5 = "((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))";
    rU = new RegExp(`^${s5}$`);
    s0 = class _s0 extends p {
      _parse(Q) {
        if (this._def.coerce) Q.data = String(Q.data);
        if (this._getType(Q) !== I.string) {
          let J = this._getOrReturnCtx(Q);
          return b(J, { code: M.invalid_type, expected: I.string, received: J.parsedType }), x;
        }
        let Y = new A0(), $ = void 0;
        for (let J of this._def.checks) if (J.kind === "min") {
          if (Q.data.length < J.value) $ = this._getOrReturnCtx(Q, $), b($, { code: M.too_small, minimum: J.value, type: "string", inclusive: true, exact: false, message: J.message }), Y.dirty();
        } else if (J.kind === "max") {
          if (Q.data.length > J.value) $ = this._getOrReturnCtx(Q, $), b($, { code: M.too_big, maximum: J.value, type: "string", inclusive: true, exact: false, message: J.message }), Y.dirty();
        } else if (J.kind === "length") {
          let W = Q.data.length > J.value, G = Q.data.length < J.value;
          if (W || G) {
            if ($ = this._getOrReturnCtx(Q, $), W) b($, { code: M.too_big, maximum: J.value, type: "string", inclusive: true, exact: true, message: J.message });
            else if (G) b($, { code: M.too_small, minimum: J.value, type: "string", inclusive: true, exact: true, message: J.message });
            Y.dirty();
          }
        } else if (J.kind === "email") {
          if (!mU.test(Q.data)) $ = this._getOrReturnCtx(Q, $), b($, { validation: "email", code: M.invalid_string, message: J.message }), Y.dirty();
        } else if (J.kind === "emoji") {
          if (!pQ) pQ = new RegExp(lU, "u");
          if (!pQ.test(Q.data)) $ = this._getOrReturnCtx(Q, $), b($, { validation: "emoji", code: M.invalid_string, message: J.message }), Y.dirty();
        } else if (J.kind === "uuid") {
          if (!gU.test(Q.data)) $ = this._getOrReturnCtx(Q, $), b($, { validation: "uuid", code: M.invalid_string, message: J.message }), Y.dirty();
        } else if (J.kind === "nanoid") {
          if (!hU.test(Q.data)) $ = this._getOrReturnCtx(Q, $), b($, { validation: "nanoid", code: M.invalid_string, message: J.message }), Y.dirty();
        } else if (J.kind === "cuid") {
          if (!TU.test(Q.data)) $ = this._getOrReturnCtx(Q, $), b($, { validation: "cuid", code: M.invalid_string, message: J.message }), Y.dirty();
        } else if (J.kind === "cuid2") {
          if (!xU.test(Q.data)) $ = this._getOrReturnCtx(Q, $), b($, { validation: "cuid2", code: M.invalid_string, message: J.message }), Y.dirty();
        } else if (J.kind === "ulid") {
          if (!yU.test(Q.data)) $ = this._getOrReturnCtx(Q, $), b($, { validation: "ulid", code: M.invalid_string, message: J.message }), Y.dirty();
        } else if (J.kind === "url") try {
          new URL(Q.data);
        } catch {
          $ = this._getOrReturnCtx(Q, $), b($, { validation: "url", code: M.invalid_string, message: J.message }), Y.dirty();
        }
        else if (J.kind === "regex") {
          if (J.regex.lastIndex = 0, !J.regex.test(Q.data)) $ = this._getOrReturnCtx(Q, $), b($, { validation: "regex", code: M.invalid_string, message: J.message }), Y.dirty();
        } else if (J.kind === "trim") Q.data = Q.data.trim();
        else if (J.kind === "includes") {
          if (!Q.data.includes(J.value, J.position)) $ = this._getOrReturnCtx(Q, $), b($, { code: M.invalid_string, validation: { includes: J.value, position: J.position }, message: J.message }), Y.dirty();
        } else if (J.kind === "toLowerCase") Q.data = Q.data.toLowerCase();
        else if (J.kind === "toUpperCase") Q.data = Q.data.toUpperCase();
        else if (J.kind === "startsWith") {
          if (!Q.data.startsWith(J.value)) $ = this._getOrReturnCtx(Q, $), b($, { code: M.invalid_string, validation: { startsWith: J.value }, message: J.message }), Y.dirty();
        } else if (J.kind === "endsWith") {
          if (!Q.data.endsWith(J.value)) $ = this._getOrReturnCtx(Q, $), b($, { code: M.invalid_string, validation: { endsWith: J.value }, message: J.message }), Y.dirty();
        } else if (J.kind === "datetime") {
          if (!QJ(J).test(Q.data)) $ = this._getOrReturnCtx(Q, $), b($, { code: M.invalid_string, validation: "datetime", message: J.message }), Y.dirty();
        } else if (J.kind === "date") {
          if (!rU.test(Q.data)) $ = this._getOrReturnCtx(Q, $), b($, { code: M.invalid_string, validation: "date", message: J.message }), Y.dirty();
        } else if (J.kind === "time") {
          if (!tU(J).test(Q.data)) $ = this._getOrReturnCtx(Q, $), b($, { code: M.invalid_string, validation: "time", message: J.message }), Y.dirty();
        } else if (J.kind === "duration") {
          if (!uU.test(Q.data)) $ = this._getOrReturnCtx(Q, $), b($, { validation: "duration", code: M.invalid_string, message: J.message }), Y.dirty();
        } else if (J.kind === "ip") {
          if (!aU(Q.data, J.version)) $ = this._getOrReturnCtx(Q, $), b($, { validation: "ip", code: M.invalid_string, message: J.message }), Y.dirty();
        } else if (J.kind === "jwt") {
          if (!sU(Q.data, J.alg)) $ = this._getOrReturnCtx(Q, $), b($, { validation: "jwt", code: M.invalid_string, message: J.message }), Y.dirty();
        } else if (J.kind === "cidr") {
          if (!eU(Q.data, J.version)) $ = this._getOrReturnCtx(Q, $), b($, { validation: "cidr", code: M.invalid_string, message: J.message }), Y.dirty();
        } else if (J.kind === "base64") {
          if (!nU.test(Q.data)) $ = this._getOrReturnCtx(Q, $), b($, { validation: "base64", code: M.invalid_string, message: J.message }), Y.dirty();
        } else if (J.kind === "base64url") {
          if (!oU.test(Q.data)) $ = this._getOrReturnCtx(Q, $), b($, { validation: "base64url", code: M.invalid_string, message: J.message }), Y.dirty();
        } else d.assertNever(J);
        return { status: Y.value, value: Q.data };
      }
      _regex(Q, X, Y) {
        return this.refinement(($) => Q.test($), { validation: X, code: M.invalid_string, ...S.errToObj(Y) });
      }
      _addCheck(Q) {
        return new _s0({ ...this._def, checks: [...this._def.checks, Q] });
      }
      email(Q) {
        return this._addCheck({ kind: "email", ...S.errToObj(Q) });
      }
      url(Q) {
        return this._addCheck({ kind: "url", ...S.errToObj(Q) });
      }
      emoji(Q) {
        return this._addCheck({ kind: "emoji", ...S.errToObj(Q) });
      }
      uuid(Q) {
        return this._addCheck({ kind: "uuid", ...S.errToObj(Q) });
      }
      nanoid(Q) {
        return this._addCheck({ kind: "nanoid", ...S.errToObj(Q) });
      }
      cuid(Q) {
        return this._addCheck({ kind: "cuid", ...S.errToObj(Q) });
      }
      cuid2(Q) {
        return this._addCheck({ kind: "cuid2", ...S.errToObj(Q) });
      }
      ulid(Q) {
        return this._addCheck({ kind: "ulid", ...S.errToObj(Q) });
      }
      base64(Q) {
        return this._addCheck({ kind: "base64", ...S.errToObj(Q) });
      }
      base64url(Q) {
        return this._addCheck({ kind: "base64url", ...S.errToObj(Q) });
      }
      jwt(Q) {
        return this._addCheck({ kind: "jwt", ...S.errToObj(Q) });
      }
      ip(Q) {
        return this._addCheck({ kind: "ip", ...S.errToObj(Q) });
      }
      cidr(Q) {
        return this._addCheck({ kind: "cidr", ...S.errToObj(Q) });
      }
      datetime(Q) {
        if (typeof Q === "string") return this._addCheck({ kind: "datetime", precision: null, offset: false, local: false, message: Q });
        return this._addCheck({ kind: "datetime", precision: typeof Q?.precision > "u" ? null : Q?.precision, offset: Q?.offset ?? false, local: Q?.local ?? false, ...S.errToObj(Q?.message) });
      }
      date(Q) {
        return this._addCheck({ kind: "date", message: Q });
      }
      time(Q) {
        if (typeof Q === "string") return this._addCheck({ kind: "time", precision: null, message: Q });
        return this._addCheck({ kind: "time", precision: typeof Q?.precision > "u" ? null : Q?.precision, ...S.errToObj(Q?.message) });
      }
      duration(Q) {
        return this._addCheck({ kind: "duration", ...S.errToObj(Q) });
      }
      regex(Q, X) {
        return this._addCheck({ kind: "regex", regex: Q, ...S.errToObj(X) });
      }
      includes(Q, X) {
        return this._addCheck({ kind: "includes", value: Q, position: X?.position, ...S.errToObj(X?.message) });
      }
      startsWith(Q, X) {
        return this._addCheck({ kind: "startsWith", value: Q, ...S.errToObj(X) });
      }
      endsWith(Q, X) {
        return this._addCheck({ kind: "endsWith", value: Q, ...S.errToObj(X) });
      }
      min(Q, X) {
        return this._addCheck({ kind: "min", value: Q, ...S.errToObj(X) });
      }
      max(Q, X) {
        return this._addCheck({ kind: "max", value: Q, ...S.errToObj(X) });
      }
      length(Q, X) {
        return this._addCheck({ kind: "length", value: Q, ...S.errToObj(X) });
      }
      nonempty(Q) {
        return this.min(1, S.errToObj(Q));
      }
      trim() {
        return new _s0({ ...this._def, checks: [...this._def.checks, { kind: "trim" }] });
      }
      toLowerCase() {
        return new _s0({ ...this._def, checks: [...this._def.checks, { kind: "toLowerCase" }] });
      }
      toUpperCase() {
        return new _s0({ ...this._def, checks: [...this._def.checks, { kind: "toUpperCase" }] });
      }
      get isDatetime() {
        return !!this._def.checks.find((Q) => Q.kind === "datetime");
      }
      get isDate() {
        return !!this._def.checks.find((Q) => Q.kind === "date");
      }
      get isTime() {
        return !!this._def.checks.find((Q) => Q.kind === "time");
      }
      get isDuration() {
        return !!this._def.checks.find((Q) => Q.kind === "duration");
      }
      get isEmail() {
        return !!this._def.checks.find((Q) => Q.kind === "email");
      }
      get isURL() {
        return !!this._def.checks.find((Q) => Q.kind === "url");
      }
      get isEmoji() {
        return !!this._def.checks.find((Q) => Q.kind === "emoji");
      }
      get isUUID() {
        return !!this._def.checks.find((Q) => Q.kind === "uuid");
      }
      get isNANOID() {
        return !!this._def.checks.find((Q) => Q.kind === "nanoid");
      }
      get isCUID() {
        return !!this._def.checks.find((Q) => Q.kind === "cuid");
      }
      get isCUID2() {
        return !!this._def.checks.find((Q) => Q.kind === "cuid2");
      }
      get isULID() {
        return !!this._def.checks.find((Q) => Q.kind === "ulid");
      }
      get isIP() {
        return !!this._def.checks.find((Q) => Q.kind === "ip");
      }
      get isCIDR() {
        return !!this._def.checks.find((Q) => Q.kind === "cidr");
      }
      get isBase64() {
        return !!this._def.checks.find((Q) => Q.kind === "base64");
      }
      get isBase64url() {
        return !!this._def.checks.find((Q) => Q.kind === "base64url");
      }
      get minLength() {
        let Q = null;
        for (let X of this._def.checks) if (X.kind === "min") {
          if (Q === null || X.value > Q) Q = X.value;
        }
        return Q;
      }
      get maxLength() {
        let Q = null;
        for (let X of this._def.checks) if (X.kind === "max") {
          if (Q === null || X.value < Q) Q = X.value;
        }
        return Q;
      }
    };
    s0.create = (Q) => {
      return new s0({ checks: [], typeName: A.ZodString, coerce: Q?.coerce ?? false, ...m(Q) });
    };
    h1 = class _h1 extends p {
      constructor() {
        super(...arguments);
        this.min = this.gte, this.max = this.lte, this.step = this.multipleOf;
      }
      _parse(Q) {
        if (this._def.coerce) Q.data = Number(Q.data);
        if (this._getType(Q) !== I.number) {
          let J = this._getOrReturnCtx(Q);
          return b(J, { code: M.invalid_type, expected: I.number, received: J.parsedType }), x;
        }
        let Y = void 0, $ = new A0();
        for (let J of this._def.checks) if (J.kind === "int") {
          if (!d.isInteger(Q.data)) Y = this._getOrReturnCtx(Q, Y), b(Y, { code: M.invalid_type, expected: "integer", received: "float", message: J.message }), $.dirty();
        } else if (J.kind === "min") {
          if (J.inclusive ? Q.data < J.value : Q.data <= J.value) Y = this._getOrReturnCtx(Q, Y), b(Y, { code: M.too_small, minimum: J.value, type: "number", inclusive: J.inclusive, exact: false, message: J.message }), $.dirty();
        } else if (J.kind === "max") {
          if (J.inclusive ? Q.data > J.value : Q.data >= J.value) Y = this._getOrReturnCtx(Q, Y), b(Y, { code: M.too_big, maximum: J.value, type: "number", inclusive: J.inclusive, exact: false, message: J.message }), $.dirty();
        } else if (J.kind === "multipleOf") {
          if (QL(Q.data, J.value) !== 0) Y = this._getOrReturnCtx(Q, Y), b(Y, { code: M.not_multiple_of, multipleOf: J.value, message: J.message }), $.dirty();
        } else if (J.kind === "finite") {
          if (!Number.isFinite(Q.data)) Y = this._getOrReturnCtx(Q, Y), b(Y, { code: M.not_finite, message: J.message }), $.dirty();
        } else d.assertNever(J);
        return { status: $.value, value: Q.data };
      }
      gte(Q, X) {
        return this.setLimit("min", Q, true, S.toString(X));
      }
      gt(Q, X) {
        return this.setLimit("min", Q, false, S.toString(X));
      }
      lte(Q, X) {
        return this.setLimit("max", Q, true, S.toString(X));
      }
      lt(Q, X) {
        return this.setLimit("max", Q, false, S.toString(X));
      }
      setLimit(Q, X, Y, $) {
        return new _h1({ ...this._def, checks: [...this._def.checks, { kind: Q, value: X, inclusive: Y, message: S.toString($) }] });
      }
      _addCheck(Q) {
        return new _h1({ ...this._def, checks: [...this._def.checks, Q] });
      }
      int(Q) {
        return this._addCheck({ kind: "int", message: S.toString(Q) });
      }
      positive(Q) {
        return this._addCheck({ kind: "min", value: 0, inclusive: false, message: S.toString(Q) });
      }
      negative(Q) {
        return this._addCheck({ kind: "max", value: 0, inclusive: false, message: S.toString(Q) });
      }
      nonpositive(Q) {
        return this._addCheck({ kind: "max", value: 0, inclusive: true, message: S.toString(Q) });
      }
      nonnegative(Q) {
        return this._addCheck({ kind: "min", value: 0, inclusive: true, message: S.toString(Q) });
      }
      multipleOf(Q, X) {
        return this._addCheck({ kind: "multipleOf", value: Q, message: S.toString(X) });
      }
      finite(Q) {
        return this._addCheck({ kind: "finite", message: S.toString(Q) });
      }
      safe(Q) {
        return this._addCheck({ kind: "min", inclusive: true, value: Number.MIN_SAFE_INTEGER, message: S.toString(Q) })._addCheck({ kind: "max", inclusive: true, value: Number.MAX_SAFE_INTEGER, message: S.toString(Q) });
      }
      get minValue() {
        let Q = null;
        for (let X of this._def.checks) if (X.kind === "min") {
          if (Q === null || X.value > Q) Q = X.value;
        }
        return Q;
      }
      get maxValue() {
        let Q = null;
        for (let X of this._def.checks) if (X.kind === "max") {
          if (Q === null || X.value < Q) Q = X.value;
        }
        return Q;
      }
      get isInt() {
        return !!this._def.checks.find((Q) => Q.kind === "int" || Q.kind === "multipleOf" && d.isInteger(Q.value));
      }
      get isFinite() {
        let Q = null, X = null;
        for (let Y of this._def.checks) if (Y.kind === "finite" || Y.kind === "int" || Y.kind === "multipleOf") return true;
        else if (Y.kind === "min") {
          if (X === null || Y.value > X) X = Y.value;
        } else if (Y.kind === "max") {
          if (Q === null || Y.value < Q) Q = Y.value;
        }
        return Number.isFinite(X) && Number.isFinite(Q);
      }
    };
    h1.create = (Q) => {
      return new h1({ checks: [], typeName: A.ZodNumber, coerce: Q?.coerce || false, ...m(Q) });
    };
    f1 = class _f1 extends p {
      constructor() {
        super(...arguments);
        this.min = this.gte, this.max = this.lte;
      }
      _parse(Q) {
        if (this._def.coerce) try {
          Q.data = BigInt(Q.data);
        } catch {
          return this._getInvalidInput(Q);
        }
        if (this._getType(Q) !== I.bigint) return this._getInvalidInput(Q);
        let Y = void 0, $ = new A0();
        for (let J of this._def.checks) if (J.kind === "min") {
          if (J.inclusive ? Q.data < J.value : Q.data <= J.value) Y = this._getOrReturnCtx(Q, Y), b(Y, { code: M.too_small, type: "bigint", minimum: J.value, inclusive: J.inclusive, message: J.message }), $.dirty();
        } else if (J.kind === "max") {
          if (J.inclusive ? Q.data > J.value : Q.data >= J.value) Y = this._getOrReturnCtx(Q, Y), b(Y, { code: M.too_big, type: "bigint", maximum: J.value, inclusive: J.inclusive, message: J.message }), $.dirty();
        } else if (J.kind === "multipleOf") {
          if (Q.data % J.value !== BigInt(0)) Y = this._getOrReturnCtx(Q, Y), b(Y, { code: M.not_multiple_of, multipleOf: J.value, message: J.message }), $.dirty();
        } else d.assertNever(J);
        return { status: $.value, value: Q.data };
      }
      _getInvalidInput(Q) {
        let X = this._getOrReturnCtx(Q);
        return b(X, { code: M.invalid_type, expected: I.bigint, received: X.parsedType }), x;
      }
      gte(Q, X) {
        return this.setLimit("min", Q, true, S.toString(X));
      }
      gt(Q, X) {
        return this.setLimit("min", Q, false, S.toString(X));
      }
      lte(Q, X) {
        return this.setLimit("max", Q, true, S.toString(X));
      }
      lt(Q, X) {
        return this.setLimit("max", Q, false, S.toString(X));
      }
      setLimit(Q, X, Y, $) {
        return new _f1({ ...this._def, checks: [...this._def.checks, { kind: Q, value: X, inclusive: Y, message: S.toString($) }] });
      }
      _addCheck(Q) {
        return new _f1({ ...this._def, checks: [...this._def.checks, Q] });
      }
      positive(Q) {
        return this._addCheck({ kind: "min", value: BigInt(0), inclusive: false, message: S.toString(Q) });
      }
      negative(Q) {
        return this._addCheck({ kind: "max", value: BigInt(0), inclusive: false, message: S.toString(Q) });
      }
      nonpositive(Q) {
        return this._addCheck({ kind: "max", value: BigInt(0), inclusive: true, message: S.toString(Q) });
      }
      nonnegative(Q) {
        return this._addCheck({ kind: "min", value: BigInt(0), inclusive: true, message: S.toString(Q) });
      }
      multipleOf(Q, X) {
        return this._addCheck({ kind: "multipleOf", value: Q, message: S.toString(X) });
      }
      get minValue() {
        let Q = null;
        for (let X of this._def.checks) if (X.kind === "min") {
          if (Q === null || X.value > Q) Q = X.value;
        }
        return Q;
      }
      get maxValue() {
        let Q = null;
        for (let X of this._def.checks) if (X.kind === "max") {
          if (Q === null || X.value < Q) Q = X.value;
        }
        return Q;
      }
    };
    f1.create = (Q) => {
      return new f1({ checks: [], typeName: A.ZodBigInt, coerce: Q?.coerce ?? false, ...m(Q) });
    };
    o6 = class extends p {
      _parse(Q) {
        if (this._def.coerce) Q.data = Boolean(Q.data);
        if (this._getType(Q) !== I.boolean) {
          let Y = this._getOrReturnCtx(Q);
          return b(Y, { code: M.invalid_type, expected: I.boolean, received: Y.parsedType }), x;
        }
        return P0(Q.data);
      }
    };
    o6.create = (Q) => {
      return new o6({ typeName: A.ZodBoolean, coerce: Q?.coerce || false, ...m(Q) });
    };
    V6 = class _V6 extends p {
      _parse(Q) {
        if (this._def.coerce) Q.data = new Date(Q.data);
        if (this._getType(Q) !== I.date) {
          let J = this._getOrReturnCtx(Q);
          return b(J, { code: M.invalid_type, expected: I.date, received: J.parsedType }), x;
        }
        if (Number.isNaN(Q.data.getTime())) {
          let J = this._getOrReturnCtx(Q);
          return b(J, { code: M.invalid_date }), x;
        }
        let Y = new A0(), $ = void 0;
        for (let J of this._def.checks) if (J.kind === "min") {
          if (Q.data.getTime() < J.value) $ = this._getOrReturnCtx(Q, $), b($, { code: M.too_small, message: J.message, inclusive: true, exact: false, minimum: J.value, type: "date" }), Y.dirty();
        } else if (J.kind === "max") {
          if (Q.data.getTime() > J.value) $ = this._getOrReturnCtx(Q, $), b($, { code: M.too_big, message: J.message, inclusive: true, exact: false, maximum: J.value, type: "date" }), Y.dirty();
        } else d.assertNever(J);
        return { status: Y.value, value: new Date(Q.data.getTime()) };
      }
      _addCheck(Q) {
        return new _V6({ ...this._def, checks: [...this._def.checks, Q] });
      }
      min(Q, X) {
        return this._addCheck({ kind: "min", value: Q.getTime(), message: S.toString(X) });
      }
      max(Q, X) {
        return this._addCheck({ kind: "max", value: Q.getTime(), message: S.toString(X) });
      }
      get minDate() {
        let Q = null;
        for (let X of this._def.checks) if (X.kind === "min") {
          if (Q === null || X.value > Q) Q = X.value;
        }
        return Q != null ? new Date(Q) : null;
      }
      get maxDate() {
        let Q = null;
        for (let X of this._def.checks) if (X.kind === "max") {
          if (Q === null || X.value < Q) Q = X.value;
        }
        return Q != null ? new Date(Q) : null;
      }
    };
    V6.create = (Q) => {
      return new V6({ checks: [], coerce: Q?.coerce || false, typeName: A.ZodDate, ...m(Q) });
    };
    h9 = class extends p {
      _parse(Q) {
        if (this._getType(Q) !== I.symbol) {
          let Y = this._getOrReturnCtx(Q);
          return b(Y, { code: M.invalid_type, expected: I.symbol, received: Y.parsedType }), x;
        }
        return P0(Q.data);
      }
    };
    h9.create = (Q) => {
      return new h9({ typeName: A.ZodSymbol, ...m(Q) });
    };
    r6 = class extends p {
      _parse(Q) {
        if (this._getType(Q) !== I.undefined) {
          let Y = this._getOrReturnCtx(Q);
          return b(Y, { code: M.invalid_type, expected: I.undefined, received: Y.parsedType }), x;
        }
        return P0(Q.data);
      }
    };
    r6.create = (Q) => {
      return new r6({ typeName: A.ZodUndefined, ...m(Q) });
    };
    t6 = class extends p {
      _parse(Q) {
        if (this._getType(Q) !== I.null) {
          let Y = this._getOrReturnCtx(Q);
          return b(Y, { code: M.invalid_type, expected: I.null, received: Y.parsedType }), x;
        }
        return P0(Q.data);
      }
    };
    t6.create = (Q) => {
      return new t6({ typeName: A.ZodNull, ...m(Q) });
    };
    q6 = class extends p {
      constructor() {
        super(...arguments);
        this._any = true;
      }
      _parse(Q) {
        return P0(Q.data);
      }
    };
    q6.create = (Q) => {
      return new q6({ typeName: A.ZodAny, ...m(Q) });
    };
    g1 = class extends p {
      constructor() {
        super(...arguments);
        this._unknown = true;
      }
      _parse(Q) {
        return P0(Q.data);
      }
    };
    g1.create = (Q) => {
      return new g1({ typeName: A.ZodUnknown, ...m(Q) });
    };
    q1 = class extends p {
      _parse(Q) {
        let X = this._getOrReturnCtx(Q);
        return b(X, { code: M.invalid_type, expected: I.never, received: X.parsedType }), x;
      }
    };
    q1.create = (Q) => {
      return new q1({ typeName: A.ZodNever, ...m(Q) });
    };
    f9 = class extends p {
      _parse(Q) {
        if (this._getType(Q) !== I.undefined) {
          let Y = this._getOrReturnCtx(Q);
          return b(Y, { code: M.invalid_type, expected: I.void, received: Y.parsedType }), x;
        }
        return P0(Q.data);
      }
    };
    f9.create = (Q) => {
      return new f9({ typeName: A.ZodVoid, ...m(Q) });
    };
    e0 = class _e0 extends p {
      _parse(Q) {
        let { ctx: X, status: Y } = this._processInputParams(Q), $ = this._def;
        if (X.parsedType !== I.array) return b(X, { code: M.invalid_type, expected: I.array, received: X.parsedType }), x;
        if ($.exactLength !== null) {
          let W = X.data.length > $.exactLength.value, G = X.data.length < $.exactLength.value;
          if (W || G) b(X, { code: W ? M.too_big : M.too_small, minimum: G ? $.exactLength.value : void 0, maximum: W ? $.exactLength.value : void 0, type: "array", inclusive: true, exact: true, message: $.exactLength.message }), Y.dirty();
        }
        if ($.minLength !== null) {
          if (X.data.length < $.minLength.value) b(X, { code: M.too_small, minimum: $.minLength.value, type: "array", inclusive: true, exact: false, message: $.minLength.message }), Y.dirty();
        }
        if ($.maxLength !== null) {
          if (X.data.length > $.maxLength.value) b(X, { code: M.too_big, maximum: $.maxLength.value, type: "array", inclusive: true, exact: false, message: $.maxLength.message }), Y.dirty();
        }
        if (X.common.async) return Promise.all([...X.data].map((W, G) => {
          return $.type._parseAsync(new Q1(X, W, X.path, G));
        })).then((W) => {
          return A0.mergeArray(Y, W);
        });
        let J = [...X.data].map((W, G) => {
          return $.type._parseSync(new Q1(X, W, X.path, G));
        });
        return A0.mergeArray(Y, J);
      }
      get element() {
        return this._def.type;
      }
      min(Q, X) {
        return new _e0({ ...this._def, minLength: { value: Q, message: S.toString(X) } });
      }
      max(Q, X) {
        return new _e0({ ...this._def, maxLength: { value: Q, message: S.toString(X) } });
      }
      length(Q, X) {
        return new _e0({ ...this._def, exactLength: { value: Q, message: S.toString(X) } });
      }
      nonempty(Q) {
        return this.min(1, Q);
      }
    };
    e0.create = (Q, X) => {
      return new e0({ type: Q, minLength: null, maxLength: null, exactLength: null, typeName: A.ZodArray, ...m(X) });
    };
    U0 = class _U0 extends p {
      constructor() {
        super(...arguments);
        this._cached = null, this.nonstrict = this.passthrough, this.augment = this.extend;
      }
      _getCached() {
        if (this._cached !== null) return this._cached;
        let Q = this._def.shape(), X = d.objectKeys(Q);
        return this._cached = { shape: Q, keys: X }, this._cached;
      }
      _parse(Q) {
        if (this._getType(Q) !== I.object) {
          let B = this._getOrReturnCtx(Q);
          return b(B, { code: M.invalid_type, expected: I.object, received: B.parsedType }), x;
        }
        let { status: Y, ctx: $ } = this._processInputParams(Q), { shape: J, keys: W } = this._getCached(), G = [];
        if (!(this._def.catchall instanceof q1 && this._def.unknownKeys === "strip")) {
          for (let B in $.data) if (!W.includes(B)) G.push(B);
        }
        let H = [];
        for (let B of W) {
          let z = J[B], K = $.data[B];
          H.push({ key: { status: "valid", value: B }, value: z._parse(new Q1($, K, $.path, B)), alwaysSet: B in $.data });
        }
        if (this._def.catchall instanceof q1) {
          let B = this._def.unknownKeys;
          if (B === "passthrough") for (let z of G) H.push({ key: { status: "valid", value: z }, value: { status: "valid", value: $.data[z] } });
          else if (B === "strict") {
            if (G.length > 0) b($, { code: M.unrecognized_keys, keys: G }), Y.dirty();
          } else if (B === "strip") ;
          else throw Error("Internal ZodObject error: invalid unknownKeys value.");
        } else {
          let B = this._def.catchall;
          for (let z of G) {
            let K = $.data[z];
            H.push({ key: { status: "valid", value: z }, value: B._parse(new Q1($, K, $.path, z)), alwaysSet: z in $.data });
          }
        }
        if ($.common.async) return Promise.resolve().then(async () => {
          let B = [];
          for (let z of H) {
            let K = await z.key, q = await z.value;
            B.push({ key: K, value: q, alwaysSet: z.alwaysSet });
          }
          return B;
        }).then((B) => {
          return A0.mergeObjectSync(Y, B);
        });
        else return A0.mergeObjectSync(Y, H);
      }
      get shape() {
        return this._def.shape();
      }
      strict(Q) {
        return S.errToObj, new _U0({ ...this._def, unknownKeys: "strict", ...Q !== void 0 ? { errorMap: (X, Y) => {
          let $ = this._def.errorMap?.(X, Y).message ?? Y.defaultError;
          if (X.code === "unrecognized_keys") return { message: S.errToObj(Q).message ?? $ };
          return { message: $ };
        } } : {} });
      }
      strip() {
        return new _U0({ ...this._def, unknownKeys: "strip" });
      }
      passthrough() {
        return new _U0({ ...this._def, unknownKeys: "passthrough" });
      }
      extend(Q) {
        return new _U0({ ...this._def, shape: () => ({ ...this._def.shape(), ...Q }) });
      }
      merge(Q) {
        return new _U0({ unknownKeys: Q._def.unknownKeys, catchall: Q._def.catchall, shape: () => ({ ...this._def.shape(), ...Q._def.shape() }), typeName: A.ZodObject });
      }
      setKey(Q, X) {
        return this.augment({ [Q]: X });
      }
      catchall(Q) {
        return new _U0({ ...this._def, catchall: Q });
      }
      pick(Q) {
        let X = {};
        for (let Y of d.objectKeys(Q)) if (Q[Y] && this.shape[Y]) X[Y] = this.shape[Y];
        return new _U0({ ...this._def, shape: () => X });
      }
      omit(Q) {
        let X = {};
        for (let Y of d.objectKeys(this.shape)) if (!Q[Y]) X[Y] = this.shape[Y];
        return new _U0({ ...this._def, shape: () => X });
      }
      deepPartial() {
        return i6(this);
      }
      partial(Q) {
        let X = {};
        for (let Y of d.objectKeys(this.shape)) {
          let $ = this.shape[Y];
          if (Q && !Q[Y]) X[Y] = $;
          else X[Y] = $.optional();
        }
        return new _U0({ ...this._def, shape: () => X });
      }
      required(Q) {
        let X = {};
        for (let Y of d.objectKeys(this.shape)) if (Q && !Q[Y]) X[Y] = this.shape[Y];
        else {
          let J = this.shape[Y];
          while (J instanceof l0) J = J._def.innerType;
          X[Y] = J;
        }
        return new _U0({ ...this._def, shape: () => X });
      }
      keyof() {
        return XJ(d.objectKeys(this.shape));
      }
    };
    U0.create = (Q, X) => {
      return new U0({ shape: () => Q, unknownKeys: "strip", catchall: q1.create(), typeName: A.ZodObject, ...m(X) });
    };
    U0.strictCreate = (Q, X) => {
      return new U0({ shape: () => Q, unknownKeys: "strict", catchall: q1.create(), typeName: A.ZodObject, ...m(X) });
    };
    U0.lazycreate = (Q, X) => {
      return new U0({ shape: Q, unknownKeys: "strip", catchall: q1.create(), typeName: A.ZodObject, ...m(X) });
    };
    a6 = class extends p {
      _parse(Q) {
        let { ctx: X } = this._processInputParams(Q), Y = this._def.options;
        function $(J) {
          for (let G of J) if (G.result.status === "valid") return G.result;
          for (let G of J) if (G.result.status === "dirty") return X.common.issues.push(...G.ctx.common.issues), G.result;
          let W = J.map((G) => new x0(G.ctx.common.issues));
          return b(X, { code: M.invalid_union, unionErrors: W }), x;
        }
        if (X.common.async) return Promise.all(Y.map(async (J) => {
          let W = { ...X, common: { ...X.common, issues: [] }, parent: null };
          return { result: await J._parseAsync({ data: X.data, path: X.path, parent: W }), ctx: W };
        })).then($);
        else {
          let J = void 0, W = [];
          for (let H of Y) {
            let B = { ...X, common: { ...X.common, issues: [] }, parent: null }, z = H._parseSync({ data: X.data, path: X.path, parent: B });
            if (z.status === "valid") return z;
            else if (z.status === "dirty" && !J) J = { result: z, ctx: B };
            if (B.common.issues.length) W.push(B.common.issues);
          }
          if (J) return X.common.issues.push(...J.ctx.common.issues), J.result;
          let G = W.map((H) => new x0(H));
          return b(X, { code: M.invalid_union, unionErrors: G }), x;
        }
      }
      get options() {
        return this._def.options;
      }
    };
    a6.create = (Q, X) => {
      return new a6({ options: Q, typeName: A.ZodUnion, ...m(X) });
    };
    R1 = (Q) => {
      if (Q instanceof e6) return R1(Q.schema);
      else if (Q instanceof X1) return R1(Q.innerType());
      else if (Q instanceof Q9) return [Q.value];
      else if (Q instanceof u1) return Q.options;
      else if (Q instanceof X9) return d.objectValues(Q.enum);
      else if (Q instanceof Y9) return R1(Q._def.innerType);
      else if (Q instanceof r6) return [void 0];
      else if (Q instanceof t6) return [null];
      else if (Q instanceof l0) return [void 0, ...R1(Q.unwrap())];
      else if (Q instanceof I1) return [null, ...R1(Q.unwrap())];
      else if (Q instanceof a4) return R1(Q.unwrap());
      else if (Q instanceof J9) return R1(Q.unwrap());
      else if (Q instanceof $9) return R1(Q._def.innerType);
      else return [];
    };
    t4 = class _t4 extends p {
      _parse(Q) {
        let { ctx: X } = this._processInputParams(Q);
        if (X.parsedType !== I.object) return b(X, { code: M.invalid_type, expected: I.object, received: X.parsedType }), x;
        let Y = this.discriminator, $ = X.data[Y], J = this.optionsMap.get($);
        if (!J) return b(X, { code: M.invalid_union_discriminator, options: Array.from(this.optionsMap.keys()), path: [Y] }), x;
        if (X.common.async) return J._parseAsync({ data: X.data, path: X.path, parent: X });
        else return J._parseSync({ data: X.data, path: X.path, parent: X });
      }
      get discriminator() {
        return this._def.discriminator;
      }
      get options() {
        return this._def.options;
      }
      get optionsMap() {
        return this._def.optionsMap;
      }
      static create(Q, X, Y) {
        let $ = /* @__PURE__ */ new Map();
        for (let J of X) {
          let W = R1(J.shape[Q]);
          if (!W.length) throw Error(`A discriminator value for key \`${Q}\` could not be extracted from all schema options`);
          for (let G of W) {
            if ($.has(G)) throw Error(`Discriminator property ${String(Q)} has duplicate value ${String(G)}`);
            $.set(G, J);
          }
        }
        return new _t4({ typeName: A.ZodDiscriminatedUnion, discriminator: Q, options: X, optionsMap: $, ...m(Y) });
      }
    };
    s6 = class extends p {
      _parse(Q) {
        let { status: X, ctx: Y } = this._processInputParams(Q), $ = (J, W) => {
          if (o4(J) || o4(W)) return x;
          let G = dQ(J.value, W.value);
          if (!G.valid) return b(Y, { code: M.invalid_intersection_types }), x;
          if (r4(J) || r4(W)) X.dirty();
          return { status: X.value, value: G.data };
        };
        if (Y.common.async) return Promise.all([this._def.left._parseAsync({ data: Y.data, path: Y.path, parent: Y }), this._def.right._parseAsync({ data: Y.data, path: Y.path, parent: Y })]).then(([J, W]) => $(J, W));
        else return $(this._def.left._parseSync({ data: Y.data, path: Y.path, parent: Y }), this._def.right._parseSync({ data: Y.data, path: Y.path, parent: Y }));
      }
    };
    s6.create = (Q, X, Y) => {
      return new s6({ left: Q, right: X, typeName: A.ZodIntersection, ...m(Y) });
    };
    U1 = class _U1 extends p {
      _parse(Q) {
        let { status: X, ctx: Y } = this._processInputParams(Q);
        if (Y.parsedType !== I.array) return b(Y, { code: M.invalid_type, expected: I.array, received: Y.parsedType }), x;
        if (Y.data.length < this._def.items.length) return b(Y, { code: M.too_small, minimum: this._def.items.length, inclusive: true, exact: false, type: "array" }), x;
        if (!this._def.rest && Y.data.length > this._def.items.length) b(Y, { code: M.too_big, maximum: this._def.items.length, inclusive: true, exact: false, type: "array" }), X.dirty();
        let J = [...Y.data].map((W, G) => {
          let H = this._def.items[G] || this._def.rest;
          if (!H) return null;
          return H._parse(new Q1(Y, W, Y.path, G));
        }).filter((W) => !!W);
        if (Y.common.async) return Promise.all(J).then((W) => {
          return A0.mergeArray(X, W);
        });
        else return A0.mergeArray(X, J);
      }
      get items() {
        return this._def.items;
      }
      rest(Q) {
        return new _U1({ ...this._def, rest: Q });
      }
    };
    U1.create = (Q, X) => {
      if (!Array.isArray(Q)) throw Error("You must pass an array of schemas to z.tuple([ ... ])");
      return new U1({ items: Q, typeName: A.ZodTuple, rest: null, ...m(X) });
    };
    u9 = class _u9 extends p {
      get keySchema() {
        return this._def.keyType;
      }
      get valueSchema() {
        return this._def.valueType;
      }
      _parse(Q) {
        let { status: X, ctx: Y } = this._processInputParams(Q);
        if (Y.parsedType !== I.object) return b(Y, { code: M.invalid_type, expected: I.object, received: Y.parsedType }), x;
        let $ = [], J = this._def.keyType, W = this._def.valueType;
        for (let G in Y.data) $.push({ key: J._parse(new Q1(Y, G, Y.path, G)), value: W._parse(new Q1(Y, Y.data[G], Y.path, G)), alwaysSet: G in Y.data });
        if (Y.common.async) return A0.mergeObjectAsync(X, $);
        else return A0.mergeObjectSync(X, $);
      }
      get element() {
        return this._def.valueType;
      }
      static create(Q, X, Y) {
        if (X instanceof p) return new _u9({ keyType: Q, valueType: X, typeName: A.ZodRecord, ...m(Y) });
        return new _u9({ keyType: s0.create(), valueType: Q, typeName: A.ZodRecord, ...m(X) });
      }
    };
    m9 = class extends p {
      get keySchema() {
        return this._def.keyType;
      }
      get valueSchema() {
        return this._def.valueType;
      }
      _parse(Q) {
        let { status: X, ctx: Y } = this._processInputParams(Q);
        if (Y.parsedType !== I.map) return b(Y, { code: M.invalid_type, expected: I.map, received: Y.parsedType }), x;
        let $ = this._def.keyType, J = this._def.valueType, W = [...Y.data.entries()].map(([G, H], B) => {
          return { key: $._parse(new Q1(Y, G, Y.path, [B, "key"])), value: J._parse(new Q1(Y, H, Y.path, [B, "value"])) };
        });
        if (Y.common.async) {
          let G = /* @__PURE__ */ new Map();
          return Promise.resolve().then(async () => {
            for (let H of W) {
              let B = await H.key, z = await H.value;
              if (B.status === "aborted" || z.status === "aborted") return x;
              if (B.status === "dirty" || z.status === "dirty") X.dirty();
              G.set(B.value, z.value);
            }
            return { status: X.value, value: G };
          });
        } else {
          let G = /* @__PURE__ */ new Map();
          for (let H of W) {
            let { key: B, value: z } = H;
            if (B.status === "aborted" || z.status === "aborted") return x;
            if (B.status === "dirty" || z.status === "dirty") X.dirty();
            G.set(B.value, z.value);
          }
          return { status: X.value, value: G };
        }
      }
    };
    m9.create = (Q, X, Y) => {
      return new m9({ valueType: X, keyType: Q, typeName: A.ZodMap, ...m(Y) });
    };
    U6 = class _U6 extends p {
      _parse(Q) {
        let { status: X, ctx: Y } = this._processInputParams(Q);
        if (Y.parsedType !== I.set) return b(Y, { code: M.invalid_type, expected: I.set, received: Y.parsedType }), x;
        let $ = this._def;
        if ($.minSize !== null) {
          if (Y.data.size < $.minSize.value) b(Y, { code: M.too_small, minimum: $.minSize.value, type: "set", inclusive: true, exact: false, message: $.minSize.message }), X.dirty();
        }
        if ($.maxSize !== null) {
          if (Y.data.size > $.maxSize.value) b(Y, { code: M.too_big, maximum: $.maxSize.value, type: "set", inclusive: true, exact: false, message: $.maxSize.message }), X.dirty();
        }
        let J = this._def.valueType;
        function W(H) {
          let B = /* @__PURE__ */ new Set();
          for (let z of H) {
            if (z.status === "aborted") return x;
            if (z.status === "dirty") X.dirty();
            B.add(z.value);
          }
          return { status: X.value, value: B };
        }
        let G = [...Y.data.values()].map((H, B) => J._parse(new Q1(Y, H, Y.path, B)));
        if (Y.common.async) return Promise.all(G).then((H) => W(H));
        else return W(G);
      }
      min(Q, X) {
        return new _U6({ ...this._def, minSize: { value: Q, message: S.toString(X) } });
      }
      max(Q, X) {
        return new _U6({ ...this._def, maxSize: { value: Q, message: S.toString(X) } });
      }
      size(Q, X) {
        return this.min(Q, X).max(Q, X);
      }
      nonempty(Q) {
        return this.min(1, Q);
      }
    };
    U6.create = (Q, X) => {
      return new U6({ valueType: Q, minSize: null, maxSize: null, typeName: A.ZodSet, ...m(X) });
    };
    n6 = class _n6 extends p {
      constructor() {
        super(...arguments);
        this.validate = this.implement;
      }
      _parse(Q) {
        let { ctx: X } = this._processInputParams(Q);
        if (X.parsedType !== I.function) return b(X, { code: M.invalid_type, expected: I.function, received: X.parsedType }), x;
        function Y(G, H) {
          return g9({ data: G, path: X.path, errorMaps: [X.common.contextualErrorMap, X.schemaErrorMap, p6(), j1].filter((B) => !!B), issueData: { code: M.invalid_arguments, argumentsError: H } });
        }
        function $(G, H) {
          return g9({ data: G, path: X.path, errorMaps: [X.common.contextualErrorMap, X.schemaErrorMap, p6(), j1].filter((B) => !!B), issueData: { code: M.invalid_return_type, returnTypeError: H } });
        }
        let J = { errorMap: X.common.contextualErrorMap }, W = X.data;
        if (this._def.returns instanceof L6) {
          let G = this;
          return P0(async function(...H) {
            let B = new x0([]), z = await G._def.args.parseAsync(H, J).catch((U) => {
              throw B.addIssue(Y(H, U)), B;
            }), K = await Reflect.apply(W, this, z);
            return await G._def.returns._def.type.parseAsync(K, J).catch((U) => {
              throw B.addIssue($(K, U)), B;
            });
          });
        } else {
          let G = this;
          return P0(function(...H) {
            let B = G._def.args.safeParse(H, J);
            if (!B.success) throw new x0([Y(H, B.error)]);
            let z = Reflect.apply(W, this, B.data), K = G._def.returns.safeParse(z, J);
            if (!K.success) throw new x0([$(z, K.error)]);
            return K.data;
          });
        }
      }
      parameters() {
        return this._def.args;
      }
      returnType() {
        return this._def.returns;
      }
      args(...Q) {
        return new _n6({ ...this._def, args: U1.create(Q).rest(g1.create()) });
      }
      returns(Q) {
        return new _n6({ ...this._def, returns: Q });
      }
      implement(Q) {
        return this.parse(Q);
      }
      strictImplement(Q) {
        return this.parse(Q);
      }
      static create(Q, X, Y) {
        return new _n6({ args: Q ? Q : U1.create([]).rest(g1.create()), returns: X || g1.create(), typeName: A.ZodFunction, ...m(Y) });
      }
    };
    e6 = class extends p {
      get schema() {
        return this._def.getter();
      }
      _parse(Q) {
        let { ctx: X } = this._processInputParams(Q);
        return this._def.getter()._parse({ data: X.data, path: X.path, parent: X });
      }
    };
    e6.create = (Q, X) => {
      return new e6({ getter: Q, typeName: A.ZodLazy, ...m(X) });
    };
    Q9 = class extends p {
      _parse(Q) {
        if (Q.data !== this._def.value) {
          let X = this._getOrReturnCtx(Q);
          return b(X, { received: X.data, code: M.invalid_literal, expected: this._def.value }), x;
        }
        return { status: "valid", value: Q.data };
      }
      get value() {
        return this._def.value;
      }
    };
    Q9.create = (Q, X) => {
      return new Q9({ value: Q, typeName: A.ZodLiteral, ...m(X) });
    };
    u1 = class _u1 extends p {
      _parse(Q) {
        if (typeof Q.data !== "string") {
          let X = this._getOrReturnCtx(Q), Y = this._def.values;
          return b(X, { expected: d.joinValues(Y), received: X.parsedType, code: M.invalid_type }), x;
        }
        if (!this._cache) this._cache = new Set(this._def.values);
        if (!this._cache.has(Q.data)) {
          let X = this._getOrReturnCtx(Q), Y = this._def.values;
          return b(X, { received: X.data, code: M.invalid_enum_value, options: Y }), x;
        }
        return P0(Q.data);
      }
      get options() {
        return this._def.values;
      }
      get enum() {
        let Q = {};
        for (let X of this._def.values) Q[X] = X;
        return Q;
      }
      get Values() {
        let Q = {};
        for (let X of this._def.values) Q[X] = X;
        return Q;
      }
      get Enum() {
        let Q = {};
        for (let X of this._def.values) Q[X] = X;
        return Q;
      }
      extract(Q, X = this._def) {
        return _u1.create(Q, { ...this._def, ...X });
      }
      exclude(Q, X = this._def) {
        return _u1.create(this.options.filter((Y) => !Q.includes(Y)), { ...this._def, ...X });
      }
    };
    u1.create = XJ;
    X9 = class extends p {
      _parse(Q) {
        let X = d.getValidEnumValues(this._def.values), Y = this._getOrReturnCtx(Q);
        if (Y.parsedType !== I.string && Y.parsedType !== I.number) {
          let $ = d.objectValues(X);
          return b(Y, { expected: d.joinValues($), received: Y.parsedType, code: M.invalid_type }), x;
        }
        if (!this._cache) this._cache = new Set(d.getValidEnumValues(this._def.values));
        if (!this._cache.has(Q.data)) {
          let $ = d.objectValues(X);
          return b(Y, { received: Y.data, code: M.invalid_enum_value, options: $ }), x;
        }
        return P0(Q.data);
      }
      get enum() {
        return this._def.values;
      }
    };
    X9.create = (Q, X) => {
      return new X9({ values: Q, typeName: A.ZodNativeEnum, ...m(X) });
    };
    L6 = class extends p {
      unwrap() {
        return this._def.type;
      }
      _parse(Q) {
        let { ctx: X } = this._processInputParams(Q);
        if (X.parsedType !== I.promise && X.common.async === false) return b(X, { code: M.invalid_type, expected: I.promise, received: X.parsedType }), x;
        let Y = X.parsedType === I.promise ? X.data : Promise.resolve(X.data);
        return P0(Y.then(($) => {
          return this._def.type.parseAsync($, { path: X.path, errorMap: X.common.contextualErrorMap });
        }));
      }
    };
    L6.create = (Q, X) => {
      return new L6({ type: Q, typeName: A.ZodPromise, ...m(X) });
    };
    X1 = class extends p {
      innerType() {
        return this._def.schema;
      }
      sourceType() {
        return this._def.schema._def.typeName === A.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
      }
      _parse(Q) {
        let { status: X, ctx: Y } = this._processInputParams(Q), $ = this._def.effect || null, J = { addIssue: (W) => {
          if (b(Y, W), W.fatal) X.abort();
          else X.dirty();
        }, get path() {
          return Y.path;
        } };
        if (J.addIssue = J.addIssue.bind(J), $.type === "preprocess") {
          let W = $.transform(Y.data, J);
          if (Y.common.async) return Promise.resolve(W).then(async (G) => {
            if (X.value === "aborted") return x;
            let H = await this._def.schema._parseAsync({ data: G, path: Y.path, parent: Y });
            if (H.status === "aborted") return x;
            if (H.status === "dirty") return K6(H.value);
            if (X.value === "dirty") return K6(H.value);
            return H;
          });
          else {
            if (X.value === "aborted") return x;
            let G = this._def.schema._parseSync({ data: W, path: Y.path, parent: Y });
            if (G.status === "aborted") return x;
            if (G.status === "dirty") return K6(G.value);
            if (X.value === "dirty") return K6(G.value);
            return G;
          }
        }
        if ($.type === "refinement") {
          let W = (G) => {
            let H = $.refinement(G, J);
            if (Y.common.async) return Promise.resolve(H);
            if (H instanceof Promise) throw Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
            return G;
          };
          if (Y.common.async === false) {
            let G = this._def.schema._parseSync({ data: Y.data, path: Y.path, parent: Y });
            if (G.status === "aborted") return x;
            if (G.status === "dirty") X.dirty();
            return W(G.value), { status: X.value, value: G.value };
          } else return this._def.schema._parseAsync({ data: Y.data, path: Y.path, parent: Y }).then((G) => {
            if (G.status === "aborted") return x;
            if (G.status === "dirty") X.dirty();
            return W(G.value).then(() => {
              return { status: X.value, value: G.value };
            });
          });
        }
        if ($.type === "transform") if (Y.common.async === false) {
          let W = this._def.schema._parseSync({ data: Y.data, path: Y.path, parent: Y });
          if (!y1(W)) return x;
          let G = $.transform(W.value, J);
          if (G instanceof Promise) throw Error("Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.");
          return { status: X.value, value: G };
        } else return this._def.schema._parseAsync({ data: Y.data, path: Y.path, parent: Y }).then((W) => {
          if (!y1(W)) return x;
          return Promise.resolve($.transform(W.value, J)).then((G) => ({ status: X.value, value: G }));
        });
        d.assertNever($);
      }
    };
    X1.create = (Q, X, Y) => {
      return new X1({ schema: Q, typeName: A.ZodEffects, effect: X, ...m(Y) });
    };
    X1.createWithPreprocess = (Q, X, Y) => {
      return new X1({ schema: X, effect: { type: "preprocess", transform: Q }, typeName: A.ZodEffects, ...m(Y) });
    };
    l0 = class extends p {
      _parse(Q) {
        if (this._getType(Q) === I.undefined) return P0(void 0);
        return this._def.innerType._parse(Q);
      }
      unwrap() {
        return this._def.innerType;
      }
    };
    l0.create = (Q, X) => {
      return new l0({ innerType: Q, typeName: A.ZodOptional, ...m(X) });
    };
    I1 = class extends p {
      _parse(Q) {
        if (this._getType(Q) === I.null) return P0(null);
        return this._def.innerType._parse(Q);
      }
      unwrap() {
        return this._def.innerType;
      }
    };
    I1.create = (Q, X) => {
      return new I1({ innerType: Q, typeName: A.ZodNullable, ...m(X) });
    };
    Y9 = class extends p {
      _parse(Q) {
        let { ctx: X } = this._processInputParams(Q), Y = X.data;
        if (X.parsedType === I.undefined) Y = this._def.defaultValue();
        return this._def.innerType._parse({ data: Y, path: X.path, parent: X });
      }
      removeDefault() {
        return this._def.innerType;
      }
    };
    Y9.create = (Q, X) => {
      return new Y9({ innerType: Q, typeName: A.ZodDefault, defaultValue: typeof X.default === "function" ? X.default : () => X.default, ...m(X) });
    };
    $9 = class extends p {
      _parse(Q) {
        let { ctx: X } = this._processInputParams(Q), Y = { ...X, common: { ...X.common, issues: [] } }, $ = this._def.innerType._parse({ data: Y.data, path: Y.path, parent: { ...Y } });
        if (d6($)) return $.then((J) => {
          return { status: "valid", value: J.status === "valid" ? J.value : this._def.catchValue({ get error() {
            return new x0(Y.common.issues);
          }, input: Y.data }) };
        });
        else return { status: "valid", value: $.status === "valid" ? $.value : this._def.catchValue({ get error() {
          return new x0(Y.common.issues);
        }, input: Y.data }) };
      }
      removeCatch() {
        return this._def.innerType;
      }
    };
    $9.create = (Q, X) => {
      return new $9({ innerType: Q, typeName: A.ZodCatch, catchValue: typeof X.catch === "function" ? X.catch : () => X.catch, ...m(X) });
    };
    l9 = class extends p {
      _parse(Q) {
        if (this._getType(Q) !== I.nan) {
          let Y = this._getOrReturnCtx(Q);
          return b(Y, { code: M.invalid_type, expected: I.nan, received: Y.parsedType }), x;
        }
        return { status: "valid", value: Q.data };
      }
    };
    l9.create = (Q) => {
      return new l9({ typeName: A.ZodNaN, ...m(Q) });
    };
    XL = Symbol("zod_brand");
    a4 = class extends p {
      _parse(Q) {
        let { ctx: X } = this._processInputParams(Q), Y = X.data;
        return this._def.type._parse({ data: Y, path: X.path, parent: X });
      }
      unwrap() {
        return this._def.type;
      }
    };
    c9 = class _c9 extends p {
      _parse(Q) {
        let { status: X, ctx: Y } = this._processInputParams(Q);
        if (Y.common.async) return (async () => {
          let J = await this._def.in._parseAsync({ data: Y.data, path: Y.path, parent: Y });
          if (J.status === "aborted") return x;
          if (J.status === "dirty") return X.dirty(), K6(J.value);
          else return this._def.out._parseAsync({ data: J.value, path: Y.path, parent: Y });
        })();
        else {
          let $ = this._def.in._parseSync({ data: Y.data, path: Y.path, parent: Y });
          if ($.status === "aborted") return x;
          if ($.status === "dirty") return X.dirty(), { status: "dirty", value: $.value };
          else return this._def.out._parseSync({ data: $.value, path: Y.path, parent: Y });
        }
      }
      static create(Q, X) {
        return new _c9({ in: Q, out: X, typeName: A.ZodPipeline });
      }
    };
    J9 = class extends p {
      _parse(Q) {
        let X = this._def.innerType._parse(Q), Y = ($) => {
          if (y1($)) $.value = Object.freeze($.value);
          return $;
        };
        return d6(X) ? X.then(($) => Y($)) : Y(X);
      }
      unwrap() {
        return this._def.innerType;
      }
    };
    J9.create = (Q, X) => {
      return new J9({ innerType: Q, typeName: A.ZodReadonly, ...m(X) });
    };
    YL = { object: U0.lazycreate };
    (function(Q) {
      Q.ZodString = "ZodString", Q.ZodNumber = "ZodNumber", Q.ZodNaN = "ZodNaN", Q.ZodBigInt = "ZodBigInt", Q.ZodBoolean = "ZodBoolean", Q.ZodDate = "ZodDate", Q.ZodSymbol = "ZodSymbol", Q.ZodUndefined = "ZodUndefined", Q.ZodNull = "ZodNull", Q.ZodAny = "ZodAny", Q.ZodUnknown = "ZodUnknown", Q.ZodNever = "ZodNever", Q.ZodVoid = "ZodVoid", Q.ZodArray = "ZodArray", Q.ZodObject = "ZodObject", Q.ZodUnion = "ZodUnion", Q.ZodDiscriminatedUnion = "ZodDiscriminatedUnion", Q.ZodIntersection = "ZodIntersection", Q.ZodTuple = "ZodTuple", Q.ZodRecord = "ZodRecord", Q.ZodMap = "ZodMap", Q.ZodSet = "ZodSet", Q.ZodFunction = "ZodFunction", Q.ZodLazy = "ZodLazy", Q.ZodLiteral = "ZodLiteral", Q.ZodEnum = "ZodEnum", Q.ZodEffects = "ZodEffects", Q.ZodNativeEnum = "ZodNativeEnum", Q.ZodOptional = "ZodOptional", Q.ZodNullable = "ZodNullable", Q.ZodDefault = "ZodDefault", Q.ZodCatch = "ZodCatch", Q.ZodPromise = "ZodPromise", Q.ZodBranded = "ZodBranded", Q.ZodPipeline = "ZodPipeline", Q.ZodReadonly = "ZodReadonly";
    })(A || (A = {}));
    $L = (Q, X = { message: `Input not instance of ${Q.name}` }) => YJ((Y) => Y instanceof Q, X);
    $J = s0.create;
    JJ = h1.create;
    JL = l9.create;
    WL = f1.create;
    WJ = o6.create;
    GL = V6.create;
    HL = h9.create;
    BL = r6.create;
    zL = t6.create;
    KL = q6.create;
    VL = g1.create;
    qL = q1.create;
    UL = f9.create;
    LL = e0.create;
    iQ = U0.create;
    FL = U0.strictCreate;
    OL = a6.create;
    NL = t4.create;
    DL = s6.create;
    wL = U1.create;
    ML = u9.create;
    AL = m9.create;
    jL = U6.create;
    RL = n6.create;
    IL = e6.create;
    bL = Q9.create;
    EL = u1.create;
    PL = X9.create;
    ZL = L6.create;
    SL = X1.create;
    CL = l0.create;
    _L = I1.create;
    kL = X1.createWithPreprocess;
    vL = c9.create;
    TL = () => $J().optional();
    xL = () => JJ().optional();
    yL = () => WJ().optional();
    gL = { string: (Q) => s0.create({ ...Q, coerce: true }), number: (Q) => h1.create({ ...Q, coerce: true }), boolean: (Q) => o6.create({ ...Q, coerce: true }), bigint: (Q) => f1.create({ ...Q, coerce: true }), date: (Q) => V6.create({ ...Q, coerce: true }) };
    hL = x;
    fL = Object.freeze({ status: "aborted" });
    uL = Symbol("zod_brand");
    l1 = class extends Error {
      constructor() {
        super("Encountered Promise during synchronous parse. Use .parseAsync() instead.");
      }
    };
    s4 = {};
    i = {};
    _Q(i, { unwrapMessage: () => p9, stringifyPrimitive: () => X8, required: () => $F, randomString: () => oL, propertyKeyTypes: () => sQ, promiseAllObject: () => nL, primitiveTypes: () => GJ, prefixIssues: () => L1, pick: () => sL, partial: () => YF, optionalKeys: () => eQ, omit: () => eL, numKeys: () => rL, nullish: () => n9, normalizeParams: () => y, merge: () => XF, jsonStringifyReplacer: () => oQ, joinValues: () => e4, issue: () => XX, isPlainObject: () => G9, isObject: () => W9, getSizableOrigin: () => BJ, getParsedType: () => tL, getLengthableOrigin: () => r9, getEnumValues: () => d9, getElementAtPath: () => iL, floatSafeRemainder: () => rQ, finalizeIssue: () => Y1, extend: () => QF, escapeRegex: () => c1, esc: () => F6, defineLazy: () => J0, createTransparentProxy: () => aL, clone: () => p0, cleanRegex: () => o9, cleanEnum: () => JF, captureStackTrace: () => Q8, cached: () => i9, assignProp: () => tQ, assertNotEqual: () => lL, assertNever: () => pL, assertIs: () => cL, assertEqual: () => mL, assert: () => dL, allowsEval: () => aQ, aborted: () => O6, NUMBER_FORMAT_RANGES: () => QX, Class: () => zJ, BIGINT_FORMAT_RANGES: () => HJ });
    Q8 = Error.captureStackTrace ? Error.captureStackTrace : (...Q) => {
    };
    aQ = i9(() => {
      if (typeof navigator < "u" && navigator?.userAgent?.includes("Cloudflare")) return false;
      try {
        return new Function(""), true;
      } catch (Q) {
        return false;
      }
    });
    tL = (Q) => {
      let X = typeof Q;
      switch (X) {
        case "undefined":
          return "undefined";
        case "string":
          return "string";
        case "number":
          return Number.isNaN(Q) ? "nan" : "number";
        case "boolean":
          return "boolean";
        case "function":
          return "function";
        case "bigint":
          return "bigint";
        case "symbol":
          return "symbol";
        case "object":
          if (Array.isArray(Q)) return "array";
          if (Q === null) return "null";
          if (Q.then && typeof Q.then === "function" && Q.catch && typeof Q.catch === "function") return "promise";
          if (typeof Map < "u" && Q instanceof Map) return "map";
          if (typeof Set < "u" && Q instanceof Set) return "set";
          if (typeof Date < "u" && Q instanceof Date) return "date";
          if (typeof File < "u" && Q instanceof File) return "file";
          return "object";
        default:
          throw Error(`Unknown data type: ${X}`);
      }
    };
    sQ = /* @__PURE__ */ new Set(["string", "number", "symbol"]);
    GJ = /* @__PURE__ */ new Set(["string", "number", "bigint", "boolean", "symbol", "undefined"]);
    QX = { safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER], int32: [-2147483648, 2147483647], uint32: [0, 4294967295], float32: [-34028234663852886e22, 34028234663852886e22], float64: [-Number.MAX_VALUE, Number.MAX_VALUE] };
    HJ = { int64: [BigInt("-9223372036854775808"), BigInt("9223372036854775807")], uint64: [BigInt(0), BigInt("18446744073709551615")] };
    zJ = class {
      constructor(...Q) {
      }
    };
    KJ = (Q, X) => {
      Q.name = "$ZodError", Object.defineProperty(Q, "_zod", { value: Q._zod, enumerable: false }), Object.defineProperty(Q, "issues", { value: X, enumerable: false }), Object.defineProperty(Q, "message", { get() {
        return JSON.stringify(X, oQ, 2);
      }, enumerable: true });
    };
    Y8 = D("$ZodError", KJ);
    t9 = D("$ZodError", KJ, { Parent: Error });
    JX = (Q) => (X, Y, $, J) => {
      let W = $ ? Object.assign($, { async: false }) : { async: false }, G = X._zod.run({ value: Y, issues: [] }, W);
      if (G instanceof Promise) throw new l1();
      if (G.issues.length) {
        let H = new (J?.Err ?? Q)(G.issues.map((B) => Y1(B, W, c0())));
        throw Q8(H, J?.callee), H;
      }
      return G.value;
    };
    WX = JX(t9);
    GX = (Q) => async (X, Y, $, J) => {
      let W = $ ? Object.assign($, { async: true }) : { async: true }, G = X._zod.run({ value: Y, issues: [] }, W);
      if (G instanceof Promise) G = await G;
      if (G.issues.length) {
        let H = new (J?.Err ?? Q)(G.issues.map((B) => Y1(B, W, c0())));
        throw Q8(H, J?.callee), H;
      }
      return G.value;
    };
    HX = GX(t9);
    BX = (Q) => (X, Y, $) => {
      let J = $ ? { ...$, async: false } : { async: false }, W = X._zod.run({ value: Y, issues: [] }, J);
      if (W instanceof Promise) throw new l1();
      return W.issues.length ? { success: false, error: new (Q ?? Y8)(W.issues.map((G) => Y1(G, J, c0()))) } : { success: true, data: W.value };
    };
    N6 = BX(t9);
    zX = (Q) => async (X, Y, $) => {
      let J = $ ? Object.assign($, { async: true }) : { async: true }, W = X._zod.run({ value: Y, issues: [] }, J);
      if (W instanceof Promise) W = await W;
      return W.issues.length ? { success: false, error: new Q(W.issues.map((G) => Y1(G, J, c0()))) } : { success: true, data: W.value };
    };
    D6 = zX(t9);
    VJ = /^[cC][^\s-]{8,}$/;
    qJ = /^[0-9a-z]+$/;
    UJ = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
    LJ = /^[0-9a-vA-V]{20}$/;
    FJ = /^[A-Za-z0-9]{27}$/;
    OJ = /^[a-zA-Z0-9_-]{21}$/;
    NJ = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
    DJ = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
    KX = (Q) => {
      if (!Q) return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000)$/;
      return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${Q}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
    };
    wJ = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
    AJ = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
    jJ = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})$/;
    RJ = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
    IJ = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
    bJ = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
    VX = /^[A-Za-z0-9_-]*$/;
    EJ = /^([a-zA-Z0-9-]+\.)*[a-zA-Z0-9-]+$/;
    PJ = /^\+(?:[0-9]){6,14}[0-9]$/;
    ZJ = "(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))";
    SJ = new RegExp(`^${ZJ}$`);
    vJ = (Q) => {
      let X = Q ? `[\\s\\S]{${Q?.minimum ?? 0},${Q?.maximum ?? ""}}` : "[\\s\\S]*";
      return new RegExp(`^${X}$`);
    };
    TJ = /^\d+$/;
    xJ = /^-?\d+(?:\.\d+)?/i;
    yJ = /true|false/i;
    gJ = /null/i;
    hJ = /^[^A-Z]*$/;
    fJ = /^[^a-z]*$/;
    j0 = D("$ZodCheck", (Q, X) => {
      var Y;
      Q._zod ?? (Q._zod = {}), Q._zod.def = X, (Y = Q._zod).onattach ?? (Y.onattach = []);
    });
    uJ = { number: "number", bigint: "bigint", object: "date" };
    qX = D("$ZodCheckLessThan", (Q, X) => {
      j0.init(Q, X);
      let Y = uJ[typeof X.value];
      Q._zod.onattach.push(($) => {
        let J = $._zod.bag, W = (X.inclusive ? J.maximum : J.exclusiveMaximum) ?? Number.POSITIVE_INFINITY;
        if (X.value < W) if (X.inclusive) J.maximum = X.value;
        else J.exclusiveMaximum = X.value;
      }), Q._zod.check = ($) => {
        if (X.inclusive ? $.value <= X.value : $.value < X.value) return;
        $.issues.push({ origin: Y, code: "too_big", maximum: X.value, input: $.value, inclusive: X.inclusive, inst: Q, continue: !X.abort });
      };
    });
    UX = D("$ZodCheckGreaterThan", (Q, X) => {
      j0.init(Q, X);
      let Y = uJ[typeof X.value];
      Q._zod.onattach.push(($) => {
        let J = $._zod.bag, W = (X.inclusive ? J.minimum : J.exclusiveMinimum) ?? Number.NEGATIVE_INFINITY;
        if (X.value > W) if (X.inclusive) J.minimum = X.value;
        else J.exclusiveMinimum = X.value;
      }), Q._zod.check = ($) => {
        if (X.inclusive ? $.value >= X.value : $.value > X.value) return;
        $.issues.push({ origin: Y, code: "too_small", minimum: X.value, input: $.value, inclusive: X.inclusive, inst: Q, continue: !X.abort });
      };
    });
    mJ = D("$ZodCheckMultipleOf", (Q, X) => {
      j0.init(Q, X), Q._zod.onattach.push((Y) => {
        var $;
        ($ = Y._zod.bag).multipleOf ?? ($.multipleOf = X.value);
      }), Q._zod.check = (Y) => {
        if (typeof Y.value !== typeof X.value) throw Error("Cannot mix number and bigint in multiple_of check.");
        if (typeof Y.value === "bigint" ? Y.value % X.value === BigInt(0) : rQ(Y.value, X.value) === 0) return;
        Y.issues.push({ origin: typeof Y.value, code: "not_multiple_of", divisor: X.value, input: Y.value, inst: Q, continue: !X.abort });
      };
    });
    lJ = D("$ZodCheckNumberFormat", (Q, X) => {
      j0.init(Q, X), X.format = X.format || "float64";
      let Y = X.format?.includes("int"), $ = Y ? "int" : "number", [J, W] = QX[X.format];
      Q._zod.onattach.push((G) => {
        let H = G._zod.bag;
        if (H.format = X.format, H.minimum = J, H.maximum = W, Y) H.pattern = TJ;
      }), Q._zod.check = (G) => {
        let H = G.value;
        if (Y) {
          if (!Number.isInteger(H)) {
            G.issues.push({ expected: $, format: X.format, code: "invalid_type", input: H, inst: Q });
            return;
          }
          if (!Number.isSafeInteger(H)) {
            if (H > 0) G.issues.push({ input: H, code: "too_big", maximum: Number.MAX_SAFE_INTEGER, note: "Integers must be within the safe integer range.", inst: Q, origin: $, continue: !X.abort });
            else G.issues.push({ input: H, code: "too_small", minimum: Number.MIN_SAFE_INTEGER, note: "Integers must be within the safe integer range.", inst: Q, origin: $, continue: !X.abort });
            return;
          }
        }
        if (H < J) G.issues.push({ origin: "number", input: H, code: "too_small", minimum: J, inclusive: true, inst: Q, continue: !X.abort });
        if (H > W) G.issues.push({ origin: "number", input: H, code: "too_big", maximum: W, inst: Q });
      };
    });
    cJ = D("$ZodCheckMaxLength", (Q, X) => {
      j0.init(Q, X), Q._zod.when = (Y) => {
        let $ = Y.value;
        return !n9($) && $.length !== void 0;
      }, Q._zod.onattach.push((Y) => {
        let $ = Y._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
        if (X.maximum < $) Y._zod.bag.maximum = X.maximum;
      }), Q._zod.check = (Y) => {
        let $ = Y.value;
        if ($.length <= X.maximum) return;
        let W = r9($);
        Y.issues.push({ origin: W, code: "too_big", maximum: X.maximum, inclusive: true, input: $, inst: Q, continue: !X.abort });
      };
    });
    pJ = D("$ZodCheckMinLength", (Q, X) => {
      j0.init(Q, X), Q._zod.when = (Y) => {
        let $ = Y.value;
        return !n9($) && $.length !== void 0;
      }, Q._zod.onattach.push((Y) => {
        let $ = Y._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
        if (X.minimum > $) Y._zod.bag.minimum = X.minimum;
      }), Q._zod.check = (Y) => {
        let $ = Y.value;
        if ($.length >= X.minimum) return;
        let W = r9($);
        Y.issues.push({ origin: W, code: "too_small", minimum: X.minimum, inclusive: true, input: $, inst: Q, continue: !X.abort });
      };
    });
    dJ = D("$ZodCheckLengthEquals", (Q, X) => {
      j0.init(Q, X), Q._zod.when = (Y) => {
        let $ = Y.value;
        return !n9($) && $.length !== void 0;
      }, Q._zod.onattach.push((Y) => {
        let $ = Y._zod.bag;
        $.minimum = X.length, $.maximum = X.length, $.length = X.length;
      }), Q._zod.check = (Y) => {
        let $ = Y.value, J = $.length;
        if (J === X.length) return;
        let W = r9($), G = J > X.length;
        Y.issues.push({ origin: W, ...G ? { code: "too_big", maximum: X.length } : { code: "too_small", minimum: X.length }, inclusive: true, exact: true, input: Y.value, inst: Q, continue: !X.abort });
      };
    });
    a9 = D("$ZodCheckStringFormat", (Q, X) => {
      var Y, $;
      if (j0.init(Q, X), Q._zod.onattach.push((J) => {
        let W = J._zod.bag;
        if (W.format = X.format, X.pattern) W.patterns ?? (W.patterns = /* @__PURE__ */ new Set()), W.patterns.add(X.pattern);
      }), X.pattern) (Y = Q._zod).check ?? (Y.check = (J) => {
        if (X.pattern.lastIndex = 0, X.pattern.test(J.value)) return;
        J.issues.push({ origin: "string", code: "invalid_format", format: X.format, input: J.value, ...X.pattern ? { pattern: X.pattern.toString() } : {}, inst: Q, continue: !X.abort });
      });
      else ($ = Q._zod).check ?? ($.check = () => {
      });
    });
    iJ = D("$ZodCheckRegex", (Q, X) => {
      a9.init(Q, X), Q._zod.check = (Y) => {
        if (X.pattern.lastIndex = 0, X.pattern.test(Y.value)) return;
        Y.issues.push({ origin: "string", code: "invalid_format", format: "regex", input: Y.value, pattern: X.pattern.toString(), inst: Q, continue: !X.abort });
      };
    });
    nJ = D("$ZodCheckLowerCase", (Q, X) => {
      X.pattern ?? (X.pattern = hJ), a9.init(Q, X);
    });
    oJ = D("$ZodCheckUpperCase", (Q, X) => {
      X.pattern ?? (X.pattern = fJ), a9.init(Q, X);
    });
    rJ = D("$ZodCheckIncludes", (Q, X) => {
      j0.init(Q, X);
      let Y = c1(X.includes), $ = new RegExp(typeof X.position === "number" ? `^.{${X.position}}${Y}` : Y);
      X.pattern = $, Q._zod.onattach.push((J) => {
        let W = J._zod.bag;
        W.patterns ?? (W.patterns = /* @__PURE__ */ new Set()), W.patterns.add($);
      }), Q._zod.check = (J) => {
        if (J.value.includes(X.includes, X.position)) return;
        J.issues.push({ origin: "string", code: "invalid_format", format: "includes", includes: X.includes, input: J.value, inst: Q, continue: !X.abort });
      };
    });
    tJ = D("$ZodCheckStartsWith", (Q, X) => {
      j0.init(Q, X);
      let Y = new RegExp(`^${c1(X.prefix)}.*`);
      X.pattern ?? (X.pattern = Y), Q._zod.onattach.push(($) => {
        let J = $._zod.bag;
        J.patterns ?? (J.patterns = /* @__PURE__ */ new Set()), J.patterns.add(Y);
      }), Q._zod.check = ($) => {
        if ($.value.startsWith(X.prefix)) return;
        $.issues.push({ origin: "string", code: "invalid_format", format: "starts_with", prefix: X.prefix, input: $.value, inst: Q, continue: !X.abort });
      };
    });
    aJ = D("$ZodCheckEndsWith", (Q, X) => {
      j0.init(Q, X);
      let Y = new RegExp(`.*${c1(X.suffix)}$`);
      X.pattern ?? (X.pattern = Y), Q._zod.onattach.push(($) => {
        let J = $._zod.bag;
        J.patterns ?? (J.patterns = /* @__PURE__ */ new Set()), J.patterns.add(Y);
      }), Q._zod.check = ($) => {
        if ($.value.endsWith(X.suffix)) return;
        $.issues.push({ origin: "string", code: "invalid_format", format: "ends_with", suffix: X.suffix, input: $.value, inst: Q, continue: !X.abort });
      };
    });
    sJ = D("$ZodCheckOverwrite", (Q, X) => {
      j0.init(Q, X), Q._zod.check = (Y) => {
        Y.value = X.tx(Y.value);
      };
    });
    LX = class {
      constructor(Q = []) {
        if (this.content = [], this.indent = 0, this) this.args = Q;
      }
      indented(Q) {
        this.indent += 1, Q(this), this.indent -= 1;
      }
      write(Q) {
        if (typeof Q === "function") {
          Q(this, { execution: "sync" }), Q(this, { execution: "async" });
          return;
        }
        let Y = Q.split(`
`).filter((W) => W), $ = Math.min(...Y.map((W) => W.length - W.trimStart().length)), J = Y.map((W) => W.slice($)).map((W) => " ".repeat(this.indent * 2) + W);
        for (let W of J) this.content.push(W);
      }
      compile() {
        let Q = Function, X = this?.args, $ = [...(this?.content ?? [""]).map((J) => `  ${J}`)];
        return new Q(...X, $.join(`
`));
      }
    };
    QW = { major: 4, minor: 0, patch: 0 };
    e = D("$ZodType", (Q, X) => {
      var Y;
      Q ?? (Q = {}), Q._zod.def = X, Q._zod.bag = Q._zod.bag || {}, Q._zod.version = QW;
      let $ = [...Q._zod.def.checks ?? []];
      if (Q._zod.traits.has("$ZodCheck")) $.unshift(Q);
      for (let J of $) for (let W of J._zod.onattach) W(Q);
      if ($.length === 0) (Y = Q._zod).deferred ?? (Y.deferred = []), Q._zod.deferred?.push(() => {
        Q._zod.run = Q._zod.parse;
      });
      else {
        let J = (W, G, H) => {
          let B = O6(W), z;
          for (let K of G) {
            if (K._zod.when) {
              if (!K._zod.when(W)) continue;
            } else if (B) continue;
            let q = W.issues.length, U = K._zod.check(W);
            if (U instanceof Promise && H?.async === false) throw new l1();
            if (z || U instanceof Promise) z = (z ?? Promise.resolve()).then(async () => {
              if (await U, W.issues.length === q) return;
              if (!B) B = O6(W, q);
            });
            else {
              if (W.issues.length === q) continue;
              if (!B) B = O6(W, q);
            }
          }
          if (z) return z.then(() => {
            return W;
          });
          return W;
        };
        Q._zod.run = (W, G) => {
          let H = Q._zod.parse(W, G);
          if (H instanceof Promise) {
            if (G.async === false) throw new l1();
            return H.then((B) => J(B, $, G));
          }
          return J(H, $, G);
        };
      }
      Q["~standard"] = { validate: (J) => {
        try {
          let W = N6(Q, J);
          return W.success ? { value: W.data } : { issues: W.error?.issues };
        } catch (W) {
          return D6(Q, J).then((G) => G.success ? { value: G.data } : { issues: G.error?.issues });
        }
      }, vendor: "zod", version: 1 };
    });
    s9 = D("$ZodString", (Q, X) => {
      e.init(Q, X), Q._zod.pattern = [...Q?._zod.bag?.patterns ?? []].pop() ?? vJ(Q._zod.bag), Q._zod.parse = (Y, $) => {
        if (X.coerce) try {
          Y.value = String(Y.value);
        } catch (J) {
        }
        if (typeof Y.value === "string") return Y;
        return Y.issues.push({ expected: "string", code: "invalid_type", input: Y.value, inst: Q }), Y;
      };
    });
    W0 = D("$ZodStringFormat", (Q, X) => {
      a9.init(Q, X), s9.init(Q, X);
    });
    OX = D("$ZodGUID", (Q, X) => {
      X.pattern ?? (X.pattern = DJ), W0.init(Q, X);
    });
    NX = D("$ZodUUID", (Q, X) => {
      if (X.version) {
        let $ = { v1: 1, v2: 2, v3: 3, v4: 4, v5: 5, v6: 6, v7: 7, v8: 8 }[X.version];
        if ($ === void 0) throw Error(`Invalid UUID version: "${X.version}"`);
        X.pattern ?? (X.pattern = KX($));
      } else X.pattern ?? (X.pattern = KX());
      W0.init(Q, X);
    });
    DX = D("$ZodEmail", (Q, X) => {
      X.pattern ?? (X.pattern = wJ), W0.init(Q, X);
    });
    wX = D("$ZodURL", (Q, X) => {
      W0.init(Q, X), Q._zod.check = (Y) => {
        try {
          let $ = Y.value, J = new URL($), W = J.href;
          if (X.hostname) {
            if (X.hostname.lastIndex = 0, !X.hostname.test(J.hostname)) Y.issues.push({ code: "invalid_format", format: "url", note: "Invalid hostname", pattern: EJ.source, input: Y.value, inst: Q, continue: !X.abort });
          }
          if (X.protocol) {
            if (X.protocol.lastIndex = 0, !X.protocol.test(J.protocol.endsWith(":") ? J.protocol.slice(0, -1) : J.protocol)) Y.issues.push({ code: "invalid_format", format: "url", note: "Invalid protocol", pattern: X.protocol.source, input: Y.value, inst: Q, continue: !X.abort });
          }
          if (!$.endsWith("/") && W.endsWith("/")) Y.value = W.slice(0, -1);
          else Y.value = W;
          return;
        } catch ($) {
          Y.issues.push({ code: "invalid_format", format: "url", input: Y.value, inst: Q, continue: !X.abort });
        }
      };
    });
    MX = D("$ZodEmoji", (Q, X) => {
      X.pattern ?? (X.pattern = MJ()), W0.init(Q, X);
    });
    AX = D("$ZodNanoID", (Q, X) => {
      X.pattern ?? (X.pattern = OJ), W0.init(Q, X);
    });
    jX = D("$ZodCUID", (Q, X) => {
      X.pattern ?? (X.pattern = VJ), W0.init(Q, X);
    });
    RX = D("$ZodCUID2", (Q, X) => {
      X.pattern ?? (X.pattern = qJ), W0.init(Q, X);
    });
    IX = D("$ZodULID", (Q, X) => {
      X.pattern ?? (X.pattern = UJ), W0.init(Q, X);
    });
    bX = D("$ZodXID", (Q, X) => {
      X.pattern ?? (X.pattern = LJ), W0.init(Q, X);
    });
    EX = D("$ZodKSUID", (Q, X) => {
      X.pattern ?? (X.pattern = FJ), W0.init(Q, X);
    });
    KW = D("$ZodISODateTime", (Q, X) => {
      X.pattern ?? (X.pattern = kJ(X)), W0.init(Q, X);
    });
    VW = D("$ZodISODate", (Q, X) => {
      X.pattern ?? (X.pattern = SJ), W0.init(Q, X);
    });
    qW = D("$ZodISOTime", (Q, X) => {
      X.pattern ?? (X.pattern = _J(X)), W0.init(Q, X);
    });
    UW = D("$ZodISODuration", (Q, X) => {
      X.pattern ?? (X.pattern = NJ), W0.init(Q, X);
    });
    PX = D("$ZodIPv4", (Q, X) => {
      X.pattern ?? (X.pattern = AJ), W0.init(Q, X), Q._zod.onattach.push((Y) => {
        let $ = Y._zod.bag;
        $.format = "ipv4";
      });
    });
    ZX = D("$ZodIPv6", (Q, X) => {
      X.pattern ?? (X.pattern = jJ), W0.init(Q, X), Q._zod.onattach.push((Y) => {
        let $ = Y._zod.bag;
        $.format = "ipv6";
      }), Q._zod.check = (Y) => {
        try {
          new URL(`http://[${Y.value}]`);
        } catch {
          Y.issues.push({ code: "invalid_format", format: "ipv6", input: Y.value, inst: Q, continue: !X.abort });
        }
      };
    });
    SX = D("$ZodCIDRv4", (Q, X) => {
      X.pattern ?? (X.pattern = RJ), W0.init(Q, X);
    });
    CX = D("$ZodCIDRv6", (Q, X) => {
      X.pattern ?? (X.pattern = IJ), W0.init(Q, X), Q._zod.check = (Y) => {
        let [$, J] = Y.value.split("/");
        try {
          if (!J) throw Error();
          let W = Number(J);
          if (`${W}` !== J) throw Error();
          if (W < 0 || W > 128) throw Error();
          new URL(`http://[${$}]`);
        } catch {
          Y.issues.push({ code: "invalid_format", format: "cidrv6", input: Y.value, inst: Q, continue: !X.abort });
        }
      };
    });
    _X = D("$ZodBase64", (Q, X) => {
      X.pattern ?? (X.pattern = bJ), W0.init(Q, X), Q._zod.onattach.push((Y) => {
        Y._zod.bag.contentEncoding = "base64";
      }), Q._zod.check = (Y) => {
        if (LW(Y.value)) return;
        Y.issues.push({ code: "invalid_format", format: "base64", input: Y.value, inst: Q, continue: !X.abort });
      };
    });
    kX = D("$ZodBase64URL", (Q, X) => {
      X.pattern ?? (X.pattern = VX), W0.init(Q, X), Q._zod.onattach.push((Y) => {
        Y._zod.bag.contentEncoding = "base64url";
      }), Q._zod.check = (Y) => {
        if (GF(Y.value)) return;
        Y.issues.push({ code: "invalid_format", format: "base64url", input: Y.value, inst: Q, continue: !X.abort });
      };
    });
    vX = D("$ZodE164", (Q, X) => {
      X.pattern ?? (X.pattern = PJ), W0.init(Q, X);
    });
    TX = D("$ZodJWT", (Q, X) => {
      W0.init(Q, X), Q._zod.check = (Y) => {
        if (HF(Y.value, X.alg)) return;
        Y.issues.push({ code: "invalid_format", format: "jwt", input: Y.value, inst: Q, continue: !X.abort });
      };
    });
    W8 = D("$ZodNumber", (Q, X) => {
      e.init(Q, X), Q._zod.pattern = Q._zod.bag.pattern ?? xJ, Q._zod.parse = (Y, $) => {
        if (X.coerce) try {
          Y.value = Number(Y.value);
        } catch (G) {
        }
        let J = Y.value;
        if (typeof J === "number" && !Number.isNaN(J) && Number.isFinite(J)) return Y;
        let W = typeof J === "number" ? Number.isNaN(J) ? "NaN" : !Number.isFinite(J) ? "Infinity" : void 0 : void 0;
        return Y.issues.push({ expected: "number", code: "invalid_type", input: J, inst: Q, ...W ? { received: W } : {} }), Y;
      };
    });
    xX = D("$ZodNumber", (Q, X) => {
      lJ.init(Q, X), W8.init(Q, X);
    });
    yX = D("$ZodBoolean", (Q, X) => {
      e.init(Q, X), Q._zod.pattern = yJ, Q._zod.parse = (Y, $) => {
        if (X.coerce) try {
          Y.value = Boolean(Y.value);
        } catch (W) {
        }
        let J = Y.value;
        if (typeof J === "boolean") return Y;
        return Y.issues.push({ expected: "boolean", code: "invalid_type", input: J, inst: Q }), Y;
      };
    });
    gX = D("$ZodNull", (Q, X) => {
      e.init(Q, X), Q._zod.pattern = gJ, Q._zod.values = /* @__PURE__ */ new Set([null]), Q._zod.parse = (Y, $) => {
        let J = Y.value;
        if (J === null) return Y;
        return Y.issues.push({ expected: "null", code: "invalid_type", input: J, inst: Q }), Y;
      };
    });
    hX = D("$ZodUnknown", (Q, X) => {
      e.init(Q, X), Q._zod.parse = (Y) => Y;
    });
    fX = D("$ZodNever", (Q, X) => {
      e.init(Q, X), Q._zod.parse = (Y, $) => {
        return Y.issues.push({ expected: "never", code: "invalid_type", input: Y.value, inst: Q }), Y;
      };
    });
    uX = D("$ZodArray", (Q, X) => {
      e.init(Q, X), Q._zod.parse = (Y, $) => {
        let J = Y.value;
        if (!Array.isArray(J)) return Y.issues.push({ expected: "array", code: "invalid_type", input: J, inst: Q }), Y;
        Y.value = Array(J.length);
        let W = [];
        for (let G = 0; G < J.length; G++) {
          let H = J[G], B = X.element._zod.run({ value: H, issues: [] }, $);
          if (B instanceof Promise) W.push(B.then((z) => XW(z, Y, G)));
          else XW(B, Y, G);
        }
        if (W.length) return Promise.all(W).then(() => Y);
        return Y;
      };
    });
    G8 = D("$ZodObject", (Q, X) => {
      e.init(Q, X);
      let Y = i9(() => {
        let q = Object.keys(X.shape);
        for (let V of q) if (!(X.shape[V] instanceof e)) throw Error(`Invalid element at key "${V}": expected a Zod schema`);
        let U = eQ(X.shape);
        return { shape: X.shape, keys: q, keySet: new Set(q), numKeys: q.length, optionalKeys: new Set(U) };
      });
      J0(Q._zod, "propValues", () => {
        let q = X.shape, U = {};
        for (let V in q) {
          let L = q[V]._zod;
          if (L.values) {
            U[V] ?? (U[V] = /* @__PURE__ */ new Set());
            for (let F of L.values) U[V].add(F);
          }
        }
        return U;
      });
      let $ = (q) => {
        let U = new LX(["shape", "payload", "ctx"]), V = Y.value, L = (j) => {
          let R = F6(j);
          return `shape[${R}]._zod.run({ value: input[${R}], issues: [] }, ctx)`;
        };
        U.write("const input = payload.value;");
        let F = /* @__PURE__ */ Object.create(null), w = 0;
        for (let j of V.keys) F[j] = `key_${w++}`;
        U.write("const newResult = {}");
        for (let j of V.keys) if (V.optionalKeys.has(j)) {
          let R = F[j];
          U.write(`const ${R} = ${L(j)};`);
          let C = F6(j);
          U.write(`
        if (${R}.issues.length) {
          if (input[${C}] === undefined) {
            if (${C} in input) {
              newResult[${C}] = undefined;
            }
          } else {
            payload.issues = payload.issues.concat(
              ${R}.issues.map((iss) => ({
                ...iss,
                path: iss.path ? [${C}, ...iss.path] : [${C}],
              }))
            );
          }
        } else if (${R}.value === undefined) {
          if (${C} in input) newResult[${C}] = undefined;
        } else {
          newResult[${C}] = ${R}.value;
        }
        `);
        } else {
          let R = F[j];
          U.write(`const ${R} = ${L(j)};`), U.write(`
          if (${R}.issues.length) payload.issues = payload.issues.concat(${R}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${F6(j)}, ...iss.path] : [${F6(j)}]
          })));`), U.write(`newResult[${F6(j)}] = ${R}.value`);
        }
        U.write("payload.value = newResult;"), U.write("return payload;");
        let N = U.compile();
        return (j, R) => N(q, j, R);
      }, J, W = W9, G = !s4.jitless, B = G && aQ.value, z = X.catchall, K;
      Q._zod.parse = (q, U) => {
        K ?? (K = Y.value);
        let V = q.value;
        if (!W(V)) return q.issues.push({ expected: "object", code: "invalid_type", input: V, inst: Q }), q;
        let L = [];
        if (G && B && U?.async === false && U.jitless !== true) {
          if (!J) J = $(X.shape);
          q = J(q, U);
        } else {
          q.value = {};
          let R = K.shape;
          for (let C of K.keys) {
            let Z = R[C], X0 = Z._zod.run({ value: V[C], issues: [] }, U), O0 = Z._zod.optin === "optional" && Z._zod.optout === "optional";
            if (X0 instanceof Promise) L.push(X0.then((S0) => O0 ? YW(S0, q, C, V) : J8(S0, q, C)));
            else if (O0) YW(X0, q, C, V);
            else J8(X0, q, C);
          }
        }
        if (!z) return L.length ? Promise.all(L).then(() => q) : q;
        let F = [], w = K.keySet, N = z._zod, j = N.def.type;
        for (let R of Object.keys(V)) {
          if (w.has(R)) continue;
          if (j === "never") {
            F.push(R);
            continue;
          }
          let C = N.run({ value: V[R], issues: [] }, U);
          if (C instanceof Promise) L.push(C.then((Z) => J8(Z, q, R)));
          else J8(C, q, R);
        }
        if (F.length) q.issues.push({ code: "unrecognized_keys", keys: F, input: V, inst: Q });
        if (!L.length) return q;
        return Promise.all(L).then(() => {
          return q;
        });
      };
    });
    H8 = D("$ZodUnion", (Q, X) => {
      e.init(Q, X), J0(Q._zod, "optin", () => X.options.some((Y) => Y._zod.optin === "optional") ? "optional" : void 0), J0(Q._zod, "optout", () => X.options.some((Y) => Y._zod.optout === "optional") ? "optional" : void 0), J0(Q._zod, "values", () => {
        if (X.options.every((Y) => Y._zod.values)) return new Set(X.options.flatMap((Y) => Array.from(Y._zod.values)));
        return;
      }), J0(Q._zod, "pattern", () => {
        if (X.options.every((Y) => Y._zod.pattern)) {
          let Y = X.options.map(($) => $._zod.pattern);
          return new RegExp(`^(${Y.map(($) => o9($.source)).join("|")})$`);
        }
        return;
      }), Q._zod.parse = (Y, $) => {
        let J = false, W = [];
        for (let G of X.options) {
          let H = G._zod.run({ value: Y.value, issues: [] }, $);
          if (H instanceof Promise) W.push(H), J = true;
          else {
            if (H.issues.length === 0) return H;
            W.push(H);
          }
        }
        if (!J) return $W(W, Y, Q, $);
        return Promise.all(W).then((G) => {
          return $W(G, Y, Q, $);
        });
      };
    });
    mX = D("$ZodDiscriminatedUnion", (Q, X) => {
      H8.init(Q, X);
      let Y = Q._zod.parse;
      J0(Q._zod, "propValues", () => {
        let J = {};
        for (let W of X.options) {
          let G = W._zod.propValues;
          if (!G || Object.keys(G).length === 0) throw Error(`Invalid discriminated union option at index "${X.options.indexOf(W)}"`);
          for (let [H, B] of Object.entries(G)) {
            if (!J[H]) J[H] = /* @__PURE__ */ new Set();
            for (let z of B) J[H].add(z);
          }
        }
        return J;
      });
      let $ = i9(() => {
        let J = X.options, W = /* @__PURE__ */ new Map();
        for (let G of J) {
          let H = G._zod.propValues[X.discriminator];
          if (!H || H.size === 0) throw Error(`Invalid discriminated union option at index "${X.options.indexOf(G)}"`);
          for (let B of H) {
            if (W.has(B)) throw Error(`Duplicate discriminator value "${String(B)}"`);
            W.set(B, G);
          }
        }
        return W;
      });
      Q._zod.parse = (J, W) => {
        let G = J.value;
        if (!W9(G)) return J.issues.push({ code: "invalid_type", expected: "object", input: G, inst: Q }), J;
        let H = $.value.get(G?.[X.discriminator]);
        if (H) return H._zod.run(J, W);
        if (X.unionFallback) return Y(J, W);
        return J.issues.push({ code: "invalid_union", errors: [], note: "No matching discriminator", input: G, path: [X.discriminator], inst: Q }), J;
      };
    });
    lX = D("$ZodIntersection", (Q, X) => {
      e.init(Q, X), Q._zod.parse = (Y, $) => {
        let J = Y.value, W = X.left._zod.run({ value: J, issues: [] }, $), G = X.right._zod.run({ value: J, issues: [] }, $);
        if (W instanceof Promise || G instanceof Promise) return Promise.all([W, G]).then(([B, z]) => {
          return JW(Y, B, z);
        });
        return JW(Y, W, G);
      };
    });
    cX = D("$ZodRecord", (Q, X) => {
      e.init(Q, X), Q._zod.parse = (Y, $) => {
        let J = Y.value;
        if (!G9(J)) return Y.issues.push({ expected: "record", code: "invalid_type", input: J, inst: Q }), Y;
        let W = [];
        if (X.keyType._zod.values) {
          let G = X.keyType._zod.values;
          Y.value = {};
          for (let B of G) if (typeof B === "string" || typeof B === "number" || typeof B === "symbol") {
            let z = X.valueType._zod.run({ value: J[B], issues: [] }, $);
            if (z instanceof Promise) W.push(z.then((K) => {
              if (K.issues.length) Y.issues.push(...L1(B, K.issues));
              Y.value[B] = K.value;
            }));
            else {
              if (z.issues.length) Y.issues.push(...L1(B, z.issues));
              Y.value[B] = z.value;
            }
          }
          let H;
          for (let B in J) if (!G.has(B)) H = H ?? [], H.push(B);
          if (H && H.length > 0) Y.issues.push({ code: "unrecognized_keys", input: J, inst: Q, keys: H });
        } else {
          Y.value = {};
          for (let G of Reflect.ownKeys(J)) {
            if (G === "__proto__") continue;
            let H = X.keyType._zod.run({ value: G, issues: [] }, $);
            if (H instanceof Promise) throw Error("Async schemas not supported in object keys currently");
            if (H.issues.length) {
              Y.issues.push({ origin: "record", code: "invalid_key", issues: H.issues.map((z) => Y1(z, $, c0())), input: G, path: [G], inst: Q }), Y.value[H.value] = H.value;
              continue;
            }
            let B = X.valueType._zod.run({ value: J[G], issues: [] }, $);
            if (B instanceof Promise) W.push(B.then((z) => {
              if (z.issues.length) Y.issues.push(...L1(G, z.issues));
              Y.value[H.value] = z.value;
            }));
            else {
              if (B.issues.length) Y.issues.push(...L1(G, B.issues));
              Y.value[H.value] = B.value;
            }
          }
        }
        if (W.length) return Promise.all(W).then(() => Y);
        return Y;
      };
    });
    pX = D("$ZodEnum", (Q, X) => {
      e.init(Q, X);
      let Y = d9(X.entries);
      Q._zod.values = new Set(Y), Q._zod.pattern = new RegExp(`^(${Y.filter(($) => sQ.has(typeof $)).map(($) => typeof $ === "string" ? c1($) : $.toString()).join("|")})$`), Q._zod.parse = ($, J) => {
        let W = $.value;
        if (Q._zod.values.has(W)) return $;
        return $.issues.push({ code: "invalid_value", values: Y, input: W, inst: Q }), $;
      };
    });
    dX = D("$ZodLiteral", (Q, X) => {
      e.init(Q, X), Q._zod.values = new Set(X.values), Q._zod.pattern = new RegExp(`^(${X.values.map((Y) => typeof Y === "string" ? c1(Y) : Y ? Y.toString() : String(Y)).join("|")})$`), Q._zod.parse = (Y, $) => {
        let J = Y.value;
        if (Q._zod.values.has(J)) return Y;
        return Y.issues.push({ code: "invalid_value", values: X.values, input: J, inst: Q }), Y;
      };
    });
    iX = D("$ZodTransform", (Q, X) => {
      e.init(Q, X), Q._zod.parse = (Y, $) => {
        let J = X.transform(Y.value, Y);
        if ($.async) return (J instanceof Promise ? J : Promise.resolve(J)).then((G) => {
          return Y.value = G, Y;
        });
        if (J instanceof Promise) throw new l1();
        return Y.value = J, Y;
      };
    });
    nX = D("$ZodOptional", (Q, X) => {
      e.init(Q, X), Q._zod.optin = "optional", Q._zod.optout = "optional", J0(Q._zod, "values", () => {
        return X.innerType._zod.values ? /* @__PURE__ */ new Set([...X.innerType._zod.values, void 0]) : void 0;
      }), J0(Q._zod, "pattern", () => {
        let Y = X.innerType._zod.pattern;
        return Y ? new RegExp(`^(${o9(Y.source)})?$`) : void 0;
      }), Q._zod.parse = (Y, $) => {
        if (X.innerType._zod.optin === "optional") return X.innerType._zod.run(Y, $);
        if (Y.value === void 0) return Y;
        return X.innerType._zod.run(Y, $);
      };
    });
    oX = D("$ZodNullable", (Q, X) => {
      e.init(Q, X), J0(Q._zod, "optin", () => X.innerType._zod.optin), J0(Q._zod, "optout", () => X.innerType._zod.optout), J0(Q._zod, "pattern", () => {
        let Y = X.innerType._zod.pattern;
        return Y ? new RegExp(`^(${o9(Y.source)}|null)$`) : void 0;
      }), J0(Q._zod, "values", () => {
        return X.innerType._zod.values ? /* @__PURE__ */ new Set([...X.innerType._zod.values, null]) : void 0;
      }), Q._zod.parse = (Y, $) => {
        if (Y.value === null) return Y;
        return X.innerType._zod.run(Y, $);
      };
    });
    rX = D("$ZodDefault", (Q, X) => {
      e.init(Q, X), Q._zod.optin = "optional", J0(Q._zod, "values", () => X.innerType._zod.values), Q._zod.parse = (Y, $) => {
        if (Y.value === void 0) return Y.value = X.defaultValue, Y;
        let J = X.innerType._zod.run(Y, $);
        if (J instanceof Promise) return J.then((W) => WW(W, X));
        return WW(J, X);
      };
    });
    tX = D("$ZodPrefault", (Q, X) => {
      e.init(Q, X), Q._zod.optin = "optional", J0(Q._zod, "values", () => X.innerType._zod.values), Q._zod.parse = (Y, $) => {
        if (Y.value === void 0) Y.value = X.defaultValue;
        return X.innerType._zod.run(Y, $);
      };
    });
    aX = D("$ZodNonOptional", (Q, X) => {
      e.init(Q, X), J0(Q._zod, "values", () => {
        let Y = X.innerType._zod.values;
        return Y ? new Set([...Y].filter(($) => $ !== void 0)) : void 0;
      }), Q._zod.parse = (Y, $) => {
        let J = X.innerType._zod.run(Y, $);
        if (J instanceof Promise) return J.then((W) => GW(W, Q));
        return GW(J, Q);
      };
    });
    sX = D("$ZodCatch", (Q, X) => {
      e.init(Q, X), Q._zod.optin = "optional", J0(Q._zod, "optout", () => X.innerType._zod.optout), J0(Q._zod, "values", () => X.innerType._zod.values), Q._zod.parse = (Y, $) => {
        let J = X.innerType._zod.run(Y, $);
        if (J instanceof Promise) return J.then((W) => {
          if (Y.value = W.value, W.issues.length) Y.value = X.catchValue({ ...Y, error: { issues: W.issues.map((G) => Y1(G, $, c0())) }, input: Y.value }), Y.issues = [];
          return Y;
        });
        if (Y.value = J.value, J.issues.length) Y.value = X.catchValue({ ...Y, error: { issues: J.issues.map((W) => Y1(W, $, c0())) }, input: Y.value }), Y.issues = [];
        return Y;
      };
    });
    eX = D("$ZodPipe", (Q, X) => {
      e.init(Q, X), J0(Q._zod, "values", () => X.in._zod.values), J0(Q._zod, "optin", () => X.in._zod.optin), J0(Q._zod, "optout", () => X.out._zod.optout), Q._zod.parse = (Y, $) => {
        let J = X.in._zod.run(Y, $);
        if (J instanceof Promise) return J.then((W) => HW(W, X, $));
        return HW(J, X, $);
      };
    });
    QY = D("$ZodReadonly", (Q, X) => {
      e.init(Q, X), J0(Q._zod, "propValues", () => X.innerType._zod.propValues), J0(Q._zod, "values", () => X.innerType._zod.values), J0(Q._zod, "optin", () => X.innerType._zod.optin), J0(Q._zod, "optout", () => X.innerType._zod.optout), Q._zod.parse = (Y, $) => {
        let J = X.innerType._zod.run(Y, $);
        if (J instanceof Promise) return J.then(BW);
        return BW(J);
      };
    });
    XY = D("$ZodCustom", (Q, X) => {
      j0.init(Q, X), e.init(Q, X), Q._zod.parse = (Y, $) => {
        return Y;
      }, Q._zod.check = (Y) => {
        let $ = Y.value, J = X.fn($);
        if (J instanceof Promise) return J.then((W) => zW(W, Y, $, Q));
        zW(J, Y, $, Q);
        return;
      };
    });
    BF = (Q) => {
      let X = typeof Q;
      switch (X) {
        case "number":
          return Number.isNaN(Q) ? "NaN" : "number";
        case "object": {
          if (Array.isArray(Q)) return "array";
          if (Q === null) return "null";
          if (Object.getPrototypeOf(Q) !== Object.prototype && Q.constructor) return Q.constructor.name;
        }
      }
      return X;
    };
    zF = () => {
      let Q = { string: { unit: "characters", verb: "to have" }, file: { unit: "bytes", verb: "to have" }, array: { unit: "items", verb: "to have" }, set: { unit: "items", verb: "to have" } };
      function X($) {
        return Q[$] ?? null;
      }
      let Y = { regex: "input", email: "email address", url: "URL", emoji: "emoji", uuid: "UUID", uuidv4: "UUIDv4", uuidv6: "UUIDv6", nanoid: "nanoid", guid: "GUID", cuid: "cuid", cuid2: "cuid2", ulid: "ULID", xid: "XID", ksuid: "KSUID", datetime: "ISO datetime", date: "ISO date", time: "ISO time", duration: "ISO duration", ipv4: "IPv4 address", ipv6: "IPv6 address", cidrv4: "IPv4 range", cidrv6: "IPv6 range", base64: "base64-encoded string", base64url: "base64url-encoded string", json_string: "JSON string", e164: "E.164 number", jwt: "JWT", template_literal: "input" };
      return ($) => {
        switch ($.code) {
          case "invalid_type":
            return `Invalid input: expected ${$.expected}, received ${BF($.input)}`;
          case "invalid_value":
            if ($.values.length === 1) return `Invalid input: expected ${X8($.values[0])}`;
            return `Invalid option: expected one of ${e4($.values, "|")}`;
          case "too_big": {
            let J = $.inclusive ? "<=" : "<", W = X($.origin);
            if (W) return `Too big: expected ${$.origin ?? "value"} to have ${J}${$.maximum.toString()} ${W.unit ?? "elements"}`;
            return `Too big: expected ${$.origin ?? "value"} to be ${J}${$.maximum.toString()}`;
          }
          case "too_small": {
            let J = $.inclusive ? ">=" : ">", W = X($.origin);
            if (W) return `Too small: expected ${$.origin} to have ${J}${$.minimum.toString()} ${W.unit}`;
            return `Too small: expected ${$.origin} to be ${J}${$.minimum.toString()}`;
          }
          case "invalid_format": {
            let J = $;
            if (J.format === "starts_with") return `Invalid string: must start with "${J.prefix}"`;
            if (J.format === "ends_with") return `Invalid string: must end with "${J.suffix}"`;
            if (J.format === "includes") return `Invalid string: must include "${J.includes}"`;
            if (J.format === "regex") return `Invalid string: must match pattern ${J.pattern}`;
            return `Invalid ${Y[J.format] ?? $.format}`;
          }
          case "not_multiple_of":
            return `Invalid number: must be a multiple of ${$.divisor}`;
          case "unrecognized_keys":
            return `Unrecognized key${$.keys.length > 1 ? "s" : ""}: ${e4($.keys, ", ")}`;
          case "invalid_key":
            return `Invalid key in ${$.origin}`;
          case "invalid_union":
            return "Invalid input";
          case "invalid_element":
            return `Invalid value in ${$.origin}`;
          default:
            return "Invalid input";
        }
      };
    };
    KF = Symbol("ZodOutput");
    VF = Symbol("ZodInput");
    B8 = class {
      constructor() {
        this._map = /* @__PURE__ */ new WeakMap(), this._idmap = /* @__PURE__ */ new Map();
      }
      add(Q, ...X) {
        let Y = X[0];
        if (this._map.set(Q, Y), Y && typeof Y === "object" && "id" in Y) {
          if (this._idmap.has(Y.id)) throw Error(`ID ${Y.id} already exists in the registry`);
          this._idmap.set(Y.id, Q);
        }
        return this;
      }
      remove(Q) {
        return this._map.delete(Q), this;
      }
      get(Q) {
        let X = Q._zod.parent;
        if (X) {
          let Y = { ...this.get(X) ?? {} };
          return delete Y.id, { ...Y, ...this._map.get(Q) };
        }
        return this._map.get(Q);
      }
      has(Q) {
        return this._map.has(Q);
      }
    };
    p1 = FW();
    cY = class {
      constructor(Q) {
        this.counter = 0, this.metadataRegistry = Q?.metadata ?? p1, this.target = Q?.target ?? "draft-2020-12", this.unrepresentable = Q?.unrepresentable ?? "throw", this.override = Q?.override ?? (() => {
        }), this.io = Q?.io ?? "output", this.seen = /* @__PURE__ */ new Map();
      }
      process(Q, X = { path: [], schemaPath: [] }) {
        var Y;
        let $ = Q._zod.def, J = { guid: "uuid", url: "uri", datetime: "date-time", json_string: "json-string", regex: "" }, W = this.seen.get(Q);
        if (W) {
          if (W.count++, X.schemaPath.includes(Q)) W.cycle = X.path;
          return W.schema;
        }
        let G = { schema: {}, count: 1, cycle: void 0, path: X.path };
        this.seen.set(Q, G);
        let H = Q._zod.toJSONSchema?.();
        if (H) G.schema = H;
        else {
          let K = { ...X, schemaPath: [...X.schemaPath, Q], path: X.path }, q = Q._zod.parent;
          if (q) G.ref = q, this.process(q, K), this.seen.get(q).isParent = true;
          else {
            let U = G.schema;
            switch ($.type) {
              case "string": {
                let V = U;
                V.type = "string";
                let { minimum: L, maximum: F, format: w, patterns: N, contentEncoding: j } = Q._zod.bag;
                if (typeof L === "number") V.minLength = L;
                if (typeof F === "number") V.maxLength = F;
                if (w) {
                  if (V.format = J[w] ?? w, V.format === "") delete V.format;
                }
                if (j) V.contentEncoding = j;
                if (N && N.size > 0) {
                  let R = [...N];
                  if (R.length === 1) V.pattern = R[0].source;
                  else if (R.length > 1) G.schema.allOf = [...R.map((C) => ({ ...this.target === "draft-7" ? { type: "string" } : {}, pattern: C.source }))];
                }
                break;
              }
              case "number": {
                let V = U, { minimum: L, maximum: F, format: w, multipleOf: N, exclusiveMaximum: j, exclusiveMinimum: R } = Q._zod.bag;
                if (typeof w === "string" && w.includes("int")) V.type = "integer";
                else V.type = "number";
                if (typeof R === "number") V.exclusiveMinimum = R;
                if (typeof L === "number") {
                  if (V.minimum = L, typeof R === "number") if (R >= L) delete V.minimum;
                  else delete V.exclusiveMinimum;
                }
                if (typeof j === "number") V.exclusiveMaximum = j;
                if (typeof F === "number") {
                  if (V.maximum = F, typeof j === "number") if (j <= F) delete V.maximum;
                  else delete V.exclusiveMaximum;
                }
                if (typeof N === "number") V.multipleOf = N;
                break;
              }
              case "boolean": {
                let V = U;
                V.type = "boolean";
                break;
              }
              case "bigint": {
                if (this.unrepresentable === "throw") throw Error("BigInt cannot be represented in JSON Schema");
                break;
              }
              case "symbol": {
                if (this.unrepresentable === "throw") throw Error("Symbols cannot be represented in JSON Schema");
                break;
              }
              case "null": {
                U.type = "null";
                break;
              }
              case "any":
                break;
              case "unknown":
                break;
              case "undefined":
              case "never": {
                U.not = {};
                break;
              }
              case "void": {
                if (this.unrepresentable === "throw") throw Error("Void cannot be represented in JSON Schema");
                break;
              }
              case "date": {
                if (this.unrepresentable === "throw") throw Error("Date cannot be represented in JSON Schema");
                break;
              }
              case "array": {
                let V = U, { minimum: L, maximum: F } = Q._zod.bag;
                if (typeof L === "number") V.minItems = L;
                if (typeof F === "number") V.maxItems = F;
                V.type = "array", V.items = this.process($.element, { ...K, path: [...K.path, "items"] });
                break;
              }
              case "object": {
                let V = U;
                V.type = "object", V.properties = {};
                let L = $.shape;
                for (let N in L) V.properties[N] = this.process(L[N], { ...K, path: [...K.path, "properties", N] });
                let F = new Set(Object.keys(L)), w = new Set([...F].filter((N) => {
                  let j = $.shape[N]._zod;
                  if (this.io === "input") return j.optin === void 0;
                  else return j.optout === void 0;
                }));
                if (w.size > 0) V.required = Array.from(w);
                if ($.catchall?._zod.def.type === "never") V.additionalProperties = false;
                else if (!$.catchall) {
                  if (this.io === "output") V.additionalProperties = false;
                } else if ($.catchall) V.additionalProperties = this.process($.catchall, { ...K, path: [...K.path, "additionalProperties"] });
                break;
              }
              case "union": {
                let V = U;
                V.anyOf = $.options.map((L, F) => this.process(L, { ...K, path: [...K.path, "anyOf", F] }));
                break;
              }
              case "intersection": {
                let V = U, L = this.process($.left, { ...K, path: [...K.path, "allOf", 0] }), F = this.process($.right, { ...K, path: [...K.path, "allOf", 1] }), w = (j) => "allOf" in j && Object.keys(j).length === 1, N = [...w(L) ? L.allOf : [L], ...w(F) ? F.allOf : [F]];
                V.allOf = N;
                break;
              }
              case "tuple": {
                let V = U;
                V.type = "array";
                let L = $.items.map((N, j) => this.process(N, { ...K, path: [...K.path, "prefixItems", j] }));
                if (this.target === "draft-2020-12") V.prefixItems = L;
                else V.items = L;
                if ($.rest) {
                  let N = this.process($.rest, { ...K, path: [...K.path, "items"] });
                  if (this.target === "draft-2020-12") V.items = N;
                  else V.additionalItems = N;
                }
                if ($.rest) V.items = this.process($.rest, { ...K, path: [...K.path, "items"] });
                let { minimum: F, maximum: w } = Q._zod.bag;
                if (typeof F === "number") V.minItems = F;
                if (typeof w === "number") V.maxItems = w;
                break;
              }
              case "record": {
                let V = U;
                V.type = "object", V.propertyNames = this.process($.keyType, { ...K, path: [...K.path, "propertyNames"] }), V.additionalProperties = this.process($.valueType, { ...K, path: [...K.path, "additionalProperties"] });
                break;
              }
              case "map": {
                if (this.unrepresentable === "throw") throw Error("Map cannot be represented in JSON Schema");
                break;
              }
              case "set": {
                if (this.unrepresentable === "throw") throw Error("Set cannot be represented in JSON Schema");
                break;
              }
              case "enum": {
                let V = U, L = d9($.entries);
                if (L.every((F) => typeof F === "number")) V.type = "number";
                if (L.every((F) => typeof F === "string")) V.type = "string";
                V.enum = L;
                break;
              }
              case "literal": {
                let V = U, L = [];
                for (let F of $.values) if (F === void 0) {
                  if (this.unrepresentable === "throw") throw Error("Literal `undefined` cannot be represented in JSON Schema");
                } else if (typeof F === "bigint") if (this.unrepresentable === "throw") throw Error("BigInt literals cannot be represented in JSON Schema");
                else L.push(Number(F));
                else L.push(F);
                if (L.length === 0) ;
                else if (L.length === 1) {
                  let F = L[0];
                  V.type = F === null ? "null" : typeof F, V.const = F;
                } else {
                  if (L.every((F) => typeof F === "number")) V.type = "number";
                  if (L.every((F) => typeof F === "string")) V.type = "string";
                  if (L.every((F) => typeof F === "boolean")) V.type = "string";
                  if (L.every((F) => F === null)) V.type = "null";
                  V.enum = L;
                }
                break;
              }
              case "file": {
                let V = U, L = { type: "string", format: "binary", contentEncoding: "binary" }, { minimum: F, maximum: w, mime: N } = Q._zod.bag;
                if (F !== void 0) L.minLength = F;
                if (w !== void 0) L.maxLength = w;
                if (N) if (N.length === 1) L.contentMediaType = N[0], Object.assign(V, L);
                else V.anyOf = N.map((j) => {
                  return { ...L, contentMediaType: j };
                });
                else Object.assign(V, L);
                break;
              }
              case "transform": {
                if (this.unrepresentable === "throw") throw Error("Transforms cannot be represented in JSON Schema");
                break;
              }
              case "nullable": {
                let V = this.process($.innerType, K);
                U.anyOf = [V, { type: "null" }];
                break;
              }
              case "nonoptional": {
                this.process($.innerType, K), G.ref = $.innerType;
                break;
              }
              case "success": {
                let V = U;
                V.type = "boolean";
                break;
              }
              case "default": {
                this.process($.innerType, K), G.ref = $.innerType, U.default = JSON.parse(JSON.stringify($.defaultValue));
                break;
              }
              case "prefault": {
                if (this.process($.innerType, K), G.ref = $.innerType, this.io === "input") U._prefault = JSON.parse(JSON.stringify($.defaultValue));
                break;
              }
              case "catch": {
                this.process($.innerType, K), G.ref = $.innerType;
                let V;
                try {
                  V = $.catchValue(void 0);
                } catch {
                  throw Error("Dynamic catch values are not supported in JSON Schema");
                }
                U.default = V;
                break;
              }
              case "nan": {
                if (this.unrepresentable === "throw") throw Error("NaN cannot be represented in JSON Schema");
                break;
              }
              case "template_literal": {
                let V = U, L = Q._zod.pattern;
                if (!L) throw Error("Pattern not found in template literal");
                V.type = "string", V.pattern = L.source;
                break;
              }
              case "pipe": {
                let V = this.io === "input" ? $.in._zod.def.type === "transform" ? $.out : $.in : $.out;
                this.process(V, K), G.ref = V;
                break;
              }
              case "readonly": {
                this.process($.innerType, K), G.ref = $.innerType, U.readOnly = true;
                break;
              }
              case "promise": {
                this.process($.innerType, K), G.ref = $.innerType;
                break;
              }
              case "optional": {
                this.process($.innerType, K), G.ref = $.innerType;
                break;
              }
              case "lazy": {
                let V = Q._zod.innerType;
                this.process(V, K), G.ref = V;
                break;
              }
              case "custom": {
                if (this.unrepresentable === "throw") throw Error("Custom types cannot be represented in JSON Schema");
                break;
              }
              default:
            }
          }
        }
        let B = this.metadataRegistry.get(Q);
        if (B) Object.assign(G.schema, B);
        if (this.io === "input" && D0(Q)) delete G.schema.examples, delete G.schema.default;
        if (this.io === "input" && G.schema._prefault) (Y = G.schema).default ?? (Y.default = G.schema._prefault);
        return delete G.schema._prefault, this.seen.get(Q).schema;
      }
      emit(Q, X) {
        let Y = { cycles: X?.cycles ?? "ref", reused: X?.reused ?? "inline", external: X?.external ?? void 0 }, $ = this.seen.get(Q);
        if (!$) throw Error("Unprocessed schema. This is a bug in Zod.");
        let J = (z) => {
          let K = this.target === "draft-2020-12" ? "$defs" : "definitions";
          if (Y.external) {
            let L = Y.external.registry.get(z[0])?.id;
            if (L) return { ref: Y.external.uri(L) };
            let F = z[1].defId ?? z[1].schema.id ?? `schema${this.counter++}`;
            return z[1].defId = F, { defId: F, ref: `${Y.external.uri("__shared")}#/${K}/${F}` };
          }
          if (z[1] === $) return { ref: "#" };
          let U = `${"#"}/${K}/`, V = z[1].schema.id ?? `__schema${this.counter++}`;
          return { defId: V, ref: U + V };
        }, W = (z) => {
          if (z[1].schema.$ref) return;
          let K = z[1], { ref: q, defId: U } = J(z);
          if (K.def = { ...K.schema }, U) K.defId = U;
          let V = K.schema;
          for (let L in V) delete V[L];
          V.$ref = q;
        };
        for (let z of this.seen.entries()) {
          let K = z[1];
          if (Q === z[0]) {
            W(z);
            continue;
          }
          if (Y.external) {
            let U = Y.external.registry.get(z[0])?.id;
            if (Q !== z[0] && U) {
              W(z);
              continue;
            }
          }
          if (this.metadataRegistry.get(z[0])?.id) {
            W(z);
            continue;
          }
          if (K.cycle) {
            if (Y.cycles === "throw") throw Error(`Cycle detected: #/${K.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
            else if (Y.cycles === "ref") W(z);
            continue;
          }
          if (K.count > 1) {
            if (Y.reused === "ref") {
              W(z);
              continue;
            }
          }
        }
        let G = (z, K) => {
          let q = this.seen.get(z), U = q.def ?? q.schema, V = { ...U };
          if (q.ref === null) return;
          let L = q.ref;
          if (q.ref = null, L) {
            G(L, K);
            let F = this.seen.get(L).schema;
            if (F.$ref && K.target === "draft-7") U.allOf = U.allOf ?? [], U.allOf.push(F);
            else Object.assign(U, F), Object.assign(U, V);
          }
          if (!q.isParent) this.override({ zodSchema: z, jsonSchema: U, path: q.path ?? [] });
        };
        for (let z of [...this.seen.entries()].reverse()) G(z[0], { target: this.target });
        let H = {};
        if (this.target === "draft-2020-12") H.$schema = "https://json-schema.org/draft/2020-12/schema";
        else if (this.target === "draft-7") H.$schema = "http://json-schema.org/draft-07/schema#";
        else console.warn(`Invalid target: ${this.target}`);
        Object.assign(H, $.def);
        let B = Y.external?.defs ?? {};
        for (let z of this.seen.entries()) {
          let K = z[1];
          if (K.def && K.defId) B[K.defId] = K.def;
        }
        if (!Y.external && Object.keys(B).length > 0) if (this.target === "draft-2020-12") H.$defs = B;
        else H.definitions = B;
        try {
          return JSON.parse(JSON.stringify(H));
        } catch (z) {
          throw Error("Error converting schema to JSON.");
        }
      }
    };
    iF = D("ZodMiniType", (Q, X) => {
      if (!Q._zod) throw Error("Uninitialized schema in ZodMiniType.");
      e.init(Q, X), Q.def = X, Q.parse = (Y, $) => WX(Q, Y, $, { callee: Q.parse }), Q.safeParse = (Y, $) => N6(Q, Y, $), Q.parseAsync = async (Y, $) => HX(Q, Y, $, { callee: Q.parseAsync }), Q.safeParseAsync = async (Y, $) => D6(Q, Y, $), Q.check = (...Y) => {
        return Q.clone({ ...X, checks: [...X.checks ?? [], ...Y.map(($) => typeof $ === "function" ? { _zod: { check: $, def: { check: "custom" }, onattach: [] } } : $)] });
      }, Q.clone = (Y, $) => p0(Q, Y, $), Q.brand = () => Q, Q.register = (Y, $) => {
        return Y.add(Q, $), Q;
      };
    });
    nF = D("ZodMiniObject", (Q, X) => {
      G8.init(Q, X), iF.init(Q, X), i.defineLazy(Q, "shape", () => X.shape);
    });
    X4 = {};
    _Q(X4, { time: () => oY, duration: () => rY, datetime: () => iY, date: () => nY, ZodISOTime: () => EW, ZodISODuration: () => PW, ZodISODateTime: () => IW, ZodISODate: () => bW });
    IW = D("ZodISODateTime", (Q, X) => {
      KW.init(Q, X), B0.init(Q, X);
    });
    bW = D("ZodISODate", (Q, X) => {
      VW.init(Q, X), B0.init(Q, X);
    });
    EW = D("ZodISOTime", (Q, X) => {
      qW.init(Q, X), B0.init(Q, X);
    });
    PW = D("ZodISODuration", (Q, X) => {
      UW.init(Q, X), B0.init(Q, X);
    });
    ZW = (Q, X) => {
      Y8.init(Q, X), Q.name = "ZodError", Object.defineProperties(Q, { format: { value: (Y) => $X(Q, Y) }, flatten: { value: (Y) => YX(Q, Y) }, addIssue: { value: (Y) => Q.issues.push(Y) }, addIssues: { value: (Y) => Q.issues.push(...Y) }, isEmpty: { get() {
        return Q.issues.length === 0;
      } } });
    };
    aC = D("ZodError", ZW);
    Y4 = D("ZodError", ZW, { Parent: Error });
    SW = JX(Y4);
    CW = GX(Y4);
    _W = BX(Y4);
    kW = zX(Y4);
    F0 = D("ZodType", (Q, X) => {
      return e.init(Q, X), Q.def = X, Object.defineProperty(Q, "_def", { value: X }), Q.check = (...Y) => {
        return Q.clone({ ...X, checks: [...X.checks ?? [], ...Y.map(($) => typeof $ === "function" ? { _zod: { check: $, def: { check: "custom" }, onattach: [] } } : $)] });
      }, Q.clone = (Y, $) => p0(Q, Y, $), Q.brand = () => Q, Q.register = (Y, $) => {
        return Y.add(Q, $), Q;
      }, Q.parse = (Y, $) => SW(Q, Y, $, { callee: Q.parse }), Q.safeParse = (Y, $) => _W(Q, Y, $), Q.parseAsync = async (Y, $) => CW(Q, Y, $, { callee: Q.parseAsync }), Q.safeParseAsync = async (Y, $) => kW(Q, Y, $), Q.spa = Q.safeParseAsync, Q.refine = (Y, $) => Q.check(pO(Y, $)), Q.superRefine = (Y) => Q.check(dO(Y)), Q.overwrite = (Y) => Q.check(w6(Y)), Q.optional = () => L0(Q), Q.nullable = () => xW(Q), Q.nullish = () => L0(xW(Q)), Q.nonoptional = (Y) => gO(Q, Y), Q.array = () => n(Q), Q.or = (Y) => G0([Q, Y]), Q.and = (Y) => w8(Q, Y), Q.transform = (Y) => aY(Q, uW(Y)), Q.default = (Y) => TO(Q, Y), Q.prefault = (Y) => yO(Q, Y), Q.catch = (Y) => fO(Q, Y), Q.pipe = (Y) => aY(Q, Y), Q.readonly = () => lO(Q), Q.describe = (Y) => {
        let $ = Q.clone();
        return p1.add($, { description: Y }), $;
      }, Object.defineProperty(Q, "description", { get() {
        return p1.get(Q)?.description;
      }, configurable: true }), Q.meta = (...Y) => {
        if (Y.length === 0) return p1.get(Q);
        let $ = Q.clone();
        return p1.add($, Y[0]), $;
      }, Q.isOptional = () => Q.safeParse(void 0).success, Q.isNullable = () => Q.safeParse(null).success, Q;
    });
    yW = D("_ZodString", (Q, X) => {
      s9.init(Q, X), F0.init(Q, X);
      let Y = Q._zod.bag;
      Q.format = Y.format ?? null, Q.minLength = Y.minimum ?? null, Q.maxLength = Y.maximum ?? null, Q.regex = (...$) => Q.check(_Y(...$)), Q.includes = (...$) => Q.check(TY(...$)), Q.startsWith = (...$) => Q.check(xY(...$)), Q.endsWith = (...$) => Q.check(yY(...$)), Q.min = (...$) => Q.check(H9(...$)), Q.max = (...$) => Q.check(U8(...$)), Q.length = (...$) => Q.check(L8(...$)), Q.nonempty = (...$) => Q.check(H9(1, ...$)), Q.lowercase = ($) => Q.check(kY($)), Q.uppercase = ($) => Q.check(vY($)), Q.trim = () => Q.check(hY()), Q.normalize = (...$) => Q.check(gY(...$)), Q.toLowerCase = () => Q.check(fY()), Q.toUpperCase = () => Q.check(uY());
    });
    YO = D("ZodString", (Q, X) => {
      s9.init(Q, X), yW.init(Q, X), Q.email = (Y) => Q.check(JY($O, Y)), Q.url = (Y) => Q.check(zY(JO, Y)), Q.jwt = (Y) => Q.check(IY(wO, Y)), Q.emoji = (Y) => Q.check(KY(WO, Y)), Q.guid = (Y) => Q.check(z8(vW, Y)), Q.uuid = (Y) => Q.check(WY(D8, Y)), Q.uuidv4 = (Y) => Q.check(GY(D8, Y)), Q.uuidv6 = (Y) => Q.check(HY(D8, Y)), Q.uuidv7 = (Y) => Q.check(BY(D8, Y)), Q.nanoid = (Y) => Q.check(VY(GO, Y)), Q.guid = (Y) => Q.check(z8(vW, Y)), Q.cuid = (Y) => Q.check(qY(HO, Y)), Q.cuid2 = (Y) => Q.check(UY(BO, Y)), Q.ulid = (Y) => Q.check(LY(zO, Y)), Q.base64 = (Y) => Q.check(AY(OO, Y)), Q.base64url = (Y) => Q.check(jY(NO, Y)), Q.xid = (Y) => Q.check(FY(KO, Y)), Q.ksuid = (Y) => Q.check(OY(VO, Y)), Q.ipv4 = (Y) => Q.check(NY(qO, Y)), Q.ipv6 = (Y) => Q.check(DY(UO, Y)), Q.cidrv4 = (Y) => Q.check(wY(LO, Y)), Q.cidrv6 = (Y) => Q.check(MY(FO, Y)), Q.e164 = (Y) => Q.check(RY(DO, Y)), Q.datetime = (Y) => Q.check(iY(Y)), Q.date = (Y) => Q.check(nY(Y)), Q.time = (Y) => Q.check(oY(Y)), Q.duration = (Y) => Q.check(rY(Y));
    });
    B0 = D("ZodStringFormat", (Q, X) => {
      W0.init(Q, X), yW.init(Q, X);
    });
    $O = D("ZodEmail", (Q, X) => {
      DX.init(Q, X), B0.init(Q, X);
    });
    vW = D("ZodGUID", (Q, X) => {
      OX.init(Q, X), B0.init(Q, X);
    });
    D8 = D("ZodUUID", (Q, X) => {
      NX.init(Q, X), B0.init(Q, X);
    });
    JO = D("ZodURL", (Q, X) => {
      wX.init(Q, X), B0.init(Q, X);
    });
    WO = D("ZodEmoji", (Q, X) => {
      MX.init(Q, X), B0.init(Q, X);
    });
    GO = D("ZodNanoID", (Q, X) => {
      AX.init(Q, X), B0.init(Q, X);
    });
    HO = D("ZodCUID", (Q, X) => {
      jX.init(Q, X), B0.init(Q, X);
    });
    BO = D("ZodCUID2", (Q, X) => {
      RX.init(Q, X), B0.init(Q, X);
    });
    zO = D("ZodULID", (Q, X) => {
      IX.init(Q, X), B0.init(Q, X);
    });
    KO = D("ZodXID", (Q, X) => {
      bX.init(Q, X), B0.init(Q, X);
    });
    VO = D("ZodKSUID", (Q, X) => {
      EX.init(Q, X), B0.init(Q, X);
    });
    qO = D("ZodIPv4", (Q, X) => {
      PX.init(Q, X), B0.init(Q, X);
    });
    UO = D("ZodIPv6", (Q, X) => {
      ZX.init(Q, X), B0.init(Q, X);
    });
    LO = D("ZodCIDRv4", (Q, X) => {
      SX.init(Q, X), B0.init(Q, X);
    });
    FO = D("ZodCIDRv6", (Q, X) => {
      CX.init(Q, X), B0.init(Q, X);
    });
    OO = D("ZodBase64", (Q, X) => {
      _X.init(Q, X), B0.init(Q, X);
    });
    NO = D("ZodBase64URL", (Q, X) => {
      kX.init(Q, X), B0.init(Q, X);
    });
    DO = D("ZodE164", (Q, X) => {
      vX.init(Q, X), B0.init(Q, X);
    });
    wO = D("ZodJWT", (Q, X) => {
      TX.init(Q, X), B0.init(Q, X);
    });
    gW = D("ZodNumber", (Q, X) => {
      W8.init(Q, X), F0.init(Q, X), Q.gt = ($, J) => Q.check(V8($, J)), Q.gte = ($, J) => Q.check(Q4($, J)), Q.min = ($, J) => Q.check(Q4($, J)), Q.lt = ($, J) => Q.check(K8($, J)), Q.lte = ($, J) => Q.check(e9($, J)), Q.max = ($, J) => Q.check(e9($, J)), Q.int = ($) => Q.check(TW($)), Q.safe = ($) => Q.check(TW($)), Q.positive = ($) => Q.check(V8(0, $)), Q.nonnegative = ($) => Q.check(Q4(0, $)), Q.negative = ($) => Q.check(K8(0, $)), Q.nonpositive = ($) => Q.check(e9(0, $)), Q.multipleOf = ($, J) => Q.check(q8($, J)), Q.step = ($, J) => Q.check(q8($, J)), Q.finite = () => Q;
      let Y = Q._zod.bag;
      Q.minValue = Math.max(Y.minimum ?? Number.NEGATIVE_INFINITY, Y.exclusiveMinimum ?? Number.NEGATIVE_INFINITY) ?? null, Q.maxValue = Math.min(Y.maximum ?? Number.POSITIVE_INFINITY, Y.exclusiveMaximum ?? Number.POSITIVE_INFINITY) ?? null, Q.isInt = (Y.format ?? "").includes("int") || Number.isSafeInteger(Y.multipleOf ?? 0.5), Q.isFinite = true, Q.format = Y.format ?? null;
    });
    MO = D("ZodNumberFormat", (Q, X) => {
      xX.init(Q, X), gW.init(Q, X);
    });
    AO = D("ZodBoolean", (Q, X) => {
      yX.init(Q, X), F0.init(Q, X);
    });
    jO = D("ZodNull", (Q, X) => {
      gX.init(Q, X), F0.init(Q, X);
    });
    RO = D("ZodUnknown", (Q, X) => {
      hX.init(Q, X), F0.init(Q, X);
    });
    IO = D("ZodNever", (Q, X) => {
      fX.init(Q, X), F0.init(Q, X);
    });
    EO = D("ZodArray", (Q, X) => {
      uX.init(Q, X), F0.init(Q, X), Q.element = X.element, Q.min = (Y, $) => Q.check(H9(Y, $)), Q.nonempty = (Y) => Q.check(H9(1, Y)), Q.max = (Y, $) => Q.check(U8(Y, $)), Q.length = (Y, $) => Q.check(L8(Y, $)), Q.unwrap = () => Q.element;
    });
    hW = D("ZodObject", (Q, X) => {
      G8.init(Q, X), F0.init(Q, X), i.defineLazy(Q, "shape", () => X.shape), Q.keyof = () => y0(Object.keys(Q._zod.def.shape)), Q.catchall = (Y) => Q.clone({ ...Q._zod.def, catchall: Y }), Q.passthrough = () => Q.clone({ ...Q._zod.def, catchall: z0() }), Q.loose = () => Q.clone({ ...Q._zod.def, catchall: z0() }), Q.strict = () => Q.clone({ ...Q._zod.def, catchall: bO() }), Q.strip = () => Q.clone({ ...Q._zod.def, catchall: void 0 }), Q.extend = (Y) => {
        return i.extend(Q, Y);
      }, Q.merge = (Y) => i.merge(Q, Y), Q.pick = (Y) => i.pick(Q, Y), Q.omit = (Y) => i.omit(Q, Y), Q.partial = (...Y) => i.partial(mW, Q, Y[0]), Q.required = (...Y) => i.required(lW, Q, Y[0]);
    });
    fW = D("ZodUnion", (Q, X) => {
      H8.init(Q, X), F0.init(Q, X), Q.options = X.options;
    });
    PO = D("ZodDiscriminatedUnion", (Q, X) => {
      fW.init(Q, X), mX.init(Q, X);
    });
    ZO = D("ZodIntersection", (Q, X) => {
      lX.init(Q, X), F0.init(Q, X);
    });
    SO = D("ZodRecord", (Q, X) => {
      cX.init(Q, X), F0.init(Q, X), Q.keyType = X.keyType, Q.valueType = X.valueType;
    });
    tY = D("ZodEnum", (Q, X) => {
      pX.init(Q, X), F0.init(Q, X), Q.enum = X.entries, Q.options = Object.values(X.entries);
      let Y = new Set(Object.keys(X.entries));
      Q.extract = ($, J) => {
        let W = {};
        for (let G of $) if (Y.has(G)) W[G] = X.entries[G];
        else throw Error(`Key ${G} not found in enum`);
        return new tY({ ...X, checks: [], ...i.normalizeParams(J), entries: W });
      }, Q.exclude = ($, J) => {
        let W = { ...X.entries };
        for (let G of $) if (Y.has(G)) delete W[G];
        else throw Error(`Key ${G} not found in enum`);
        return new tY({ ...X, checks: [], ...i.normalizeParams(J), entries: W });
      };
    });
    CO = D("ZodLiteral", (Q, X) => {
      dX.init(Q, X), F0.init(Q, X), Q.values = new Set(X.values), Object.defineProperty(Q, "value", { get() {
        if (X.values.length > 1) throw Error("This schema contains multiple valid literal values. Use `.values` instead.");
        return X.values[0];
      } });
    });
    _O = D("ZodTransform", (Q, X) => {
      iX.init(Q, X), F0.init(Q, X), Q._zod.parse = (Y, $) => {
        Y.addIssue = (W) => {
          if (typeof W === "string") Y.issues.push(i.issue(W, Y.value, X));
          else {
            let G = W;
            if (G.fatal) G.continue = false;
            G.code ?? (G.code = "custom"), G.input ?? (G.input = Y.value), G.inst ?? (G.inst = Q), G.continue ?? (G.continue = true), Y.issues.push(i.issue(G));
          }
        };
        let J = X.transform(Y.value, Y);
        if (J instanceof Promise) return J.then((W) => {
          return Y.value = W, Y;
        });
        return Y.value = J, Y;
      };
    });
    mW = D("ZodOptional", (Q, X) => {
      nX.init(Q, X), F0.init(Q, X), Q.unwrap = () => Q._zod.def.innerType;
    });
    kO = D("ZodNullable", (Q, X) => {
      oX.init(Q, X), F0.init(Q, X), Q.unwrap = () => Q._zod.def.innerType;
    });
    vO = D("ZodDefault", (Q, X) => {
      rX.init(Q, X), F0.init(Q, X), Q.unwrap = () => Q._zod.def.innerType, Q.removeDefault = Q.unwrap;
    });
    xO = D("ZodPrefault", (Q, X) => {
      tX.init(Q, X), F0.init(Q, X), Q.unwrap = () => Q._zod.def.innerType;
    });
    lW = D("ZodNonOptional", (Q, X) => {
      aX.init(Q, X), F0.init(Q, X), Q.unwrap = () => Q._zod.def.innerType;
    });
    hO = D("ZodCatch", (Q, X) => {
      sX.init(Q, X), F0.init(Q, X), Q.unwrap = () => Q._zod.def.innerType, Q.removeCatch = Q.unwrap;
    });
    uO = D("ZodPipe", (Q, X) => {
      eX.init(Q, X), F0.init(Q, X), Q.in = X.in, Q.out = X.out;
    });
    mO = D("ZodReadonly", (Q, X) => {
      QY.init(Q, X), F0.init(Q, X);
    });
    cW = D("ZodCustom", (Q, X) => {
      XY.init(Q, X), F0.init(Q, X);
    });
    c0(YY());
    X$ = "2025-11-25";
    dW = [X$, "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07"];
    n1 = "io.modelcontextprotocol/related-task";
    A8 = "2.0";
    R0 = pW((Q) => Q !== null && (typeof Q === "object" || typeof Q === "function"));
    iW = G0([O(), s().int()]);
    nW = O();
    V_ = _0({ ttl: G0([s(), sY()]).optional(), pollInterval: s().optional() });
    iO = P({ ttl: s().optional() });
    nO = P({ taskId: O() });
    Y$ = _0({ progressToken: iW.optional(), [n1]: nO.optional() });
    d0 = P({ _meta: Y$.optional() });
    $4 = d0.extend({ task: iO.optional() });
    oW = (Q) => $4.safeParse(Q).success;
    I0 = P({ method: O(), params: d0.loose().optional() });
    o0 = P({ _meta: Y$.optional() });
    r0 = P({ method: O(), params: o0.loose().optional() });
    b0 = _0({ _meta: Y$.optional() });
    j8 = G0([O(), s().int()]);
    rW = P({ jsonrpc: k(A8), id: j8, ...I0.shape }).strict();
    $$ = (Q) => rW.safeParse(Q).success;
    tW = P({ jsonrpc: k(A8), ...r0.shape }).strict();
    aW = (Q) => tW.safeParse(Q).success;
    J$ = P({ jsonrpc: k(A8), id: j8, result: b0 }).strict();
    J4 = (Q) => J$.safeParse(Q).success;
    (function(Q) {
      Q[Q.ConnectionClosed = -32e3] = "ConnectionClosed", Q[Q.RequestTimeout = -32001] = "RequestTimeout", Q[Q.ParseError = -32700] = "ParseError", Q[Q.InvalidRequest = -32600] = "InvalidRequest", Q[Q.MethodNotFound = -32601] = "MethodNotFound", Q[Q.InvalidParams = -32602] = "InvalidParams", Q[Q.InternalError = -32603] = "InternalError", Q[Q.UrlElicitationRequired = -32042] = "UrlElicitationRequired";
    })(T || (T = {}));
    W$ = P({ jsonrpc: k(A8), id: j8.optional(), error: P({ code: s().int(), message: O(), data: z0().optional() }) }).strict();
    sW = (Q) => W$.safeParse(Q).success;
    q_ = G0([rW, tW, J$, W$]);
    U_ = G0([J$, W$]);
    R8 = b0.strict();
    oO = o0.extend({ requestId: j8.optional(), reason: O().optional() });
    I8 = r0.extend({ method: k("notifications/cancelled"), params: oO });
    rO = P({ src: O(), mimeType: O().optional(), sizes: n(O()).optional(), theme: y0(["light", "dark"]).optional() });
    W4 = P({ icons: n(rO).optional() });
    z9 = P({ name: O(), title: O().optional() });
    eW = z9.extend({ ...z9.shape, ...W4.shape, version: O(), websiteUrl: O().optional(), description: O().optional() });
    tO = w8(P({ applyDefaults: M0().optional() }), K0(O(), z0()));
    aO = Q$((Q) => {
      if (Q && typeof Q === "object" && !Array.isArray(Q)) {
        if (Object.keys(Q).length === 0) return { form: {} };
      }
      return Q;
    }, w8(P({ form: tO.optional(), url: R0.optional() }), K0(O(), z0()).optional()));
    sO = _0({ list: R0.optional(), cancel: R0.optional(), requests: _0({ sampling: _0({ createMessage: R0.optional() }).optional(), elicitation: _0({ create: R0.optional() }).optional() }).optional() });
    eO = _0({ list: R0.optional(), cancel: R0.optional(), requests: _0({ tools: _0({ call: R0.optional() }).optional() }).optional() });
    QN = P({ experimental: K0(O(), R0).optional(), sampling: P({ context: R0.optional(), tools: R0.optional() }).optional(), elicitation: aO.optional(), roots: P({ listChanged: M0().optional() }).optional(), tasks: sO.optional() });
    XN = d0.extend({ protocolVersion: O(), capabilities: QN, clientInfo: eW });
    G$ = I0.extend({ method: k("initialize"), params: XN });
    YN = P({ experimental: K0(O(), R0).optional(), logging: R0.optional(), completions: R0.optional(), prompts: P({ listChanged: M0().optional() }).optional(), resources: P({ subscribe: M0().optional(), listChanged: M0().optional() }).optional(), tools: P({ listChanged: M0().optional() }).optional(), tasks: eO.optional() });
    $N = b0.extend({ protocolVersion: O(), capabilities: YN, serverInfo: eW, instructions: O().optional() });
    H$ = r0.extend({ method: k("notifications/initialized"), params: o0.optional() });
    b8 = I0.extend({ method: k("ping"), params: d0.optional() });
    JN = P({ progress: s(), total: L0(s()), message: L0(O()) });
    WN = P({ ...o0.shape, ...JN.shape, progressToken: iW });
    E8 = r0.extend({ method: k("notifications/progress"), params: WN });
    GN = d0.extend({ cursor: nW.optional() });
    G4 = I0.extend({ params: GN.optional() });
    H4 = b0.extend({ nextCursor: nW.optional() });
    HN = y0(["working", "input_required", "completed", "failed", "cancelled"]);
    B4 = P({ taskId: O(), status: HN, ttl: G0([s(), sY()]), createdAt: O(), lastUpdatedAt: O(), pollInterval: L0(s()), statusMessage: L0(O()) });
    K9 = b0.extend({ task: B4 });
    BN = o0.merge(B4);
    z4 = r0.extend({ method: k("notifications/tasks/status"), params: BN });
    P8 = I0.extend({ method: k("tasks/get"), params: d0.extend({ taskId: O() }) });
    Z8 = b0.merge(B4);
    S8 = I0.extend({ method: k("tasks/result"), params: d0.extend({ taskId: O() }) });
    L_ = b0.loose();
    C8 = G4.extend({ method: k("tasks/list") });
    _8 = H4.extend({ tasks: n(B4) });
    k8 = I0.extend({ method: k("tasks/cancel"), params: d0.extend({ taskId: O() }) });
    QG = b0.merge(B4);
    XG = P({ uri: O(), mimeType: L0(O()), _meta: K0(O(), z0()).optional() });
    YG = XG.extend({ text: O() });
    B$ = O().refine((Q) => {
      try {
        return atob(Q), true;
      } catch {
        return false;
      }
    }, { message: "Invalid Base64 string" });
    $G = XG.extend({ blob: B$ });
    K4 = y0(["user", "assistant"]);
    V9 = P({ audience: n(K4).optional(), priority: s().min(0).max(1).optional(), lastModified: X4.datetime({ offset: true }).optional() });
    JG = P({ ...z9.shape, ...W4.shape, uri: O(), description: L0(O()), mimeType: L0(O()), annotations: V9.optional(), _meta: L0(_0({})) });
    zN = P({ ...z9.shape, ...W4.shape, uriTemplate: O(), description: L0(O()), mimeType: L0(O()), annotations: V9.optional(), _meta: L0(_0({})) });
    v8 = G4.extend({ method: k("resources/list") });
    KN = H4.extend({ resources: n(JG) });
    T8 = G4.extend({ method: k("resources/templates/list") });
    VN = H4.extend({ resourceTemplates: n(zN) });
    z$ = d0.extend({ uri: O() });
    qN = z$;
    x8 = I0.extend({ method: k("resources/read"), params: qN });
    UN = b0.extend({ contents: n(G0([YG, $G])) });
    LN = r0.extend({ method: k("notifications/resources/list_changed"), params: o0.optional() });
    FN = z$;
    ON = I0.extend({ method: k("resources/subscribe"), params: FN });
    NN = z$;
    DN = I0.extend({ method: k("resources/unsubscribe"), params: NN });
    wN = o0.extend({ uri: O() });
    MN = r0.extend({ method: k("notifications/resources/updated"), params: wN });
    AN = P({ name: O(), description: L0(O()), required: L0(M0()) });
    jN = P({ ...z9.shape, ...W4.shape, description: L0(O()), arguments: L0(n(AN)), _meta: L0(_0({})) });
    y8 = G4.extend({ method: k("prompts/list") });
    RN = H4.extend({ prompts: n(jN) });
    IN = d0.extend({ name: O(), arguments: K0(O(), O()).optional() });
    g8 = I0.extend({ method: k("prompts/get"), params: IN });
    K$ = P({ type: k("text"), text: O(), annotations: V9.optional(), _meta: K0(O(), z0()).optional() });
    V$ = P({ type: k("image"), data: B$, mimeType: O(), annotations: V9.optional(), _meta: K0(O(), z0()).optional() });
    q$ = P({ type: k("audio"), data: B$, mimeType: O(), annotations: V9.optional(), _meta: K0(O(), z0()).optional() });
    bN = P({ type: k("tool_use"), name: O(), id: O(), input: K0(O(), z0()), _meta: K0(O(), z0()).optional() });
    EN = P({ type: k("resource"), resource: G0([YG, $G]), annotations: V9.optional(), _meta: K0(O(), z0()).optional() });
    PN = JG.extend({ type: k("resource_link") });
    U$ = G0([K$, V$, q$, PN, EN]);
    ZN = P({ role: K4, content: U$ });
    SN = b0.extend({ description: O().optional(), messages: n(ZN) });
    CN = r0.extend({ method: k("notifications/prompts/list_changed"), params: o0.optional() });
    _N = P({ title: O().optional(), readOnlyHint: M0().optional(), destructiveHint: M0().optional(), idempotentHint: M0().optional(), openWorldHint: M0().optional() });
    kN = P({ taskSupport: y0(["required", "optional", "forbidden"]).optional() });
    WG = P({ ...z9.shape, ...W4.shape, description: O().optional(), inputSchema: P({ type: k("object"), properties: K0(O(), R0).optional(), required: n(O()).optional() }).catchall(z0()), outputSchema: P({ type: k("object"), properties: K0(O(), R0).optional(), required: n(O()).optional() }).catchall(z0()).optional(), annotations: _N.optional(), execution: kN.optional(), _meta: K0(O(), z0()).optional() });
    h8 = G4.extend({ method: k("tools/list") });
    vN = H4.extend({ tools: n(WG) });
    f8 = b0.extend({ content: n(U$).default([]), structuredContent: K0(O(), z0()).optional(), isError: M0().optional() });
    F_ = f8.or(b0.extend({ toolResult: z0() }));
    TN = $4.extend({ name: O(), arguments: K0(O(), z0()).optional() });
    q9 = I0.extend({ method: k("tools/call"), params: TN });
    xN = r0.extend({ method: k("notifications/tools/list_changed"), params: o0.optional() });
    O_ = P({ autoRefresh: M0().default(true), debounceMs: s().int().nonnegative().default(300) });
    V4 = y0(["debug", "info", "notice", "warning", "error", "critical", "alert", "emergency"]);
    yN = d0.extend({ level: V4 });
    L$ = I0.extend({ method: k("logging/setLevel"), params: yN });
    gN = o0.extend({ level: V4, logger: O().optional(), data: z0() });
    hN = r0.extend({ method: k("notifications/message"), params: gN });
    fN = P({ name: O().optional() });
    uN = P({ hints: n(fN).optional(), costPriority: s().min(0).max(1).optional(), speedPriority: s().min(0).max(1).optional(), intelligencePriority: s().min(0).max(1).optional() });
    mN = P({ mode: y0(["auto", "required", "none"]).optional() });
    lN = P({ type: k("tool_result"), toolUseId: O().describe("The unique identifier for the corresponding tool call."), content: n(U$).default([]), structuredContent: P({}).loose().optional(), isError: M0().optional(), _meta: K0(O(), z0()).optional() });
    cN = eY("type", [K$, V$, q$]);
    M8 = eY("type", [K$, V$, q$, bN, lN]);
    pN = P({ role: K4, content: G0([M8, n(M8)]), _meta: K0(O(), z0()).optional() });
    dN = $4.extend({ messages: n(pN), modelPreferences: uN.optional(), systemPrompt: O().optional(), includeContext: y0(["none", "thisServer", "allServers"]).optional(), temperature: s().optional(), maxTokens: s().int(), stopSequences: n(O()).optional(), metadata: R0.optional(), tools: n(WG).optional(), toolChoice: mN.optional() });
    iN = I0.extend({ method: k("sampling/createMessage"), params: dN });
    q4 = b0.extend({ model: O(), stopReason: L0(y0(["endTurn", "stopSequence", "maxTokens"]).or(O())), role: K4, content: cN });
    F$ = b0.extend({ model: O(), stopReason: L0(y0(["endTurn", "stopSequence", "maxTokens", "toolUse"]).or(O())), role: K4, content: G0([M8, n(M8)]) });
    nN = P({ type: k("boolean"), title: O().optional(), description: O().optional(), default: M0().optional() });
    oN = P({ type: k("string"), title: O().optional(), description: O().optional(), minLength: s().optional(), maxLength: s().optional(), format: y0(["email", "uri", "date", "date-time"]).optional(), default: O().optional() });
    rN = P({ type: y0(["number", "integer"]), title: O().optional(), description: O().optional(), minimum: s().optional(), maximum: s().optional(), default: s().optional() });
    tN = P({ type: k("string"), title: O().optional(), description: O().optional(), enum: n(O()), default: O().optional() });
    aN = P({ type: k("string"), title: O().optional(), description: O().optional(), oneOf: n(P({ const: O(), title: O() })), default: O().optional() });
    sN = P({ type: k("string"), title: O().optional(), description: O().optional(), enum: n(O()), enumNames: n(O()).optional(), default: O().optional() });
    eN = G0([tN, aN]);
    QD = P({ type: k("array"), title: O().optional(), description: O().optional(), minItems: s().optional(), maxItems: s().optional(), items: P({ type: k("string"), enum: n(O()) }), default: n(O()).optional() });
    XD = P({ type: k("array"), title: O().optional(), description: O().optional(), minItems: s().optional(), maxItems: s().optional(), items: P({ anyOf: n(P({ const: O(), title: O() })) }), default: n(O()).optional() });
    YD = G0([QD, XD]);
    $D = G0([sN, eN, YD]);
    JD = G0([$D, nN, oN, rN]);
    WD = $4.extend({ mode: k("form").optional(), message: O(), requestedSchema: P({ type: k("object"), properties: K0(O(), JD), required: n(O()).optional() }) });
    GD = $4.extend({ mode: k("url"), message: O(), elicitationId: O(), url: O().url() });
    HD = G0([WD, GD]);
    BD = I0.extend({ method: k("elicitation/create"), params: HD });
    zD = o0.extend({ elicitationId: O() });
    KD = r0.extend({ method: k("notifications/elicitation/complete"), params: zD });
    U9 = b0.extend({ action: y0(["accept", "decline", "cancel"]), content: Q$((Q) => Q === null ? void 0 : Q, K0(O(), G0([O(), s(), M0(), n(O())])).optional()) });
    VD = P({ type: k("ref/resource"), uri: O() });
    qD = P({ type: k("ref/prompt"), name: O() });
    UD = d0.extend({ ref: G0([qD, VD]), argument: P({ name: O(), value: O() }), context: P({ arguments: K0(O(), O()).optional() }).optional() });
    u8 = I0.extend({ method: k("completion/complete"), params: UD });
    LD = b0.extend({ completion: _0({ values: n(O()).max(100), total: L0(s().int()), hasMore: L0(M0()) }) });
    FD = P({ uri: O().startsWith("file://"), name: O().optional(), _meta: K0(O(), z0()).optional() });
    OD = I0.extend({ method: k("roots/list"), params: d0.optional() });
    O$ = b0.extend({ roots: n(FD) });
    ND = r0.extend({ method: k("notifications/roots/list_changed"), params: o0.optional() });
    N_ = G0([b8, G$, u8, L$, g8, y8, v8, T8, x8, ON, DN, q9, h8, P8, S8, C8, k8]);
    D_ = G0([I8, E8, H$, ND, z4]);
    w_ = G0([R8, q4, F$, U9, O$, Z8, _8, K9]);
    M_ = G0([b8, iN, BD, OD, P8, S8, C8, k8]);
    A_ = G0([I8, E8, hN, MN, LN, xN, CN, z4, KD]);
    j_ = G0([R8, $N, LD, SN, RN, KN, VN, UN, f8, vN, Z8, _8, K9]);
    _ = class __ extends Error {
      constructor(Q, X, Y) {
        super(`MCP error ${Q}: ${X}`);
        this.code = Q, this.data = Y, this.name = "McpError";
      }
      static fromError(Q, X, Y) {
        if (Q === T.UrlElicitationRequired && Y) {
          let $ = Y;
          if ($.elicitations) return new BG($.elicitations, X);
        }
        return new __(Q, X, Y);
      }
    };
    BG = class extends _ {
      constructor(Q, X = `URL elicitation${Q.length > 1 ? "s" : ""} required`) {
        super(T.UrlElicitationRequired, X, { elicitations: Q });
      }
      get elicitations() {
        return this.data?.elicitations ?? [];
      }
    };
    KG = Symbol("Let zodToJsonSchema decide on which parser to use");
    zG = { name: void 0, $refStrategy: "root", basePath: ["#"], effectStrategy: "input", pipeStrategy: "all", dateStrategy: "format:date-time", mapStrategy: "entries", removeAdditionalStrategy: "passthrough", allowedAdditionalProperties: true, rejectedAdditionalProperties: false, definitionPath: "definitions", target: "jsonSchema7", strictUnions: false, definitions: {}, errorMessages: false, markdownDescription: false, patternStrategy: "escape", applyRegexFlags: false, emailStrategy: "format:email", base64Strategy: "contentEncoding:base64", nameStrategy: "ref", openAiAnyTypeName: "OpenAiAnyType" };
    VG = (Q) => typeof Q === "string" ? { ...zG, name: Q } : { ...zG, ...Q };
    qG = (Q) => {
      let X = VG(Q), Y = X.name !== void 0 ? [...X.basePath, X.definitionPath, X.name] : X.basePath;
      return { ...X, flags: { hasReferencedOpenAiAnyType: false }, currentPath: Y, propertyPath: void 0, seen: new Map(Object.entries(X.definitions).map(([$, J]) => [J._def, { def: J._def, path: [...X.basePath, X.definitionPath, $], jsonSchema: void 0 }])) };
    };
    m8 = (Q, X) => {
      let Y = 0;
      for (; Y < Q.length && Y < X.length; Y++) if (Q[Y] !== X[Y]) break;
      return [(Q.length - Y).toString(), ...X.slice(Y)].join("/");
    };
    OG = (Q, X) => {
      return g(Q.innerType._def, X);
    };
    DD = (Q, X) => {
      let Y = { type: "integer", format: "unix-time" };
      if (X.target === "openApi3") return Y;
      for (let $ of Q.checks) switch ($.kind) {
        case "min":
          o(Y, "minimum", $.value, $.message, X);
          break;
        case "max":
          o(Y, "maximum", $.value, $.message, X);
          break;
      }
      return Y;
    };
    wD = (Q) => {
      if ("type" in Q && Q.type === "string") return false;
      return "allOf" in Q;
    };
    w$ = void 0;
    $1 = { cuid: /^[cC][^\s-]{8,}$/, cuid2: /^[0-9a-z]+$/, ulid: /^[0-9A-HJKMNP-TV-Z]{26}$/, email: /^(?!\.)(?!.*\.\.)([a-zA-Z0-9_'+\-\.]*)[a-zA-Z0-9_+-]@([a-zA-Z0-9][a-zA-Z0-9\-]*\.)+[a-zA-Z]{2,}$/, emoji: () => {
      if (w$ === void 0) w$ = RegExp("^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$", "u");
      return w$;
    }, uuid: /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/, ipv4: /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/, ipv4Cidr: /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/, ipv6: /^(([a-f0-9]{1,4}:){7}|::([a-f0-9]{1,4}:){0,6}|([a-f0-9]{1,4}:){1}:([a-f0-9]{1,4}:){0,5}|([a-f0-9]{1,4}:){2}:([a-f0-9]{1,4}:){0,4}|([a-f0-9]{1,4}:){3}:([a-f0-9]{1,4}:){0,3}|([a-f0-9]{1,4}:){4}:([a-f0-9]{1,4}:){0,2}|([a-f0-9]{1,4}:){5}:([a-f0-9]{1,4}:){0,1})([a-f0-9]{1,4}|(((25[0-5])|(2[0-4][0-9])|(1[0-9]{2})|([0-9]{1,2}))\.){3}((25[0-5])|(2[0-4][0-9])|(1[0-9]{2})|([0-9]{1,2})))$/, ipv6Cidr: /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/, base64: /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/, base64url: /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/, nanoid: /^[a-zA-Z0-9_-]{21}$/, jwt: /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/ };
    MD = new Set("ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvxyz0123456789");
    U4 = { ZodString: "string", ZodNumber: "number", ZodBigInt: "integer", ZodBoolean: "boolean", ZodNull: "null" };
    PG = (Q, X) => {
      let Y = (Q.options instanceof Map ? Array.from(Q.options.values()) : Q.options).map(($, J) => g($._def, { ...X, currentPath: [...X.currentPath, "anyOf", `${J}`] })).filter(($) => !!$ && (!X.strictUnions || typeof $ === "object" && Object.keys($).length > 0));
      return Y.length ? { anyOf: Y } : void 0;
    };
    kG = (Q, X) => {
      if (X.currentPath.toString() === X.propertyPath?.toString()) return g(Q.innerType._def, X);
      let Y = g(Q.innerType._def, { ...X, currentPath: [...X.currentPath, "anyOf", "1"] });
      return Y ? { anyOf: [{ not: V0(X) }, Y] } : V0(X);
    };
    vG = (Q, X) => {
      if (X.pipeStrategy === "input") return g(Q.in._def, X);
      else if (X.pipeStrategy === "output") return g(Q.out._def, X);
      let Y = g(Q.in._def, { ...X, currentPath: [...X.currentPath, "allOf", "0"] }), $ = g(Q.out._def, { ...X, currentPath: [...X.currentPath, "allOf", Y ? "1" : "0"] });
      return { allOf: [Y, $].filter((J) => J !== void 0) };
    };
    fG = (Q, X) => {
      return g(Q.innerType._def, X);
    };
    uG = (Q, X, Y) => {
      switch (X) {
        case A.ZodString:
          return c8(Q, Y);
        case A.ZodNumber:
          return CG(Q, Y);
        case A.ZodObject:
          return _G(Q, Y);
        case A.ZodBigInt:
          return LG(Q, Y);
        case A.ZodBoolean:
          return FG();
        case A.ZodDate:
          return D$(Q, Y);
        case A.ZodUndefined:
          return gG(Y);
        case A.ZodNull:
          return EG(Y);
        case A.ZodArray:
          return UG(Q, Y);
        case A.ZodUnion:
        case A.ZodDiscriminatedUnion:
          return ZG(Q, Y);
        case A.ZodIntersection:
          return MG(Q, Y);
        case A.ZodTuple:
          return yG(Q, Y);
        case A.ZodRecord:
          return p8(Q, Y);
        case A.ZodLiteral:
          return AG(Q, Y);
        case A.ZodEnum:
          return wG(Q);
        case A.ZodNativeEnum:
          return IG(Q);
        case A.ZodNullable:
          return SG(Q, Y);
        case A.ZodOptional:
          return kG(Q, Y);
        case A.ZodMap:
          return RG(Q, Y);
        case A.ZodSet:
          return xG(Q, Y);
        case A.ZodLazy:
          return () => Q.getter()._def;
        case A.ZodPromise:
          return TG(Q, Y);
        case A.ZodNaN:
        case A.ZodNever:
          return bG(Y);
        case A.ZodEffects:
          return DG(Q, Y);
        case A.ZodAny:
          return V0(Y);
        case A.ZodUnknown:
          return hG(Y);
        case A.ZodDefault:
          return NG(Q, Y);
        case A.ZodBranded:
          return l8(Q, Y);
        case A.ZodReadonly:
          return fG(Q, Y);
        case A.ZodCatch:
          return OG(Q, Y);
        case A.ZodPipeline:
          return vG(Q, Y);
        case A.ZodFunction:
        case A.ZodVoid:
        case A.ZodSymbol:
          return;
        default:
          return /* @__PURE__ */ (($) => {
            return;
          })(X);
      }
    };
    ID = (Q, X) => {
      switch (X.$refStrategy) {
        case "root":
          return { $ref: Q.path.join("/") };
        case "relative":
          return { $ref: m8(X.currentPath, Q.path) };
        case "none":
        case "seen": {
          if (Q.path.length < X.currentPath.length && Q.path.every((Y, $) => X.currentPath[$] === Y)) return console.warn(`Recursive reference detected at ${X.currentPath.join("/")}! Defaulting to any`), V0(X);
          return X.$refStrategy === "seen" ? V0(X) : void 0;
        }
      }
    };
    bD = (Q, X, Y) => {
      if (Q.description) {
        if (Y.description = Q.description, X.markdownDescription) Y.markdownDescription = Q.description;
      }
      return Y;
    };
    A$ = (Q, X) => {
      let Y = qG(X), $ = typeof X === "object" && X.definitions ? Object.entries(X.definitions).reduce((B, [z, K]) => ({ ...B, [z]: g(K._def, { ...Y, currentPath: [...Y.basePath, Y.definitionPath, z] }, true) ?? V0(Y) }), {}) : void 0, J = typeof X === "string" ? X : X?.nameStrategy === "title" ? void 0 : X?.name, W = g(Q._def, J === void 0 ? Y : { ...Y, currentPath: [...Y.basePath, Y.definitionPath, J] }, false) ?? V0(Y), G = typeof X === "object" && X.name !== void 0 && X.nameStrategy === "title" ? X.name : void 0;
      if (G !== void 0) W.title = G;
      if (Y.flags.hasReferencedOpenAiAnyType) {
        if (!$) $ = {};
        if (!$[Y.openAiAnyTypeName]) $[Y.openAiAnyTypeName] = { type: ["string", "number", "integer", "boolean", "array", "null"], items: { $ref: Y.$refStrategy === "relative" ? "1" : [...Y.basePath, Y.definitionPath, Y.openAiAnyTypeName].join("/") } };
      }
      let H = J === void 0 ? $ ? { ...W, [Y.definitionPath]: $ } : W : { $ref: [...Y.$refStrategy === "relative" ? [] : Y.basePath, Y.definitionPath, J].join("/"), [Y.definitionPath]: { ...$, [J]: W } };
      if (Y.target === "jsonSchema7") H.$schema = "http://json-schema.org/draft-07/schema#";
      else if (Y.target === "jsonSchema2019-09" || Y.target === "openAi") H.$schema = "https://json-schema.org/draft/2019-09/schema#";
      if (Y.target === "openAi" && ("anyOf" in H || "oneOf" in H || "allOf" in H || "type" in H && Array.isArray(H.type))) console.warn("Warning: OpenAI may not support schemas with unions as roots! Try wrapping it in an object property.");
      return H;
    };
    PD = 6e4;
    b$ = class {
      constructor(Q) {
        if (this._options = Q, this._requestMessageId = 0, this._requestHandlers = /* @__PURE__ */ new Map(), this._requestHandlerAbortControllers = /* @__PURE__ */ new Map(), this._notificationHandlers = /* @__PURE__ */ new Map(), this._responseHandlers = /* @__PURE__ */ new Map(), this._progressHandlers = /* @__PURE__ */ new Map(), this._timeoutInfo = /* @__PURE__ */ new Map(), this._pendingDebouncedNotifications = /* @__PURE__ */ new Set(), this._taskProgressTokens = /* @__PURE__ */ new Map(), this._requestResolvers = /* @__PURE__ */ new Map(), this.setNotificationHandler(I8, (X) => {
          this._oncancel(X);
        }), this.setNotificationHandler(E8, (X) => {
          this._onprogress(X);
        }), this.setRequestHandler(b8, (X) => ({})), this._taskStore = Q?.taskStore, this._taskMessageQueue = Q?.taskMessageQueue, this._taskStore) this.setRequestHandler(P8, async (X, Y) => {
          let $ = await this._taskStore.getTask(X.params.taskId, Y.sessionId);
          if (!$) throw new _(T.InvalidParams, "Failed to retrieve task: Task not found");
          return { ...$ };
        }), this.setRequestHandler(S8, async (X, Y) => {
          let $ = async () => {
            let J = X.params.taskId;
            if (this._taskMessageQueue) {
              let G;
              while (G = await this._taskMessageQueue.dequeue(J, Y.sessionId)) {
                if (G.type === "response" || G.type === "error") {
                  let H = G.message, B = H.id, z = this._requestResolvers.get(B);
                  if (z) if (this._requestResolvers.delete(B), G.type === "response") z(H);
                  else {
                    let K = H, q = new _(K.error.code, K.error.message, K.error.data);
                    z(q);
                  }
                  else {
                    let K = G.type === "response" ? "Response" : "Error";
                    this._onerror(Error(`${K} handler missing for request ${B}`));
                  }
                  continue;
                }
                await this._transport?.send(G.message, { relatedRequestId: Y.requestId });
              }
            }
            let W = await this._taskStore.getTask(J, Y.sessionId);
            if (!W) throw new _(T.InvalidParams, `Task not found: ${J}`);
            if (!o1(W.status)) return await this._waitForTaskUpdate(J, Y.signal), await $();
            if (o1(W.status)) {
              let G = await this._taskStore.getTaskResult(J, Y.sessionId);
              return this._clearTaskQueue(J), { ...G, _meta: { ...G._meta, [n1]: { taskId: J } } };
            }
            return await $();
          };
          return await $();
        }), this.setRequestHandler(C8, async (X, Y) => {
          try {
            let { tasks: $, nextCursor: J } = await this._taskStore.listTasks(X.params?.cursor, Y.sessionId);
            return { tasks: $, nextCursor: J, _meta: {} };
          } catch ($) {
            throw new _(T.InvalidParams, `Failed to list tasks: ${$ instanceof Error ? $.message : String($)}`);
          }
        }), this.setRequestHandler(k8, async (X, Y) => {
          try {
            let $ = await this._taskStore.getTask(X.params.taskId, Y.sessionId);
            if (!$) throw new _(T.InvalidParams, `Task not found: ${X.params.taskId}`);
            if (o1($.status)) throw new _(T.InvalidParams, `Cannot cancel task in terminal status: ${$.status}`);
            await this._taskStore.updateTaskStatus(X.params.taskId, "cancelled", "Client cancelled task execution.", Y.sessionId), this._clearTaskQueue(X.params.taskId);
            let J = await this._taskStore.getTask(X.params.taskId, Y.sessionId);
            if (!J) throw new _(T.InvalidParams, `Task not found after cancellation: ${X.params.taskId}`);
            return { _meta: {}, ...J };
          } catch ($) {
            if ($ instanceof _) throw $;
            throw new _(T.InvalidRequest, `Failed to cancel task: ${$ instanceof Error ? $.message : String($)}`);
          }
        });
      }
      async _oncancel(Q) {
        if (!Q.params.requestId) return;
        this._requestHandlerAbortControllers.get(Q.params.requestId)?.abort(Q.params.reason);
      }
      _setupTimeout(Q, X, Y, $, J = false) {
        this._timeoutInfo.set(Q, { timeoutId: setTimeout($, X), startTime: Date.now(), timeout: X, maxTotalTimeout: Y, resetTimeoutOnProgress: J, onTimeout: $ });
      }
      _resetTimeout(Q) {
        let X = this._timeoutInfo.get(Q);
        if (!X) return false;
        let Y = Date.now() - X.startTime;
        if (X.maxTotalTimeout && Y >= X.maxTotalTimeout) throw this._timeoutInfo.delete(Q), _.fromError(T.RequestTimeout, "Maximum total timeout exceeded", { maxTotalTimeout: X.maxTotalTimeout, totalElapsed: Y });
        return clearTimeout(X.timeoutId), X.timeoutId = setTimeout(X.onTimeout, X.timeout), true;
      }
      _cleanupTimeout(Q) {
        let X = this._timeoutInfo.get(Q);
        if (X) clearTimeout(X.timeoutId), this._timeoutInfo.delete(Q);
      }
      async connect(Q) {
        if (this._transport) throw Error("Already connected to a transport. Call close() before connecting to a new transport, or use a separate Protocol instance per connection.");
        this._transport = Q;
        let X = this.transport?.onclose;
        this._transport.onclose = () => {
          X?.(), this._onclose();
        };
        let Y = this.transport?.onerror;
        this._transport.onerror = (J) => {
          Y?.(J), this._onerror(J);
        };
        let $ = this._transport?.onmessage;
        this._transport.onmessage = (J, W) => {
          if ($?.(J, W), J4(J) || sW(J)) this._onresponse(J);
          else if ($$(J)) this._onrequest(J, W);
          else if (aW(J)) this._onnotification(J);
          else this._onerror(Error(`Unknown message type: ${JSON.stringify(J)}`));
        }, await this._transport.start();
      }
      _onclose() {
        let Q = this._responseHandlers;
        this._responseHandlers = /* @__PURE__ */ new Map(), this._progressHandlers.clear(), this._taskProgressTokens.clear(), this._pendingDebouncedNotifications.clear();
        for (let Y of this._requestHandlerAbortControllers.values()) Y.abort();
        this._requestHandlerAbortControllers.clear();
        let X = _.fromError(T.ConnectionClosed, "Connection closed");
        this._transport = void 0, this.onclose?.();
        for (let Y of Q.values()) Y(X);
      }
      _onerror(Q) {
        this.onerror?.(Q);
      }
      _onnotification(Q) {
        let X = this._notificationHandlers.get(Q.method) ?? this.fallbackNotificationHandler;
        if (X === void 0) return;
        Promise.resolve().then(() => X(Q)).catch((Y) => this._onerror(Error(`Uncaught error in notification handler: ${Y}`)));
      }
      _onrequest(Q, X) {
        let Y = this._requestHandlers.get(Q.method) ?? this.fallbackRequestHandler, $ = this._transport, J = Q.params?._meta?.[n1]?.taskId;
        if (Y === void 0) {
          let z = { jsonrpc: "2.0", id: Q.id, error: { code: T.MethodNotFound, message: "Method not found" } };
          if (J && this._taskMessageQueue) this._enqueueTaskMessage(J, { type: "error", message: z, timestamp: Date.now() }, $?.sessionId).catch((K) => this._onerror(Error(`Failed to enqueue error response: ${K}`)));
          else $?.send(z).catch((K) => this._onerror(Error(`Failed to send an error response: ${K}`)));
          return;
        }
        let W = new AbortController();
        this._requestHandlerAbortControllers.set(Q.id, W);
        let G = oW(Q.params) ? Q.params.task : void 0, H = this._taskStore ? this.requestTaskStore(Q, $?.sessionId) : void 0, B = { signal: W.signal, sessionId: $?.sessionId, _meta: Q.params?._meta, sendNotification: async (z) => {
          if (W.signal.aborted) return;
          let K = { relatedRequestId: Q.id };
          if (J) K.relatedTask = { taskId: J };
          await this.notification(z, K);
        }, sendRequest: async (z, K, q) => {
          if (W.signal.aborted) throw new _(T.ConnectionClosed, "Request was cancelled");
          let U = { ...q, relatedRequestId: Q.id };
          if (J && !U.relatedTask) U.relatedTask = { taskId: J };
          let V = U.relatedTask?.taskId ?? J;
          if (V && H) await H.updateTaskStatus(V, "input_required");
          return await this.request(z, K, U);
        }, authInfo: X?.authInfo, requestId: Q.id, requestInfo: X?.requestInfo, taskId: J, taskStore: H, taskRequestedTtl: G?.ttl, closeSSEStream: X?.closeSSEStream, closeStandaloneSSEStream: X?.closeStandaloneSSEStream };
        Promise.resolve().then(() => {
          if (G) this.assertTaskHandlerCapability(Q.method);
        }).then(() => Y(Q, B)).then(async (z) => {
          if (W.signal.aborted) return;
          let K = { result: z, jsonrpc: "2.0", id: Q.id };
          if (J && this._taskMessageQueue) await this._enqueueTaskMessage(J, { type: "response", message: K, timestamp: Date.now() }, $?.sessionId);
          else await $?.send(K);
        }, async (z) => {
          if (W.signal.aborted) return;
          let K = { jsonrpc: "2.0", id: Q.id, error: { code: Number.isSafeInteger(z.code) ? z.code : T.InternalError, message: z.message ?? "Internal error", ...z.data !== void 0 && { data: z.data } } };
          if (J && this._taskMessageQueue) await this._enqueueTaskMessage(J, { type: "error", message: K, timestamp: Date.now() }, $?.sessionId);
          else await $?.send(K);
        }).catch((z) => this._onerror(Error(`Failed to send response: ${z}`))).finally(() => {
          this._requestHandlerAbortControllers.delete(Q.id);
        });
      }
      _onprogress(Q) {
        let { progressToken: X, ...Y } = Q.params, $ = Number(X), J = this._progressHandlers.get($);
        if (!J) {
          this._onerror(Error(`Received a progress notification for an unknown token: ${JSON.stringify(Q)}`));
          return;
        }
        let W = this._responseHandlers.get($), G = this._timeoutInfo.get($);
        if (G && W && G.resetTimeoutOnProgress) try {
          this._resetTimeout($);
        } catch (H) {
          this._responseHandlers.delete($), this._progressHandlers.delete($), this._cleanupTimeout($), W(H);
          return;
        }
        J(Y);
      }
      _onresponse(Q) {
        let X = Number(Q.id), Y = this._requestResolvers.get(X);
        if (Y) {
          if (this._requestResolvers.delete(X), J4(Q)) Y(Q);
          else {
            let W = new _(Q.error.code, Q.error.message, Q.error.data);
            Y(W);
          }
          return;
        }
        let $ = this._responseHandlers.get(X);
        if ($ === void 0) {
          this._onerror(Error(`Received a response for an unknown message ID: ${JSON.stringify(Q)}`));
          return;
        }
        this._responseHandlers.delete(X), this._cleanupTimeout(X);
        let J = false;
        if (J4(Q) && Q.result && typeof Q.result === "object") {
          let W = Q.result;
          if (W.task && typeof W.task === "object") {
            let G = W.task;
            if (typeof G.taskId === "string") J = true, this._taskProgressTokens.set(G.taskId, X);
          }
        }
        if (!J) this._progressHandlers.delete(X);
        if (J4(Q)) $(Q);
        else {
          let W = _.fromError(Q.error.code, Q.error.message, Q.error.data);
          $(W);
        }
      }
      get transport() {
        return this._transport;
      }
      async close() {
        await this._transport?.close();
      }
      async *requestStream(Q, X, Y) {
        let { task: $ } = Y ?? {};
        if (!$) {
          try {
            yield { type: "result", result: await this.request(Q, X, Y) };
          } catch (W) {
            yield { type: "error", error: W instanceof _ ? W : new _(T.InternalError, String(W)) };
          }
          return;
        }
        let J;
        try {
          let W = await this.request(Q, K9, Y);
          if (W.task) J = W.task.taskId, yield { type: "taskCreated", task: W.task };
          else throw new _(T.InternalError, "Task creation did not return a task");
          while (true) {
            let G = await this.getTask({ taskId: J }, Y);
            if (yield { type: "taskStatus", task: G }, o1(G.status)) {
              if (G.status === "completed") yield { type: "result", result: await this.getTaskResult({ taskId: J }, X, Y) };
              else if (G.status === "failed") yield { type: "error", error: new _(T.InternalError, `Task ${J} failed`) };
              else if (G.status === "cancelled") yield { type: "error", error: new _(T.InternalError, `Task ${J} was cancelled`) };
              return;
            }
            if (G.status === "input_required") {
              yield { type: "result", result: await this.getTaskResult({ taskId: J }, X, Y) };
              return;
            }
            let H = G.pollInterval ?? this._options?.defaultTaskPollInterval ?? 1e3;
            await new Promise((B) => setTimeout(B, H)), Y?.signal?.throwIfAborted();
          }
        } catch (W) {
          yield { type: "error", error: W instanceof _ ? W : new _(T.InternalError, String(W)) };
        }
      }
      request(Q, X, Y) {
        let { relatedRequestId: $, resumptionToken: J, onresumptiontoken: W, task: G, relatedTask: H } = Y ?? {};
        return new Promise((B, z) => {
          let K = (N) => {
            z(N);
          };
          if (!this._transport) {
            K(Error("Not connected"));
            return;
          }
          if (this._options?.enforceStrictCapabilities === true) try {
            if (this.assertCapabilityForMethod(Q.method), G) this.assertTaskCapability(Q.method);
          } catch (N) {
            K(N);
            return;
          }
          Y?.signal?.throwIfAborted();
          let q = this._requestMessageId++, U = { ...Q, jsonrpc: "2.0", id: q };
          if (Y?.onprogress) this._progressHandlers.set(q, Y.onprogress), U.params = { ...Q.params, _meta: { ...Q.params?._meta || {}, progressToken: q } };
          if (G) U.params = { ...U.params, task: G };
          if (H) U.params = { ...U.params, _meta: { ...U.params?._meta || {}, [n1]: H } };
          let V = (N) => {
            this._responseHandlers.delete(q), this._progressHandlers.delete(q), this._cleanupTimeout(q), this._transport?.send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: q, reason: String(N) } }, { relatedRequestId: $, resumptionToken: J, onresumptiontoken: W }).catch((R) => this._onerror(Error(`Failed to send cancellation: ${R}`)));
            let j = N instanceof _ ? N : new _(T.RequestTimeout, String(N));
            z(j);
          };
          this._responseHandlers.set(q, (N) => {
            if (Y?.signal?.aborted) return;
            if (N instanceof Error) return z(N);
            try {
              let j = d1(X, N.result);
              if (!j.success) z(j.error);
              else B(j.data);
            } catch (j) {
              z(j);
            }
          }), Y?.signal?.addEventListener("abort", () => {
            V(Y?.signal?.reason);
          });
          let L = Y?.timeout ?? PD, F = () => V(_.fromError(T.RequestTimeout, "Request timed out", { timeout: L }));
          this._setupTimeout(q, L, Y?.maxTotalTimeout, F, Y?.resetTimeoutOnProgress ?? false);
          let w = H?.taskId;
          if (w) {
            let N = (j) => {
              let R = this._responseHandlers.get(q);
              if (R) R(j);
              else this._onerror(Error(`Response handler missing for side-channeled request ${q}`));
            };
            this._requestResolvers.set(q, N), this._enqueueTaskMessage(w, { type: "request", message: U, timestamp: Date.now() }).catch((j) => {
              this._cleanupTimeout(q), z(j);
            });
          } else this._transport.send(U, { relatedRequestId: $, resumptionToken: J, onresumptiontoken: W }).catch((N) => {
            this._cleanupTimeout(q), z(N);
          });
        });
      }
      async getTask(Q, X) {
        return this.request({ method: "tasks/get", params: Q }, Z8, X);
      }
      async getTaskResult(Q, X, Y) {
        return this.request({ method: "tasks/result", params: Q }, X, Y);
      }
      async listTasks(Q, X) {
        return this.request({ method: "tasks/list", params: Q }, _8, X);
      }
      async cancelTask(Q, X) {
        return this.request({ method: "tasks/cancel", params: Q }, QG, X);
      }
      async notification(Q, X) {
        if (!this._transport) throw Error("Not connected");
        this.assertNotificationCapability(Q.method);
        let Y = X?.relatedTask?.taskId;
        if (Y) {
          let G = { ...Q, jsonrpc: "2.0", params: { ...Q.params, _meta: { ...Q.params?._meta || {}, [n1]: X.relatedTask } } };
          await this._enqueueTaskMessage(Y, { type: "notification", message: G, timestamp: Date.now() });
          return;
        }
        if ((this._options?.debouncedNotificationMethods ?? []).includes(Q.method) && !Q.params && !X?.relatedRequestId && !X?.relatedTask) {
          if (this._pendingDebouncedNotifications.has(Q.method)) return;
          this._pendingDebouncedNotifications.add(Q.method), Promise.resolve().then(() => {
            if (this._pendingDebouncedNotifications.delete(Q.method), !this._transport) return;
            let G = { ...Q, jsonrpc: "2.0" };
            if (X?.relatedTask) G = { ...G, params: { ...G.params, _meta: { ...G.params?._meta || {}, [n1]: X.relatedTask } } };
            this._transport?.send(G, X).catch((H) => this._onerror(H));
          });
          return;
        }
        let W = { ...Q, jsonrpc: "2.0" };
        if (X?.relatedTask) W = { ...W, params: { ...W.params, _meta: { ...W.params?._meta || {}, [n1]: X.relatedTask } } };
        await this._transport.send(W, X);
      }
      setRequestHandler(Q, X) {
        let Y = R$(Q);
        this.assertRequestHandlerCapability(Y), this._requestHandlers.set(Y, ($, J) => {
          let W = I$(Q, $);
          return Promise.resolve(X(W, J));
        });
      }
      removeRequestHandler(Q) {
        this._requestHandlers.delete(Q);
      }
      assertCanSetRequestHandler(Q) {
        if (this._requestHandlers.has(Q)) throw Error(`A request handler for ${Q} already exists, which would be overridden`);
      }
      setNotificationHandler(Q, X) {
        let Y = R$(Q);
        this._notificationHandlers.set(Y, ($) => {
          let J = I$(Q, $);
          return Promise.resolve(X(J));
        });
      }
      removeNotificationHandler(Q) {
        this._notificationHandlers.delete(Q);
      }
      _cleanupTaskProgressHandler(Q) {
        let X = this._taskProgressTokens.get(Q);
        if (X !== void 0) this._progressHandlers.delete(X), this._taskProgressTokens.delete(Q);
      }
      async _enqueueTaskMessage(Q, X, Y) {
        if (!this._taskStore || !this._taskMessageQueue) throw Error("Cannot enqueue task message: taskStore and taskMessageQueue are not configured");
        let $ = this._options?.maxTaskQueueSize;
        await this._taskMessageQueue.enqueue(Q, X, Y, $);
      }
      async _clearTaskQueue(Q, X) {
        if (this._taskMessageQueue) {
          let Y = await this._taskMessageQueue.dequeueAll(Q, X);
          for (let $ of Y) if ($.type === "request" && $$($.message)) {
            let J = $.message.id, W = this._requestResolvers.get(J);
            if (W) W(new _(T.InternalError, "Task cancelled or completed")), this._requestResolvers.delete(J);
            else this._onerror(Error(`Resolver missing for request ${J} during task ${Q} cleanup`));
          }
        }
      }
      async _waitForTaskUpdate(Q, X) {
        let Y = this._options?.defaultTaskPollInterval ?? 1e3;
        try {
          let $ = await this._taskStore?.getTask(Q);
          if ($?.pollInterval) Y = $.pollInterval;
        } catch {
        }
        return new Promise(($, J) => {
          if (X.aborted) {
            J(new _(T.InvalidRequest, "Request cancelled"));
            return;
          }
          let W = setTimeout($, Y);
          X.addEventListener("abort", () => {
            clearTimeout(W), J(new _(T.InvalidRequest, "Request cancelled"));
          }, { once: true });
        });
      }
      requestTaskStore(Q, X) {
        let Y = this._taskStore;
        if (!Y) throw Error("No task store configured");
        return { createTask: async ($) => {
          if (!Q) throw Error("No request provided");
          return await Y.createTask($, Q.id, { method: Q.method, params: Q.params }, X);
        }, getTask: async ($) => {
          let J = await Y.getTask($, X);
          if (!J) throw new _(T.InvalidParams, "Failed to retrieve task: Task not found");
          return J;
        }, storeTaskResult: async ($, J, W) => {
          await Y.storeTaskResult($, J, W, X);
          let G = await Y.getTask($, X);
          if (G) {
            let H = z4.parse({ method: "notifications/tasks/status", params: G });
            if (await this.notification(H), o1(G.status)) this._cleanupTaskProgressHandler($);
          }
        }, getTaskResult: ($) => {
          return Y.getTaskResult($, X);
        }, updateTaskStatus: async ($, J, W) => {
          let G = await Y.getTask($, X);
          if (!G) throw new _(T.InvalidParams, `Task "${$}" not found - it may have been cleaned up`);
          if (o1(G.status)) throw new _(T.InvalidParams, `Cannot update task "${$}" from terminal status "${G.status}" to "${J}". Terminal states (completed, failed, cancelled) cannot transition to other states.`);
          await Y.updateTaskStatus($, J, W, X);
          let H = await Y.getTask($, X);
          if (H) {
            let B = z4.parse({ method: "notifications/tasks/status", params: H });
            if (await this.notification(B), o1(H.status)) this._cleanupTaskProgressHandler($);
          }
        }, listTasks: ($) => {
          return Y.listTasks($, X);
        } };
      }
    };
    bK = m7(D7(), 1);
    EK = m7(IK(), 1);
    Z7 = class {
      constructor(Q) {
        this._ajv = Q ?? xb();
      }
      getValidator(Q) {
        let X = "$id" in Q && typeof Q.$id === "string" ? this._ajv.getSchema(Q.$id) ?? this._ajv.compile(Q) : this._ajv.compile(Q);
        return (Y) => {
          if (X(Y)) return { valid: true, data: Y, errorMessage: void 0 };
          else return { valid: false, data: void 0, errorMessage: this._ajv.errorsText(X.errors) };
        };
      }
    };
    S7 = class {
      constructor(Q) {
        this._server = Q;
      }
      requestStream(Q, X, Y) {
        return this._server.requestStream(Q, X, Y);
      }
      createMessageStream(Q, X) {
        let Y = this._server.getClientCapabilities();
        if ((Q.tools || Q.toolChoice) && !Y?.sampling?.tools) throw Error("Client does not support sampling tools capability.");
        if (Q.messages.length > 0) {
          let $ = Q.messages[Q.messages.length - 1], J = Array.isArray($.content) ? $.content : [$.content], W = J.some((z) => z.type === "tool_result"), G = Q.messages.length > 1 ? Q.messages[Q.messages.length - 2] : void 0, H = G ? Array.isArray(G.content) ? G.content : [G.content] : [], B = H.some((z) => z.type === "tool_use");
          if (W) {
            if (J.some((z) => z.type !== "tool_result")) throw Error("The last message must contain only tool_result content if any is present");
            if (!B) throw Error("tool_result blocks are not matching any tool_use from the previous message");
          }
          if (B) {
            let z = new Set(H.filter((q) => q.type === "tool_use").map((q) => q.id)), K = new Set(J.filter((q) => q.type === "tool_result").map((q) => q.toolUseId));
            if (z.size !== K.size || ![...z].every((q) => K.has(q))) throw Error("ids of tool_result blocks and tool_use blocks from previous message do not match");
          }
        }
        return this.requestStream({ method: "sampling/createMessage", params: Q }, q4, X);
      }
      elicitInputStream(Q, X) {
        let Y = this._server.getClientCapabilities(), $ = Q.mode ?? "form";
        switch ($) {
          case "url": {
            if (!Y?.elicitation?.url) throw Error("Client does not support url elicitation.");
            break;
          }
          case "form": {
            if (!Y?.elicitation?.form) throw Error("Client does not support form elicitation.");
            break;
          }
        }
        let J = $ === "form" && Q.mode === void 0 ? { ...Q, mode: "form" } : Q;
        return this.requestStream({ method: "elicitation/create", params: J }, U9, X);
      }
      async getTask(Q, X) {
        return this._server.getTask({ taskId: Q }, X);
      }
      async getTaskResult(Q, X, Y) {
        return this._server.getTaskResult({ taskId: Q }, X, Y);
      }
      async listTasks(Q, X) {
        return this._server.listTasks(Q ? { cursor: Q } : void 0, X);
      }
      async cancelTask(Q, X) {
        return this._server.cancelTask({ taskId: Q }, X);
      }
    };
    C7 = class extends b$ {
      constructor(Q, X) {
        super(X);
        if (this._serverInfo = Q, this._loggingLevels = /* @__PURE__ */ new Map(), this.LOG_LEVEL_SEVERITY = new Map(V4.options.map((Y, $) => [Y, $])), this.isMessageIgnored = (Y, $) => {
          let J = this._loggingLevels.get($);
          return J ? this.LOG_LEVEL_SEVERITY.get(Y) < this.LOG_LEVEL_SEVERITY.get(J) : false;
        }, this._capabilities = X?.capabilities ?? {}, this._instructions = X?.instructions, this._jsonSchemaValidator = X?.jsonSchemaValidator ?? new Z7(), this.setRequestHandler(G$, (Y) => this._oninitialize(Y)), this.setNotificationHandler(H$, () => this.oninitialized?.()), this._capabilities.logging) this.setRequestHandler(L$, async (Y, $) => {
          let J = $.sessionId || $.requestInfo?.headers["mcp-session-id"] || void 0, { level: W } = Y.params, G = V4.safeParse(W);
          if (G.success) this._loggingLevels.set(J, G.data);
          return {};
        });
      }
      get experimental() {
        if (!this._experimental) this._experimental = { tasks: new S7(this) };
        return this._experimental;
      }
      registerCapabilities(Q) {
        if (this.transport) throw Error("Cannot register capabilities after connecting to transport");
        this._capabilities = lG(this._capabilities, Q);
      }
      setRequestHandler(Q, X) {
        let $ = i1(Q)?.method;
        if (!$) throw Error("Schema is missing a method literal");
        let J;
        if (n0($)) {
          let G = $;
          J = G._zod?.def?.value ?? G.value;
        } else {
          let G = $;
          J = G._def?.value ?? G.value;
        }
        if (typeof J !== "string") throw Error("Schema method literal must be a string");
        if (J === "tools/call") {
          let G = async (H, B) => {
            let z = d1(q9, H);
            if (!z.success) {
              let V = z.error instanceof Error ? z.error.message : String(z.error);
              throw new _(T.InvalidParams, `Invalid tools/call request: ${V}`);
            }
            let { params: K } = z.data, q = await Promise.resolve(X(H, B));
            if (K.task) {
              let V = d1(K9, q);
              if (!V.success) {
                let L = V.error instanceof Error ? V.error.message : String(V.error);
                throw new _(T.InvalidParams, `Invalid task creation result: ${L}`);
              }
              return V.data;
            }
            let U = d1(f8, q);
            if (!U.success) {
              let V = U.error instanceof Error ? U.error.message : String(U.error);
              throw new _(T.InvalidParams, `Invalid tools/call result: ${V}`);
            }
            return U.data;
          };
          return super.setRequestHandler(Q, G);
        }
        return super.setRequestHandler(Q, X);
      }
      assertCapabilityForMethod(Q) {
        switch (Q) {
          case "sampling/createMessage":
            if (!this._clientCapabilities?.sampling) throw Error(`Client does not support sampling (required for ${Q})`);
            break;
          case "elicitation/create":
            if (!this._clientCapabilities?.elicitation) throw Error(`Client does not support elicitation (required for ${Q})`);
            break;
          case "roots/list":
            if (!this._clientCapabilities?.roots) throw Error(`Client does not support listing roots (required for ${Q})`);
            break;
          case "ping":
            break;
        }
      }
      assertNotificationCapability(Q) {
        switch (Q) {
          case "notifications/message":
            if (!this._capabilities.logging) throw Error(`Server does not support logging (required for ${Q})`);
            break;
          case "notifications/resources/updated":
          case "notifications/resources/list_changed":
            if (!this._capabilities.resources) throw Error(`Server does not support notifying about resources (required for ${Q})`);
            break;
          case "notifications/tools/list_changed":
            if (!this._capabilities.tools) throw Error(`Server does not support notifying of tool list changes (required for ${Q})`);
            break;
          case "notifications/prompts/list_changed":
            if (!this._capabilities.prompts) throw Error(`Server does not support notifying of prompt list changes (required for ${Q})`);
            break;
          case "notifications/elicitation/complete":
            if (!this._clientCapabilities?.elicitation?.url) throw Error(`Client does not support URL elicitation (required for ${Q})`);
            break;
          case "notifications/cancelled":
            break;
          case "notifications/progress":
            break;
        }
      }
      assertRequestHandlerCapability(Q) {
        if (!this._capabilities) return;
        switch (Q) {
          case "completion/complete":
            if (!this._capabilities.completions) throw Error(`Server does not support completions (required for ${Q})`);
            break;
          case "logging/setLevel":
            if (!this._capabilities.logging) throw Error(`Server does not support logging (required for ${Q})`);
            break;
          case "prompts/get":
          case "prompts/list":
            if (!this._capabilities.prompts) throw Error(`Server does not support prompts (required for ${Q})`);
            break;
          case "resources/list":
          case "resources/templates/list":
          case "resources/read":
            if (!this._capabilities.resources) throw Error(`Server does not support resources (required for ${Q})`);
            break;
          case "tools/call":
          case "tools/list":
            if (!this._capabilities.tools) throw Error(`Server does not support tools (required for ${Q})`);
            break;
          case "tasks/get":
          case "tasks/list":
          case "tasks/result":
          case "tasks/cancel":
            if (!this._capabilities.tasks) throw Error(`Server does not support tasks capability (required for ${Q})`);
            break;
          case "ping":
          case "initialize":
            break;
        }
      }
      assertTaskCapability(Q) {
        ZK(this._clientCapabilities?.tasks?.requests, Q, "Client");
      }
      assertTaskHandlerCapability(Q) {
        if (!this._capabilities) return;
        PK(this._capabilities.tasks?.requests, Q, "Server");
      }
      async _oninitialize(Q) {
        let X = Q.params.protocolVersion;
        return this._clientCapabilities = Q.params.capabilities, this._clientVersion = Q.params.clientInfo, { protocolVersion: dW.includes(X) ? X : X$, capabilities: this.getCapabilities(), serverInfo: this._serverInfo, ...this._instructions && { instructions: this._instructions } };
      }
      getClientCapabilities() {
        return this._clientCapabilities;
      }
      getClientVersion() {
        return this._clientVersion;
      }
      getCapabilities() {
        return this._capabilities;
      }
      async ping() {
        return this.request({ method: "ping" }, R8);
      }
      async createMessage(Q, X) {
        if (Q.tools || Q.toolChoice) {
          if (!this._clientCapabilities?.sampling?.tools) throw Error("Client does not support sampling tools capability.");
        }
        if (Q.messages.length > 0) {
          let Y = Q.messages[Q.messages.length - 1], $ = Array.isArray(Y.content) ? Y.content : [Y.content], J = $.some((B) => B.type === "tool_result"), W = Q.messages.length > 1 ? Q.messages[Q.messages.length - 2] : void 0, G = W ? Array.isArray(W.content) ? W.content : [W.content] : [], H = G.some((B) => B.type === "tool_use");
          if (J) {
            if ($.some((B) => B.type !== "tool_result")) throw Error("The last message must contain only tool_result content if any is present");
            if (!H) throw Error("tool_result blocks are not matching any tool_use from the previous message");
          }
          if (H) {
            let B = new Set(G.filter((K) => K.type === "tool_use").map((K) => K.id)), z = new Set($.filter((K) => K.type === "tool_result").map((K) => K.toolUseId));
            if (B.size !== z.size || ![...B].every((K) => z.has(K))) throw Error("ids of tool_result blocks and tool_use blocks from previous message do not match");
          }
        }
        if (Q.tools) return this.request({ method: "sampling/createMessage", params: Q }, F$, X);
        return this.request({ method: "sampling/createMessage", params: Q }, q4, X);
      }
      async elicitInput(Q, X) {
        switch (Q.mode ?? "form") {
          case "url": {
            if (!this._clientCapabilities?.elicitation?.url) throw Error("Client does not support url elicitation.");
            let $ = Q;
            return this.request({ method: "elicitation/create", params: $ }, U9, X);
          }
          case "form": {
            if (!this._clientCapabilities?.elicitation?.form) throw Error("Client does not support form elicitation.");
            let $ = Q.mode === "form" ? Q : { ...Q, mode: "form" }, J = await this.request({ method: "elicitation/create", params: $ }, U9, X);
            if (J.action === "accept" && J.content && $.requestedSchema) try {
              let G = this._jsonSchemaValidator.getValidator($.requestedSchema)(J.content);
              if (!G.valid) throw new _(T.InvalidParams, `Elicitation response content does not match requested schema: ${G.errorMessage}`);
            } catch (W) {
              if (W instanceof _) throw W;
              throw new _(T.InternalError, `Error validating elicitation response: ${W instanceof Error ? W.message : String(W)}`);
            }
            return J;
          }
        }
      }
      createElicitationCompletionNotifier(Q, X) {
        if (!this._clientCapabilities?.elicitation?.url) throw Error("Client does not support URL elicitation (required for notifications/elicitation/complete)");
        return () => this.notification({ method: "notifications/elicitation/complete", params: { elicitationId: Q } }, X);
      }
      async listRoots(Q, X) {
        return this.request({ method: "roots/list", params: Q }, O$, X);
      }
      async sendLoggingMessage(Q, X) {
        if (this._capabilities.logging) {
          if (!this.isMessageIgnored(Q.level, X)) return this.notification({ method: "notifications/message", params: Q });
        }
      }
      async sendResourceUpdated(Q) {
        return this.notification({ method: "notifications/resources/updated", params: Q });
      }
      async sendResourceListChanged() {
        return this.notification({ method: "notifications/resources/list_changed" });
      }
      async sendToolListChanged() {
        return this.notification({ method: "notifications/tools/list_changed" });
      }
      async sendPromptListChanged() {
        return this.notification({ method: "notifications/prompts/list_changed" });
      }
    };
    CK = Symbol.for("mcp.completable");
    (function(Q) {
      Q.Completable = "McpCompletable";
    })(SK || (SK = {}));
    yb = /^[A-Za-z0-9._-]{1,128}$/;
    v7 = class {
      constructor(Q) {
        this._mcpServer = Q;
      }
      registerToolTask(Q, X, Y) {
        let $ = { taskSupport: "required", ...X.execution };
        if ($.taskSupport === "forbidden") throw Error(`Cannot register task-based tool '${Q}' with taskSupport 'forbidden'. Use registerTool() instead.`);
        return this._mcpServer._createRegisteredTool(Q, X.title, X.description, X.inputSchema, X.outputSchema, X.annotations, $, X._meta, Y);
      }
    };
    x7 = class {
      constructor(Q, X) {
        this._registeredResources = {}, this._registeredResourceTemplates = {}, this._registeredTools = {}, this._registeredPrompts = {}, this._toolHandlersInitialized = false, this._completionHandlerInitialized = false, this._resourceHandlersInitialized = false, this._promptHandlersInitialized = false, this.server = new C7(Q, X);
      }
      get experimental() {
        if (!this._experimental) this._experimental = { tasks: new v7(this) };
        return this._experimental;
      }
      async connect(Q) {
        return await this.server.connect(Q);
      }
      async close() {
        await this.server.close();
      }
      setToolRequestHandlers() {
        if (this._toolHandlersInitialized) return;
        this.server.assertCanSetRequestHandler(Y6(h8)), this.server.assertCanSetRequestHandler(Y6(q9)), this.server.registerCapabilities({ tools: { listChanged: true } }), this.server.setRequestHandler(h8, () => ({ tools: Object.entries(this._registeredTools).filter(([, Q]) => Q.enabled).map(([Q, X]) => {
          let Y = { name: Q, title: X.title, description: X.description, inputSchema: (() => {
            let $ = B9(X.inputSchema);
            return $ ? j$($, { strictUnions: true, pipeStrategy: "input" }) : fb;
          })(), annotations: X.annotations, execution: X.execution, _meta: X._meta };
          if (X.outputSchema) {
            let $ = B9(X.outputSchema);
            if ($) Y.outputSchema = j$($, { strictUnions: true, pipeStrategy: "output" });
          }
          return Y;
        }) })), this.server.setRequestHandler(q9, async (Q, X) => {
          try {
            let Y = this._registeredTools[Q.params.name];
            if (!Y) throw new _(T.InvalidParams, `Tool ${Q.params.name} not found`);
            if (!Y.enabled) throw new _(T.InvalidParams, `Tool ${Q.params.name} disabled`);
            let $ = !!Q.params.task, J = Y.execution?.taskSupport, W = "createTask" in Y.handler;
            if ((J === "required" || J === "optional") && !W) throw new _(T.InternalError, `Tool ${Q.params.name} has taskSupport '${J}' but was not registered with registerToolTask`);
            if (J === "required" && !$) throw new _(T.MethodNotFound, `Tool ${Q.params.name} requires task augmentation (taskSupport: 'required')`);
            if (J === "optional" && !$ && W) return await this.handleAutomaticTaskPolling(Y, Q, X);
            let G = await this.validateToolInput(Y, Q.params.arguments, Q.params.name), H = await this.executeToolHandler(Y, G, X);
            if ($) return H;
            return await this.validateToolOutput(Y, H, Q.params.name), H;
          } catch (Y) {
            if (Y instanceof _) {
              if (Y.code === T.UrlElicitationRequired) throw Y;
            }
            return this.createToolError(Y instanceof Error ? Y.message : String(Y));
          }
        }), this._toolHandlersInitialized = true;
      }
      createToolError(Q) {
        return { content: [{ type: "text", text: Q }], isError: true };
      }
      async validateToolInput(Q, X, Y) {
        if (!Q.inputSchema) return;
        let J = B9(Q.inputSchema) ?? Q.inputSchema, W = await F8(J, X);
        if (!W.success) {
          let G = "error" in W ? W.error : "Unknown error", H = O8(G);
          throw new _(T.InvalidParams, `Input validation error: Invalid arguments for tool ${Y}: ${H}`);
        }
        return W.data;
      }
      async validateToolOutput(Q, X, Y) {
        if (!Q.outputSchema) return;
        if (!("content" in X)) return;
        if (X.isError) return;
        if (!X.structuredContent) throw new _(T.InvalidParams, `Output validation error: Tool ${Y} has an output schema but no structured content was provided`);
        let $ = B9(Q.outputSchema), J = await F8($, X.structuredContent);
        if (!J.success) {
          let W = "error" in J ? J.error : "Unknown error", G = O8(W);
          throw new _(T.InvalidParams, `Output validation error: Invalid structured content for tool ${Y}: ${G}`);
        }
      }
      async executeToolHandler(Q, X, Y) {
        let $ = Q.handler;
        if ("createTask" in $) {
          if (!Y.taskStore) throw Error("No task store provided.");
          let W = { ...Y, taskStore: Y.taskStore };
          if (Q.inputSchema) return await Promise.resolve($.createTask(X, W));
          else return await Promise.resolve($.createTask(W));
        }
        if (Q.inputSchema) return await Promise.resolve($(X, Y));
        else return await Promise.resolve($(Y));
      }
      async handleAutomaticTaskPolling(Q, X, Y) {
        if (!Y.taskStore) throw Error("No task store provided for task-capable tool.");
        let $ = await this.validateToolInput(Q, X.params.arguments, X.params.name), J = Q.handler, W = { ...Y, taskStore: Y.taskStore }, G = $ ? await Promise.resolve(J.createTask($, W)) : await Promise.resolve(J.createTask(W)), H = G.task.taskId, B = G.task, z = B.pollInterval ?? 5e3;
        while (B.status !== "completed" && B.status !== "failed" && B.status !== "cancelled") {
          await new Promise((q) => setTimeout(q, z));
          let K = await Y.taskStore.getTask(H);
          if (!K) throw new _(T.InternalError, `Task ${H} not found during polling`);
          B = K;
        }
        return await Y.taskStore.getTaskResult(H);
      }
      setCompletionRequestHandler() {
        if (this._completionHandlerInitialized) return;
        this.server.assertCanSetRequestHandler(Y6(u8)), this.server.registerCapabilities({ completions: {} }), this.server.setRequestHandler(u8, async (Q) => {
          switch (Q.params.ref.type) {
            case "ref/prompt":
              return GG(Q), this.handlePromptCompletion(Q, Q.params.ref);
            case "ref/resource":
              return HG(Q), this.handleResourceCompletion(Q, Q.params.ref);
            default:
              throw new _(T.InvalidParams, `Invalid completion reference: ${Q.params.ref}`);
          }
        }), this._completionHandlerInitialized = true;
      }
      async handlePromptCompletion(Q, X) {
        let Y = this._registeredPrompts[X.name];
        if (!Y) throw new _(T.InvalidParams, `Prompt ${X.name} not found`);
        if (!Y.enabled) throw new _(T.InvalidParams, `Prompt ${X.name} disabled`);
        if (!Y.argsSchema) return g4;
        let J = i1(Y.argsSchema)?.[Q.params.argument.name];
        if (!_7(J)) return g4;
        let W = _K(J);
        if (!W) return g4;
        let G = await W(Q.params.argument.value, Q.params.context);
        return vK(G);
      }
      async handleResourceCompletion(Q, X) {
        let Y = Object.values(this._registeredResourceTemplates).find((W) => W.resourceTemplate.uriTemplate.toString() === X.uri);
        if (!Y) {
          if (this._registeredResources[X.uri]) return g4;
          throw new _(T.InvalidParams, `Resource template ${Q.params.ref.uri} not found`);
        }
        let $ = Y.resourceTemplate.completeCallback(Q.params.argument.name);
        if (!$) return g4;
        let J = await $(Q.params.argument.value, Q.params.context);
        return vK(J);
      }
      setResourceRequestHandlers() {
        if (this._resourceHandlersInitialized) return;
        this.server.assertCanSetRequestHandler(Y6(v8)), this.server.assertCanSetRequestHandler(Y6(T8)), this.server.assertCanSetRequestHandler(Y6(x8)), this.server.registerCapabilities({ resources: { listChanged: true } }), this.server.setRequestHandler(v8, async (Q, X) => {
          let Y = Object.entries(this._registeredResources).filter(([J, W]) => W.enabled).map(([J, W]) => ({ uri: J, name: W.name, ...W.metadata })), $ = [];
          for (let J of Object.values(this._registeredResourceTemplates)) {
            if (!J.resourceTemplate.listCallback) continue;
            let W = await J.resourceTemplate.listCallback(X);
            for (let G of W.resources) $.push({ ...J.metadata, ...G });
          }
          return { resources: [...Y, ...$] };
        }), this.server.setRequestHandler(T8, async () => {
          return { resourceTemplates: Object.entries(this._registeredResourceTemplates).map(([X, Y]) => ({ name: X, uriTemplate: Y.resourceTemplate.uriTemplate.toString(), ...Y.metadata })) };
        }), this.server.setRequestHandler(x8, async (Q, X) => {
          let Y = new URL(Q.params.uri), $ = this._registeredResources[Y.toString()];
          if ($) {
            if (!$.enabled) throw new _(T.InvalidParams, `Resource ${Y} disabled`);
            return $.readCallback(Y, X);
          }
          for (let J of Object.values(this._registeredResourceTemplates)) {
            let W = J.resourceTemplate.uriTemplate.match(Y.toString());
            if (W) return J.readCallback(Y, W, X);
          }
          throw new _(T.InvalidParams, `Resource ${Y} not found`);
        }), this._resourceHandlersInitialized = true;
      }
      setPromptRequestHandlers() {
        if (this._promptHandlersInitialized) return;
        this.server.assertCanSetRequestHandler(Y6(y8)), this.server.assertCanSetRequestHandler(Y6(g8)), this.server.registerCapabilities({ prompts: { listChanged: true } }), this.server.setRequestHandler(y8, () => ({ prompts: Object.entries(this._registeredPrompts).filter(([, Q]) => Q.enabled).map(([Q, X]) => {
          return { name: Q, title: X.title, description: X.description, arguments: X.argsSchema ? mb(X.argsSchema) : void 0 };
        }) })), this.server.setRequestHandler(g8, async (Q, X) => {
          let Y = this._registeredPrompts[Q.params.name];
          if (!Y) throw new _(T.InvalidParams, `Prompt ${Q.params.name} not found`);
          if (!Y.enabled) throw new _(T.InvalidParams, `Prompt ${Q.params.name} disabled`);
          if (Y.argsSchema) {
            let $ = B9(Y.argsSchema), J = await F8($, Q.params.arguments);
            if (!J.success) {
              let H = "error" in J ? J.error : "Unknown error", B = O8(H);
              throw new _(T.InvalidParams, `Invalid arguments for prompt ${Q.params.name}: ${B}`);
            }
            let W = J.data, G = Y.callback;
            return await Promise.resolve(G(W, X));
          } else {
            let $ = Y.callback;
            return await Promise.resolve($(X));
          }
        }), this._promptHandlersInitialized = true;
      }
      resource(Q, X, ...Y) {
        let $;
        if (typeof Y[0] === "object") $ = Y.shift();
        let J = Y[0];
        if (typeof X === "string") {
          if (this._registeredResources[X]) throw Error(`Resource ${X} is already registered`);
          let W = this._createRegisteredResource(Q, void 0, X, $, J);
          return this.setResourceRequestHandlers(), this.sendResourceListChanged(), W;
        } else {
          if (this._registeredResourceTemplates[Q]) throw Error(`Resource template ${Q} is already registered`);
          let W = this._createRegisteredResourceTemplate(Q, void 0, X, $, J);
          return this.setResourceRequestHandlers(), this.sendResourceListChanged(), W;
        }
      }
      registerResource(Q, X, Y, $) {
        if (typeof X === "string") {
          if (this._registeredResources[X]) throw Error(`Resource ${X} is already registered`);
          let J = this._createRegisteredResource(Q, Y.title, X, Y, $);
          return this.setResourceRequestHandlers(), this.sendResourceListChanged(), J;
        } else {
          if (this._registeredResourceTemplates[Q]) throw Error(`Resource template ${Q} is already registered`);
          let J = this._createRegisteredResourceTemplate(Q, Y.title, X, Y, $);
          return this.setResourceRequestHandlers(), this.sendResourceListChanged(), J;
        }
      }
      _createRegisteredResource(Q, X, Y, $, J) {
        let W = { name: Q, title: X, metadata: $, readCallback: J, enabled: true, disable: () => W.update({ enabled: false }), enable: () => W.update({ enabled: true }), remove: () => W.update({ uri: null }), update: (G) => {
          if (typeof G.uri < "u" && G.uri !== Y) {
            if (delete this._registeredResources[Y], G.uri) this._registeredResources[G.uri] = W;
          }
          if (typeof G.name < "u") W.name = G.name;
          if (typeof G.title < "u") W.title = G.title;
          if (typeof G.metadata < "u") W.metadata = G.metadata;
          if (typeof G.callback < "u") W.readCallback = G.callback;
          if (typeof G.enabled < "u") W.enabled = G.enabled;
          this.sendResourceListChanged();
        } };
        return this._registeredResources[Y] = W, W;
      }
      _createRegisteredResourceTemplate(Q, X, Y, $, J) {
        let W = { resourceTemplate: Y, title: X, metadata: $, readCallback: J, enabled: true, disable: () => W.update({ enabled: false }), enable: () => W.update({ enabled: true }), remove: () => W.update({ name: null }), update: (B) => {
          if (typeof B.name < "u" && B.name !== Q) {
            if (delete this._registeredResourceTemplates[Q], B.name) this._registeredResourceTemplates[B.name] = W;
          }
          if (typeof B.title < "u") W.title = B.title;
          if (typeof B.template < "u") W.resourceTemplate = B.template;
          if (typeof B.metadata < "u") W.metadata = B.metadata;
          if (typeof B.callback < "u") W.readCallback = B.callback;
          if (typeof B.enabled < "u") W.enabled = B.enabled;
          this.sendResourceListChanged();
        } };
        this._registeredResourceTemplates[Q] = W;
        let G = Y.uriTemplate.variableNames;
        if (Array.isArray(G) && G.some((B) => !!Y.completeCallback(B))) this.setCompletionRequestHandler();
        return W;
      }
      _createRegisteredPrompt(Q, X, Y, $, J) {
        let W = { title: X, description: Y, argsSchema: $ === void 0 ? void 0 : A6($), callback: J, enabled: true, disable: () => W.update({ enabled: false }), enable: () => W.update({ enabled: true }), remove: () => W.update({ name: null }), update: (G) => {
          if (typeof G.name < "u" && G.name !== Q) {
            if (delete this._registeredPrompts[Q], G.name) this._registeredPrompts[G.name] = W;
          }
          if (typeof G.title < "u") W.title = G.title;
          if (typeof G.description < "u") W.description = G.description;
          if (typeof G.argsSchema < "u") W.argsSchema = A6(G.argsSchema);
          if (typeof G.callback < "u") W.callback = G.callback;
          if (typeof G.enabled < "u") W.enabled = G.enabled;
          this.sendPromptListChanged();
        } };
        if (this._registeredPrompts[Q] = W, $) {
          if (Object.values($).some((H) => {
            let B = H instanceof l0 ? H._def?.innerType : H;
            return _7(B);
          })) this.setCompletionRequestHandler();
        }
        return W;
      }
      _createRegisteredTool(Q, X, Y, $, J, W, G, H, B) {
        k7(Q);
        let z = { title: X, description: Y, inputSchema: kK($), outputSchema: kK(J), annotations: W, execution: G, _meta: H, handler: B, enabled: true, disable: () => z.update({ enabled: false }), enable: () => z.update({ enabled: true }), remove: () => z.update({ name: null }), update: (K) => {
          if (typeof K.name < "u" && K.name !== Q) {
            if (typeof K.name === "string") k7(K.name);
            if (delete this._registeredTools[Q], K.name) this._registeredTools[K.name] = z;
          }
          if (typeof K.title < "u") z.title = K.title;
          if (typeof K.description < "u") z.description = K.description;
          if (typeof K.paramsSchema < "u") z.inputSchema = A6(K.paramsSchema);
          if (typeof K.outputSchema < "u") z.outputSchema = A6(K.outputSchema);
          if (typeof K.callback < "u") z.handler = K.callback;
          if (typeof K.annotations < "u") z.annotations = K.annotations;
          if (typeof K._meta < "u") z._meta = K._meta;
          if (typeof K.enabled < "u") z.enabled = K.enabled;
          this.sendToolListChanged();
        } };
        return this._registeredTools[Q] = z, this.setToolRequestHandlers(), this.sendToolListChanged(), z;
      }
      tool(Q, ...X) {
        if (this._registeredTools[Q]) throw Error(`Tool ${Q} is already registered`);
        let Y, $, J, W;
        if (typeof X[0] === "string") Y = X.shift();
        if (X.length > 1) {
          let H = X[0];
          if (T7(H)) {
            if ($ = X.shift(), X.length > 1 && typeof X[0] === "object" && X[0] !== null && !T7(X[0])) W = X.shift();
          } else if (typeof H === "object" && H !== null) W = X.shift();
        }
        let G = X[0];
        return this._createRegisteredTool(Q, void 0, Y, $, J, W, { taskSupport: "forbidden" }, void 0, G);
      }
      registerTool(Q, X, Y) {
        if (this._registeredTools[Q]) throw Error(`Tool ${Q} is already registered`);
        let { title: $, description: J, inputSchema: W, outputSchema: G, annotations: H, _meta: B } = X;
        return this._createRegisteredTool(Q, $, J, W, G, H, { taskSupport: "forbidden" }, B, Y);
      }
      prompt(Q, ...X) {
        if (this._registeredPrompts[Q]) throw Error(`Prompt ${Q} is already registered`);
        let Y;
        if (typeof X[0] === "string") Y = X.shift();
        let $;
        if (X.length > 1) $ = X.shift();
        let J = X[0], W = this._createRegisteredPrompt(Q, void 0, Y, $, J);
        return this.setPromptRequestHandlers(), this.sendPromptListChanged(), W;
      }
      registerPrompt(Q, X, Y) {
        if (this._registeredPrompts[Q]) throw Error(`Prompt ${Q} is already registered`);
        let { title: $, description: J, argsSchema: W } = X, G = this._createRegisteredPrompt(Q, $, J, W, Y);
        return this.setPromptRequestHandlers(), this.sendPromptListChanged(), G;
      }
      isConnected() {
        return this.server.transport !== void 0;
      }
      async sendLoggingMessage(Q, X) {
        return this.server.sendLoggingMessage(Q, X);
      }
      sendResourceListChanged() {
        if (this.isConnected()) this.server.sendResourceListChanged();
      }
      sendToolListChanged() {
        if (this.isConnected()) this.server.sendToolListChanged();
      }
      sendPromptListChanged() {
        if (this.isConnected()) this.server.sendPromptListChanged();
      }
    };
    fb = { type: "object", properties: {} };
    g4 = { completion: { values: [], hasMore: false } };
    yK = 15e3;
    pb = xK(() => m1.object({ session_id: m1.string(), ws_url: m1.string(), work_dir: m1.string().optional(), session_key: m1.string().optional() }));
    D1 = class extends Error {
      constructor(Q) {
        super(Q);
        this.name = "DirectConnectError";
      }
    };
    hK = class {
      options;
      ws;
      sessionId;
      workDir;
      abortController;
      readyState = false;
      closed = false;
      exitError;
      messageQueue = [];
      messageResolve;
      messageReject;
      readyPromise;
      readyResolve;
      readyReject;
      abortHandler;
      partialLine = "";
      constructor(Q) {
        this.options = Q;
        this.abortController = Q.abortController ?? new AbortController(), this.readyPromise = new Promise((X, Y) => {
          this.readyResolve = X, this.readyReject = Y;
        }), this.readyPromise.catch(() => {
        }), this.initialize();
      }
      get ready() {
        return this.readyPromise;
      }
      getSessionId() {
        return this.sessionId;
      }
      getWorkDir() {
        return this.workDir;
      }
      async initialize() {
        if (this.abortController.signal.aborted) {
          this.failInit(new m0("Connection aborted"));
          return;
        }
        this.abortHandler = () => {
          this.close(), this.exitError = new m0("Connection aborted by user");
        }, this.abortController.signal.addEventListener("abort", this.abortHandler);
        let Q;
        try {
          let J = await ib(this.options);
          this.sessionId = J.sessionId, this.workDir = J.workDir, Q = J.wsUrl;
        } catch (J) {
          this.failInit(J instanceof Error ? J : Error(String(J)));
          return;
        }
        if (this.closed) {
          if (this.options.deleteSessionOnClose && this.sessionId) gK(this.options.serverUrl, this.sessionId, this.options.authToken);
          return;
        }
        let X = {};
        if (this.options.authToken) X.authorization = `Bearer ${this.options.authToken}`;
        let Y = new WebSocket(Q, { headers: X });
        this.ws = Y;
        let $ = setTimeout(() => {
          if (!this.readyState) {
            Y.close();
            let J = new D1(`WebSocket connection timeout after ${yK}ms`);
            this.exitError = J, this.readyReject?.(J);
          }
        }, yK);
        Y.addEventListener("open", () => {
          clearTimeout($), this.readyState = true, i0(`[DirectConnectTransport] Connected to ${this.options.serverUrl}, session=${this.sessionId}`), this.readyResolve?.();
        }), Y.addEventListener("message", (J) => {
          let W = typeof J.data === "string" ? J.data : "", H = (this.partialLine + W).split(`
`);
          this.partialLine = H.pop() ?? "";
          for (let B of H) {
            if (!B) continue;
            let z;
            try {
              z = x1(B);
            } catch {
              continue;
            }
            this.enqueue(z);
          }
        }), Y.addEventListener("error", () => {
          clearTimeout($);
          let J = new D1("WebSocket connection error");
          if (this.exitError = J, this.readyReject?.(J), this.messageReject) this.messageReject(J), this.messageReject = void 0, this.messageResolve = void 0;
        }), Y.addEventListener("close", (J) => {
          if (this.readyState = false, this.closed = true, J.code !== 1e3 && J.code !== 1001 && !this.exitError) this.exitError = new D1(`WebSocket closed abnormally: ${J.code} ${J.reason}`);
          if (this.messageResolve) this.messageResolve({ done: true, value: void 0 }), this.messageResolve = void 0, this.messageReject = void 0;
        });
      }
      failInit(Q) {
        if (this.exitError = Q, this.closed = true, this.readyReject?.(Q), this.messageResolve) this.messageResolve({ done: true, value: void 0 }), this.messageResolve = void 0, this.messageReject = void 0;
      }
      enqueue(Q) {
        if (this.messageResolve) {
          let X = this.messageResolve;
          this.messageResolve = void 0, this.messageReject = void 0, X({ done: false, value: Q });
        } else this.messageQueue.push(Q);
      }
      async write(Q) {
        if (this.abortController.signal.aborted) throw new m0("Operation aborted");
        if (!this.readyState) await this.readyPromise;
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new D1("Transport is not ready for writing");
        this.ws.send(Q);
      }
      isReady() {
        return this.readyState && this.ws?.readyState === WebSocket.OPEN;
      }
      endInput() {
      }
      close() {
        if (this.closed) return;
        if (this.closed = true, this.readyState = false, this.abortHandler) this.abortController.signal.removeEventListener("abort", this.abortHandler), this.abortHandler = void 0;
        if (!this.abortController.signal.aborted) this.abortController.abort();
        if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.close(1e3, "Normal closure");
        if (this.messageResolve) this.messageResolve({ done: true, value: void 0 }), this.messageResolve = void 0, this.messageReject = void 0;
        if (this.options.deleteSessionOnClose && this.sessionId) gK(this.options.serverUrl, this.sessionId, this.options.authToken);
      }
      async *readMessages() {
        while (!this.closed || this.messageQueue.length > 0) {
          if (this.messageQueue.length > 0) {
            yield this.messageQueue.shift();
            continue;
          }
          if (this.closed) break;
          let Q = await new Promise((X, Y) => {
            if (this.messageQueue.length > 0) {
              X({ done: false, value: this.messageQueue.shift() });
              return;
            }
            if (this.closed) {
              X({ done: true, value: void 0 });
              return;
            }
            this.messageResolve = X, this.messageReject = Y;
          });
          if (Q.done) break;
          yield Q.value;
        }
        if (this.exitError) throw this.exitError;
      }
    };
  }
});

// src-tauri/sidecar/claude-agent-sdk-server.mjs
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
var queryFn;
try {
  const sdk = await Promise.resolve().then(() => (init_sdk(), sdk_exports));
  queryFn = sdk.query;
} catch (err) {
  process.stdout.write(
    JSON.stringify({
      type: "error",
      message: `Failed to load @anthropic-ai/claude-agent-sdk: ${err.message}. Install it with: pnpm add @anthropic-ai/claude-agent-sdk`
    }) + "\n"
  );
  process.exit(1);
}
var rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
var activeQueries = /* @__PURE__ */ new Map();
var pendingApprovals = /* @__PURE__ */ new Map();
var MAX_ATTACHMENTS_PER_TURN = 10;
var MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
var MAX_TEXT_ATTACHMENT_CHARS = 4e4;
var TEXT_ATTACHMENT_EXTENSIONS = /* @__PURE__ */ new Set([
  "txt",
  "md",
  "json",
  "js",
  "ts",
  "tsx",
  "jsx",
  "py",
  "rs",
  "go",
  "css",
  "html",
  "yaml",
  "yml",
  "toml",
  "xml",
  "sql",
  "sh",
  "csv",
  "svg"
]);
var IMAGE_ATTACHMENT_MEDIA_TYPES = /* @__PURE__ */ new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"]
]);
var SUPPORTED_IMAGE_MIME_TYPES = new Set(IMAGE_ATTACHMENT_MEDIA_TYPES.values());
function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}
function truncateTextToMaxChars(value, maxChars) {
  if ([...value].length <= maxChars) {
    return [value, false];
  }
  return [[...value].slice(0, maxChars).join(""), true];
}
function attachmentExtension(attachment) {
  const fileName = attachment?.fileName || attachment?.filePath || "";
  const extension = path.extname(fileName).replace(/^\./, "").toLowerCase();
  return extension || "";
}
function normalizeAttachmentMimeType(attachment) {
  const mimeType = attachment?.mimeType;
  return typeof mimeType === "string" && mimeType.trim() ? mimeType.trim().toLowerCase() : null;
}
function isSupportedTextMimeType(mimeType) {
  return mimeType.startsWith("text/") || mimeType.includes("json") || mimeType.includes("xml") || mimeType.includes("yaml") || mimeType.includes("toml") || mimeType.includes("javascript") || mimeType.includes("typescript") || mimeType.includes("x-rust") || mimeType.includes("x-python") || mimeType.includes("x-go") || mimeType.includes("x-shellscript") || mimeType.includes("sql") || mimeType.includes("csv");
}
function classifyAttachment(attachment) {
  const mimeType = normalizeAttachmentMimeType(attachment);
  const extension = attachmentExtension(attachment);
  if (mimeType && SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
    return {
      kind: "image",
      mediaType: mimeType
    };
  }
  if (mimeType === "image/svg+xml") {
    return { kind: "text" };
  }
  if (mimeType && isSupportedTextMimeType(mimeType)) {
    return { kind: "text" };
  }
  if (IMAGE_ATTACHMENT_MEDIA_TYPES.has(extension)) {
    return {
      kind: "image",
      mediaType: IMAGE_ATTACHMENT_MEDIA_TYPES.get(extension)
    };
  }
  if (TEXT_ATTACHMENT_EXTENSIONS.has(extension)) {
    return { kind: "text" };
  }
  return null;
}
async function buildAttachmentContentBlock(attachment, cwd) {
  const resolvedPath = normalizePath(cwd, attachment?.filePath ?? attachment?.path);
  const fileName = typeof attachment?.fileName === "string" && attachment.fileName.trim() || (resolvedPath ? path.basename(resolvedPath) : "attachment");
  if (!resolvedPath) {
    throw new Error(`Attachment "${fileName}" has an empty path.`);
  }
  const attachmentType = classifyAttachment(attachment);
  if (!attachmentType) {
    throw new Error(
      `Attachment "${fileName}" is not supported by the Claude sidecar. Only text and PNG/JPEG/GIF/WEBP image attachments are currently supported.`
    );
  }
  let bytes;
  try {
    bytes = await readFile(resolvedPath);
  } catch (err) {
    throw new Error(
      `Attachment "${fileName}" could not be read at "${resolvedPath}": ${err.message || String(err)}`
    );
  }
  const sizeBytes = Math.max(bytes.byteLength, Number(attachment?.sizeBytes) || 0);
  if (sizeBytes > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Attachment "${fileName}" exceeds the 10 MB per-file limit.`);
  }
  if (attachmentType.kind === "image") {
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: attachmentType.mediaType,
        data: bytes.toString("base64")
      }
    };
  }
  const rawText = bytes.toString("utf8");
  const [truncatedText, wasTruncated] = truncateTextToMaxChars(
    rawText,
    MAX_TEXT_ATTACHMENT_CHARS
  );
  let text = `Attached text file: ${fileName} (${resolvedPath})
<attached-file-content>
${truncatedText}
</attached-file-content>`;
  if (wasTruncated) {
    text += `

[Attachment content was truncated to ${MAX_TEXT_ATTACHMENT_CHARS} characters.]`;
  }
  return {
    type: "text",
    text
  };
}
function buildPromptInput(prompt, attachments, cwd, sessionIdHint) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return prompt;
  }
  if (attachments.length > MAX_ATTACHMENTS_PER_TURN) {
    throw new Error(
      `You can attach at most ${MAX_ATTACHMENTS_PER_TURN} files per Claude turn.`
    );
  }
  return async function* promptWithAttachments() {
    const content = [];
    if (typeof prompt === "string" && prompt.length > 0) {
      content.push({ type: "text", text: prompt });
    }
    for (const attachment of attachments) {
      content.push(await buildAttachmentContentBlock(attachment, cwd));
    }
    if (content.length === 0) {
      throw new Error(
        "Claude turn must include either a prompt or at least one supported attachment."
      );
    }
    yield {
      type: "user",
      message: {
        role: "user",
        content
      },
      parent_tool_use_id: null,
      session_id: sessionIdHint || ""
    };
  }();
}
function mapToolNameToActionType(toolName) {
  switch (toolName) {
    case "Read":
      return "file_read";
    case "Write":
      return "file_write";
    case "Edit":
      return "file_edit";
    case "Bash":
      return "command";
    case "WebFetch":
      return "search";
    case "Glob":
    case "Grep":
      return "search";
    default:
      return "other";
  }
}
function summarizeTool(toolName, toolInput) {
  if (!toolInput) return toolName;
  if (toolInput.command) return `${toolName}: ${toolInput.command}`;
  if (toolInput.file_path) return `${toolName}: ${toolInput.file_path}`;
  if (toolInput.pattern) return `${toolName}: ${toolInput.pattern}`;
  if (toolInput.url) return `${toolName}: ${toolInput.url}`;
  if (toolInput.prompt) return `${toolName}: ${toolInput.prompt.slice(0, 80)}`;
  return toolName;
}
function normalizePath(cwd, value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  return path.resolve(cwd, value);
}
function isWithinRoot(rootPath, targetPath) {
  const rel = path.relative(rootPath, targetPath);
  return rel === "" || !rel.startsWith("..") && !path.isAbsolute(rel);
}
function isWithinAnyRoot(roots, targetPath) {
  return roots.some((root) => isWithinRoot(root, targetPath));
}
function collectCandidatePaths(toolName, toolInput, cwd) {
  const paths = [];
  const add = (value) => {
    const normalized = normalizePath(cwd, value);
    if (normalized) {
      paths.push(normalized);
    }
  };
  switch (toolName) {
    case "Read":
    case "Write":
    case "Edit":
      add(toolInput?.file_path ?? toolInput?.path);
      add(toolInput?.new_file_path);
      add(toolInput?.old_file_path);
      break;
    case "Glob":
    case "Grep":
      add(toolInput?.path);
      add(toolInput?.cwd);
      break;
    default:
      break;
  }
  return paths;
}
function resolveTrustMode(approvalPolicy, allowNetwork) {
  if (approvalPolicy === "untrusted") {
    return "restricted";
  }
  return allowNetwork ? "trusted" : "standard";
}
function requiresApproval(trustMode, toolName) {
  if (trustMode === "trusted") {
    return false;
  }
  if (trustMode === "restricted") {
    return true;
  }
  return !["Read", "Glob", "Grep"].includes(toolName);
}
function createQueryContext(id) {
  return {
    id,
    query: null,
    actionCounter: 0,
    pendingActionIds: [],
    pendingApprovalIds: /* @__PURE__ */ new Set(),
    cancelled: false
  };
}
function cleanupPendingApprovalsForQuery(queryId, denialMessage) {
  const context = activeQueries.get(queryId);
  if (!context) {
    return;
  }
  for (const approvalId of context.pendingApprovalIds) {
    const pending = pendingApprovals.get(approvalId);
    if (!pending) {
      continue;
    }
    pendingApprovals.delete(approvalId);
    pending.resolve({
      behavior: "deny",
      message: denialMessage
    });
  }
  context.pendingApprovalIds.clear();
}
async function requestApproval(context, toolName, toolInput) {
  const approvalId = `${context.id}:approval:${context.pendingApprovalIds.size + 1}:${Date.now()}`;
  emit({
    id: context.id,
    type: "approval_requested",
    approvalId,
    actionType: mapToolNameToActionType(toolName),
    summary: summarizeTool(toolName, toolInput),
    details: toolInput ?? {}
  });
  const permission = await new Promise((resolve) => {
    pendingApprovals.set(approvalId, {
      queryId: context.id,
      resolve
    });
    context.pendingApprovalIds.add(approvalId);
  });
  context.pendingApprovalIds.delete(approvalId);
  pendingApprovals.delete(approvalId);
  return permission;
}
function buildPermissionHandler({
  context,
  cwd,
  writableRoots,
  allowNetwork,
  approvalPolicy
}) {
  const normalizedRoots = writableRoots.map((root) => path.resolve(root));
  const trustMode = resolveTrustMode(approvalPolicy, allowNetwork);
  return async (toolName, input, options) => {
    const toolInput = input ?? {};
    if (!allowNetwork && toolName === "WebFetch") {
      return {
        behavior: "deny",
        message: "Network access is disabled for this repository."
      };
    }
    if (options?.blockedPath) {
      return {
        behavior: "deny",
        message: `Path outside the allowed workspace scope: ${options.blockedPath}`
      };
    }
    if (toolName === "Write" || toolName === "Edit") {
      const candidatePaths = collectCandidatePaths(toolName, toolInput, cwd);
      if (candidatePaths.length > 0 && !candidatePaths.every((candidate) => isWithinAnyRoot(normalizedRoots, candidate))) {
        return {
          behavior: "deny",
          message: "This file path is outside the approved writable roots for the thread."
        };
      }
    }
    if (!requiresApproval(trustMode, toolName)) {
      return { behavior: "allow" };
    }
    return requestApproval(context, toolName, toolInput);
  };
}
function resolveApprovalDecision(response) {
  const decision = typeof response?.decision === "string" ? response.decision : "";
  if (decision === "accept" || decision === "accept_for_session") {
    return {
      behavior: "allow"
    };
  }
  return {
    behavior: "deny",
    message: "Tool usage denied by the user."
  };
}
async function handleQuery(req) {
  const { id, params = {} } = req;
  const {
    prompt,
    attachments = [],
    cwd,
    model,
    allowedTools,
    systemPrompt,
    resume,
    sessionId,
    maxTurns,
    planMode,
    approvalPolicy,
    allowNetwork,
    writableRoots = [],
    reasoningEffort
  } = params;
  const context = createQueryContext(id);
  activeQueries.set(id, context);
  const toolList = allowedTools || [
    "Read",
    "Write",
    "Edit",
    "Bash",
    "Glob",
    "Grep",
    ...allowNetwork ? ["WebFetch"] : []
  ];
  const sessionCwd = cwd || process.cwd();
  const normalizedWritableRoots = writableRoots.length > 0 ? writableRoots.map((root) => path.resolve(root)) : [sessionCwd];
  const options = {
    cwd: sessionCwd,
    additionalDirectories: normalizedWritableRoots.filter(
      (root) => root !== path.resolve(sessionCwd)
    ),
    permissionMode: planMode ? "plan" : "dontAsk",
    allowedTools: toolList,
    canUseTool: buildPermissionHandler({
      context,
      cwd: sessionCwd,
      writableRoots: normalizedWritableRoots,
      allowNetwork: Boolean(allowNetwork),
      approvalPolicy
    }),
    settingSources: ["project"],
    sandbox: {
      enabled: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      filesystem: {
        allowWrite: normalizedWritableRoots
      },
      ...allowNetwork ? {} : {
        network: {
          allowedDomains: [],
          allowLocalBinding: false,
          allowUnixSockets: []
        }
      }
    },
    settings: {
      permissions: {
        defaultMode: planMode ? "plan" : "dontAsk",
        disableBypassPermissionsMode: "disable"
      }
    },
    includePartialMessages: true,
    hooks: {
      PreToolUse: [
        {
          matcher: ".*",
          hooks: [
            async (hookInput) => {
              const actionId = `claude-action-${++context.actionCounter}`;
              const toolName = hookInput?.tool_name || hookInput?.name || "unknown";
              const toolInput = hookInput?.tool_input || hookInput?.input || {};
              context.pendingActionIds.push(actionId);
              emit({
                id,
                type: "action_started",
                actionId,
                actionType: mapToolNameToActionType(toolName),
                toolName,
                summary: summarizeTool(toolName, toolInput),
                details: toolInput
              });
              return {};
            }
          ]
        }
      ],
      PostToolUse: [
        {
          matcher: ".*",
          hooks: [
            async (hookInput) => {
              const actionId = context.pendingActionIds.pop() || `claude-action-${context.actionCounter}`;
              const output = hookInput?.tool_result || hookInput?.result;
              const outputStr = typeof output === "string" ? output.slice(0, 4e3) : output != null ? JSON.stringify(output).slice(0, 4e3) : void 0;
              emit({
                id,
                type: "action_completed",
                actionId,
                success: true,
                output: outputStr,
                durationMs: 0
              });
              return {};
            }
          ]
        }
      ],
      PostToolUseFailure: [
        {
          matcher: ".*",
          hooks: [
            async (hookInput) => {
              const actionId = context.pendingActionIds.pop() || `claude-action-${context.actionCounter}`;
              emit({
                id,
                type: "action_completed",
                actionId,
                success: false,
                error: hookInput?.error?.message || hookInput?.error || "Tool execution failed",
                durationMs: 0
              });
              return {};
            }
          ]
        }
      ]
    }
  };
  if (model) options.model = model;
  if (systemPrompt) options.systemPrompt = systemPrompt;
  if (resume) options.resume = resume;
  if (sessionId) options.sessionId = sessionId;
  if (maxTurns) options.maxTurns = maxTurns;
  if (reasoningEffort) options.effort = reasoningEffort;
  try {
    emit({ id, type: "turn_started" });
    let actualSessionId = null;
    let sawTextDelta = false;
    const promptInput = buildPromptInput(
      prompt,
      attachments,
      sessionCwd,
      sessionId || resume || ""
    );
    const query = queryFn({ prompt: promptInput, options });
    context.query = query;
    for await (const message of query) {
      if (context.cancelled) {
        break;
      }
      if (message.type === "system" && message.subtype === "init") {
        actualSessionId = message.session_id;
        emit({ id, type: "session_init", sessionId: actualSessionId });
      } else if (message.type === "stream_event") {
        const streamEvent = message.event;
        if (streamEvent?.type !== "content_block_delta") {
          continue;
        }
        const delta = streamEvent.delta;
        if (delta?.type === "text_delta" && typeof delta.text === "string" && delta.text.length > 0) {
          sawTextDelta = true;
          emit({ id, type: "text_delta", content: delta.text });
        } else if (delta?.type === "thinking_delta" && typeof delta.thinking === "string" && delta.thinking.length > 0) {
          emit({ id, type: "thinking_delta", content: delta.thinking });
        }
      } else if ("result" in message && typeof message.result === "string" && message.result.length > 0 && !sawTextDelta) {
        emit({ id, type: "text_delta", content: message.result });
      }
    }
    emit({
      id,
      type: "turn_completed",
      status: context.cancelled ? "interrupted" : "completed",
      sessionId: actualSessionId
    });
  } catch (err) {
    emit({
      id,
      type: "error",
      message: err.message || String(err),
      recoverable: false
    });
    emit({ id, type: "turn_completed", status: "failed", sessionId: null });
  } finally {
    cleanupPendingApprovalsForQuery(id, "Claude query was canceled.");
    activeQueries.delete(id);
  }
}
function handleCancel(params = {}) {
  const requestId = params.requestId || params.request_id || params.id || null;
  if (!requestId) {
    return;
  }
  const context = activeQueries.get(requestId);
  if (!context) {
    return;
  }
  context.cancelled = true;
  cleanupPendingApprovalsForQuery(
    requestId,
    "Claude query was canceled before approval was answered."
  );
  context.query?.close();
}
function handleApprovalResponse(params = {}) {
  const approvalId = params.approvalId || params.approval_id;
  if (!approvalId) {
    return;
  }
  const pending = pendingApprovals.get(approvalId);
  if (!pending) {
    return;
  }
  pendingApprovals.delete(approvalId);
  const context = activeQueries.get(pending.queryId);
  context?.pendingApprovalIds.delete(approvalId);
  pending.resolve(resolveApprovalDecision(params.response || {}));
}
rl.on("line", (line) => {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    emit({ type: "error", message: "invalid JSON input" });
    return;
  }
  if (req.method === "cancel") {
    handleCancel(req.params || {});
    return;
  }
  if (req.method === "approval_response") {
    handleApprovalResponse(req.params || {});
    return;
  }
  if (req.method === "version") {
    emit({ id: req.id, type: "version", version: "1.0.0" });
    return;
  }
  if (req.method === "query") {
    void handleQuery(req);
  }
});
rl.on("close", () => process.exit(0));
emit({ type: "ready" });
