/* ============= 模块常量与基础状态区 ============= */
import { getContext, extension_settings } from "../../../extensions.js";
import { updateMessageBlock } from "../../../../script.js";
import { getLocalVariable, setLocalVariable } from "../../../variables.js";

const MODULE_ID = 'variablesCore';
let initialized = false;
let listeners = [];

const TAG_RE = {
  varevent: /<\s*varevent[^>]*>([\s\S]*?)<\s*\/\s*varevent\s*>/gi,
  xbgetvar: /{{xbgetvar::([^}]+)}}/gi,
  scenario: /<\s*plot-log[^>]*>([\s\S]*?)<\s*\/\s*plot-log\s*>/gi,
};

const OP_ALIASES = {
  set: ['set', '记下', '记录', '录入', 'record'],
  push: ['push', '添入', '增录', '追加', 'append'],
  bump: ['bump', '推移', '变更', '调整', 'adjust'],
  del: ['del', '遗忘', '抹去', '删除', 'erase'],
};
const reEscape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ALL_OP_WORDS = Object.values(OP_ALIASES).flat();
const OP_WORDS_PATTERN = ALL_OP_WORDS.map(reEscape).sort((a,b)=>b.length-a.length).join('|');
const TOP_OP_RE = new RegExp(`^(${OP_WORDS_PATTERN})\\s*:\\s*$`, 'i');

const OP_MAP = {};
for (const [k, arr] of Object.entries(OP_ALIASES)) for (const a of arr) OP_MAP[a.toLowerCase()] = k;

const json = (v)=>{ try{return JSON.stringify(v)}catch{return ''} };
const parseObj = (raw)=>{
  if(raw==null) return null;
  if(typeof raw==='object') return raw && !Array.isArray(raw) ? raw : null;
  if(typeof raw!=='string') raw = String(raw);
  try{ const v=JSON.parse(raw); return v && typeof v==='object' && !Array.isArray(v) ? v : null; }catch{return null}
};
const on = (t,e,h)=>{ t?.on?.(e,h); listeners.push({target:t,event:e,handler:h}); };
const offAll = ()=>{ for(const {target,event,handler} of listeners){ try{target.off?.(event,handler)}catch{} try{target.removeListener?.(event,handler)}catch{} } listeners=[] };
const asObject = (rec)=>{ if(rec.mode!=='object'){ rec.mode='object'; rec.base={}; rec.next={}; rec.changed=true; delete rec.scalar; } return rec.next??(rec.next={}); };
const debounce=(fn,wait=100)=>{ let t=null; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn.apply(null,args),wait); }; };
const splitPathSegments=(path)=> String(path||'').split('.').map(s=>s.trim()).filter(Boolean).map(seg=>(/^\d+$/.test(seg)?Number(seg):seg));
function ensureDeepContainer(root,segs){ let cur=root; for(let i=0;i<segs.length-1;i++){ const key=segs[i]; const nextKey=segs[i+1]; const shouldBeArray= typeof nextKey==='number'; let val=cur?.[key]; if(val===undefined || val===null || typeof val!=='object'){ cur[key]= shouldBeArray ? [] : {}; } cur=cur[key]; } return { parent:cur, lastKey: segs[segs.length-1] }; }
function setDeepValue(root, path, value){ const segs=splitPathSegments(path); if(segs.length===0) return false; const {parent,lastKey}=ensureDeepContainer(root,segs); const prev=parent[lastKey]; if(prev!==value){ parent[lastKey]=value; return true; } return false; }
function pushDeepValue(root, path, values){ const segs=splitPathSegments(path); if(segs.length===0) return false; const {parent,lastKey}=ensureDeepContainer(root,segs); let arr=parent[lastKey]; let changed=false; if(!Array.isArray(arr)) arr = arr===undefined?[]:[arr]; const incoming=Array.isArray(values)?values:[values]; for(const v of incoming){ if(!arr.includes(v)){ arr.push(v); changed=true; } } if(changed){ parent[lastKey]=arr; } return changed; }
function deleteDeepKey(root, path){ const segs=splitPathSegments(path); if(segs.length===0) return false; const {parent,lastKey}=ensureDeepContainer(root,segs); if(Object.prototype.hasOwnProperty.call(parent,lastKey)){ delete parent[lastKey]; return true; } return false; }
const getRootAndPath=(name)=>{ const segs=String(name||'').split('.').map(s=>s.trim()).filter(Boolean); if(segs.length<=1) return {root:String(name||'').trim(), subPath:''}; return {root:segs[0], subPath: segs.slice(1).join('.')}; };
const joinPath=(base, more)=> base ? (more ? base + '.' + more : base) : more;


/* ============= 第一区：聊天消息变量处理 ============= */
function getActiveCharacter() {
  try {
    const ctx = getContext();
    const id = ctx?.characterId ?? ctx?.this_chid;
    if (id == null) return null;
    const char = ctx?.getCharacter?.(id) ?? (Array.isArray(ctx?.characters) ? ctx.characters[id] : null);
    return char || null;
  } catch { return null; }
}
function readCharExtBumpAliases() {
  try {
    const ctx = getContext();
    const id = ctx?.characterId ?? ctx?.this_chid;
    if (id == null) return {};
    const char = ctx?.getCharacter?.(id) ?? (Array.isArray(ctx?.characters) ? ctx.characters[id] : null);
    const ns = char?.data?.extensions?.[LWB_EXT_ID];
    const vc = ns?.variablesCore;
    const bump = vc?.bumpAliases;
    if (bump && typeof bump === 'object') return bump;
    const legacy = char?.extensions?.[LWB_EXT_ID]?.variablesCore?.bumpAliases;
    if (legacy && typeof legacy === 'object') {
      writeCharExtBumpAliases(legacy);
      return legacy;
    }
    return {};
  } catch { return {}; }
}
async function writeCharExtBumpAliases(newStore) {
  try {
    const ctx = getContext();
    const id = ctx?.characterId ?? ctx?.this_chid;
    if (id == null) return;
    if (typeof ctx?.writeExtensionField === 'function') {
      await ctx.writeExtensionField(id, LWB_EXT_ID, {
        variablesCore: { bumpAliases: structuredClone(newStore || {}) },
      });
      const char = ctx?.getCharacter?.(id) ?? (Array.isArray(ctx?.characters) ? ctx.characters[id] : null);
      if (char) {
        char.data = char.data && typeof char.data === 'object' ? char.data : {};
        char.data.extensions = char.data.extensions && typeof char.data.extensions === 'object' ? char.data.extensions : {};
        const ns = (char.data.extensions[LWB_EXT_ID] ||= {});
        ns.variablesCore = ns.variablesCore && typeof ns.variablesCore === 'object' ? ns.variablesCore : {};
        ns.variablesCore.bumpAliases = structuredClone(newStore || {});
      }
      if (typeof ctx?.saveCharacter === 'function') {
        await ctx.saveCharacter();
      } else {
        ctx?.saveCharacterDebounced?.();
      }
      return;
    }
    const char = ctx?.getCharacter?.(id) ?? (Array.isArray(ctx?.characters) ? ctx.characters[id] : null);
    if (char) {
      char.data = char.data && typeof char.data === 'object' ? char.data : {};
      char.data.extensions = char.data.extensions && typeof char.data.extensions === 'object' ? char.data.extensions : {};
      const ns = (char.data.extensions[LWB_EXT_ID] ||= {});
      ns.variablesCore = ns.variablesCore && typeof ns.variablesCore === 'object' ? ns.variablesCore : {};
      ns.variablesCore.bumpAliases = structuredClone(newStore || {});
    }
    if (typeof ctx?.saveCharacter === 'function') {
      await ctx.saveCharacter();
    } else {
      ctx?.saveCharacterDebounced?.();
    }
  } catch {}
}
function getBumpAliasStore() {
  return readCharExtBumpAliases();
}
async function setBumpAliasStore(newStore) {
  await writeCharExtBumpAliases(newStore);
}
async function clearBumpAliasStore() {
  await writeCharExtBumpAliases({});
}
function extractVareventBlocks(text) {
  if (!text || typeof text!=='string') return [];
  const out=[]; let m;
  TAG_RE.scenario.lastIndex=0;
  while((m=TAG_RE.scenario.exec(text))!==null){ const inner=m[1]??''; if(inner.trim()) out.push(inner) }
  return out;
}
function getBumpAliasMap() {
  try { return getBumpAliasStore(); } catch { return {}; }
}
function matchAlias(varOrKey, rhs) {
  const map = getBumpAliasMap();
  const scopes = [map._global || {}, map[varOrKey] || {}];
  for (const scope of scopes) {
    for (const [k, v] of Object.entries(scope)) {
      if (k.startsWith('/') && k.lastIndexOf('/') > 0) {
        const last = k.lastIndexOf('/');
        try {
          const re = new RegExp(k.slice(1, last), k.slice(last + 1));
          if (re.test(rhs)) return Number(v);
        } catch {}
      } else {
        if (rhs === k) return Number(v);
      }
    }
  }
  return null;
}
function preprocessBumpAliases(innerText) {
  const lines = String(innerText || '').split(/\r?\n/);
  const out = [];
  let inBump = false;
  const indentOf = (s) => s.length - s.trimStart().length;
  const stack = [];
  let currentVarRoot = '';
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t) { out.push(raw); continue; }
    const ind = indentOf(raw);
    const mTop = TOP_OP_RE.exec(t);
    if (mTop && ind === 0) {
      const opKey = OP_MAP[mTop[1].toLowerCase()] || '';
      inBump = opKey === 'bump';
      stack.length = 0;
      currentVarRoot = '';
      out.push(raw);
      continue;
    }
    if (!inBump) { out.push(raw); continue; }
    while (stack.length && stack[stack.length - 1].indent >= ind) stack.pop();
    const mKV = t.match(/^([^:]+):\s*(.*)$/);
    if (mKV) {
      const key = mKV[1].trim();
      const val = mKV[2].trim();
      const parentPath = stack.length ? stack[stack.length - 1].path : '';
      const curPath = parentPath ? `${parentPath}.${key}` : key;
      if (val === '') {
        stack.push({ indent: ind, path: curPath });
        if (!parentPath) currentVarRoot = key;
        out.push(raw);
        continue;
      }
      let rhs = val.replace(/^['"]|['"]$/g, '');
      const leafKey = key;
      const num = matchAlias(leafKey, rhs) ?? matchAlias(currentVarRoot, rhs) ?? matchAlias('', rhs);
      if (num !== null && Number.isFinite(num)) {
        out.push(raw.replace(/:\s*.*$/, `: ${num}`));
      } else {
        out.push(raw);
      }
      continue;
    }
    const mArr = t.match(/^-\s*(.+)$/);
    if (mArr) {
      let rhs = mArr[1].trim().replace(/^['"]|['"]$/g, '');
      const leafKey = stack.length ? stack[stack.length - 1].path.split('.').pop() : '';
      const num = matchAlias(leafKey || currentVarRoot, rhs) ?? matchAlias(currentVarRoot, rhs) ?? matchAlias('', rhs);
      if (num !== null && Number.isFinite(num)) {
        out.push(raw.replace(/-\s*.*$/, `- ${num}`));
      } else {
        out.push(raw);
      }
      continue;
    }
    out.push(raw);
  }
  return out.join('\n');
}
function parseBlock(innerText) {
  innerText = preprocessBumpAliases(innerText);
  const ops = { set: {}, push: {}, bump: {}, del: {} };
  const lines = String(innerText || '').split(/\r?\n/);
  const indentOf = (s) => s.length - s.trimStart().length;
  const stripQ = (s) => { let t = String(s ?? '').trim(); if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) t = t.slice(1, -1); return t; };
  let curOp = '';
  const stack = [];
  const putSet = (top, path, value) => { (ops.set[top] ||= {}); ops.set[top][path] = value; };
  const putPush = (top, path, value) => { (ops.push[top] ||= {}); const arr = (ops.push[top][path] ||= []); Array.isArray(value) ? arr.push(...value) : arr.push(value); };
  const putBump = (top, path, delta) => { const n = Number(String(delta).replace(/^\+/, '')); if (!Number.isFinite(n)) return; (ops.bump[top] ||= {}); ops.bump[top][path] = (ops.bump[top][path] ?? 0) + n; };
  const putDel = (top, path) => { (ops.del[top] ||= []); ops.del[top].push(path); };
  const finalizeResults = () => {
    const results = [];
    for (const [top, flat] of Object.entries(ops.set)) if (flat && Object.keys(flat).length) results.push({ name: top, operation: 'setObject', data: flat });
    for (const [top, flat] of Object.entries(ops.push)) if (flat && Object.keys(flat).length) results.push({ name: top, operation: 'push', data: flat });
    for (const [top, flat] of Object.entries(ops.bump)) if (flat && Object.keys(flat).length) results.push({ name: top, operation: 'bump', data: flat });
    for (const [top, list] of Object.entries(ops.del)) if (Array.isArray(list) && list.length) results.push({ name: top, operation: 'del', data: list });
    return results;
  };
  const tryParseJsonFirst = (text) => {
    const s = String(text || '').trim();
    if (!s) return false;
    if (s[0] !== '{' && s[0] !== '[') return false;
    try {
      const data = JSON.parse(s);
      const OP_KEYS = { set: ['set', '录入', 'record'], push: ['push', '追加', 'append'], bump: ['bump'], del: ['del', '删除', 'erase'] };
      const resolveOp = (k) => {
        const kl = String(k).toLowerCase();
        for (const [std, arr] of Object.entries(OP_KEYS)) {
          if (arr.some(a => a.toLowerCase() === kl)) return std;
        }
        return null;
      };
      const walkSetLike = (top, node, basePath = '') => {
        if (node === null || node === undefined) return;
        if (typeof node !== 'object' || Array.isArray(node)) { putSet(top, basePath, node); return; }
        for (const [k, v] of Object.entries(node)) {
          const p = basePath ? `${basePath}.${k}` : k;
          if (Array.isArray(v)) putSet(top, p, v);
          else if (v && typeof v === 'object') walkSetLike(top, v, p);
          else putSet(top, p, v);
        }
      };
      const walkPushLike = (top, node, basePath = '') => {
        if (!node || typeof node !== 'object' || Array.isArray(node)) return;
        for (const [k, v] of Object.entries(node)) {
          const p = basePath ? `${basePath}.${k}` : k;
          if (Array.isArray(v)) for (const it of v) putPush(top, p, it);
          else if (v && typeof v === 'object') walkPushLike(top, v, p);
          else putPush(top, p, v);
        }
      };
      const walkBumpLike = (top, node, basePath = '') => {
        if (!node || typeof node !== 'object' || Array.isArray(node)) return;
        for (const [k, v] of Object.entries(node)) {
          const p = basePath ? `${basePath}.${k}` : k;
          if (v && typeof v === 'object' && !Array.isArray(v)) walkBumpLike(top, v, p);
          else putBump(top, p, v);
        }
      };
      const collectDelPaths = (acc, node, basePath = '') => {
        if (Array.isArray(node)) { for (const it of node) if (typeof it === 'string') acc.push(basePath ? `${basePath}.${it}` : it); return; }
        if (node && typeof node === 'object') {
          for (const [k, v] of Object.entries(node)) {
            const p = basePath ? `${basePath}.${k}` : k;
            if (v === true) acc.push(p); else collectDelPaths(acc, v, p);
          }
        }
      };
      if (Array.isArray(data)) {
        for (const entry of data) {
          if (!entry || typeof entry !== 'object') continue;
          for (const [k, v] of Object.entries(entry)) {
            const op = resolveOp(k); if (!op || !v || typeof v !== 'object') continue;
            for (const [top, payload] of Object.entries(v)) {
              if (op === 'set') walkSetLike(top, payload);
              else if (op === 'push') walkPushLike(top, payload);
              else if (op === 'bump') walkBumpLike(top, payload);
              else if (op === 'del') { const acc = []; collectDelPaths(acc, payload); for (const p of acc) putDel(top, p); }
            }
          }
        }
      } else if (data && typeof data === 'object') {
        for (const [k, v] of Object.entries(data)) {
          const op = resolveOp(k); if (!op || !v || typeof v !== 'object') continue;
          for (const [top, payload] of Object.entries(v)) {
            if (op === 'set') walkSetLike(top, payload);
            else if (op === 'push') walkPushLike(top, payload);
            else if (op === 'bump') walkBumpLike(top, payload);
            else if (op === 'del') { const acc = []; collectDelPaths(acc, payload); for (const p of acc) putDel(top, p); }
          }
        }
      }
      return true;
    } catch { return false; }
  };
  const tryParseTomlSecond = (text) => {
    const src = String(text || '');
    const s = src.trim();
    if (!s) return false;
    if (!s.includes('[') || !s.includes('=')) return false;
    try {
      const OP_KEYS = { set: ['set', '录入', 'record'], push: ['push', '追加', 'append'], bump: ['bump'], del: ['del', '删除', 'erase'] };
      const resolveOp = (k) => {
        const kl = String(k).toLowerCase();
        for (const [std, arr] of Object.entries(OP_KEYS)) {
          if (arr.some(a => a.toLowerCase() === kl)) return std;
        }
        return null;
      };
      const parseScalar = (raw) => {
        const v = String(raw ?? '').trim();
        if (v === 'true') return true;
        if (v === 'false') return false;
        if (/^-?\d+$/.test(v)) return parseInt(v, 10);
        if (/^-?\d+\.\d+$/.test(v)) return parseFloat(v);
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          const inner = v.slice(1, -1);
          if (v.startsWith('"')) return inner.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, '\\');
          return inner;
        }
        if (v.startsWith('[') && v.endsWith(']')) {
          try { return JSON.parse(v.replace(/'/g, '"')); } catch { return v; }
        }
        return v;
      };
      const L = src.split(/\r?\n/);
      let i = 0;
      let currentOp = '';
      while (i < L.length) {
        let line = L[i].trim();
        i++;
        if (!line || line.startsWith('#')) continue;
        const sec = line.match(/\[\s*([^\]]+)\s*\]$/);
        if (sec) { currentOp = resolveOp(sec[1]) || ''; continue; }
        if (!currentOp) continue;
        const kv = line.match(/^([^=]+)=(.*)$/);
        if (!kv) continue;
        const keyRaw = kv[1].trim();
        let rhs = kv[2];
        if (!rhs.includes('"""') && !rhs.includes("'''")) {
          const value = parseScalar(rhs);
          const segs = keyRaw.split('.').map(s => s.trim()).filter(Boolean);
          if (!segs.length) continue;
          const top = segs[0];
          const path = segs.slice(1).join('.');
          if (currentOp === 'set') putSet(top, path, value);
          else if (currentOp === 'push') putPush(top, path, value);
          else if (currentOp === 'bump') putBump(top, path, value);
          else if (currentOp === 'del') putDel(top, path || keyRaw);
          continue;
        }
        const isTripleBasic = rhs.includes('"""');
        const isTripleLiteral = rhs.includes("'''");
        const delim = isTripleBasic ? '"""' : "'''";
        const startIdx = rhs.indexOf(delim);
        let tail = rhs.slice(startIdx + delim.length);
        const buf = [];
        if (tail.length) buf.push(tail);
        let closedInline = false;
        if (tail.includes(delim)) {
          const endIdx = tail.indexOf(delim);
          const firstPart = tail.slice(0, endIdx);
          buf.length = 0;
          buf.push(firstPart);
          closedInline = true;
        }
        if (!closedInline) {
          while (i < L.length) {
            const ln = L[i];
            i++;
            const pos = ln.indexOf(delim);
            if (pos !== -1) { buf.push(ln.slice(0, pos)); break; }
            buf.push(ln);
          }
        }
        let value = buf.join('\n').replace(/\r\n/g, '\n');
        if (value.startsWith('\n')) value = value.slice(1);
        const segs = keyRaw.split('.').map(s => s.trim()).filter(Boolean);
        if (!segs.length) continue;
        const top = segs[0];
        const path = segs.slice(1).join('.');
        if (currentOp === 'set') putSet(top, path, value);
        else if (currentOp === 'push') putPush(top, path, value);
        else if (currentOp === 'bump') putBump(top, path, value);
        else if (currentOp === 'del') putDel(top, path || keyRaw);
      }
      return true;
    } catch { return false; }
  };
  if (tryParseJsonFirst(innerText)) return finalizeResults();
  if (tryParseTomlSecond(innerText)) return finalizeResults();
  const readList = (startIndex, parentIndent) => {
    const out = [];
    let i = startIndex;
    for (; i < lines.length; i++) {
      const raw = lines[i];
      const t = raw.trim();
      if (!t) continue;
      const ind = indentOf(raw);
      if (ind <= parentIndent) break;
      const m = t.match(/^-+\s*(.+)$/);
      if (m) out.push(stripQ(m[1])); else break;
    }
    return { arr: out, next: i - 1 };
  };
  const readBlockScalar = (startIndex, parentIndent, ch) => {
    const out = [];
    let i = startIndex;
    for (; i < lines.length; i++) {
      const raw = lines[i];
      const t = raw.trimEnd();
      const tt = raw.trim();
      const ind = indentOf(raw);
      if (!tt) { out.push(''); continue; }
      if (ind <= parentIndent) {
        const isKey = /^[^\s-][^:]*:\s*(?:\||>.*|.*)?$/.test(tt);
        const isListSibling = tt.startsWith('- ');
        const isTopOp = (parentIndent === 0) && TOP_OP_RE.test(tt);
        if (isKey || isListSibling || isTopOp) break;
        out.push(t);
        continue;
      }
      out.push(raw.slice(parentIndent + 2));
    }
    let text = out.join('\n');
    if (ch === '>') text = text.replace(/\n(?!\n)/g, ' ');
    return { text, next: i - 1 };
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t || t.startsWith('#')) continue;
    const ind = indentOf(raw);
    const mTop = TOP_OP_RE.exec(t);
    if (mTop && ind === 0) { curOp = OP_MAP[mTop[1].toLowerCase()] || ''; stack.length = 0; continue; }
    if (!curOp) continue;
    while (stack.length && stack[stack.length - 1].indent >= ind) stack.pop();
    const mKV = t.match(/^([^:]+):\s*(.*)$/);
    if (mKV) {
      const key = mKV[1].trim();
      const rhs = mKV[2].trim();
      const parentPath = stack.length ? stack[stack.length - 1].path : '';
      const curPath = parentPath ? `${parentPath}.${key}` : key;
      if (rhs && (rhs[0] === '|' || rhs[0] === '>')) {
        const { text, next } = readBlockScalar(i + 1, ind, rhs[0]);
        i = next;
        const [top, ...rest] = curPath.split('.');
        const rel = rest.join('.');
        if (curOp === 'set') putSet(top, rel, text);
        else if (curOp === 'push') putPush(top, rel, text);
        else if (curOp === 'bump') putBump(top, rel, Number(text));
        continue;
      }
      if (rhs === '') {
        stack.push({ indent: ind, path: curPath });
        let j = i + 1;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j < lines.length) {
          const t2 = lines[j].trim();
          const ind2 = indentOf(lines[j]);
          if (ind2 > ind && /^-+\s+/.test(t2)) {
            const { arr, next } = readList(j, ind);
            i = next;
            const [top, ...rest] = curPath.split('.');
            const rel = rest.join('.');
            if (curOp === 'set') putSet(top, rel, arr);
            else if (curOp === 'push') putPush(top, rel, arr);
            else if (curOp === 'del') for (const item of arr) putDel(top, rel ? `${rel}.${item}` : item);
            else if (curOp === 'bump') for (const item of arr) putBump(top, rel, Number(item));
            stack.pop();
          }
        }
        continue;
      }
      const [top, ...rest] = curPath.split('.');
      const rel = rest.join('.');
      if (curOp === 'set') putSet(top, rel, stripQ(rhs));
      else if (curOp === 'push') putPush(top, rel, stripQ(rhs));
      else if (curOp === 'del') putDel(top, rel);
      else if (curOp === 'bump') putBump(top, rel, Number(stripQ(rhs)));
      continue;
    }
    const mArr = t.match(/^-+\s*(.+)$/);
    if (mArr && stack.length) {
      const curPath = stack[stack.length - 1].path;
      const [top, ...rest] = curPath.split('.');
      const rel = rest.join('.');
      const val = stripQ(mArr[1]);
      if (curOp === 'set') {
        const bucket = (ops.set[top] ||= {});
        const prev = bucket[rel];
        if (Array.isArray(prev)) prev.push(val);
        else if (prev !== undefined) bucket[rel] = [prev, val];
        else bucket[rel] = [val];
      } else if (curOp === 'push') putPush(top, rel, val);
      else if (curOp === 'del') putDel(top, rel ? `${rel}.${val}` : val);
      else if (curOp === 'bump') putBump(top, rel, Number(val));
      continue;
    }
  }
  return finalizeResults();
}
async function applyVariablesForMessage(messageId){
  try{
    const ctx=getContext(); const msg=ctx?.chat?.[messageId]; if(!msg) return;
    const raw=(typeof msg.mes==='string'?msg.mes:(typeof msg.content==='string'?msg.content:'')) ?? '';
    const blocks=extractVareventBlocks(raw); if(blocks.length===0) return;
    const ops=[]; const delVarNames=new Set();
    blocks.forEach((b,idx)=>{
      const parts=parseBlock(b);
      for(const p of parts){
        const name=p.name&&p.name.trim()?p.name.trim():`varevent_${idx+1}`;
        if(p.operation==='setObject' && p.data && Object.keys(p.data).length>0) ops.push({name,operation:'setObject',data:p.data});
        else if(p.operation==='del' && Array.isArray(p.data) && p.data.length>0) ops.push({name,operation:'del',data:p.data});
        else if(p.operation==='push' && p.data && Object.keys(p.data).length>0) ops.push({name,operation:'push',data:p.data});
        else if(p.operation==='bump' && p.data && Object.keys(p.data).length>0) ops.push({name,operation:'bump',data:p.data});
        else if(p.operation==='delVar') delVarNames.add(name);
      }
    });
    if(ops.length===0 && delVarNames.size===0) return;
    const byName=new Map();
    for(const {name} of ops){
      const {root}=getRootAndPath(name);
      if(!byName.has(root)){
        const curRaw=getLocalVariable(root); const obj=parseObj(curRaw);
        if(obj){
          byName.set(root,{mode:'object',base:obj,next:{...obj},changed:false});
        }else{
          byName.set(root,{mode:'scalar',scalar:curRaw??'',changed:false});
        }
      }
    }
    function bumpAtPath(rec, path, delta){
      const numDelta=Number(delta);
      if(!Number.isFinite(numDelta)) return false;
      if(!path){
        if(rec.mode==='scalar'){
          let base=Number(rec.scalar);
          if(!Number.isFinite(base)) base=0;
          const next=base+numDelta;
          const nextStr=String(next);
          if(rec.scalar!==nextStr){ rec.scalar=nextStr; rec.changed=true; return true; }
          return false;
        }
        return false;
      }
      const obj=asObject(rec);
      const segs=splitPathSegments(path);
      const { parent, lastKey }=ensureDeepContainer(obj, segs);
      const prev=parent?.[lastKey];
      if(prev && typeof prev==='object') return false;
      let base=Number(prev);
      if(!Number.isFinite(base)) base=0;
      const next=base+numDelta;
      if(prev!==next){ parent[lastKey]=next; rec.changed=true; return true; }
      return false;
    }
    function parseScalarArrayMaybe(str){
      try{
        const v = JSON.parse(String(str??''));
        return Array.isArray(v) ? v : null;
      }catch{ return null; }
    }
    for(const op of ops){
      const {root, subPath}=getRootAndPath(op.name);
      const rec=byName.get(root); if(!rec) continue;
      if(op.operation==='setObject'){
        for(const [k,v] of Object.entries(op.data)){
          const path=joinPath(subPath,k);
          if(!path){
            if(v!==null && typeof v==='object'){
              rec.mode='object';
              rec.next=structuredClone(v);
              rec.changed=true;
            }else{
              rec.mode='scalar';
              rec.scalar=String(v ?? '');
              rec.changed=true;
            }
            continue;
          }
          const obj=asObject(rec);
          if(setDeepValue(obj,path,v)) rec.changed=true;
        }
      }
      else if(op.operation==='del'){
        const obj=asObject(rec);
        for(const key of op.data){
          const path=joinPath(subPath,key);
          if(!path){
            if(rec.mode==='scalar'){
              if(rec.scalar!==''){ rec.scalar=''; rec.changed=true; }
            }else{
              if(rec.next && (Array.isArray(rec.next) ? rec.next.length>0 : Object.keys(rec.next||{}).length>0)){
                rec.next = Array.isArray(rec.next) ? [] : {};
                rec.changed=true;
              }
            }
            continue;
          }
          if(deleteDeepKey(obj,path)) rec.changed=true;
        }
      }
      else if(op.operation==='push'){
        for(const [k,vals] of Object.entries(op.data)){
          const path=joinPath(subPath,k);
          if(!path){
            let arrRef=null;
            if(rec.mode==='object'){
              if(Array.isArray(rec.next)){
                arrRef=rec.next;
              }else if(rec.next && typeof rec.next==='object' && Object.keys(rec.next).length===0){
                rec.next=[]; arrRef=rec.next;
              }else if(Array.isArray(rec.base)){
                rec.next = [...rec.base]; arrRef = rec.next;
              }else{
                rec.next = []; arrRef = rec.next;
              }
            }else{
              const parsed = parseScalarArrayMaybe(rec.scalar);
              rec.mode='object';
              rec.next = parsed ?? [];
              arrRef = rec.next;
            }
            const incoming = Array.isArray(vals) ? vals : [vals];
            let changed=false;
            for(const v of incoming){
              if(!arrRef.includes(v)){ arrRef.push(v); changed=true; }
            }
            if(changed) rec.changed=true;
            continue;
          }
          const obj=asObject(rec);
          if(pushDeepValue(obj,path,vals)) rec.changed=true;
        }
      }
      else if(op.operation==='bump'){
        for(const [k,delta] of Object.entries(op.data)){
          const num=Number(delta); if(!Number.isFinite(num)) continue;
          const path=joinPath(subPath,k);
          bumpAtPath(rec, path, num);
        }
      }
    }
    const hasChanges = Array.from(byName.values()).some(rec => rec && rec.changed === true);
    if(!hasChanges && delVarNames.size===0) return;
    for(const [name,rec] of byName.entries()){
      if(!rec.changed) continue;
      try{
        if(rec.mode==='scalar'){
          setLocalVariable(name, rec.scalar??'');
        }else{
          setLocalVariable(name, json(rec.next??{}));
        }
      }catch(e){}
    }
    if(delVarNames.size>0){
      try{
        const meta=ctx?.chatMetadata;
        if(meta && meta.variables){
          for(const v of delVarNames) delete meta.variables[v];
          ctx?.saveMetadataDebounced?.(); ctx?.saveSettingsDebounced?.();
        }
      }catch(e){}
    }
  }catch(err){}
}
function rebuildVariablesFromScratch() {
  try {
    setVarDict({});
    const chat = getContext()?.chat || [];
    for (let i = 0; i < chat.length; i++) {
      applyVariablesForMessage(i);
    }
  } catch {}
}

/* ============= 第二区：世界书条件事件系统（最终流就地替换） ============= */
const LWB_VAREVENT_PROMPT_KEY = 'LWB_varevent_display';

function installWIHiddenTagStripper() {
  const ctx = getContext();
  const ext = ctx?.extensionSettings;
  if (!ext) return;
  ext.regex = Array.isArray(ext.regex) ? ext.regex : [];
  ext.regex = ext.regex.filter(r =>
    !['lwb-varevent-stripper', 'lwb-varevent-replacer'].includes(r?.id) &&
    !['LWB_VarEventStripper', 'LWB_VarEventReplacer'].includes(r?.scriptName)
  );
  ctx?.saveSettingsDebounced?.();
}

function enqueuePendingVareventBlock(innerText, sourceInfo) {
  try {
    const ctx = getContext();
    const meta = ctx?.chatMetadata || {};
    const list = (meta.LWB_PENDING_VAREVENT_BLOCKS ||= []);
    list.push({
      inner: String(innerText || ''),
      source: sourceInfo || 'unknown',
      turn: (ctx?.chat?.length ?? 0),
      ts: Date.now(),
    });
    ctx?.saveMetadataDebounced?.();
  } catch (e) {}
}

function drainPendingVareventBlocks() {
  try {
    const ctx = getContext();
    const meta = ctx?.chatMetadata || {};
    const list = Array.isArray(meta.LWB_PENDING_VAREVENT_BLOCKS) ? meta.LWB_PENDING_VAREVENT_BLOCKS.slice() : [];
    meta.LWB_PENDING_VAREVENT_BLOCKS = [];
    ctx?.saveMetadataDebounced?.();
    return list;
  } catch (e) {
    return [];
  }
}

function registerWIEventSystem() {
  const { eventSource, event_types } = getContext() || {};

  if (event_types?.CHAT_COMPLETION_PROMPT_READY) {
    on(eventSource, event_types.CHAT_COMPLETION_PROMPT_READY, async (data) => {
      try {
        if (data?.dryRun) {
          return;
        }
        const chat = data?.chat;
        if (!Array.isArray(chat)) {
          return;
        }

        for (const msg of chat) {
          if (typeof msg?.content === 'string' && msg.content.includes('<varevent')) {
            TAG_RE.varevent.lastIndex = 0;
            let mm;
            while ((mm = TAG_RE.varevent.exec(msg.content)) !== null) {
              enqueuePendingVareventBlock(mm[1] ?? '', 'chat.content');
            }
            const replaced = await replaceVareventInString(msg.content, false, false);
            if (replaced !== msg.content) {
              msg.content = replaced;
            }
            if (typeof msg.content === 'string' && msg.content.indexOf('{{xbgetvar::') !== -1) {
              const r2 = replaceXbGetVarInString(msg.content);
              if (r2 !== msg.content) msg.content = r2;
            }
          }
          if (typeof msg?.content === 'string' && msg.content.indexOf('{{xbgetvar::') !== -1) {
            const r3 = replaceXbGetVarInString(msg.content);
            if (r3 !== msg.content) msg.content = r3;
          }
          else if (Array.isArray(msg?.content)) {
            for (const part of msg.content) {
              if (part && part.type === 'text' && typeof part.text === 'string' && part.text.includes('<varevent')) {
                TAG_RE.varevent.lastIndex = 0;
                let mm;
                while ((mm = TAG_RE.varevent.exec(part.text)) !== null) {
                  enqueuePendingVareventBlock(mm[1] ?? '', 'chat.content[].text');
                }
                const replaced = await replaceVareventInString(part.text, false, false);
                if (replaced !== part.text) {
                  part.text = replaced;
                }
                if (typeof part.text === 'string' && part.text.indexOf('{{xbgetvar::') !== -1) {
                  const r2 = replaceXbGetVarInString(part.text);
                  if (r2 !== part.text) part.text = r2;
                }
              }
              if (part && part.type === 'text' && typeof part.text === 'string' && part.text.indexOf('{{xbgetvar::') !== -1) {
                const r3 = replaceXbGetVarInString(part.text);
                if (r3 !== part.text) part.text = r3;
              }
            }
          }
          else if (typeof msg?.mes === 'string' && msg.mes.includes('<varevent')) {
            TAG_RE.varevent.lastIndex = 0;
            let mm;
            while ((mm = TAG_RE.varevent.exec(msg.mes)) !== null) {
              enqueuePendingVareventBlock(mm[1] ?? '', 'chat.mes');
            }
            const replaced = await replaceVareventInString(msg.mes, false, false);
            if (replaced !== msg.mes) {
              msg.mes = replaced;
            }
            if (typeof msg.mes === 'string' && msg.mes.indexOf('{{xbgetvar::') !== -1) {
              const r2 = replaceXbGetVarInString(msg.mes);
              if (r2 !== msg.mes) msg.mes = r2;
            }
          }
          if (typeof msg?.mes === 'string' && msg.mes.indexOf('{{xbgetvar::') !== -1) {
            const r3 = replaceXbGetVarInString(msg.mes);
            if (r3 !== msg.mes) msg.mes = r3;
          }
        }
      } catch (e) {}
    });
  }

  if (event_types?.GENERATE_AFTER_COMBINE_PROMPTS) {
    on(eventSource, event_types.GENERATE_AFTER_COMBINE_PROMPTS, async (data) => {
      try {
        if (data?.dryRun) {
          return;
        }
        if (typeof data?.prompt === 'string' && data.prompt.includes('<varevent')) {
          TAG_RE.varevent.lastIndex = 0;
          let mm;
          while ((mm = TAG_RE.varevent.exec(data.prompt)) !== null) {
            enqueuePendingVareventBlock(mm[1] ?? '', 'prompt');
          }
          const replaced = await replaceVareventInString(data.prompt, false, false);
          if (replaced !== data.prompt) {
            data.prompt = replaced;
          }
          if (typeof data.prompt === 'string' && data.prompt.indexOf('{{xbgetvar::') !== -1) {
            const r2 = replaceXbGetVarInString(data.prompt);
            if (r2 !== data.prompt) data.prompt = r2;
          }
        }
        if (typeof data?.prompt === 'string' && data.prompt.indexOf('{{xbgetvar::') !== -1) {
          const r3 = replaceXbGetVarInString(data.prompt);
          if (r3 !== data.prompt) data.prompt = r3;
        }
      } catch (e) {}
    });
  }

  if (event_types?.GENERATION_ENDED) {
    on(eventSource, event_types.GENERATION_ENDED, () => {
      try {
        getContext()?.setExtensionPrompt?.(LWB_VAREVENT_PROMPT_KEY, '', 0, 0, false);
      } catch {}
    });
  }
  if (event_types?.CHAT_CHANGED) {
    on(eventSource, event_types.CHAT_CHANGED, () => {
      try {
        getContext()?.setExtensionPrompt?.(LWB_VAREVENT_PROMPT_KEY, '', 0, 0, false);
      } catch {}
    });
  }
}

async function replaceVareventInString(text, _dryRun, executeJs = false) {
  if (!text || text.indexOf('<varevent') === -1) {
    return text;
  }
  const replaceByRegexAsync = async (input, regex, repl) => {
    let out = '';
    let last = 0;
    regex.lastIndex = 0;
    let m;
    while ((m = regex.exec(input))) {
      out += input.slice(last, m.index);
      out += await repl(...m);
      last = regex.lastIndex;
    }
    return out + input.slice(last);
  };
  let result = text;
  result = await replaceByRegexAsync(result, TAG_RE.varevent, (m, inner) => buildVareventReplacement(inner, false, executeJs));
  return result;
}

async function buildVareventReplacement(innerText, dryRun, executeJs = false) {
  try {
    const events = parseVareventEvents(innerText);
    if (!events.length) {
      return '';
    }
    let chosen = null;
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      const condStr = String(ev.condition ?? '').trim();
      const hasCond = !!condStr;
      const condOk = hasCond ? evaluateCondition(condStr) : true;
      const hasDisplay = !!(ev.display && String(ev.display).trim());
      const hasJs = !!(ev.js && String(ev.js).trim());

      if (!(hasDisplay || hasJs)) continue;
      if (condOk) {
        chosen = { ev, hasCond };
        break;
      }
    }
    if (!chosen) {
      return '';
    }
    const ev = chosen.ev;
    let out = ev.display && String(ev.display) ? String(ev.display) : '';
    out = out.replace(/^\n+/, '').replace(/\n+$/, '');
    if (!dryRun && executeJs && ev.js && String(ev.js).trim()) {
      try {
        await runJS(ev.js);
      } catch (jsError) {}
    }

    return out;
  } catch (error) {
    return '';
  }
}

function parseVareventEvents(innerText) {
  const events = [];
  const lines = String(innerText || '').split(/\r?\n/);
  let cur = null;
  const flush = () => { if (cur) { events.push(cur); cur = null; } };
  const isStopLine = (t) => {
    if (!t) return false;
    if (/^\[\s*event\.[^\]]+]\s*$/i.test(t)) return true;
    if (/^(condition|display|js_execute)\s*:/i.test(t)) return true;
    if (/^<\s*\/\s*varevent\s*>/i.test(t)) return true;
    return false;
  };
  const findUnescapedQuote = (str, q) => {
    for (let i = 0; i < str.length; i++) { if (str[i] === q && str[i - 1] !== '\\') return i; }
    return -1;
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) continue;
    const header = /^\[\s*event\.([^\]]+)]\s*$/i.exec(line);
    if (header) { flush(); cur = { id: String(header[1]).trim() }; continue; }
    const m = /^(condition|display|js_execute)\s*:\s*(.*)$/i.exec(line);
    if (m) {
      const key = m[1].toLowerCase();
      let valPart = m[2] ?? '';
      if (!cur) cur = {};
      let value = '';
      const ltrim = valPart.replace(/^\s+/, '');
      const firstCh = ltrim[0];
      if (firstCh === '"' || firstCh === "'") {
        const quote = firstCh;
        let after = ltrim.slice(1);
        let endIdx = findUnescapedQuote(after, quote);
        if (endIdx !== -1) value = after.slice(0, endIdx);
        else {
          value = after + '\n';
          while (++i < lines.length) {
            const ln = lines[i];
            const pos = findUnescapedQuote(ln, quote);
            if (pos !== -1) { value += ln.slice(0, pos); break; }
            value += ln + '\n';
          }
        }
        value = value.replace(/\\"/g, '"').replace(/\\'/g, "'");
      } else {
        value = valPart;
        let j = i + 1;
        while (j < lines.length) {
          const nextTrim = lines[j].trim();
          if (isStopLine(nextTrim)) break;
          value += '\n' + lines[j];
          j++;
        }
        i = j - 1;
      }
      if (key === 'condition') cur.condition = value;
      else if (key === 'display') cur.display = value;
      else if (key === 'js_execute') cur.js = value;
    }
  }
  flush();
  return events;
}

function evaluateCondition(expr) {
  const ctx = getContext();

  const isNumericLike = (v) => {
    if (v == null) return false;
    const s = String(v).trim();
    return /^-?\d+(?:\.\d+)?$/.test(s);
  };

  function VAR(path) {
    try {
      const p = String(path ?? '');
      const seg = p.split('.').map(s => s.trim()).filter(Boolean);
      if (!seg.length) return '';
      const root = ctx?.variables?.local?.get?.(seg[0]);

      if (seg.length === 1) {
        if (root == null) return '';
        if (typeof root === 'object') return JSON.stringify(root);
        return String(root);
      }

      let obj;
      if (typeof root === 'string') {
        try { obj = JSON.parse(root); } catch { return undefined; }
      } else if (root && typeof root === 'object') {
        obj = root;
      } else {
        return undefined;
      }

      let cur = obj;
      for (let i = 1; i < seg.length; i++) {
        const k = /^\d+$/.test(seg[i]) ? Number(seg[i]) : seg[i];
        cur = cur?.[k];
        if (cur === undefined) return undefined;
      }
      if (cur == null) return '';
      return typeof cur === 'object' ? JSON.stringify(cur) : String(cur);
    } catch {
      return undefined;
    }
  }

  const VAL = (t) => String(t ?? '');

  function REL(a, op, b) {
    const bothNumeric = isNumericLike(a) && isNumericLike(b);
    if (bothNumeric) {
      const A = Number(String(a).trim());
      const B = Number(String(b).trim());
      switch (op) {
        case '>':  return A > B;
        case '>=': return A >= B;
        case '<':  return A < B;
        case '<=': return A <= B;
      }
    } else {
      const A = String(a);
      const B = String(b);
      switch (op) {
        case '>':  return A > B;
        case '>=': return A >= B;
        case '<':  return A < B;
        case '<=': return A <= B;
      }
    }
    return false;
  }
  try {
    let processed = expr
      .replace(/var\(`([^`]+)`\)/g, 'VAR("$1")')
      .replace(/val\(`([^`]+)`\)/g, 'VAL("$1")');
    processed = processed.replace(
      /(VAR\(".*?"\)|VAL\(".*?"\))\s*(>=|<=|>|<)\s*(VAR\(".*?"\)|VAL\(".*?"\))/g,
      'REL($1,"$2",$3)'
    );
    return !!eval(processed);
  } catch {
    return false;
  }
}

async function runJS(code) {
  const ctx = getContext();
  try {
    const STscriptProxy = async (command) => {
      try {
        if (!command) return;
        if (command[0] !== '/') command = '/' + command;
        const { executeSlashCommands, substituteParams } = getContext();
        const cmd = substituteParams ? substituteParams(command) : command;
        const result = await executeSlashCommands?.(cmd, true);
        return result;
      } catch (err) {
        throw err;
      }
    };
    const fn = new Function('ctx', 'getVar', 'setVar', 'console', 'STscript', `return (async()=>{ ${code}\n })();`);
    const getVar = (k) => ctx?.variables?.local?.get?.(k);
    const setVar = (k, v) => ctx?.variables?.local?.set?.(k, v);
    const globalST = (typeof window !== 'undefined' && window?.STscript) ? window.STscript : null;
    const ret = await fn(ctx, getVar, setVar, console, globalST || STscriptProxy);
    return ret;
  } catch (jsError) {}
}

/* 旧版：按需依旧保留 */
const runImmediateVarEventsDebounced = debounce(runImmediateVarEvents, 30);
let _lwbScanRunning = false;

async function runST(code) {
  try {
    if (!code) return;
    if (code[0] !== '/') code = '/' + code;
    const { executeSlashCommands, substituteParams } = getContext() || {};
    const cmd = substituteParams ? substituteParams(code) : code;
    return await executeSlashCommands?.(cmd, true);
  } catch (err) {}
}

function escapeForSlash(s) {
  const t = String(s ?? '').replace(/"/g, '\\"');
  return `"${t}"`;
}

async function runImmediateVarEvents() {
  if (_lwbScanRunning) return;
  _lwbScanRunning = true;
  try {
    const ctx = getContext();
    const wiList = ctx?.world_info || [];
    for (const entry of wiList) {
      const content = String(entry?.content ?? '');
      if (!content || content.indexOf('<varevent') === -1) continue;
      TAG_RE.varevent.lastIndex = 0;
      let m;
      while ((m = TAG_RE.varevent.exec(content)) !== null) {
        const inner = m[1] ?? '';
        const events = parseVareventEvents(inner);
        for (const ev of events) {
          const condStr = String(ev.condition ?? '').trim();
          const ok = condStr ? evaluateCondition(condStr) : true;
          if (!ok) continue;
          const disp = String(ev.display ?? '').trim();
          if (disp) {
            await runST(`/sys ${escapeForSlash(disp)}`);
          }
          const js = String(ev.js ?? '').trim();
          if (js) {
            await runJS(js);
          }
        }
      }
    }
  } catch (e) {
  } finally {
    setTimeout(() => {
      _lwbScanRunning = false;
    }, 0);
  }
}

/* ============= 第三区：条件规则编辑器UI ============= */
let LWB_VAREDITOR_INSTALLED=false; let LWB_EDITOR_OBSERVER=null;
function installVarEventEditorUI(){
  if(LWB_VAREDITOR_INSTALLED) return; LWB_VAREDITOR_INSTALLED=true;
  try{ injectVarEditorStyles(); }catch{}
  try{ observeWIEntriesForEditorButton(); }catch{}
  try{ setTimeout(()=>tryInjectButtons(document.body),600); }catch{}
}
function injectVarEditorStyles(){
  if(document.getElementById('lwb-varevent-editor-styles')) return;
  const style=document.createElement('style'); style.id='lwb-varevent-editor-styles';
  style.textContent=`.lwb-ve-overlay{position:fixed;inset:0;background:none;z-index:9999;display:flex;align-items:center;justify-content:center;pointer-events:none}
.lwb-ve-modal{width:650px;background:var(--SmartThemeBlurTintColor);border:2px solid var(--SmartThemeBorderColor);border-radius:10px;box-shadow:0 8px 16px var(--SmartThemeShadowColor);pointer-events:auto}
.lwb-ve-header{display:flex;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--SmartThemeBorderColor);font-weight:600;cursor:move}
.lwb-ve-tabs{display:flex;gap:6px;padding:8px 14px;border-bottom:1px solid var(--SmartThemeBorderColor)}
.lwb-ve-tab{cursor:pointer;border:1px solid var(--SmartThemeBorderColor);background:var(--SmartThemeBlurTintColor);padding:4px 8px;border-radius:6px;opacity:.8}
.lwb-ve-tab.active{opacity:1;border-color:var(--crimson70a)}
.lwb-ve-page{display:none}
.lwb-ve-page.active{display:block}
.lwb-ve-body{height:60vh;overflow:auto;padding:10px}
.lwb-ve-footer{display:flex;gap:8px;justify-content:flex-end;padding:12px 14px;border-top:1px solid var(--SmartThemeBorderColor)}
.lwb-ve-section{margin:12px 0}
.lwb-ve-label{font-size:13px;opacity:.7;margin:6px 0}
.lwb-ve-row{gap:8px;align-items:center;margin:4px 0;padding-bottom:10px;border-bottom:1px dashed var(--SmartThemeBorderColor)}
.lwb-ve-input,.lwb-ve-text{box-sizing:border-box;background:var(--SmartThemeShadowColor);color:inherit;border:1px solid var(--SmartThemeUserMesBlurTintColor);border-radius:6px;padding:6px 8px}
.lwb-ve-text{min-height:64px;resize:vertical}
.lwb-ve-input{width:260px}
.lwb-ve-mini{width:70px!important;margin:0}
.lwb-ve-op,.lwb-ve-ctype option{text-align:center}
.lwb-ve-lop{width:70px!important;text-align:center}
.lwb-ve-btn{cursor:pointer;border:1px solid var(--SmartThemeBorderColor);background:var(--SmartThemeBlurTintColor);padding:6px 10px;border-radius:6px}
.lwb-ve-btn.primary{background:var(--crimson70a)}
.lwb-ve-event{border:1px dashed var(--SmartThemeBorderColor);border-radius:8px;padding:10px;margin:10px 0}
.lwb-ve-event-title{font-weight:600;display:flex;align-items:center;gap:8px}
.lwb-ve-close{cursor:pointer}
.lwb-var-editor-button.right_menu_button{display:inline-flex;align-items:center;margin-left:10px;transform:scale(1.5)}
.lwb-ve-vals,.lwb-ve-varrhs{align-items:center}
.lwb-ve-delval{transform:scale(.5)}
.lwb-act-type{width:200px!important}
@media (max-width:999px){.lwb-ve-overlay{position:absolute;inset:0;align-items:flex-start}.lwb-ve-modal{width:100%;max-height:100%;margin:0;border-radius:10px 10px 0 0}}`;
  document.head.appendChild(style);
}
function observeWIEntriesForEditorButton(){
  try{ if(LWB_EDITOR_OBSERVER){ LWB_EDITOR_OBSERVER.disconnect(); LWB_EDITOR_OBSERVER=null; } }catch{}
  const root = document.getElementById('WorldInfo') || document.body;
  const cb = (()=>{
    let t=null; return ()=>{ clearTimeout(t); t=setTimeout(()=>{ try{ tryInjectButtons(root); }catch{} },100); };
  })();
  const obs=new MutationObserver(()=>cb());
  try{ obs.observe(root,{childList:true,subtree:true}); }catch{}
  LWB_EDITOR_OBSERVER=obs;
}
function tryInjectButtons(root){
  const scope = root.closest?.('#WorldInfo') || document.getElementById('WorldInfo') || root;
  scope.querySelectorAll?.('.world_entry .alignitemscenter.flex-container .editor_maximize')?.forEach((maxBtn)=>{
    const container=maxBtn.parentElement; if(!container || container.querySelector('.lwb-var-editor-button')) return;
    const entry=container.closest('.world_entry'); const uid=entry?.getAttribute('data-uid')||entry?.dataset?.uid|| (window?.jQuery?window.jQuery(entry).data('uid'):undefined);
    const btn=document.createElement('div'); btn.className='right_menu_button interactable lwb-var-editor-button'; btn.title='条件规则编辑器'; btn.innerHTML='<i class="fa-solid fa-pen-ruler"></i>';
    btn.addEventListener('click',()=>openVarEditor(entry||undefined,uid));
    container.insertBefore(btn,maxBtn.nextSibling);
  });
}
function openVarEditor(entryEl, uid) {
    const textarea = (uid ? document.getElementById(`world_entry_content_${uid}`) : null) || entryEl?.querySelector?.('textarea[name="content"]');
    if (!textarea) { window?.toastr?.warning?.('未找到内容输入框，请先展开该条目的编辑抽屉'); return; }
    const overlay = document.createElement('div'); overlay.className = 'lwb-ve-overlay';
    const modal = document.createElement('div'); modal.className = 'lwb-ve-modal'; overlay.appendChild(modal);
    modal.style.pointerEvents = 'auto'; modal.style.zIndex = '10010';
    const header = document.createElement('div'); header.className = 'lwb-ve-header'; header.innerHTML = '<span>条件规则编辑器</span><span class="lwb-ve-close">✕</span>'; modal.appendChild(header);
    const tabs = document.createElement('div'); tabs.className = 'lwb-ve-tabs'; modal.appendChild(tabs);
    const tabsCtrl = document.createElement('div'); tabsCtrl.style.marginLeft = 'auto'; tabsCtrl.style.display = 'inline-flex'; tabsCtrl.style.gap = '6px';
    const btnAddTab = document.createElement('button'); btnAddTab.className = 'lwb-ve-btn'; btnAddTab.textContent = '+组';
    const btnDelTab = document.createElement('button'); btnDelTab.className = 'lwb-ve-btn ghost'; btnDelTab.textContent = '-组';
    tabs.appendChild(tabsCtrl); tabsCtrl.append(btnAddTab, btnDelTab);
    const body = document.createElement('div'); body.className = 'lwb-ve-body'; modal.appendChild(body);
    const footer = document.createElement('div'); footer.className = 'lwb-ve-footer'; modal.appendChild(footer);
    const wi = document.getElementById('WorldInfo'); const wiIcon = document.getElementById('WIDrawerIcon'); const wasPinned = !!wi?.classList.contains('pinnedOpen'); let tempPinned = false;
    if (wi && !wasPinned) { wi.classList.add('pinnedOpen'); tempPinned = true; } if (wiIcon && !wiIcon.classList.contains('drawerPinnedOpen')) wiIcon.classList.add('drawerPinnedOpen');
    setupModalDrag(modal, overlay, header);
    const pagesWrap = document.createElement('div'); body.appendChild(pagesWrap);
    const makePage = () => { const page = document.createElement('div'); page.className = 'lwb-ve-page'; const eventsWrap = document.createElement('div'); page.appendChild(eventsWrap); return { page, eventsWrap }; };
    const ensureTabActive = (idx) => {
      Array.from(tabs.querySelectorAll('.lwb-ve-tab')).forEach((el, i) => { el.classList.toggle('active', i === idx); });
      Array.from(pagesWrap.querySelectorAll('.lwb-ve-page')).forEach((el, i) => { el.classList.toggle('active', i === idx); });
    };
    const footerCancel = document.createElement('button'); footerCancel.className = 'lwb-ve-btn'; footerCancel.textContent = '取消';
    const footerOk = document.createElement('button'); footerOk.className = 'lwb-ve-btn primary'; footerOk.textContent = '确认';
    footer.append(footerCancel, footerOk);
    function closeVarEditor() {
      try {
        const pinChecked = !!(document.getElementById('WI_panel_pin'))?.checked;
        if (tempPinned && !pinChecked) { wi?.classList.remove('pinnedOpen'); wiIcon?.classList.remove('drawerPinnedOpen'); }
      } catch { }
      overlay.remove();
    }
    overlay.addEventListener('click', (e) => { e.stopPropagation(); });
    header.querySelector('.lwb-ve-close').addEventListener('click', closeVarEditor);
    footerCancel.addEventListener('click', closeVarEditor);
    const addEventBtn = document.createElement('button');
    addEventBtn.className = 'lwb-ve-btn';
    addEventBtn.style = 'background: var(--SmartThemeBlurTintColor); border: 1px solid var(--SmartThemeBorderColor); cursor: pointer; margin-right: 5px;';
    addEventBtn.type = 'button';
    addEventBtn.innerHTML = '<i class="fa-solid fa-plus"></i> 添加事件';
    const tools = document.createElement('div');
    tools.className = 'lwb-ve-toolbar';
    const bumpBtn = document.createElement('button');
    bumpBtn.type = 'button';
    bumpBtn.className = 'lwb-ve-btn lwb-ve-gen-bump';
    bumpBtn.textContent = 'bump数值映射设置';
    bumpBtn.addEventListener('click', () => openBumpAliasBuilder(null));
    tools.appendChild(addEventBtn);
    tools.appendChild(bumpBtn);
    body.appendChild(tools);
    addEventBtn.addEventListener('click', () => {
      const activePage = pagesWrap.querySelector('.lwb-ve-page.active');
      const eventsWrap = activePage?.querySelector(':scope > div');
      if (!eventsWrap) return;
      eventsWrap.appendChild(createEventBlock(eventsWrap.children.length + 1));
      eventsWrap.dispatchEvent(new CustomEvent('lwb-refresh-idx', { bubbles: true }));
    });
    const originalText = String(textarea.value || ''); const vareventBlocks = [];
    TAG_RE.varevent.lastIndex = 0; let m;
    while ((m = TAG_RE.varevent.exec(originalText)) !== null) { const full = m[0]; const inner = m[1] ?? ''; const start = m.index; const end = TAG_RE.varevent.lastIndex; vareventBlocks.push({ full, inner, start, end }); }
    const parsedIdsPerBlock = vareventBlocks.map(b => { try { return parseVareventEvents(b.inner).map(ev => ev.id).filter(Boolean); } catch { return []; } });
    const pageInitialized = new Set();
    function getEventBlockHTML(index) {
      return `
        <div class="lwb-ve-event-title">事件 #<span class="lwb-ve-idx">${index}</span><span class="lwb-ve-close" title="删除事件" style="margin-left:auto;">✕</span></div>
        <div class="lwb-ve-section">
          <div class="lwb-ve-label">执行条件</div>
          <div class="lwb-ve-conds"></div>
          <button type="button" class="lwb-ve-btn lwb-ve-add-cond"><i class="fa-solid fa-plus"></i>添加条件</button>
        </div>
        <div class="lwb-ve-section">
          <div class="lwb-ve-label">将显示世界书内容（可选）</div>
          <textarea class="lwb-ve-text lwb-ve-display" placeholder="例如：<Info>……</Info>"></textarea>
        </div>
        <div class="lwb-ve-section">
          <div class="lwb-ve-label">将执行stscript命令或JS代码（可选）</div>
          <textarea class="lwb-ve-text lwb-ve-js" placeholder="stscript:/setvar key=foo 1 | /run SomeQR（多条命令用 | 连接）或直接编写JS代码"></textarea>
          <div style="margin-top:6px; display:flex; gap:8px; flex-wrap:wrap;">
            <button type="button" class="lwb-ve-btn lwb-ve-gen-st">常用st控制</button>
          </div>
        </div>`;
    }
    function getConditionRowHTML() {
      return `
        <select class="lwb-ve-input lwb-ve-mini lwb-ve-lop" style="display:none;">
          <option value="||">或</option><option value="&&" selected>和</option>
        </select>
        <select class="lwb-ve-input lwb-ve-mini lwb-ve-ctype">
          <option value="vv">比较值</option><option value="vvv">比较变量</option>
        </select>
        <input class="lwb-ve-input lwb-ve-var" placeholder="变量名称"/>
        <select class="lwb-ve-input lwb-ve-mini lwb-ve-op">
          <option value="==">等于</option><option value="!=">不等于</option>
          <option value=">=">大于或等于</option><option value="<=">小于或等于</option>
          <option value=">">大于</option><option value="<">小于</option>
        </select>
        <span class="lwb-ve-vals">
          <span class="lwb-ve-valwrap"><input class="lwb-ve-input lwb-ve-val" placeholder="值"/></span>
        </span>
        <span class="lwb-ve-varrhs" style="display:none;">
          <span class="lwb-ve-valvarwrap"><input class="lwb-ve-input lwb-ve-valvar" placeholder="变量B名称"/></span>
        </span>
        <button type="button" class="lwb-ve-btn ghost lwb-ve-del">删除</button>`;
    }
    function setupConditionRow(row, onRowsChanged) {
      row.querySelector('.lwb-ve-del').addEventListener('click', () => { row.remove(); onRowsChanged?.(); });
      const ctype = row.querySelector('.lwb-ve-ctype'); const valsWrap = row.querySelector('.lwb-ve-vals'); const varRhsWrap = row.querySelector('.lwb-ve-varrhs');
      ctype.addEventListener('change', () => { const mode = ctype.value; if (mode === 'vv') { valsWrap.style.display = 'inline-flex'; varRhsWrap.style.display = 'none'; } else { valsWrap.style.display = 'none'; varRhsWrap.style.display = 'inline-flex'; } });
    }
    function setupEventBlock(block) {
      block.querySelector('.lwb-ve-event-title .lwb-ve-close')?.addEventListener('click', () => {
        block.remove(); try { block.dispatchEvent(new CustomEvent('lwb-refresh-idx', { bubbles: true })); } catch { }
      });
      const conds = block.querySelector('.lwb-ve-conds'); const addRowBtn = block.querySelector('.lwb-ve-add-cond');
      const refreshRowOperators = () => {
        const rows = Array.from(conds.querySelectorAll('.lwb-ve-row'));
        rows.forEach((r, idx) => { const lop = r.querySelector('.lwb-ve-lop'); if (!lop) return; lop.style.display = idx === 0 ? 'none' : ''; if (idx > 0 && !lop.value) lop.value = '&&'; });
      };
      const makeRow = () => { const row = document.createElement('div'); row.className = 'lwb-ve-row'; row.innerHTML = getConditionRowHTML(); setupConditionRow(row, refreshRowOperators); conds.appendChild(row); refreshRowOperators(); };
      addRowBtn.addEventListener('click', makeRow); makeRow();
      const btnGenSt = block.querySelector('.lwb-ve-gen-st');
      if (btnGenSt) btnGenSt.addEventListener('click', () => openActionBuilder(block));
      const btnGenBump = block.querySelector('.lwb-ve-gen-bump');
      if (btnGenBump) btnGenBump.addEventListener('click', () => openBumpAliasBuilder(block));
    }
    function createEventBlock(index) { const block = document.createElement('div'); block.className = 'lwb-ve-event'; block.innerHTML = getEventBlockHTML(index); setupEventBlock(block); return block; }
    function refreshIndices() {
      const activePage = pagesWrap.querySelector('.lwb-ve-page.active'); const eventsWrap = activePage?.querySelector(':scope > div'); if (!eventsWrap) return;
      eventsWrap.querySelectorAll('.lwb-ve-event').forEach((el, i) => {
        const idxEl = el.querySelector('.lwb-ve-idx');
        if (idxEl) {
          idxEl.textContent = String(i + 1); idxEl.style.cursor = 'pointer'; idxEl.title = '点击修改显示名称'; const ds = idxEl.dataset || {};
          if (!ds.clickbound) { ds.clickbound = '1'; idxEl.addEventListener('click', () => { const cur = idxEl.textContent || ''; const name = prompt('输入事件显示名称：', cur) ?? ''; if (name) idxEl.textContent = name; }); }
        }
      });
    }
    function processEventBlock(block, idx) {
      const displayName = String(block.querySelector('.lwb-ve-idx')?.textContent || '').trim();
      const id = (displayName && /^\w[\w.-]*$/.test(displayName)) ? displayName : String(idx + 1).padStart(4, '0');
      const lines = [`[event.${id}]`];
      let condStr = ''; let hasAny = false;
      const rows = Array.from(block.querySelectorAll('.lwb-ve-row'));
      const wrapBack = (s) => { const t = String(s || '').trim(); return /^([`'"]).*\1$/.test(t) ? t : '`' + t.replace(/`/g, '\\`') + '`'; };
      const buildVar = (name) => `var(${wrapBack(name)})`;
      const buildVal = (v) => { const t = String(v || '').trim(); return /^([`'"]).*\1$/.test(t) ? `val(${t})` : `val(${wrapBack(t)})`; };
      const hasOr = (s) => /\|\|/.test(s);
      const parenIf = (need, s) => need ? (s.startsWith('(') && s.endsWith(')') ? s : `(${s})`) : s;
      for (const r of rows) {
        const v = r.querySelector('.lwb-ve-var')?.value?.trim?.() || '';
        const op = r.querySelector('.lwb-ve-op')?.value || '==';
        const ctype = r.querySelector('.lwb-ve-ctype')?.value || 'vv';
        if (!v) continue;
        let rowExpr = '';
        if (ctype === 'vv') {
          const valInputs = Array.from(r.querySelectorAll('.lwb-ve-vals .lwb-ve-val'));
          const exprs = [];
          for (const inp of valInputs) {
            const _inp = inp; let val = (_inp?.value || '').trim();
            if (!val) continue;
            exprs.push(`${buildVar(v)} ${op} ${buildVal(val)}`);
          }
          if (exprs.length === 1) rowExpr = exprs[0]; else if (exprs.length > 1) rowExpr = '(' + exprs.join(' || ') + ')';
        } else {
          const varInputs = Array.from(r.querySelectorAll('.lwb-ve-varrhs .lwb-ve-valvar'));
          const exprs = [];
          for (const inp of varInputs) {
            const _inp = inp; const rhs = (_inp?.value || '').trim(); if (!rhs) continue;
            exprs.push(`${buildVar(v)} ${op} ${buildVar(rhs)}`);
          }
          if (exprs.length === 1) rowExpr = exprs[0]; else if (exprs.length > 1) rowExpr = '(' + exprs.join(' || ') + ')';
        }
        if (!rowExpr) continue;
        const lop = r.querySelector('.lwb-ve-lop')?.value || '&&';
        if (!hasAny) { condStr = rowExpr; hasAny = true; }
        else {
          if (lop === '&&') { condStr = `${parenIf(hasOr(condStr), condStr)} && ${parenIf(hasOr(rowExpr), rowExpr)}`; }
          else condStr = `${condStr} || ${rowExpr}`;
        }
      }
      const disp = block.querySelector('.lwb-ve-display')?.value ?? '';
      const js = block.querySelector('.lwb-ve-js')?.value ?? '';
      const dispCore = String(disp).replace(/^\n+|\n+$/g, '');
      if (dispCore && !condStr) { window?.toastr?.error?.('填写了"将显示世界书内容"时，必须提供执行条件'); return { lines: [] }; }
      if (!dispCore && !js && !condStr) return { lines: [] };
      if (condStr) lines.push(`condition: ${condStr}`);
      if (dispCore !== '') {
        const dispStored = '\n' + dispCore + '\n';
        lines.push('display: "' + dispStored.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"');
      }
      if (js !== '') lines.push(`js_execute: ${JSON.stringify(js)}`);
      return { lines };
    }
    if (vareventBlocks.length === 0) {
      const tab = document.createElement('div'); tab.className = 'lwb-ve-tab active'; tab.textContent = '组 1'; tabs.insertBefore(tab, tabsCtrl);
      const { page, eventsWrap } = makePage(); pagesWrap.appendChild(page); page.classList.add('active');
      eventsWrap.appendChild(createEventBlock(eventsWrap.children.length + 1));
      refreshIndices();
      tab.addEventListener('click', () => {
        document.querySelectorAll('.lwb-ve-tab').forEach(el => el.classList.remove('active')); tab.classList.add('active');
        pagesWrap.querySelectorAll('.lwb-ve-page').forEach(el => el.classList.remove('active')); page.classList.add('active');
      });
    } else {
      let activeIndex = 0;
      const renderPage = (pageIdx) => {
        activeIndex = pageIdx;
        document.querySelectorAll('.lwb-ve-tab').forEach((el, i) => el.classList.toggle('active', i === pageIdx));
        const current = vareventBlocks[pageIdx]; const events = (current && typeof current.inner === 'string') ? parseVareventEvents(current.inner) : [];
        let page = pagesWrap.querySelectorAll('.lwb-ve-page')[pageIdx];
        if (!page) { const created = makePage(); page = created.page; pagesWrap.appendChild(page); }
        pagesWrap.querySelectorAll('.lwb-ve-page').forEach((el) => el.classList.remove('active'));
        page.classList.add('active');
        let eventsWrap = page.querySelector(':scope > div');
        if (!eventsWrap) { const d = document.createElement('div'); page.appendChild(d); eventsWrap = d; }
        const initContent = () => {
          eventsWrap.innerHTML = '';
          if (!events.length) eventsWrap.appendChild(createEventBlock(1));
          else {
            events.forEach((_ev, i) => {
              const block = createEventBlock(i + 1);
              try {
                const condStr = String(_ev.condition || '').trim();
                if (condStr) {
                  const firstRow = block.querySelector('.lwb-ve-row');
                  const condsWrap = block.querySelector('.lwb-ve-conds');
                  const addParsedRow = (lop, lhs, op, rhsIsVar, rhsVal) => {
                    const row = document.createElement('div'); row.className = 'lwb-ve-row'; row.innerHTML = getConditionRowHTML();
                    const lopSel = row.querySelector('.lwb-ve-lop'); if (lopSel) { if (!lop) { lopSel.style.display = 'none'; lopSel.value = '&&'; } else { lopSel.style.display = ''; lopSel.value = lop; } }
                    const varInp = row.querySelector('.lwb-ve-var'); if (varInp) varInp.value = lhs;
                    const opSel = row.querySelector('.lwb-ve-op'); if (opSel) opSel.value = op;
                    const ctypeSel = row.querySelector('.lwb-ve-ctype'); const valsWrap = row.querySelector('.lwb-ve-vals'); const varRhsWrap = row.querySelector('.lwb-ve-varrhs');
                    if (ctypeSel && valsWrap && varRhsWrap) {
                      if (rhsIsVar) {
                        ctypeSel.value = 'vvv'; valsWrap.style.display = 'none'; varRhsWrap.style.display = 'inline-flex';
                        const rhsInp = row.querySelector('.lwb-ve-varrhs .lwb-ve-valvar'); if (rhsInp) rhsInp.value = rhsVal;
                      } else {
                        ctypeSel.value = 'vv'; valsWrap.style.display = 'inline-flex'; varRhsWrap.style.display = 'none';
                        const rhsInp = row.querySelector('.lwb-ve-vals .lwb-ve-val'); if (rhsInp) rhsInp.value = rhsVal;
                      }
                    }
                    setupConditionRow(row, null); condsWrap?.appendChild(row);
                  };
                  const stripOuter = (s) => {
                    let t = String(s || '').trim(); if (!t.startsWith('(') || !t.endsWith(')')) return t; let i = 0, d = 0, q = null;
                    while (i < t.length) { const c = t[i]; if (q) { if (c === q && t[i - 1] !== '\\') q = null; }
                      else if (c === '"' || c === "'" || c === '`') q = c; else if (c === '(') d++; else if (c === ')') { d--; if (d === 0 && i !== t.length - 1) return t; } i++; }
                    if (d === 0) return t.slice(1, -1).trim(); return t;
                  };
                  const splitTop = (s, sep) => {
                    const parts = []; let i = 0, start = 0, d = 0, q = null;
                    while (i < s.length) {
                      const c = s[i];
                      if (q) { if (c === q && s[i - 1] !== '\\') q = null; i++; continue; }
                      if (c === '"' || c === "'" || c === '`') { q = c; i++; continue; }
                      if (c === '(') { d++; i++; continue; }
                      if (c === ')') { d--; i++; continue; }
                      if (d === 0 && s.slice(i, i + sep.length) === sep) { parts.push(s.slice(start, i)); i += sep.length; start = i; continue; }
                      i++;
                    }
                    parts.push(s.slice(start)); return parts.map(p => p.trim()).filter(Boolean);
                  };
                  const parseComp = (s) => {
                    const t = stripOuter(s);
                    const m = t.match(/^var\(\s*([`'\"])([\s\S]*?)\1\s*\)\s*(==|!=|>=|<=|>|<)\s*(val|var)\(\s*([`'\"])([\s\S]*?)\5\s*\)$/);
                    if (!m) return null; return { lhs: m[2], op: m[3], rhsIsVar: m[4] === 'var', rhs: m[6] };
                  };
                  let ok = false;
                  try {
                    if (condsWrap) condsWrap.innerHTML = '';
                    const andChunks = splitTop(condStr, '&&'); let first = true;
                    for (const chunk of andChunks) {
                      const inner = stripOuter(chunk);
                      const orParts = splitTop(inner, '||');
                      let firstInChunk = true;
                      for (const part of orParts) {
                        const comp = parseComp(part); if (!comp) throw new Error('unparsable');
                        const lop = first ? null : (firstInChunk ? '&&' : '||');
                        addParsedRow(lop, comp.lhs, comp.op, comp.rhsIsVar, comp.rhs);
                        first = false; firstInChunk = false;
                      }
                    }
                    ok = true;
                  } catch { }
                  if (!ok) {
                    const firstRow2 = firstRow;
                    const varInp2 = firstRow2?.querySelector('.lwb-ve-var');
                    const opSel2 = firstRow2?.querySelector('.lwb-ve-op');
                    const vals2 = firstRow2?.querySelector('.lwb-ve-vals .lwb-ve-val');
                    if (varInp2 && opSel2 && vals2) { varInp2.value = condStr; opSel2.value = '=='; vals2.value = 'true'; }
                  }
                }
                const disp = String(_ev.display || '');
                const dispEl = block.querySelector('.lwb-ve-display');
                if (dispEl) {
                  const shown = disp.replace(/^\r?\n/, '').replace(/\r?\n$/, '');
                  dispEl.value = shown;
                }
                const js = String(_ev.js || ''); const jsEl = block.querySelector('.lwb-ve-js'); if (jsEl) jsEl.value = js;
              } catch { }
              eventsWrap.appendChild(block);
            });
          }
          refreshIndices();
          eventsWrap.addEventListener('lwb-refresh-idx', () => { try { refreshIndices(); } catch { } });
        };
        if (!pageInitialized.has(pageIdx)) { initContent(); pageInitialized.add(pageIdx); }
        else if (!eventsWrap.querySelector('.lwb-ve-event')) { initContent(); }
      };
      try { pagesWrap._lwbRenderPage = renderPage; } catch { }
      vareventBlocks.forEach((_b, i) => {
        const tab = document.createElement('div'); tab.className = 'lwb-ve-tab' + (i === 0 ? ' active' : ''); tab.textContent = `组 ${i + 1}`;
        tab.addEventListener('click', () => renderPage(i)); tabs.insertBefore(tab, tabsCtrl);
      });
      renderPage(0);
    }
    try {
      btnAddTab.addEventListener('click', () => {
        const tabCount = tabs.querySelectorAll('.lwb-ve-tab').length;
        const newIdx = tabCount;
        if (typeof pagesWrap["_lwbRenderPage"] === 'function') {
          try { vareventBlocks.push({ inner: '' }); } catch {}
          const tab = document.createElement('div');
          tab.className = 'lwb-ve-tab';
          tab.textContent = `组 ${newIdx + 1}`;
          tab.addEventListener('click', () => pagesWrap["_lwbRenderPage"](newIdx));
          tabs.insertBefore(tab, tabsCtrl);
          pagesWrap["_lwbRenderPage"](newIdx);
        } else {
          const { page, eventsWrap } = makePage();
          pagesWrap.appendChild(page);
          eventsWrap.appendChild(createEventBlock(1));
          const tab = document.createElement('div');
          tab.className = 'lwb-ve-tab';
          tab.textContent = `组 ${newIdx + 1}`;
          tab.addEventListener('click', () => {
            Array.from(tabs.querySelectorAll('.lwb-ve-tab')).forEach((el, i) => el.classList.toggle('active', i === newIdx));
            Array.from(pagesWrap.querySelectorAll('.lwb-ve-page')).forEach((el, i) => el.classList.toggle('active', i === newIdx));
          });
          tabs.insertBefore(tab, tabsCtrl);
          Array.from(tabs.querySelectorAll('.lwb-ve-tab')).forEach((el, i) => el.classList.toggle('active', i === newIdx));
          Array.from(pagesWrap.querySelectorAll('.lwb-ve-page')).forEach((el, i) => el.classList.toggle('active', i === newIdx));
          try { refreshIndices(); } catch {}
        }
      });
    } catch {}
    try {
      btnDelTab.addEventListener('click', () => {
        const tabEls = Array.from(tabs.querySelectorAll('.lwb-ve-tab'));
        if (tabEls.length <= 1) { try { window?.toastr?.warning?.('至少保留一组'); } catch {} return; }
        const activeIdx = tabEls.findIndex(t => t.classList.contains('active')) >= 0 ? tabEls.findIndex(t => t.classList.contains('active')) : 0;
        const pageEls = Array.from(pagesWrap.querySelectorAll('.lwb-ve-page'));
        try { pageEls[activeIdx]?.remove(); } catch {}
        try { tabEls[activeIdx]?.remove(); } catch {}
        if (typeof pagesWrap["_lwbRenderPage"] === 'function') {
          try { vareventBlocks.splice(activeIdx, 1); } catch {}
          try { pageInitialized?.clear?.(); } catch {}
          const rebind = Array.from(tabs.querySelectorAll('.lwb-ve-tab'));
          rebind.forEach((t, i) => {
            const nt = t.cloneNode(true);
            nt.textContent = `组 ${i + 1}`;
            nt.addEventListener('click', () => pagesWrap["_lwbRenderPage"](i));
            tabs.replaceChild(nt, t);
          });
          const nextIdx = Math.max(0, Math.min(activeIdx, rebind.length - 1));
          pagesWrap["_lwbRenderPage"](nextIdx);
        } else {
          const rebind = Array.from(tabs.querySelectorAll('.lwb-ve-tab'));
          rebind.forEach((t, i) => {
            const nt = t.cloneNode(true);
            nt.textContent = `组 ${i + 1}`;
            nt.addEventListener('click', () => {
              rebind.forEach((el, j) => el.classList.toggle('active', j === i));
              const pg = Array.from(pagesWrap.querySelectorAll('.lwb-ve-page'));
              pg.forEach((el, j) => el.classList.toggle('active', j === i));
            });
            tabs.replaceChild(nt, t);
          });
          const nextIdx = Math.max(0, Math.min(activeIdx, rebind.length - 1));
          rebind.forEach((el, i) => el.classList.toggle('active', i === nextIdx));
          const pg = Array.from(pagesWrap.querySelectorAll('.lwb-ve-page'));
          pg.forEach((el, i) => el.classList.toggle('active', i === nextIdx));
          try { refreshIndices(); } catch {}
        }
      });
    } catch {}
    footerOk.addEventListener('click', () => {
      try { const maybeRender = pagesWrap._lwbRenderPage; if (typeof maybeRender === 'function') { const tabEls = Array.from(tabs.querySelectorAll('.lwb-ve-tab')); for (let i = 0; i < tabEls.length; i++) { try { maybeRender(i); } catch { } } } } catch { }
      const pageEls = Array.from(pagesWrap.querySelectorAll('.lwb-ve-page')); if (pageEls.length === 0) { closeVarEditor(); return; }
      const builtBlocks = []; const seenIds = new Set();
      pageEls.forEach((p, i) => {
        const wrap = p.querySelector(':scope > div'); const blks = wrap ? Array.from(wrap.querySelectorAll('.lwb-ve-event')) : [];
        const lines = ['<varevent>'];
        blks.forEach((b, j) => {
          const r = processEventBlock(b, j);
          if (r.lines.length > 0) {
            const idLine = r.lines[0]; const m = idLine.match(/^\[\s*event\.([^\]]+)\]/i); const id = m ? m[1] : `evt_${j + 1}`;
            let use = id; let k = 2; while (seenIds.has(use)) use = `${id}_${k++}`;
            if (use !== id) { r.lines[0] = `[event.${use}]`; }
            seenIds.add(use);
            lines.push(...r.lines);
          }
        });
        lines.push('</varevent>');
        builtBlocks.push(lines.join('\n'));
      });
      const oldVal = textarea.value || '';
      const originals = []; TAG_RE.varevent.lastIndex = 0; let mm;
      while ((mm = TAG_RE.varevent.exec(oldVal)) !== null) { originals.push({ start: mm.index, end: TAG_RE.varevent.lastIndex }); }
      let acc = ''; let pos = 0; const minLen = Math.min(originals.length, builtBlocks.length);
      for (let i = 0; i < originals.length; i++) {
        const { start, end } = originals[i]; acc += oldVal.slice(pos, start); if (i < minLen) acc += builtBlocks[i]; pos = end;
      }
      acc += oldVal.slice(pos);
      if (builtBlocks.length > originals.length) {
        const extras = builtBlocks.slice(originals.length).join('\n\n');
        acc = acc.replace(/\s*$/, '');
        if (acc && !/(?:\r?\n){2}$/.test(acc)) { acc += (/\r?\n$/.test(acc) ? '' : '\n') + '\n'; }
        acc += extras;
      }
      acc = acc.replace(/(?:\r?\n){3,}/g, '\n\n');
      textarea.value = acc; try { const $ta = window?.jQuery ? window.jQuery(textarea) : null; $ta?.trigger?.('input'); } catch { }
      window?.toastr?.success?.('已更新条件规则到该世界书条目');
      closeVarEditor();
    });
    document.body.appendChild(overlay);
  }
function setupModalDrag(modal,overlay,header){
  try{ modal.style.position='absolute'; modal.style.left='50%'; modal.style.top='50%'; modal.style.transform='translate(-50%,-50%)'; }catch{}
  let dragging=false,sx=0,sy=0,sl=0,st=0;
  function onDown(e){ if(!(e instanceof PointerEvent)||e.button!==0) return;
    dragging=true;
    const overlayRect=overlay.getBoundingClientRect(); const rect=modal.getBoundingClientRect();
    modal.style.left=(rect.left-overlayRect.left)+'px'; modal.style.top=(rect.top-overlayRect.top)+'px'; modal.style.transform='';
    sx=e.clientX; sy=e.clientY; sl=parseFloat(modal.style.left)||0; st=parseFloat(modal.style.top)||0;
    window.addEventListener('pointermove',onMove,{passive:true}); window.addEventListener('pointerup',onUp,{once:true}); e.preventDefault();
  }
  function onMove(e){ if(!dragging) return; const dx=e.clientX-sx, dy=e.clientY-sy;
    let nl=sl+dx, nt=st+dy; const maxLeft=(overlay.clientWidth||overlay.getBoundingClientRect().width)-modal.offsetWidth;
    const maxTop=(overlay.clientHeight||overlay.getBoundingClientRect().height)-modal.offsetHeight;
    nl=Math.max(0,Math.min(maxLeft,nl)); nt=Math.max(0,Math.min(maxTop,nt));
    modal.style.left=nl+'px'; modal.style.top=nt+'px';
  }
  function onUp(){ dragging=false; window.removeEventListener('pointermove',onMove); }
  header.addEventListener('pointerdown',onDown);
}
function buildSTscriptFromActions(actionList) {
  const parts = [];
  const jsEsc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  const plain = (s) => String(s ?? '').trim();

  for (const a of actionList || []) {
    switch (a.type) {
      case 'var.set':
        parts.push(`/setvar key=${plain(a.key)} ${plain(a.value)}`);
        break;
      case 'var.bump':
        parts.push(`/addvar key=${plain(a.key)} ${Number(a.delta) || 0}`);
        break;
      case 'var.del':
        parts.push(`/flushvar ${plain(a.key)}`);
        break;
      case 'wi.enableUID':
        parts.push(`/setentryfield file=${plain(a.file)} uid=${plain(a.uid)} field=disable 0`);
        break;
      case 'wi.disableUID':
        parts.push(`/setentryfield file=${plain(a.file)} uid=${plain(a.uid)} field=disable 1`);
        break;
      case 'wi.setContentUID':
        parts.push(`/setentryfield file=${plain(a.file)} uid=${plain(a.uid)} field=content ${plain(a.content)}`);
        break;
      case 'wi.createContent':
        if (plain(a.content)) {
          parts.push(`/createentry file=${plain(a.file)} key=${plain(a.key)} ${plain(a.content)}`);
        } else {
          parts.push(`/createentry file=${plain(a.file)} key=${plain(a.key)}`);
        }
        parts.push(`/setentryfield file=${plain(a.file)} uid={{pipe}} field=constant 1`);
        break;
      case 'qr.run':
        parts.push(`/run ${a.preset ? `${plain(a.preset)}.` : ''}${plain(a.label)}`);
        break;
      case 'custom.st':
        if (a.script) {
          const cmds = a.script.split('\n').map(s => s.trim()).filter(Boolean).map(c => (c.startsWith('/') ? c : '/' + c));
          parts.push(...cmds);
        }
        break;
      default:
        break;
    }
  }

  const st = parts.join(' | ');
  return 'STscript(`' + jsEsc(st) + '`)';
}
function makeMiniModal(innerHTML) {
  const wrap = document.createElement('div');
  wrap.className = 'lwb-ve-overlay';
  const modal = document.createElement('div');
  modal.className = 'lwb-ve-modal';
  modal.style.maxWidth = '720px';
  modal.style.pointerEvents = 'auto';
  modal.style.zIndex = '10010';
  wrap.appendChild(modal);
  const header = document.createElement('div');
  header.className = 'lwb-ve-header';
  header.innerHTML = '<span>编辑器</span><span class="lwb-ve-close">✕</span>';
  modal.appendChild(header);
  const body = document.createElement('div');
  body.className = 'lwb-ve-body';
  body.innerHTML = innerHTML;
  modal.appendChild(body);
  const footer = document.createElement('div');
  footer.className = 'lwb-ve-footer';
  const btnCancel = document.createElement('button');
  btnCancel.className = 'lwb-ve-btn';
  btnCancel.textContent = '取消';
  const btnOk = document.createElement('button');
  btnOk.className = 'lwb-ve-btn primary';
  btnOk.textContent = '生成';
  footer.append(btnCancel, btnOk);
  modal.appendChild(footer);
  setupModalDrag(modal, wrap, header);
  btnCancel.addEventListener('click', () => wrap.remove());
  header.querySelector('.lwb-ve-close')?.addEventListener('click', () => wrap.remove());
  document.body.appendChild(wrap);
  return { wrap, modal, body, btnOk, btnCancel };
}
function openActionBuilder(block) {
  const html = `
    <div class="lwb-ve-section">
      <div class="lwb-ve-label">添加动作</div>
      <div id="lwb-action-list"></div>
      <button type="button" class="lwb-ve-btn" id="lwb-add-action">+动作</button>
    </div>
  `;
  const ui = makeMiniModal(html);
  const list = ui.body.querySelector('#lwb-action-list');
  const addBtn = ui.body.querySelector('#lwb-add-action');
  const addRow = (presetType) => {
    const row = document.createElement('div');
    row.className = 'lwb-ve-row';
    row.style.alignItems = 'flex-start';
    row.innerHTML = `
      <select class="lwb-ve-input lwb-ve-mini lwb-act-type">
        <option value="var.set">变量: set</option>
        <option value="var.bump">变量: bump(+/-)</option>
        <option value="var.del">变量: del</option>
        <option value="wi.enableUID">世界书: 启用条目(UID)</option>
        <option value="wi.disableUID">世界书: 禁用条目(UID)</option>
        <option value="wi.setContentUID">世界书: 设置内容(UID)</option>
        <option value="wi.createContent">世界书: 新建条目(仅内容)</option>
        <option value="qr.run">快速回复（/run）</option>
        <option value="custom.st">自定义ST命令</option>
      </select>
      <div class="lwb-ve-fields" style="flex:1; display:grid; grid-template-columns: 1fr 1fr; gap:6px;"></div>
      <button type="button" class="lwb-ve-btn ghost lwb-ve-del">删除</button>
    `;
    const typeSel = row.querySelector('.lwb-act-type');
    const fields = row.querySelector('.lwb-ve-fields');
    const del = row.querySelector('.lwb-ve-del');
    del.addEventListener('click', () => row.remove());
    const renderFields = () => {
      const t = typeSel.value;
      if (t === 'var.set') {
        fields.innerHTML = `
          <input class="lwb-ve-input" placeholder="变量名 key"/>
          <input class="lwb-ve-input" placeholder="值 value"/>
        `;
      } else if (t === 'var.bump') {
        fields.innerHTML = `
          <input class="lwb-ve-input" placeholder="变量名 key"/>
          <input class="lwb-ve-input" placeholder="增量(整数，可负) delta"/>
        `;
      } else if (t === 'var.del') {
        fields.innerHTML = `
          <input class="lwb-ve-input" placeholder="变量名 key"/>
        `;
      } else if (t === 'wi.enableUID' || t === 'wi.disableUID') {
        fields.innerHTML = `
          <input class="lwb-ve-input" placeholder="世界书文件名 file（必填）"/>
          <input class="lwb-ve-input" placeholder="条目UID（必填）"/>
        `;
      } else if (t === 'wi.setContentUID') {
        fields.innerHTML = `
          <input class="lwb-ve-input" placeholder="世界书文件名 file（必填）"/>
          <input class="lwb-ve-input" placeholder="条目UID（必填）"/>
          <textarea class="lwb-ve-text" rows="3" placeholder="内容 content（可多行）"></textarea>
        `;
      } else if (t === 'wi.createContent') {
        fields.innerHTML = `
          <input class="lwb-ve-input" placeholder="世界书文件名 file（必填）"/>
          <input class="lwb-ve-input" placeholder="条目 key（建议填写）"/>
          <textarea class="lwb-ve-text" rows="4" placeholder="新条目内容 content（可留空）"></textarea>
        `;
      } else if (t === 'qr.run') {
        fields.innerHTML = `
          <input class="lwb-ve-input" placeholder="预设名（可空） preset"/>
          <input class="lwb-ve-input" placeholder="标签（label，必填）"/>
        `;
      } else if (t === 'custom.st') {
        fields.innerHTML = `
          <textarea class="lwb-ve-text" rows="4" placeholder="每行一条斜杠命令，例如：/echo 123（支持多行）"></textarea>
        `;
      }
    };
    typeSel.addEventListener('change', renderFields);
    renderFields();
    if (presetType) typeSel.value = presetType, renderFields();
    list.appendChild(row);
  };
  addBtn.addEventListener('click', () => addRow());
  addRow();
  ui.btnOk.addEventListener('click', () => {
    const rows = Array.from(list.querySelectorAll('.lwb-ve-row'));
    const actions = [];
    for (const r of rows) {
      const type = r.querySelector('.lwb-act-type')?.value;
      const inputs = Array.from(r.querySelectorAll('.lwb-ve-fields .lwb-ve-input, .lwb-ve-fields .lwb-ve-text')).map(i=>i.value);
      if (type === 'var.set' && inputs[0]) actions.push({ type, key: inputs[0], value: inputs[1]||'' });
      if (type === 'var.bump' && inputs[0]) actions.push({ type, key: inputs[0], delta: inputs[1]||'0' });
      if (type === 'var.del' && inputs[0]) actions.push({ type, key: inputs[0] });
      if ((type === 'wi.enableUID' || type==='wi.disableUID') && inputs[0] && inputs[1]) actions.push({ type, file: inputs[0], uid: inputs[1] });
      if (type === 'wi.setContentUID' && inputs[0] && inputs[1]) actions.push({ type, file: inputs[0], uid: inputs[1], content: inputs[2]||'' });
      if (type === 'wi.createContent' && inputs[0]) actions.push({ type, file: inputs[0], key: inputs[1]||'', content: inputs[2]||'' });
      if (type === 'qr.run' && inputs[1]) actions.push({ type, preset: inputs[0]||'', label: inputs[1] });
      if (type === 'custom.st' && inputs[0]) {
        const cmds = inputs[0].split('\n').map(s=>s.trim()).filter(Boolean).map(c => c.startsWith('/') ? c : ('/' + c)).join(' | ');
        if (cmds) actions.push({ type, script: cmds });
      }
    }
    const jsCode = buildSTscriptFromActions(actions);
    const jsBox = block.querySelector('.lwb-ve-js');
    if (jsCode && jsBox) jsBox.value = jsCode;
    ui.wrap.remove();
  });
}
function openBumpAliasBuilder(block) {
    const html = `
      <div class="lwb-ve-section">
        <div class="lwb-ve-label">bump数值映射（每行一条：变量名(可空) | 短语或 /regex/flags | 数值）</div>
        <div id="lwb-bump-list"></div>
        <button type="button" class="lwb-ve-btn" id="lwb-add-bump">+映射</button>
      </div>
    `;
    const ui = makeMiniModal(html);
    const list = ui.body.querySelector('#lwb-bump-list');
    const addBtn = ui.body.querySelector('#lwb-add-bump');
    const addRow = (scope='', phrase='', val='1') => {
      const row = document.createElement('div');
      row.className = 'lwb-ve-row';
      row.innerHTML = `
        <input class="lwb-ve-input" placeholder="变量名(可空=全局)" value="${scope}"/>
        <input class="lwb-ve-input" placeholder="短语 或 /regex(例：/她(很)?开心/i)" value="${phrase}"/>
        <input class="lwb-ve-input" placeholder="数值(整数，可负)" value="${val}"/>
        <button type="button" class="lwb-ve-btn ghost lwb-ve-del">删除</button>
      `;
      row.querySelector('.lwb-ve-del').addEventListener('click', ()=>row.remove());
      list.appendChild(row);
    };
    addBtn.addEventListener('click', () => addRow());
    try {
      const store = getBumpAliasStore();
      const addFromBucket = (scope, bucket) => {
        let n = 0;
        for (const [phrase, val] of Object.entries(bucket || {})) {
          addRow(scope, phrase, String(val));
          n++;
        }
        return n;
      };
      let prefilled = 0;
      if (store._global) prefilled += addFromBucket('', store._global);
      for (const [scope, bucket] of Object.entries(store || {})) {
        if (scope === '_global') continue;
        prefilled += addFromBucket(scope, bucket);
      }
      if (prefilled === 0) addRow();
    } catch {
      addRow();
    }
    ui.btnOk.addEventListener('click', async () => {
      try {
        const rows = Array.from(list.querySelectorAll('.lwb-ve-row'));
        const items = rows.map(r => {
          const ins = Array.from(r.querySelectorAll('.lwb-ve-input')).map(i => i.value);
          return { scope: (ins[0] || '').trim(), phrase: (ins[1] || '').trim(), val: Number(ins[2] || 0) };
        }).filter(x => x.phrase);
        const next = {};
        for (const it of items) {
          const bucket = it.scope ? (next[it.scope] ||= {}) : (next._global ||= {});
          bucket[it.phrase] = Number.isFinite(it.val) ? it.val : 0;
        }
        await setBumpAliasStore(next);
        window?.toastr?.success?.('Bump 映射已保存到角色卡');
        ui.wrap.remove();
      } catch (e) {}
    });
  }

/* ============= 第四区：xbgetvar 宏与命令 ============= */
function lwbResolveVarPath(path){
  try{
    const segs=String(path||'').split('.').map(s=>s.trim()).filter(Boolean); if(!segs.length) return '';
    const rootName=segs[0]; const rootRaw=getLocalVariable(rootName);
    if(segs.length===1){ if(rootRaw==null) return ''; if(typeof rootRaw==='object'){ try{ return JSON.stringify(rootRaw); }catch{return ''} } return String(rootRaw); }
    const obj=parseObj(rootRaw); if(!obj) return '';
    let cur=obj; for(let i=1;i<segs.length;i++){ const key=/^\d+$/.test(segs[i])?Number(segs[i]):segs[i]; cur=cur?.[key]; if(cur===undefined) return ''; }
    if(cur==null) return ''; if(typeof cur==='object'){ try{ return JSON.stringify(cur); }catch{return ''} } return String(cur);
  }catch{ return ''; }
}
function replaceXbGetVarInString(s){ s=String(s??''); if(!s || s.indexOf('{{xbgetvar::')===-1) return s; return s.replace(TAG_RE.xbgetvar,(_,p)=>lwbResolveVarPath(p)); }
function replaceXbGetVarInChat(chat){
  if(!Array.isArray(chat)) return;
  for(const msg of chat){
    try{
      const key=(typeof msg?.content==='string')?'content':(typeof msg?.mes==='string'?'mes':null);
      if(!key) continue;
      const old=String(msg[key]??''); if(old.indexOf('{{xbgetvar::')===-1) continue;
      msg[key]=replaceXbGetVarInString(old);
    }catch{}
  }
}
function applyXbGetVarForMessage(messageId,writeback=true){
  try{
    const ctx=getContext(); const msg=ctx?.chat?.[messageId]; if(!msg) return;
    const key=(typeof msg?.content==='string')?'content':(typeof msg?.mes==='string'?'mes':null); if(!key) return;
    const old=String(msg[key]??''); if(old.indexOf('{{xbgetvar::')===-1) return;
    const out=replaceXbGetVarInString(old); if(writeback && out!==old) msg[key]=out;
  }catch{}
}
function registerXbGetVarSlashCommand(){
  try{
    const ctx = getContext();
    const { SlashCommandParser, SlashCommand, SlashCommandArgument, ARGUMENT_TYPE } = ctx || {};
    if (!SlashCommandParser?.addCommandObject || !SlashCommand?.fromProps || !SlashCommandArgument?.fromProps) return;
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
      name: 'xbgetvar',
      returns: 'string',
      helpString: '通过点路径获取嵌套的本地变量值。示例: /xbgetvar A.A1.AA1.AAA1 | /echo {{pipe}}',
unnamedArgumentList: [
        SlashCommandArgument.fromProps({
          description: '点号分隔的变量路径，例如 A.B.C 或 A.0.name',
          typeList: [ARGUMENT_TYPE.STRING],
          isRequired: true,
          acceptsMultiple: false,
        }),
      ],
      callback: (namedArgs, unnamedArgs) => {
        try {
          const path = Array.isArray(unnamedArgs) ? unnamedArgs[0] : unnamedArgs;
          return lwbResolveVarPath(String(path ?? ''));
        } catch {
          return '';
        }
      },
    }));
  } catch (e) {}
}

/* ============= 第五区：快照/回滚器 ============= */
const SNAP_STORE_KEY = 'LWB_SNAP';

function getMeta() {
  return getContext()?.chatMetadata || {};
}

function getVarDict() {
  const meta = getMeta();
  return structuredClone(meta.variables || {});
}

function syncMetaToLocalVariables(dict) {
  try {
    const ctx = getContext();
    const meta = ctx?.chatMetadata || {};
    const current = meta.variables || {};
    const next = dict || {};
    for (const k of Object.keys(current)) {
      if (!(k in next)) {
        try { delete current[k]; } catch {}
        try { setLocalVariable(k, ''); } catch {}
      }
    }
    for (const [k, v] of Object.entries(next)) {
      let toStore = v;
      if (v && typeof v === 'object') {
        try { toStore = JSON.stringify(v); } catch { toStore = ''; }
      }
      try { setLocalVariable(k, toStore); } catch {}
    }
    meta.variables = structuredClone(next);
    getContext()?.saveMetadataDebounced?.();
  } catch {}
}

function setVarDict(dict) {
  syncMetaToLocalVariables(dict);
}

function getSnapMap() {
  const meta = getMeta();
  if (!meta[SNAP_STORE_KEY]) meta[SNAP_STORE_KEY] = {};
  return meta[SNAP_STORE_KEY];
}

function setSnapshot(messageId, snapDict) {
  if (messageId == null || messageId < 0) return;
  const snaps = getSnapMap();
  snaps[messageId] = structuredClone(snapDict || {});
  getContext()?.saveMetadataDebounced?.();
}

function getSnapshot(messageId) {
  if (messageId == null || messageId < 0) return undefined;
  const snaps = getSnapMap();
  const snap = snaps[messageId];
  return snap ? structuredClone(snap) : undefined;
}

function clearSnapshotsFrom(startIdInclusive) {
  if (startIdInclusive == null) return;
  const snaps = getSnapMap();
  for (const k of Object.keys(snaps)) {
    const id = Number(k);
    if (!Number.isNaN(id) && id >= startIdInclusive) {
      delete snaps[k];
    }
  }
  getContext()?.saveMetadataDebounced?.();
}

function snapshotCurrentLastFloor() {
  try {
    const ctx = getContext();
    const chat = ctx?.chat || [];
    const lastId = chat.length ? chat.length - 1 : -1;
    if (lastId < 0) return;
    const dict = getVarDict();
    setSnapshot(lastId, dict);
  } catch {}
}

function snapshotPreviousFloor() {
  snapshotCurrentLastFloor();
}

function snapshotForMessageId(currentId) {
  try {
    if (typeof currentId !== 'number' || currentId < 0) return;
    const dict = getVarDict();
    setSnapshot(currentId, dict);
  } catch {}
}

function rollbackToPreviousOf(messageId) {
  const id = Number(messageId);
  if (Number.isNaN(id)) return;
  const prevId = id - 1;
  if (prevId < 0) return;
  const snap = getSnapshot(prevId);
  if (snap) setVarDict(snap);
}

async function executeQueuedVareventJsAfterTurn() {
  const blocks = drainPendingVareventBlocks();
  if (!blocks.length) {
    return;
  }

  for (let i = 0; i < blocks.length; i++) {
    const item = blocks[i];
    try {
      const events = parseVareventEvents(item.inner);
      if (!events.length) continue;

      let chosen = null;
      for (let j = events.length - 1; j >= 0; j--) {
        const ev = events[j];
        const condStr = String(ev.condition ?? '').trim();
        const ok = condStr ? evaluateCondition(condStr) : true;
        if (!ok) continue;
        const hasJs = !!(ev.js && String(ev.js).trim());
        if (!hasJs) {
          continue;
        }
        chosen = ev;
        break;
      }

      if (!chosen) {
        continue;
      }

      const js = String(chosen.js ?? '').trim();
      try {
        await runJS(js);
      } catch (e) {}
    } catch (err) {}
  }
}

function bindEvents() {
  const { eventSource, event_types } = getContext();
  if (!eventSource || !event_types) return;

  const getMsgIdLoose = (payload) => {
    if (payload && typeof payload === 'object') {
      if (typeof payload.messageId === 'number') return payload.messageId;
      if (typeof payload.id === 'number') return payload.id;
    }
    if (typeof payload === 'number') return payload;
    const chat = getContext()?.chat || [];
    return chat.length ? chat.length - 1 : undefined;
  };

  const getMsgIdStrictForDelete = (payload) => {
    if (payload && typeof payload === 'object') {
      if (typeof payload.id === 'number') return payload.id;
      if (typeof payload.messageId === 'number') return payload.messageId;
    }
    if (typeof payload === 'number') return payload;
    return undefined;
  };

  if (event_types.MESSAGE_SENT) {
    on(eventSource, event_types.MESSAGE_SENT, async () => {
      snapshotCurrentLastFloor();
      const chat = getContext()?.chat || [];
      const id = chat.length ? chat.length - 1 : undefined;
      if (typeof id === 'number') {
        applyVariablesForMessage(id);
        applyXbGetVarForMessage(id, true);
      }
    });
  }

  if (event_types.MESSAGE_RECEIVED) {
    on(eventSource, event_types.MESSAGE_RECEIVED, async (data) => {
      const id = getMsgIdLoose(data);
      if (typeof id === 'number') {
        applyVariablesForMessage(id);
        applyXbGetVarForMessage(id, true);
        await executeQueuedVareventJsAfterTurn();
      }
    });
  }

  if (event_types.USER_MESSAGE_RENDERED) {
    on(eventSource, event_types.USER_MESSAGE_RENDERED, (data) => {
      const id = getMsgIdLoose(data);
      if (typeof id === 'number') {
        snapshotForMessageId(id);
      }
    });
  }

  if (event_types.CHARACTER_MESSAGE_RENDERED) {
    on(eventSource, event_types.CHARACTER_MESSAGE_RENDERED, (data) => {
      const id = getMsgIdLoose(data);
      if (typeof id === 'number') {
        snapshotForMessageId(id);
      }
    });
  }

  const pendingSwipeApply = new Map();
  let lastSwipedId = undefined;

  if (event_types.GENERATION_STARTED) {
    on(eventSource, event_types.GENERATION_STARTED, (data) => {
      const t = (typeof data === 'string' ? data : (data?.type || data?.mode || data?.reason || '')).toLowerCase();
      if (t === 'swipe') {
        const id = lastSwipedId;
        const tId = id != null ? pendingSwipeApply.get(id) : undefined;
        if (tId) {
          clearTimeout(tId);
          pendingSwipeApply.delete(id);
        }
      }
    });
  }

  if (event_types.MESSAGE_SWIPED) {
    on(eventSource, event_types.MESSAGE_SWIPED, (data) => {
      const id = getMsgIdLoose(data);
      if (typeof id === 'number') {
        lastSwipedId = id;
        rollbackToPreviousOf(id);
        const tId = setTimeout(async () => {
          pendingSwipeApply.delete(id);
          applyVariablesForMessage(id);
          await executeQueuedVareventJsAfterTurn();
        }, 10);
        pendingSwipeApply.set(id, tId);
      }
    });
  }

  if (event_types.MESSAGE_DELETED) {
    on(eventSource, event_types.MESSAGE_DELETED, (data) => {
      const id = getMsgIdStrictForDelete(data);
      if (typeof id === 'number') {
        rollbackToPreviousOf(id);
        clearSnapshotsFrom(id);
      }
    });
  }

  if (event_types.MESSAGE_EDITED) {
    on(eventSource, event_types.MESSAGE_EDITED, async (data) => {
      const id = getMsgIdLoose(data);
      if (typeof id === 'number') {
        rollbackToPreviousOf(id);
        setTimeout(async () => {
          applyVariablesForMessage(id);
          applyXbGetVarForMessage(id, true);
          try {
            const ctx = getContext();
            const msg = ctx?.chat?.[id];
            if (msg) updateMessageBlock(id, msg, { rerenderMessage: true });
          } catch {}
          try { if (eventSource?.emit && event_types?.MESSAGE_UPDATED) await eventSource.emit(event_types.MESSAGE_UPDATED, id); } catch {}
          await executeQueuedVareventJsAfterTurn();
        }, 10);
      }
    });
  }

  if (event_types.MESSAGE_UPDATED) {
    on(eventSource, event_types.MESSAGE_UPDATED, async (data) => {
      const id = getMsgIdLoose(data);
      if (typeof id === 'number') {
        applyXbGetVarForMessage(id, true);
      }
    });
  }
}
/* ============= 第六区：聊天消息变量缺失补全 ============= */
const LWB_PLOTLOG_BTN_ID = 'lwb_plotlog_top10_btn';
const LWB_EXT_ID = 'LittleWhiteBox';
const LWB_PLOTLOG_SETTINGS_KEY = 'plotlog';

function getPlotlogSettings() {
  try {
    extension_settings[LWB_EXT_ID] = extension_settings[LWB_EXT_ID] || {};
    extension_settings[LWB_EXT_ID].variablesCore = extension_settings[LWB_EXT_ID].variablesCore || {};
    const bucket = extension_settings[LWB_EXT_ID].variablesCore;
    const cfg = bucket[LWB_PLOTLOG_SETTINGS_KEY] || {};
    const out = {
      api: typeof cfg.api === 'string' ? cfg.api : '',
      model: typeof cfg.model === 'string' ? cfg.model : '',
      apiurl: typeof cfg.apiurl === 'string' ? cfg.apiurl : '',
      apipassword: typeof cfg.apipassword === 'string' ? cfg.apipassword : '',
    };
    bucket[LWB_PLOTLOG_SETTINGS_KEY] = out;
    return out;
  } catch { return { api: '', model: '', apiurl: '', apipassword: '' }; }
}

function setPlotlogSettings(next) {
  try {
    extension_settings[LWB_EXT_ID] = extension_settings[LWB_EXT_ID] || {};
    extension_settings[LWB_EXT_ID].variablesCore = extension_settings[LWB_EXT_ID].variablesCore || {};
    extension_settings[LWB_EXT_ID].variablesCore[LWB_PLOTLOG_SETTINGS_KEY] = {
      api: String(next.api ?? '').trim(),
      model: String(next.model ?? '').trim(),
      apiurl: String(next.apiurl ?? '').trim(),
      apipassword: String(next.apipassword ?? '').trim(),
    };
    getContext()?.saveSettingsDebounced?.();
  } catch {}
}
function stEscArg(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\|/g, '\\|');
}
async function buildTop10HistoryString() {
  const ctx = getContext();
  const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];
  if (!chat.length) return '';

  const extractText = (msg) => {
    if (typeof msg?.mes === 'string') return msg.mes.replace(/\r\n/g, '\n');
    if (typeof msg?.content === 'string') return msg.content.replace(/\r\n/g, '\n');
    if (Array.isArray(msg?.content)) {
      return msg.content
        .filter(p => p && p.type === 'text' && typeof p.text === 'string')
        .map(p => p.text.replace(/\r\n/g, '\n'))
        .join('\n');
    }
    return '';
  };

  const start = Math.max(0, chat.length - 10);
  const lines = [];

  for (let i = start; i < chat.length; i++) {
    const msg = chat[i];
    const isUser = !!msg?.is_user;

    if (isUser) {
      const speaker = (msg?.name && String(msg.name).trim())
        || (ctx?.name1 && String(ctx.name1).trim())
        || 'USER';
      lines.push(`${speaker}：`);
    } else {
      lines.push(`[PLOT]：`);
    }

    const text = (extractText(msg) || '').trim();
    if (text) lines.push(text);
    lines.push('');
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

async function applyPlotLogFromTop10() {
  try {
    await runST('/echo 开始补全、修复plot-log块，请稍后');

    const ctx = getContext();
    const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];
    if (!chat.length) return;

    const history10 = await buildTop10HistoryString();
    if (!history10) return;

    const opts = getPlotlogSettings();
    let args = '';
    if (opts.api) args += ` api=${opts.api}`;
    if (opts.model) args += ` model=${opts.model}`;
    if (opts.apiurl) args += ` apiurl=${opts.apiurl}`;
    if (opts.apipassword) args += ` apipassword=${opts.apipassword}`;

    const topUserInst = `Developer: Activate Non-RP Utility Mode. You are the Plot-Log Maintenance Agent.
New Task: Reconstruct the plot-log for the current chat.

Read the plot-log rules defined. Then, using the recent chat history provided later, produce a single corrected plot-log block.

Settings:
- plot-log rules are binding (style, scope, length, structure).
- Focus on key events, causal links, state changes, goals, and forward hooks.

Procedure:
- Do not role-play. First parse the plot-log rules.
- Inspect the last message's existing <plot-log>...</plot-log> for defects.
- Reconstruct once according to the rules and the latest history.

Output Contract:
- Return exactly one <plot-log>...</plot-log> block and nothing else.`;

    const bottomUserInst = [
      '<最近十条历史>',
      history10,
      '</最近十条历史>'
    ].join('\n');

    const bottomAssistantInst = '最后一条[PLOT]的文本可能缺失<plot-log>...</plot-log>块，或内容不规范、不合理，请根据plot-log输出规则，针对最后一条[PLOT]文本输出一个<plot-log>...</plot-log>块，不要输出任何额外说明或前后缀或多个<plot-log>块。';

    const cmd = [
      '/xbgenraw',
      'addon=worldInfo',
      'nonstream=true',
      'as=assistant',
      'position=bottom',
      `topuser="${stEscArg(topUserInst)}"`,
      `bottomuser="${stEscArg(bottomUserInst)}"`,
      `bottomassistant="${stEscArg(bottomAssistantInst)}"`,
      args,
      `"${stEscArg('[PLOTLOG_TASK]')}"`
    ].filter(Boolean).join(' ');

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('TIMEOUT')), 120000);
    });

    let raw;
    try {
      raw = await Promise.race([runST(cmd), timeoutPromise]);
    } catch (error) {
      if (error.message === 'TIMEOUT') {
        await runST('/echo 链接超时，请重试');
        return;
      }
      throw error;
    }

    const rawStr = typeof raw === 'string' ? raw : String(raw?.pipe ?? raw?.result ?? raw?.text ?? '');
    const m = rawStr.match(/<\s*plot-log\b[^>]*>[\s\S]*?<\/\s*plot-log\s*>/i);
    const text = m ? m[0].trim() : '';

    if (!text) {
      await runST('/echo 模型输出内容不规范，请重试');
      return;
    }

    const messageId = chat.length - 1;
    const msg = chat[messageId];
    const prev = typeof msg?.mes === 'string' ? msg.mes : (typeof msg?.content === 'string' ? msg.content : '');
    const tagPattern = /<\s*plot-log\b[^>]*>[\s\S]*?<\/\s*plot-log\s*>/gi;

    if (tagPattern.test(prev)) {
      msg.mes = prev.replace(tagPattern, text);
    } else {
      msg.mes = prev ? `${prev}\n\n${text}` : text;
    }

    const { eventSource, event_types } = ctx || {};
    try { await ctx?.saveChat?.(); } catch {}
    try { updateMessageBlock(messageId, msg, { rerenderMessage: true }); } catch {}
    if (eventSource?.emit && event_types?.MESSAGE_EDITED) {
      await eventSource.emit(event_types.MESSAGE_EDITED, messageId);
    }

    await runST('/echo 已补全、修复块');
  } catch {}
}

function registerPlotLogButton() {
  try {
    if (document.getElementById(LWB_PLOTLOG_BTN_ID)) return;
    const menu = document.getElementById('extensionsMenu');
    if (!menu) { setTimeout(registerPlotLogButton, 500); return; }
    const btn = document.createElement('div');
    btn.id = LWB_PLOTLOG_BTN_ID;
    btn.className = 'list-group-item flex-container flexGap5';
    btn.style.cursor = 'pointer';
    btn.innerHTML = '<div class="fa-solid fa-scroll extensionsMenuExtensionButton"></div>plot-log缺失补全';
    let lpTimer = 0; let lpArmed = false; let ignoreClickUntil = 0;
    const armLongPress = () => {
      try { clearTimeout(lpTimer); } catch {}
      lpArmed = true;
      lpTimer = setTimeout(() => {
        lpArmed = false;
        ignoreClickUntil = Date.now() + 600;
        openPlotlogSettingsModal();
      }, 3000);
    };
    const disarmLongPress = () => { try { clearTimeout(lpTimer); } catch {} lpArmed = false; };
    btn.addEventListener('pointerdown', armLongPress);
    btn.addEventListener('pointerup', disarmLongPress);
    btn.addEventListener('pointerleave', disarmLongPress);
    btn.addEventListener('pointercancel', disarmLongPress);
    btn.addEventListener('click', () => {
      if (Date.now() < ignoreClickUntil) return;
      applyPlotLogFromTop10();
    });
    menu.appendChild(btn);
  } catch {}
}

function openPlotlogSettingsModal() {
  try {
    const cur = getPlotlogSettings();
    const html = `
      <div class="lwb-ve-section">
        <div class="lwb-ve-label">聊天补全来源</div>
        <select id="lwb-plotlog-api" class="lwb-ve-input">
          <option value="">（不指定）</option>
          <option value="openai">openai</option>
          <option value="claude">claude</option>
          <option value="gemini">gemini</option>
          <option value="cohere">cohere</option>
          <option value="deepseek">deepseek</option>
        </select>
      </div>
      <div class="lwb-ve-section">
        <div class="lwb-ve-label">模型名称</div>
        <input id="lwb-plotlog-model" class="lwb-ve-input" placeholder="例如：gpt-4o-mini / gemini-2.5-pro" />
      </div>
      <div class="lwb-ve-section">
        <div class="lwb-ve-label">代理地址</div>
        <input id="lwb-plotlog-apiurl" class="lwb-ve-input" placeholder="例如：claude.aslight.one/v1" />
      </div>
      <div class="lwb-ve-section">
        <div class="lwb-ve-label">代理地址密码</div>
        <input id="lwb-plotlog-apipassword" class="lwb-ve-input" type="password" placeholder="可留空" />
      </div>
    `;
    const ui = makeMiniModal(html);
    try {
      if (ui?.body) ui.body.style.height = 'auto';
      if (ui?.modal) {
        ui.modal.style.width = 'auto';
        ui.modal.style.maxWidth = 'none';
      }
    } catch {}
    const sel = ui.body.querySelector('#lwb-plotlog-api');
    const model = ui.body.querySelector('#lwb-plotlog-model');
    const apiurl = ui.body.querySelector('#lwb-plotlog-apiurl');
    const apipassword = ui.body.querySelector('#lwb-plotlog-apipassword');
    try { if (sel) sel.value = cur.api || ''; } catch {}
    try { if (model) model.value = cur.model || ''; } catch {}
    try { if (apiurl) apiurl.value = cur.apiurl || ''; } catch {}
    try { if (apipassword) apipassword.value = cur.apipassword || ''; } catch {}
    ui.btnOk.addEventListener('click', () => {
      const next = {
        api: String(sel && sel.value || '').trim(),
        model: String(model && model.value || '').trim(),
        apiurl: String(apiurl && apiurl.value || '').trim(),
        apipassword: String(apipassword && apipassword.value || '').trim(),
      };
      setPlotlogSettings(next);
      try { ui.wrap.remove(); } catch {}
    });
  } catch {}
}

/* ============= 第七区：模块导出/初始化/清理 ============= */
export function initVariablesCore(){
  if(initialized) return; initialized=true;
  bindEvents();
  try{ registerXbGetVarSlashCommand(); }catch(e){}
  try{ installWIHiddenTagStripper(); }catch(e){}
  try{ registerWIEventSystem(); }catch(e){}
  try{ installVarEventEditorUI(); }catch(e){}
  try{ registerPlotLogButton(); }catch{}
  try{ if(typeof window?.registerModuleCleanup==='function'){ window.registerModuleCleanup(MODULE_ID, cleanupVariablesCore); } }catch{}
}
export function cleanupVariablesCore(){
  try{ offAll(); }catch{}
  try{ if(LWB_EDITOR_OBSERVER){ LWB_EDITOR_OBSERVER.disconnect(); LWB_EDITOR_OBSERVER=null; } }catch{}
  try{ document.querySelectorAll('.lwb-ve-overlay').forEach(el=>el.remove()); }catch{}
  try{ document.querySelectorAll('.lwb-var-editor-button').forEach(el=>el.remove()); }catch{}
  try{ document.getElementById('lwb-varevent-editor-styles')?.remove(); }catch{}
  try{
    const ctx=getContext(); ctx?.setExtensionPrompt?.(LWB_VAREVENT_PROMPT_KEY,'',0,0,false);
    const ext=ctx?.extensionSettings;
    if(ext && Array.isArray(ext.regex)){
      ext.regex=ext.regex.filter(r=>!(r?.id==='lwb-varevent-replacer'||r?.scriptName==='LWB_VarEventReplacer'));
    }
    ctx?.saveSettingsDebounced?.();
  }catch{}
  try{ const btn=document.getElementById(LWB_PLOTLOG_BTN_ID); if(btn){ btn.replaceWith(); } }catch{}
  LWB_VAREDITOR_INSTALLED=false; initialized=false;
}
export { replaceXbGetVarInString }; 