import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";
import { callGenericPopup, POPUP_TYPE } from "../../../popup.js";

const EXT_ID = "LittleWhiteBox";
const C = {
  MAX_HISTORY: 10,
  CHECK: 200,
  DEBOUNCE: 300,
  CLEAN: 300000,
  TARGET: "/api/backends/chat-completions/generate",
  TIMEOUT: 30,
  ASSOC_DELAY: 1000,
  REQ_WINDOW: 30000,
};

const S = {
  active: false,
  isPreview: false,
  isLong: false,
  previewData: null,
  previewIds: new Set(),
  interceptedIds: [],
  history: [],
  listeners: [],
  resolve: null,
  reject: null,
  sendBtnWasDisabled: false,
  longPressTimer: null,
  longPressDelay: 1000,
  chatLenBefore: 0,
  restoreLong: null,
  cleanTimer: null,
  previewAbort: null,
};

const q = (sel) => $(sel);
const ON = (ev, cb) => eventSource.on(ev, cb);
const OFF = (ev, cb) => eventSource.removeListener(ev, cb);
const now = () => Date.now();
const isTarget = (url, opt = {}) => url?.includes(C.TARGET) && opt.body?.includes('"messages"');
const colorXml = (t) => (typeof t === "string" ? t.replace(/<([^>]+)>/g, '<span style="color:#999; font-weight:bold;">&lt;$1&gt;</span>') : t);
const geEnabled = () => {
  try { return ("isXiaobaixEnabled" in window) ? !!window["isXiaobaixEnabled"] : true; } catch { return true; }
};
function getSettings() {
  const d = extension_settings[EXT_ID] || (extension_settings[EXT_ID] = {});
  d.preview = d.preview || { enabled: false, timeoutSeconds: C.TIMEOUT };
  d.recorded = d.recorded || { enabled: true };
  d.preview.timeoutSeconds = C.TIMEOUT;
  return d;
}
function debounce(fn, wait) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), wait); };
}

let __installed = false;
let __originalDesc = null;
let __lastKnownImpl = null;
let __ensureTimer = null;
let __pollTimer = null;
let __guardFetch = null;
const ENSURE_INTERVAL = 1500;

function getLatestFetchImpl() {
  try {
    if (typeof __lastKnownImpl === "function") return __lastKnownImpl;
    const d = Object.getOwnPropertyDescriptor(window, "fetch");
    if (d) {
      if (typeof d.value === "function" && d.value !== getGuardFetch && d.value !== __guardFetch) return d.value;
      if (typeof d.get === "function" && d.get !== getGuardFetch) {
        try {
          const v = d.get.call(window);
          if (typeof v === "function" && v !== __guardFetch) return v;
        } catch {}
      }
    }
    if (typeof globalThis.fetch === "function" && globalThis.fetch !== __guardFetch) return globalThis.fetch;
    if (typeof fetch === "function" && fetch !== __guardFetch) return fetch;
    return Function.prototype;
  } catch {
    return (typeof fetch === "function" && fetch !== __guardFetch) ? fetch : Function.prototype;
  }
}

function getGuardFetch() { return __guardFetch; }
function makeGuardFetch() {
  const guard = function (url, options = {}) {
    const latest = getLatestFetchImpl();
    try {
      if (isTarget(url, options)) {
        if (S.isPreview || S.isLong) {
          return interceptPreview(url, options).catch(
            () => new Response(JSON.stringify({ error: { message: "拦截失败，请手动中止消息生成。" } }), { status: 500, headers: { "Content-Type": "application/json" } })
          );
        } else {
          try { recordRealApiRequest(url, options); } catch {}
        }
      }
    } catch {}
    return Reflect.apply(latest, this, arguments);
  };
  return guard;
}

function installUltimateFetchGuard() {
  if (__installed) return; __installed = true;
  try {
    __originalDesc = Object.getOwnPropertyDescriptor(window, "fetch") || { configurable: true, enumerable: true, value: window.fetch };
    __guardFetch = makeGuardFetch();

    Object.defineProperty(window, "fetch", {
      configurable: true,
      enumerable: __originalDesc.enumerable ?? true,
      get: getGuardFetch,
      set(v) { __lastKnownImpl = (typeof v === "function") ? v : (__originalDesc?.value || fetch); },
    });

    if (typeof __originalDesc.value === "function") {
      __lastKnownImpl = __originalDesc.value;
    } else if (typeof window.fetch === "function" && window.fetch !== __guardFetch) {
      __lastKnownImpl = window.fetch;
    }

const ensure = () => {
  if (__ensureTimer) return;
  __ensureTimer = setTimeout(() => {
    __ensureTimer = null;
    try {
      const desc = Object.getOwnPropertyDescriptor(window, "fetch");
      if (!desc || desc.get !== getGuardFetch) {
        let latestVal = null;
        try {
          if (desc?.value && typeof desc.value === "function") {
            latestVal = desc.value;
          } else if (typeof desc?.get === "function" && desc.get !== getGuardFetch) {
            latestVal = desc.get.call(window);
          }
        } catch {}
        if (typeof latestVal === "function") __lastKnownImpl = latestVal;

        __originalDesc = desc || __originalDesc;
        Object.defineProperty(window, "fetch", {
          configurable: true,
          enumerable: (desc?.enumerable ?? __originalDesc?.enumerable ?? true),
          get: getGuardFetch,
          set(v) { __lastKnownImpl = (typeof v === "function") ? v : (__originalDesc?.value || fetch); },
        });
      }
    } catch {}
  }, 0);
};

    __pollTimer = setInterval(() => {
    try {
        const desc = Object.getOwnPropertyDescriptor(window, "fetch");
        if (!desc || desc.get !== getGuardFetch) {
        let latestVal = null;
        try {
            if (desc?.value && typeof desc.value === "function") {
            latestVal = desc.value;
            } else if (typeof desc?.get === "function" && desc.get !== getGuardFetch) {
            latestVal = desc.get.call(window);
            }
        } catch {}
        if (typeof latestVal === "function") __lastKnownImpl = latestVal;

        Object.defineProperty(window, "fetch", {
            configurable: true,
            enumerable: (desc?.enumerable ?? __originalDesc?.enumerable ?? true),
            get: getGuardFetch,
            set(v) { __lastKnownImpl = (typeof v === "function") ? v : (__originalDesc?.value || fetch); },
        });
        }
    } catch {}
    }, ENSURE_INTERVAL);

    if (document.readyState === "complete") ensure(); else window.addEventListener("load", ensure, { once: true });

    __pollTimer = setInterval(() => {
      try {
        const desc = Object.getOwnPropertyDescriptor(window, "fetch");
        if (!desc || desc.get !== getGuardFetch) {
          Object.defineProperty(window, "fetch", {
            configurable: true,
            enumerable: (desc?.enumerable ?? __originalDesc?.enumerable ?? true),
            get: getGuardFetch,
            set(v) { __lastKnownImpl = (typeof v === "function") ? v : (__originalDesc?.value || fetch); },
          });
        }
      } catch {}
    }, ENSURE_INTERVAL);
  } catch (e) { console.error("[LittleWhiteBox] installUltimateFetchGuard error", e); }
}
function uninstallUltimateFetchGuard() {
  try {
    if (!__installed) return; __installed = false;
    if (__ensureTimer) { clearTimeout(__ensureTimer); __ensureTimer = null; }
    if (__pollTimer) { clearInterval(__pollTimer); __pollTimer = null; }
    if (__originalDesc) {
      try {
        if (typeof __lastKnownImpl === "function") {
          Object.defineProperty(window, "fetch", {
            configurable: true,
            enumerable: __originalDesc.enumerable ?? true,
            writable: true,
            value: __lastKnownImpl,
          });
        } else {
          Object.defineProperty(window, "fetch", __originalDesc);
        }
      } catch {
        window.fetch = __lastKnownImpl || __originalDesc?.value || fetch;
      }
    } else {
      window.fetch = __lastKnownImpl || window.fetch || fetch;
    }
  } catch (e) { console.error("[LittleWhiteBox] uninstallUltimateFetchGuard error", e); }
  finally { __originalDesc = __lastKnownImpl = __guardFetch = null; }
}
function setupFetchWrapperOnce() { if (!S.active) { installUltimateFetchGuard(); S.active = true; } }
function restoreFetch() { if (S.active) { uninstallUltimateFetchGuard(); S.active = false; } }
function updateFetchState() {
  const set = getSettings(), need = (set.preview.enabled || set.recorded.enabled);
  if (need && !S.active) setupFetchWrapperOnce();
  if (!need && S.active) restoreFetch();
}
/* ========================== end fetch guard ========================== */

function manageSendButton(disable = true) {
  const $b = q("#send_but");
  if (disable) {
    S.sendBtnWasDisabled = $b.prop("disabled");
    $b.prop("disabled", true).off("click.preview-block").on("click.preview-block", (e) => { e.preventDefault(); e.stopImmediatePropagation(); return false; });
  } else {
    $b.prop("disabled", S.sendBtnWasDisabled).off("click.preview-block"); S.sendBtnWasDisabled = false;
  }
}
function triggerSend() {
  const $b = q("#send_but"), $t = q("#send_textarea"), txt = String($t.val() || "");
  if (!txt.trim()) return false;
  const was = $b.prop("disabled"); $b.prop("disabled", false);
  $b[0].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  if (was) $b.prop("disabled", true);
  return true;
}

function pushHistory(rec) { S.history.unshift(rec); if (S.history.length > C.MAX_HISTORY) S.history.length = C.MAX_HISTORY; }
function extractUserInput(messages) {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]?.role === "user") return messages[i].content || "";
  return "";
}
function recordRealApiRequest(url, options) {
  const data = JSON.parse(options.body), ctx = getContext();
  pushHistory({
    url, method: options.method || "POST", requestData: data, messages: data.messages || [], model: data.model || "Unknown",
    timestamp: now(), messageId: ctx.chat?.length || 0, characterName: ctx.characters?.[ctx.characterId]?.name || "Unknown",
    userInput: extractUserInput(data.messages || []), isRealRequest: true,
  });
  setTimeout(() => { if (S.history[0] && !S.history[0].associatedMessageId) S.history[0].associatedMessageId = ctx.chat?.length || 0; }, C.ASSOC_DELAY);
}
function findRecordForMsg(id) {
  if (!S.history.length) return null;
  const preds = [
    (r) => r.associatedMessageId === id,
    (r) => r.messageId === id,
    (r) => r.messageId === id - 1,
    (r) => Math.abs(r.messageId - id) <= 1,
  ];
  for (const p of preds) { const m = S.history.find(p); if (m) return m; }
  const cands = S.history.filter((r) => r.messageId <= id + 2);
  return cands.length ? cands.sort((a, b) => b.messageId - a.messageId)[0] : S.history[0];
}

async function interceptPreview(url, options) {
  const data = JSON.parse(options.body), userInput = extractUserInput(data?.messages || []);
  S.previewData = { url, method: options.method || "POST", requestData: data, messages: data?.messages || [], model: data?.model || "Unknown", timestamp: now(), userInput, isPreview: true };
  if (S.isLong) {
    setTimeout(() => {
      displayPreview(S.previewData, userInput);
      if (S.restoreLong) {
        try { S.restoreLong(); } catch {}
        const ctx = getContext(); S.chatLenBefore = ctx.chat?.length || 0; S.restoreLong = hijackMessageCreation();
      }
    }, 100);
  } else if (S.resolve) { S.resolve({ success: true, data: S.previewData }); S.resolve = S.reject = null; }
  return new Response(JSON.stringify({ choices: [{ message: { content: "" }, finish_reason: "stop" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
}
function hijackMessageCreation() {
  const ctx = getContext(), origPush = ctx.chat.push, beforeLen = ctx.chat.length;
  ctx.chat.push = function (...items) {
    if (S.isPreview || S.isLong) {
      const start = this.length, res = origPush.apply(this, items);
      for (let i = 0; i < items.length; i++) { const id = start + i; S.previewIds.add(id); if (S.isPreview) recordInterceptedMessage(id); }
      return res;
    }
    return origPush.apply(this, items);
  };
  const ap = Element.prototype.appendChild, ib = Element.prototype.insertBefore;
  Element.prototype.appendChild = function (child) { return (S.isPreview || S.isLong) && child?.classList?.contains("mes") ? child : ap.call(this, child); };
  Element.prototype.insertBefore = function (child, ref) { return (S.isPreview || S.isLong) && child?.classList?.contains("mes") ? child : ib.call(this, child, ref); };
  return function restore() {
    ctx.chat.push = origPush; Element.prototype.appendChild = ap; Element.prototype.insertBefore = ib;
    if (S.previewIds.size) {
      const ids = [...S.previewIds].sort((a, b) => b - a);
      ids.forEach((id) => { if (id < ctx.chat.length) ctx.chat.splice(id, 1); $(`#chat .mes[mesid="${id}"]`).remove(); });
      while (ctx.chat.length > beforeLen) ctx.chat.pop();
      S.previewIds.clear();
    }
  };
}
function waitIntercept() {
  const timeout = getSettings().preview.timeoutSeconds * 1000;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { if (S.resolve) { S.resolve({ success: false, error: `等待超时 (${timeout / 1000}秒)` }); S.resolve = S.reject = null; } }, timeout);
    S.resolve = (v) => { clearTimeout(t); resolve(v); };
    S.reject = (e) => { clearTimeout(t); reject(e); };
  });
}

const MIRROR = { MERGE: "merge", MERGE_TOOLS: "merge_tools", SEMI: "semi", SEMI_TOOLS: "semi_tools", STRICT: "strict", STRICT_TOOLS: "strict_tools", SINGLE: "single" };
const mapRole = { system: { label: "SYSTEM:", color: "#F7E3DA" }, user: { label: "USER:", color: "#F0ADA7" }, assistant: { label: "ASSISTANT:", color: "#6BB2CC" } };

function getNames(req) {
  const n = { charName: String(req?.char_name || ""), userName: String(req?.user_name || ""), groupNames: Array.isArray(req?.group_names) ? req.group_names.map(String) : [] };
  n.startsWithGroupName = (m) => n.groupNames.some((g) => String(m || "").startsWith(`${g}: `));
  return n;
}
function toText(m) {
  const c = m?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c.map((p) => {
      if (p?.type === "text") return String(p.text || "");
      if (p?.type === "image_url") return "[image]";
      if (p?.type === "video_url") return "[video]";
      if (typeof p === "string") return p;
      if (typeof p?.content === "string") return p.content;
      return "";
    }).filter(Boolean).join("\n\n");
  }
  return String(c || "");
}
function applyName(m, names) {
  const { role, name } = m; let t = toText(m);
  if (role === "system" && name === "example_assistant") {
    if (names.charName && !t.startsWith(`${names.charName}: `) && !names.startsWithGroupName(t)) t = `${names.charName}: ${t}`;
  } else if (role === "system" && name === "example_user") {
    if (names.userName && !t.startsWith(`${names.userName}: `)) t = `${names.userName}: ${t}`;
  } else if (name && role !== "system") {
    if (!t.startsWith(`${name}: `)) t = `${name}: ${t}`;
  }
  return { ...m, content: t, name: undefined };
}
function mergeMessages(messages, names, { strict = false, placeholders = false, single = false, tools = false } = {}) {
  if (!Array.isArray(messages)) return [];
  let mapped = messages.map((m) => applyName({ ...m }, names)).map((x) => {
    const m = { ...x };
    if (!tools) { if (m.role === "tool") m.role = "user"; delete m.tool_calls; delete m.tool_call_id; }
    if (single) {
      if (m.role === "assistant") {
        const t = String(m.content || "");
        if (names.charName && !t.startsWith(`${names.charName}: `) && !names.startsWithGroupName(t)) m.content = `${names.charName}: ${t}`;
      }
      if (m.role === "user") {
        const t = String(m.content || "");
        if (names.userName && !t.startsWith(`${names.userName}: `)) m.content = `${names.userName}: ${t}`;
      }
      m.role = "user";
    }
    return m;
  });
  const squash = (arr) => {
    const out = [];
    for (const m of arr) {
      if (out.length && out[out.length - 1].role === m.role && String(m.content || "").length && m.role !== "tool") {
        out[out.length - 1].content = `${out[out.length - 1].content}\n\n${m.content}`;
      } else out.push(m);
    }
    return out;
  };
  let sq = squash(mapped);
  if (strict) {
    for (let i = 0; i < sq.length; i++) if (i > 0 && sq[i].role === "system") sq[i].role = "user";
    if (placeholders) {
      if (!sq.length) sq.push({ role: "user", content: "[Start a new chat]" });
      else if (sq[0].role === "system" && (sq.length === 1 || sq[1].role !== "user")) sq.splice(1, 0, { role: "user", content: "[Start a new chat]" });
      else if (sq[0].role !== "system" && sq[0].role !== "user") sq.unshift({ role: "user", content: "[Start a new chat]" });
    }
    return squash(sq);
  }
  if (!sq.length) sq.push({ role: "user", content: "[Start a new chat]" });
  return sq;
}
function mirror(requestData) {
  try {
    let type = String(requestData?.custom_prompt_post_processing || "").toLowerCase();
    const source = String(requestData?.chat_completion_source || "").toLowerCase();
    if (source === "perplexity") type = MIRROR.STRICT;
    const names = getNames(requestData || {});
    const src = Array.isArray(requestData?.messages) ? JSON.parse(JSON.stringify(requestData.messages)) : [];
    const mk = (o) => mergeMessages(src, names, o);
    switch (type) {
      case MIRROR.MERGE: return mk({ strict: false, placeholders: false, single: false, tools: false });
      case MIRROR.MERGE_TOOLS: return mk({ strict: false, placeholders: false, single: false, tools: true });
      case MIRROR.SEMI: return mk({ strict: true, placeholders: false, single: false, tools: false });
      case MIRROR.SEMI_TOOLS: return mk({ strict: true, placeholders: false, single: false, tools: true });
      case MIRROR.STRICT: return mk({ strict: true, placeholders: true, single: false, tools: false });
      case MIRROR.STRICT_TOOLS: return mk({ strict: true, placeholders: true, single: false, tools: true });
      case MIRROR.SINGLE: return mk({ strict: true, placeholders: false, single: true, tools: false });
      default: return src;
    }
  } catch { return Array.isArray(requestData?.messages) ? requestData.messages : []; }
}
function finalMessagesForDisplay(data) {
  try {
    if (data?.requestData && Array.isArray(data.requestData.messages)) return mirror(data.requestData);
    if (Array.isArray(data?.messages)) return data.messages;
    return [];
  } catch { return Array.isArray(data?.messages) ? data.messages : []; }
}
function formatPreviewContent(data) {
  const msgs = finalMessagesForDisplay(data);
  let out = `↓酒馆日志↓(已整理好json格式使其更具可读性) (${msgs.length}):\n${"-".repeat(30)}\n`;
  msgs.forEach((m, i) => {
    const txt = m.content || "", role = mapRole[m.role] || { label: `${String(m.role || "").toUpperCase()}:`, color: "#FFF" };
    out += `<div style="color:${role.color};font-weight:bold;margin-top:${i ? "15px" : "0"};">${role.label}</div>`;
    out += /<[^>]+>/g.test(txt)
      ? `<pre style="white-space:pre-wrap;margin:5px 0;color:${role.color};">${colorXml(txt)}</pre>`
      : `<div style="margin:5px 0;color:${role.color};white-space:pre-wrap;">${txt}</div>`;
  });
  return out;
}
function formatRawJson(data) {
  try {
    const hasReq = data && typeof data === "object" && Array.isArray(data?.requestData?.messages);
    const hasMsgs = !hasReq && Array.isArray(data?.messages);
    let obj;
    if (hasReq) {
      const req = JSON.parse(JSON.stringify(data.requestData));
      try { req.messages = mirror(req); } catch {}
      obj = req;
    } else if (hasMsgs) {
      const fakeReq = { ...(data || {}), messages: data.messages };
      let outMsgs = null; try { outMsgs = mirror(fakeReq); } catch {}
      obj = { ...(data || {}), messages: outMsgs || data.messages };
    } else obj = data?.requestData ?? data;
    return colorXml(JSON.stringify(obj, null, 2));
  } catch { try { return colorXml(String(data)); } catch { return ""; } }
}
function buildPreviewHtml(data) {
  const formatted = formatPreviewContent(data), raw = formatRawJson(data);
  return `<div class="message-preview-container">
    <div class="message-preview-content-box">
      <div class="mp-state-formatted">${formatted}</div>
      <pre class="mp-state-raw" style="display:none; white-space:pre-wrap; margin-top:8px;">${raw}</pre>
    </div>
  </div>`;
}
function toggleRawButtonAction(evt) {
  const btn = evt?.currentTarget; if (!(btn instanceof HTMLElement)) return;
  const dlg = btn.closest(".popup"); const box = dlg?.querySelector(".message-preview-content-box");
  const f = box?.querySelector(".mp-state-formatted"); const r = box?.querySelector(".mp-state-raw");
  if (!(f instanceof HTMLElement) || !(r instanceof HTMLElement)) return;
  const rawShown = r.style.display !== "none"; r.style.display = rawShown ? "none" : "block"; f.style.display = rawShown ? "block" : "none";
  btn.textContent = rawShown ? "切换原始格式" : "切换整理格式";
}
async function openPreviewPopup(html, title) {
  await callGenericPopup(html, POPUP_TYPE.TEXT, title, {
    wide: true, large: true,
    customButtons: [{ text: "切换原始格式", classes: ["interactable", "popup-button-toggle-raw"], action: toggleRawButtonAction }],
  });
}
async function displayPreview(data) {
  try { await openPreviewPopup(buildPreviewHtml(data), "消息拦截"); } catch { toastr.error("显示拦截失败"); }
}

async function showPreview() {
  let restore = null, toast = null, backup = null;
  try {
    const set = getSettings(); if (!set.preview.enabled || !geEnabled()) return toastr.warning("消息拦截功能未启用");
    const text = String(q("#send_textarea").val() || "").trim(); if (!text) return toastr.error("请先输入消息内容");
    backup = text; manageSendButton(true);
    S.isPreview = true; S.previewData = null; S.previewIds.clear(); S.previewAbort = new AbortController();
    restore = hijackMessageCreation();
    toast = toastr.info(`正在拦截请求...（${set.preview.timeoutSeconds}秒超时）`, "消息拦截", { timeOut: 0, tapToDismiss: false });
    if (!triggerSend()) throw new Error("无法触发发送事件");
    const res = await waitIntercept().catch((e) => ({ success: false, error: e?.message || e }));
    if (toast) { toastr.clear(toast); toast = null; }
    if (res.success) { await displayPreview(res.data, text); toastr.success("拦截成功！", "", { timeOut: 3000 }); }
    else toastr.error(`拦截失败: ${res.error}`, "", { timeOut: 5000 });
  } catch (e) {
    if (toast) toastr.clear(toast); toastr.error(`拦截异常: ${e.message}`, "", { timeOut: 5000 });
  } finally {
    try { S.previewAbort?.abort("拦截结束"); } catch {} S.previewAbort = null;
    if (S.resolve) S.resolve({ success: false, error: "拦截已取消" }); S.resolve = S.reject = null;
    try { restore?.(); } catch {}
    S.isPreview = false; S.previewData = null; manageSendButton(false); if (backup) q("#send_textarea").val(backup);
  }
}
async function showHistoryPreview(messageId) {
  try {
    const set = getSettings(); if (!set.recorded.enabled || !geEnabled()) return;
    const rec = findRecordForMsg(messageId);
    if (rec?.messages?.length || rec?.requestData?.messages?.length) {
      const msg = { ...rec, isHistoryPreview: true, targetMessageId: messageId };
      await openPreviewPopup(buildPreviewHtml(msg), `消息历史查看 - 第 ${messageId + 1} 条消息`);
    } else toastr.warning(`未找到第 ${messageId + 1} 条消息的API请求记录`);
  } catch { toastr.error("查看历史消息失败"); }
}

const addHistoryButtonsDebounced = debounce(() => {
  const set = getSettings(); if (!set.recorded.enabled || !geEnabled()) return;
  $(".mes_history_preview").remove();
  $("#chat .mes").each(function () {
    const id = parseInt($(this).attr("mesid")); const isUser = $(this).attr("is_user") === "true";
    if (id <= 0 || isUser) return;
    const btn = $(`<div class="mes_btn mes_history_preview" title="查看历史API请求"><i class="fa-regular fa-note-sticky"></i></div>`).on("click", (e) => { e.preventDefault(); e.stopPropagation(); showHistoryPreview(id); });
    if (window.registerButtonToSubContainer && window.registerButtonToSubContainer(id, btn[0])) return;
    $(this).find(".flex-container.flex1.alignitemscenter").append(btn);
  });
}, C.DEBOUNCE);

function cleanupMemory() {
  if (S.history.length > C.MAX_HISTORY) S.history = S.history.slice(0, C.MAX_HISTORY);
  S.previewIds.clear(); S.previewData = null;
  $(".mes_history_preview").each(function () { if (!$(this).closest(".mes").length) $(this).remove(); });
  if (!S.isLong) S.interceptedIds = [];
}

function addEvents() {
  removeEvents();
  const L = [
    { e: event_types.MESSAGE_RECEIVED, h: addHistoryButtonsDebounced },
    { e: event_types.CHARACTER_MESSAGE_RENDERED, h: addHistoryButtonsDebounced },
    { e: event_types.USER_MESSAGE_RENDERED, h: addHistoryButtonsDebounced },
    { e: event_types.CHAT_CHANGED, h: () => { S.history = []; setTimeout(addHistoryButtonsDebounced, C.CHECK); } },
    {
      e: event_types.MESSAGE_RECEIVED, h: (messageId) => setTimeout(() => {
        const r = S.history.find((x) => !x.associatedMessageId && now() - x.timestamp < C.REQ_WINDOW);
        if (r) r.associatedMessageId = messageId;
      }, 100),
    },
  ];
  L.forEach(({ e, h }) => { ON(e, h); S.listeners.push({ e, h }); });

  const late = (payload) => {
    try {
      const ctx = getContext();
      pushHistory({
        url: C.TARGET, method: "POST", requestData: payload, messages: payload?.messages || [], model: payload?.model || "Unknown",
        timestamp: now(), messageId: ctx.chat?.length || 0, characterName: ctx.characters?.[ctx.characterId]?.name || "Unknown",
        userInput: extractUserInput(payload?.messages || []), isRealRequest: true, source: "settings_ready",
      });
    } catch {}
    queueMicrotask(() => setTimeout(() => updateFetchState(), 0));
  };
  eventSource.makeLast(event_types.CHAT_COMPLETION_SETTINGS_READY, late);
  S.listeners.push({ e: event_types.CHAT_COMPLETION_SETTINGS_READY, h: late });
}
function removeEvents() { S.listeners.forEach(({ e, h }) => OFF(e, h)); S.listeners = []; }

function toggleLong() {
  S.isLong = !S.isLong;
  const $b = q("#message_preview_btn");
  if (S.isLong) {
    const ctx = getContext(); S.chatLenBefore = ctx.chat?.length || 0; S.restoreLong = hijackMessageCreation();
    $b.css("color", "red"); toastr.info("持续拦截已开启", "", { timeOut: 2000 });
  } else {
    $b.css("color", ""); try { S.restoreLong?.(); } catch {} S.restoreLong = null; S.interceptedIds = []; S.chatLenBefore = 0;
    toastr.info("持续拦截已关闭", "", { timeOut: 2000 });
  }
}
function bindPreviewButton() {
  const $b = q("#message_preview_btn");
  $b.on("mousedown touchstart", () => { S.longPressTimer = setTimeout(() => toggleLong(), S.longPressDelay); });
  $b.on("mouseup touchend mouseleave", () => { if (S.longPressTimer) { clearTimeout(S.longPressTimer); S.longPressTimer = null; } });
  $b.on("click", () => {
    if (S.longPressTimer) { clearTimeout(S.longPressTimer); S.longPressTimer = null; return; }
    if (!S.isLong) showPreview();
  });
}
function recordInterceptedMessage(id) { if (S.isPreview && !S.interceptedIds.includes(id)) S.interceptedIds.push(id); }

async function deleteMessageById(id) {
  try {
    const ctx = getContext();
    if (id === ctx.chat?.length - 1) { await deleteLastMessage(); return true; } 
    if (ctx.chat && ctx.chat[id]) {
      ctx.chat.splice(id, 1); $(`#chat .mes[mesid="${id}"]`).remove(); if (ctx.chat_metadata) ctx.chat_metadata.tainted = true; return true;
    }
    const el = $(`#chat .mes[mesid="${id}"]`); if (el.length) { el.remove(); return true; }
    return false;
  } catch { return false; }
}
async function deleteInterceptedMessages() {
  try {
    if (!S.interceptedIds.length) return;
    const ids = [...S.interceptedIds].sort((a, b) => b - a); let n = 0;
    for (const id of ids) if (await deleteMessageById(id)) n++;
    S.interceptedIds = []; try { await saveChatConditional(); } catch {}
    if (n) toastr.success(`拦截模式下的 ${n} 条消息已自动删除`, "", { timeOut: 2000 });
  } catch { toastr.error("删除拦截消息失败"); }
}

function cleanup() {
  if (S.cleanTimer) { clearInterval(S.cleanTimer); S.cleanTimer = null; }
  removeEvents(); restoreFetch(); manageSendButton(false);
  $(".mes_history_preview").remove(); $("#message_preview_btn").remove(); cleanupMemory();
  Object.assign(S, { resolve: null, reject: null, isPreview: false, isLong: false, interceptedIds: [], chatLenBefore: 0, sendBtnWasDisabled: false });
  if (S.longPressTimer) { clearTimeout(S.longPressTimer); S.longPressTimer = null; }
  if (S.restoreLong) { try { S.restoreLong(); } catch {} S.restoreLong = null; }
}
function initMessagePreview() {
  try {
    cleanup();
    const set = getSettings();
    const btn = $(`<div id="message_preview_btn" class="fa-regular fa-note-sticky interactable" title="预览消息"></div>`);
    $("#send_but").before(btn); bindPreviewButton();

    $("#xiaobaix_preview_enabled").prop("checked", set.preview.enabled).on("change", function () {
      if (!geEnabled()) return; set.preview.enabled = $(this).prop("checked"); saveSettingsDebounced();
      $("#message_preview_btn").toggle(set.preview.enabled);
      if (set.preview.enabled) S.cleanTimer = setInterval(cleanupMemory, C.CLEAN); else if (S.cleanTimer) { clearInterval(S.cleanTimer); S.cleanTimer = null; }
      updateFetchState();
      if (!set.preview.enabled && set.recorded.enabled) { addEvents(); addHistoryButtonsDebounced(); }
    });

    $("#xiaobaix_recorded_enabled").prop("checked", set.recorded.enabled).on("change", function () {
      if (!geEnabled()) return; set.recorded.enabled = $(this).prop("checked"); saveSettingsDebounced();
      if (set.recorded.enabled) { addEvents(); addHistoryButtonsDebounced(); }
      else { $(".mes_history_preview").remove(); S.history.length = 0; if (!set.preview.enabled) removeEvents(); }
      updateFetchState();
    });

    if (!set.preview.enabled) $("#message_preview_btn").hide();
    updateFetchState();
    if (set.recorded.enabled) addHistoryButtonsDebounced();
    if (set.preview.enabled || set.recorded.enabled) addEvents();
    if (window["registerModuleCleanup"]) window["registerModuleCleanup"]("messagePreview", cleanup);
    if (set.preview.enabled) S.cleanTimer = setInterval(cleanupMemory, C.CLEAN);
  } catch { toastr.error("模块初始化失败"); }
}

window.addEventListener("beforeunload", cleanup);
window["messagePreviewCleanup"] = cleanup;

export { initMessagePreview, addHistoryButtonsDebounced, cleanup };
