import {
    eventSource, event_types, main_api, chat, name1, getRequestHeaders,
    extractMessageFromData, activateSendButtons, deactivateSendButtons,
} from "../../../../script.js";
import { getStreamingReply, chat_completion_sources, oai_settings, promptManager, getChatCompletionModel } from "../../../openai.js";
import { ChatCompletionService } from "../../../custom-request.js";
import { getEventSourceStream } from "../../../sse-stream.js";
import { getContext } from "../../../st-context.js";
import { SlashCommandParser } from "../../../slash-commands/SlashCommandParser.js";
import { SlashCommand } from "../../../slash-commands/SlashCommand.js";
import { ARGUMENT_TYPE, SlashCommandArgument, SlashCommandNamedArgument } from "../../../slash-commands/SlashCommandArgument.js";
import { SECRET_KEYS, writeSecret } from "../../../secrets.js";

const EVT_DONE = 'xiaobaix_streaming_completed';

const PROXY_SUPPORTED = new Set([
    chat_completion_sources.OPENAI, chat_completion_sources.CLAUDE,
    chat_completion_sources.MAKERSUITE, chat_completion_sources.COHERE,
    chat_completion_sources.DEEPSEEK,
]);

class StreamingGeneration {
    constructor() {
        this.tempreply = '';
        this.isInitialized = false;
        this.isStreaming = false;
        this.sessions = new Map();
        this.lastSessionId = null;
        this.activeCount = 0;
        this._toggleBusy = false;
    }

    init() {
        if (this.isInitialized) return;
        this.registerCommands();
        this.isInitialized = true;
    }

    _getSlotId(id) {
        if (!id) return 1;
        const m = String(id).match(/^xb(\d+)$/i);
        if (m && +m[1] >= 1 && +m[1] <= 10) return `xb${m[1]}`;
        const n = parseInt(id, 10);
        return (!isNaN(n) && n >= 1 && n <= 10) ? n : 1;
    }

    _ensureSession(id, prompt) {
        const slotId = this._getSlotId(id);
        if (!this.sessions.has(slotId)) {
            if (this.sessions.size >= 10) this._cleanupOldestSessions();
            this.sessions.set(slotId, {
                id: slotId, text: '', isStreaming: false, prompt: prompt || '',
                updatedAt: Date.now(), abortController: null
            });
        }
        this.lastSessionId = slotId;
        return this.sessions.get(slotId);
    }

    _cleanupOldestSessions() {
        const sorted = [...this.sessions.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
        sorted.slice(0, Math.max(0, sorted.length - 9)).forEach(([sid, s]) => {
            try { s.abortController?.abort(); } catch {}
            this.sessions.delete(sid);
        });
    }

    updateTempReply(value, sessionId) {
        const text = String(value || '');
        if (sessionId !== undefined) {
            const sid = this._getSlotId(sessionId);
            const s = this.sessions.get(sid) || {
                id: sid, text: '', isStreaming: false, prompt: '',
                updatedAt: 0, abortController: null
            };
            s.text = text;
            s.updatedAt = Date.now();
            this.sessions.set(sid, s);
            this.lastSessionId = sid;
        }
        this.tempreply = text;
    }

    postToFrames(name, payload) {
        try {
            const frames = window?.frames;
            if (frames?.length) {
                const msg = { type: name, payload, from: 'xiaobaix' };
                for (let i = 0; i < frames.length; i++) {
                    try { frames[i].postMessage(msg, '*'); } catch {}
                }
            }
        } catch {}
    }

    resolveCurrentApiAndModel(apiOptions = {}) {
        if (apiOptions.api && apiOptions.model) return apiOptions;
        const source = oai_settings?.chat_completion_source;
        const model = getChatCompletionModel();
        const map = {
            [chat_completion_sources.OPENAI]: 'openai',
            [chat_completion_sources.CLAUDE]: 'claude',
            [chat_completion_sources.MAKERSUITE]: 'gemini',
            [chat_completion_sources.COHERE]: 'cohere',
            [chat_completion_sources.DEEPSEEK]: 'deepseek',
            [chat_completion_sources.CUSTOM]: 'custom',
        };
        const api = map[source] || 'openai';
        return { api, model };
    }

    async callAPI(generateData, abortSignal, stream = true) {
        const messages = Array.isArray(generateData) ? generateData :
            (generateData?.prompt || generateData?.messages || generateData);
        const baseOptions = (!Array.isArray(generateData) && generateData?.apiOptions) ? generateData.apiOptions : {};
        const opts = { ...baseOptions, ...this.resolveCurrentApiAndModel(baseOptions) };
        const source = {
            openai: chat_completion_sources.OPENAI,
            claude: chat_completion_sources.CLAUDE,
            gemini: chat_completion_sources.MAKERSUITE,
            google: chat_completion_sources.MAKERSUITE,
            cohere: chat_completion_sources.COHERE,
            deepseek: chat_completion_sources.DEEPSEEK,
            custom: chat_completion_sources.CUSTOM,
        }[String(opts.api || '').toLowerCase()];
        if (!source) throw new Error(`不支持的 api: ${opts.api}`);
        const model = String(opts.model || '').trim();
        if (!model) throw new Error('未检测到当前模型，请在聊天面板选择模型或在插件设置中为分析显式指定模型。');

        try {
            const provider = String(opts.api || '').toLowerCase();
            const reverseProxyConfigured = String(opts.apiurl || '').trim().length > 0;
            const pwd = String(opts.apipassword || '').trim();
            if (!reverseProxyConfigured && pwd) {
                const providerToSecretKey = {
                    openai: SECRET_KEYS.OPENAI,
                    gemini: SECRET_KEYS.MAKERSUITE,
                    google: SECRET_KEYS.MAKERSUITE,
                    cohere: SECRET_KEYS.COHERE,
                    deepseek: SECRET_KEYS.DEEPSEEK,
                    custom: SECRET_KEYS.CUSTOM,
                };
                const secretKey = providerToSecretKey[provider];
                if (secretKey) {
                    await writeSecret(secretKey, pwd, 'xbgen-inline');
                }
            }
        } catch {}

        const body = {
            messages, model, stream,
            chat_completion_source: source,
            max_tokens: Number(oai_settings?.openai_max_tokens ?? 0) || 1024,
            temperature: Number(oai_settings?.temp_openai ?? ''),
            presence_penalty: Number(oai_settings?.pres_pen_openai ?? ''),
            frequency_penalty: Number(oai_settings?.freq_pen_openai ?? ''),
            stop: Array.isArray(generateData?.stop) ? generateData.stop : undefined,
        };

        let reverseProxy = String(opts.apiurl || oai_settings?.reverse_proxy || '').trim();
        let proxyPassword = String(oai_settings?.proxy_password || '').trim();
        const cmdApiUrl = String(opts.apiurl || '').trim();
        const cmdApiPwd = String(opts.apipassword || '').trim();
        if (cmdApiUrl) {
            if (cmdApiPwd) proxyPassword = cmdApiPwd;
        } else if (cmdApiPwd) {
            reverseProxy = '';
            proxyPassword = '';
        }

        if (PROXY_SUPPORTED.has(source) && reverseProxy) {
            body.reverse_proxy = reverseProxy.replace(/\/?$/, '');
            if (proxyPassword) body.proxy_password = proxyPassword;
        }

        if (source === chat_completion_sources.CUSTOM) {
            const customUrl = String(cmdApiUrl || oai_settings?.custom_url || '').trim();
            if (customUrl) {
                body.custom_url = customUrl;
            } else {
                throw new Error('未配置自定义后端URL，请在命令中提供 apiurl 或在设置中填写 custom_url');
            }
            if (oai_settings?.custom_include_headers) body.custom_include_headers = oai_settings.custom_include_headers;
            if (oai_settings?.custom_include_body) body.custom_include_body = oai_settings.custom_include_body;
            if (oai_settings?.custom_exclude_body) body.custom_exclude_body = oai_settings.custom_exclude_body;
        }

        if (stream) {
            const response = await fetch('/api/backends/chat-completions/generate', {
                method: 'POST', body: JSON.stringify(body),
                headers: getRequestHeaders(), signal: abortSignal,
            });

            if (!response.ok) {
                const txt = await response.text().catch(() => '');
                throw new Error(txt || `后端响应错误: ${response.status}`);
            }

            const eventStream = getEventSourceStream();
            response.body.pipeThrough(eventStream);
            const reader = eventStream.readable.getReader();
            const state = { reasoning: '', image: '' };
            let text = '';

            return (async function* () {
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done || !value?.data || value.data === '[DONE]') return;
                        let parsed;
                        try { parsed = JSON.parse(value.data); } catch { continue; }
                        const chunk = getStreamingReply(parsed, state, { chatCompletionSource: source });
                        if (typeof chunk === 'string' && chunk) {
                            text += chunk;
                            yield text;
                        }
                    }
                } catch (err) {
                    if (err?.name !== 'AbortError') throw err;
                } finally {
                    try { reader.releaseLock?.(); } catch {}
                }
            })();
        } else {
            const payload = ChatCompletionService.createRequestData(body);
            const json = await ChatCompletionService.sendRequest(payload, false, abortSignal);
            return String(extractMessageFromData(json, ChatCompletionService.TYPE) || '');
        }
    }

    async _emitPromptReady(chatArray) {
        try {
            if (Array.isArray(chatArray)) {
                await eventSource?.emit?.(event_types.CHAT_COMPLETION_PROMPT_READY, { chat: chatArray, dryRun: false });
            }
        } catch {}
    }

    async processGeneration(generateData, prompt, sessionId, stream = true) {
        const session = this._ensureSession(sessionId, prompt);
        const abortController = new AbortController();
        session.abortController = abortController;

        try {
            this.isStreaming = true;
            this.activeCount++;
            session.isStreaming = true;
            session.text = '';
            session.updatedAt = Date.now();
            this.tempreply = '';

            if (stream) {
                const generator = await this.callAPI(generateData, abortController.signal, true);
                for await (const chunk of generator) {
                    this.updateTempReply(chunk, session.id);
                }
            } else {
                const result = await this.callAPI(generateData, abortController.signal, false);
                this.updateTempReply(result, session.id);
            }

            const payload = {
                finalText: session.text,
                originalPrompt: prompt,
                sessionId: session.id
            };

            try { eventSource?.emit?.(EVT_DONE, payload); } catch {}
            this.postToFrames(EVT_DONE, payload);
            try { window?.postMessage?.({ type: EVT_DONE, payload, from: 'xiaobaix' }, '*'); } catch {}
            return String(session.text || '');
        } catch {
            return String(session.text || '');
        } finally {
            session.isStreaming = false;
            this.activeCount = Math.max(0, this.activeCount - 1);
            this.isStreaming = this.activeCount > 0;
            try { session.abortController = null; } catch {}
        }
    }

    _normalize = (s) => String(s || '').replace(/[\r\t\u200B\u00A0]/g, '').replace(/\s+/g, ' ')
        .replace(/^["'""'']+|["'""'']+$/g, '').trim();
    _stripNamePrefix = (s) => String(s || '').replace(/^\s*[^:]{1,32}:\s*/, '');
    _normStrip = (s) => this._normalize(this._stripNamePrefix(s));

    _parseCompositeParam(param) {
        const input = String(param || '').trim();
        if (!input) return [];
        const parts = [];
        let buf = '';
        let depth = 0;
        for (let i = 0; i < input.length; i++) {
            const ch = input[i];
            if (ch === '{') depth++;
            if (ch === '}') depth = Math.max(0, depth - 1);
            if (ch === ';' && depth === 0) {
                parts.push(buf);
                buf = '';
            } else {
                buf += ch;
            }
        }
        if (buf) parts.push(buf);
        const normRole = (r) => {
            const x = String(r || '').trim().toLowerCase();
            if (x === 'sys' || x === 'system') return 'system';
            if (x === 'assistant' || x === 'asst' || x === 'ai') return 'assistant';
            if (x === 'user' || x === 'u') return 'user';
            return '';
        };
        const extractValue = (v) => {
            let s = String(v || '').trim();
            if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('"') && s.endsWith('"')) || (s.startsWith('\'') && s.endsWith('\''))) {
                s = s.slice(1, -1);
            }
            return s.trim();
        };
        const result = [];
        for (const seg of parts) {
            const idx = seg.indexOf('=');
            if (idx === -1) continue;
            const role = normRole(seg.slice(0, idx));
            if (!role) continue;
            const content = extractValue(seg.slice(idx + 1));
            if (content) result.push({ role, content });
        }
        return result;
    }

    _createIsFromChat() {
        const chatNorms = chat.map(m => this._normStrip(m?.mes)).filter(Boolean);
        const chatSet = new Set(chatNorms);
        return (content) => {
            const n = this._normStrip(content);
            if (!n || chatSet.has(n)) return !n ? false : true;
            for (const c of chatNorms) {
                const [a, b] = [n.length, c.length];
                const [minL, maxL] = [Math.min(a, b), Math.max(a, b)];
                if (minL < 20) continue;
                if (((a >= b && n.includes(c)) || (b >= a && c.includes(n))) && minL / maxL >= 0.8)
                    return true;
            }
            return false;
        };
    }

    _pushIf = (arr, role, content) => {
        const t = String(content || '').trim();
        if (t) arr.push({ role, content: t });
    };

    async _waitForToggleFree() {
        while (this._toggleBusy) {
            await new Promise(r => setTimeout(r, 10));
        }
    }

    async _withTemporaryPromptToggles(addonSet, fn) {
        await this._waitForToggleFree();
        this._toggleBusy = true;
        let snapshot = [];
        try {
            const pm = promptManager;
            const activeChar = pm?.activeCharacter ?? null;
            const order = pm?.getPromptOrderForCharacter(activeChar) ?? [];
            snapshot = order.map(e => ({ identifier: e.identifier, enabled: !!e.enabled }));
            this._lastToggleSnapshot = snapshot.map(s => ({ ...s }));
            order.forEach(e => { e.enabled = false; });
            const enableIds = new Set();
            const PRESET_EXCLUDES = new Set([
                'chatHistory',
                'worldInfoBefore', 'worldInfoAfter',
                'charDescription', 'charPersonality', 'scenario', 'personaDescription',
            ]);
            if (addonSet.has('preset')) {
                for (const s of snapshot) {
                    const isExcluded = PRESET_EXCLUDES.has(s.identifier);
                    if (s.enabled && !isExcluded) enableIds.add(s.identifier);
                }
            }
            if (addonSet.has('chatHistory')) enableIds.add('chatHistory');
            if (addonSet.has('worldInfo')) { enableIds.add('worldInfoBefore'); enableIds.add('worldInfoAfter'); }
            if (addonSet.has('charDescription')) enableIds.add('charDescription');
            if (addonSet.has('charPersonality')) enableIds.add('charPersonality');
            if (addonSet.has('scenario')) enableIds.add('scenario');
            if (addonSet.has('personaDescription')) enableIds.add('personaDescription');
            if (addonSet.has('worldInfo') && !addonSet.has('chatHistory')) enableIds.add('chatHistory');
            order.forEach(e => { if (enableIds.has(e.identifier)) e.enabled = true; });
            return await fn();
        } finally {
            try {
                const pm = promptManager;
                const activeChar = pm?.activeCharacter ?? null;
                const order = pm?.getPromptOrderForCharacter(activeChar) ?? [];
                const mapSnap = new Map((this._lastToggleSnapshot || snapshot).map(s => [s.identifier, s.enabled]));
                order.forEach(e => { if (mapSnap.has(e.identifier)) e.enabled = mapSnap.get(e.identifier); });
            } catch {}
            this._toggleBusy = false;
            this._lastToggleSnapshot = null;
        }
    }

    async _captureWorldInfoText(prompt) {
        const addonSet = new Set(['worldInfo']);
        const context = getContext();
        let capturedData = null;
        const dataListener = (data) => {
            capturedData = (data && typeof data === 'object' && !Array.isArray(data) && Array.isArray(data.prompt))
                ? { ...data, prompt: data.prompt.slice() }
                : (Array.isArray(data) ? data.slice() : data);
        };
        eventSource.on(event_types.GENERATE_AFTER_DATA, dataListener);
        const tempKeys = [];
        try {
            await this._withTemporaryPromptToggles(addonSet, async () => {
                const sandboxed = addonSet.has('worldInfo') && !addonSet.has('chatHistory');
                let chatBackup = null;
                if (sandboxed) {
                    try {
                        chatBackup = chat.slice();
                        chat.length = 0;
                        chat.push({ name: name1 || 'User', is_user: true, is_system: false, mes: '[hist]', send_date: new Date().toISOString() });
                    } catch {}
                }
                try {
                    await context.generate('normal', {
                        quiet_prompt: String(prompt || '').trim(),
                        quietToLoud: false,
                        skipWIAN: false,
                        force_name2: true
                    }, true);
                } finally {
                    if (sandboxed && Array.isArray(chatBackup)) {
                        chat.length = 0;
                        chat.push(...chatBackup);
                    }
                }
            });
        } finally {
            eventSource.removeListener(event_types.GENERATE_AFTER_DATA, dataListener);
            tempKeys.forEach(k => {});
        }
        let src = [];
        const cd = capturedData;
        if (Array.isArray(cd)) {
            src = cd.slice();
        } else if (cd && typeof cd === 'object' && Array.isArray(cd.prompt)) {
            src = cd.prompt.slice();
        }
        const sandboxedAfter = true;
        const isFromChat = this._createIsFromChat();
        const pieces = [];
        for (const m of src) {
            if (!m || typeof m.content !== 'string') continue;
            if (sandboxedAfter) {
                if (m.role === 'system') {
                    pieces.push(m.content);
                } else if ((m.role === 'user' || m.role === 'assistant') && isFromChat(m.content)) {
                    continue;
                } else if (m.role !== 'user' && m.role !== 'assistant') {
                    pieces.push(m.content);
                }
            } else {
                pieces.push(m.content);
            }
        }
        let text = pieces.map(s => String(s || '').trim()).filter(Boolean).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
        // 清理多余标题如 "[Start a new Chat]"，并消除其前后多余空行
        text = text.replace(/\n{0,2}\s*\[Start a new Chat\]\s*\n?/ig, '\n');
        text = text.replace(/\n{3,}/g, '\n\n').trim();
        return text;
    }

    async xbgenrawCommand(args, prompt) {
        const hasScaffolding = Boolean(String(
            args?.top || args?.topsys || args?.topuser || args?.topassistant ||
            args?.bottom || args?.bottomsys || args?.bottomuser || args?.bottomassistant ||
            args?.addon || ''
        ).trim());
        if (!prompt?.trim() && !hasScaffolding) return '';
        const role = ['user', 'system', 'assistant'].includes(args?.as) ? args.as : 'user';
        const sessionId = this._getSlotId(args?.id);
        const lockArg = String(args?.lock || '').toLowerCase();
        const lock = lockArg === 'on' || lockArg === 'true' || lockArg === '1';
        const apiOptions = {
            api: args?.api, apiurl: args?.apiurl,
            apipassword: args?.apipassword, model: args?.model
        };
        let parsedStop;
        try {
            if (args?.stop) {
                const s = String(args.stop).trim();
                if (s) {
                    const j = JSON.parse(s);
                    parsedStop = Array.isArray(j) ? j : (typeof j === 'string' ? [j] : undefined);
                }
            }
        } catch {}
        const nonstream = String(args?.nonstream || '').toLowerCase() === 'true';
        const addonSet = new Set(String(args?.addon || '').split(',').map(s => s.trim()).filter(Boolean));
        const createMsgs = (prefix) => {
            const msgs = [];
            ['sys', 'user', 'assistant'].forEach(r => {
                const content = String(args?.[`${prefix}${r === 'sys' ? 'sys' : r}`] || '').trim();
                if (content) msgs.push({ role: r === 'sys' ? 'system' : r, content });
            });
            return msgs;
        };
        const topComposite = String(args?.top || '').trim();
        const bottomComposite = String(args?.bottom || '').trim();
        const historyPlaceholderRegex = /\{\$history(\d{1,3})\}/ig;
        const resolveHistoryPlaceholder = async (text) => {
            if (!text || typeof text !== 'string') return text;
            const ctx = getContext();
            const chatArr = Array.isArray(ctx?.chat) ? ctx.chat : [];
            if (!chatArr.length) return text;
            const extractText = (msg) => {
                if (typeof msg?.mes === 'string') return msg.mes.replace(/\r\n/g, '\n');
                if (typeof msg?.content === 'string') return msg.content.replace(/\r\n/g, '\n');
                if (Array.isArray(msg?.content)) {
                    return msg.content
                        .filter(p => p && p.type === 'text' && typeof p.text === 'string')
                        .map(p => p.text.replace(/\r\n/g, '\n')).join('\n');
                }
                return '';
            };
            const replaceFn = (match, countStr) => {
                const count = Math.max(1, Math.min(200, Number(countStr)));
                const start = Math.max(0, chatArr.length - count);
                const lines = [];
                for (let i = start; i < chatArr.length; i++) {
                    const msg = chatArr[i];
                    const isUser = !!msg?.is_user;
                    if (isUser) {
                        const speaker = (msg?.name && String(msg.name).trim())
                            || (ctx?.name1 && String(ctx.name1).trim())
                            || 'USER';
                        lines.push(`${speaker}：`);
                    } else {
                        const speaker = (msg?.name && String(msg.name).trim())
                            || (ctx?.name2 && String(ctx.name2).trim())
                            || 'ASSISTANT';
                        lines.push(`${speaker}：`);
                    }
                    const textContent = (extractText(msg) || '').trim();
                    if (textContent) lines.push(textContent);
                    lines.push('');
                }
                return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
            };
            return text.replace(historyPlaceholderRegex, replaceFn);
        };
        const mapHistoryPlaceholders = async (messages) => {
            const out = [];
            for (const m of messages) {
                if (!m) continue;
                const content = await resolveHistoryPlaceholder(m.content);
                out.push({ ...m, content });
            }
            return out;
        };
        const topMsgs = await mapHistoryPlaceholders(
            []
                .concat(topComposite ? this._parseCompositeParam(topComposite) : [])
                .concat(createMsgs('top'))
        );
        const bottomMsgs = await mapHistoryPlaceholders(
            []
                .concat(bottomComposite ? this._parseCompositeParam(bottomComposite) : [])
                .concat(createMsgs('bottom'))
        );

        // {$worldInfo} 占位符：仅激活世界书进行一次干跑，抓取文本后内联替换
        try {
            const needsWI = [...topMsgs, ...bottomMsgs].some(m => m && typeof m.content === 'string' && m.content.includes('{$worldInfo}'));
            if (needsWI) {
                const wiText = await this._captureWorldInfoText(prompt || '');
                const wiRegex = /\{\$worldInfo\}/ig;
                const applyWI = (arr) => {
                    for (const m of arr) {
                        if (m && typeof m.content === 'string') {
                            m.content = m.content.replace(wiRegex, wiText || '');
                        }
                    }
                };
                applyWI(topMsgs);
                applyWI(bottomMsgs);
            }
        } catch {}

        const buildAddonFinalMessages = async () => {
            const context = getContext();
            let capturedData = null;
            const dataListener = (data) => {
                capturedData = (data && typeof data === 'object' && !Array.isArray(data) && Array.isArray(data.prompt))
                    ? { ...data, prompt: data.prompt.slice() }
                    : (Array.isArray(data) ? data.slice() : data);
            };
            eventSource.on(event_types.GENERATE_AFTER_DATA, dataListener);
            const tempKeys = [];
            const pushTemp = () => {};
            const skipWIAN = addonSet.has('worldInfo') ? false : true;
            await this._withTemporaryPromptToggles(addonSet, async () => {
                const sandboxed = addonSet.has('worldInfo') && !addonSet.has('chatHistory');
                let chatBackup = null;
                if (sandboxed) {
                    try {
                        chatBackup = chat.slice();
                        chat.length = 0;
                        chat.push({ name: name1 || 'User', is_user: true, is_system: false, mes: '[hist]', send_date: new Date().toISOString() });
                    } catch {}
                }
                try {
                    await context.generate('normal', {
                        quiet_prompt: (prompt || '').trim(), quietToLoud: false,
                        skipWIAN, force_name2: true
                    }, true);
                } finally {
                    if (sandboxed && Array.isArray(chatBackup)) {
                        chat.length = 0;
                        chat.push(...chatBackup);
                    }
                }
            });
            eventSource.removeListener(event_types.GENERATE_AFTER_DATA, dataListener);
            tempKeys.forEach(key => {});
            let src = [];
            const cd = capturedData;
            if (Array.isArray(cd)) {
                src = cd.slice();
            } else if (cd && typeof cd === 'object' && Array.isArray(cd.prompt)) {
                src = cd.prompt.slice();
            }
            const sandboxedAfter = addonSet.has('worldInfo') && !addonSet.has('chatHistory');
            const isFromChat = this._createIsFromChat();
            const finalPromptMessages = src.filter(m => {
                if (!sandboxedAfter) return true;
                if (!m) return false;
                if (m.role === 'system') return true;
                if ((m.role === 'user' || m.role === 'assistant') && isFromChat(m.content)) return false;
                return true;
            });
            const norm = this._normStrip;
            const position = ['history', 'after_history', 'afterhistory', 'chathistory']
                .includes(String(args?.position || '').toLowerCase()) ? 'history' : 'bottom';
            const targetIdx = finalPromptMessages.findIndex(m => m && typeof m.content === 'string' && norm(m.content) === norm(prompt || ''));
            if (targetIdx !== -1) {
                finalPromptMessages.splice(targetIdx, 1);
            }
            if (prompt?.trim()) {
                const centerMsg = { role: (args?.as || 'assistant'), content: prompt.trim() };
                if (position === 'history') {
                    let lastHistoryIndex = -1;
                    const isFromChat2 = this._createIsFromChat();
                    for (let i = 0; i < finalPromptMessages.length; i++) {
                        const m = finalPromptMessages[i];
                        if (m && (m.role === 'user' || m.role === 'assistant') && isFromChat2(m.content)) {
                            lastHistoryIndex = i;
                        }
                    }
                    if (lastHistoryIndex >= 0) finalPromptMessages.splice(lastHistoryIndex + 1, 0, centerMsg);
                    else {
                        let lastSystemIndex = -1;
                        for (let i = 0; i < finalPromptMessages.length; i++) {
                            if (finalPromptMessages[i]?.role === 'system') lastSystemIndex = i;
                        }
                        if (lastSystemIndex >= 0) finalPromptMessages.splice(lastSystemIndex + 1, 0, centerMsg);
                        else finalPromptMessages.push(centerMsg);
                    }
                } else {
                    finalPromptMessages.push(centerMsg);
                }
            }
            const mergedOnce = ([]).concat(topMsgs).concat(finalPromptMessages).concat(bottomMsgs);
            const seenKey = new Set();
            const finalMessages = [];
            for (const m of mergedOnce) {
                if (!m || !m.content) continue;
                const key = `${m.role}:${this._normStrip(m.content)}`;
                if (seenKey.has(key)) continue;
                seenKey.add(key);
                finalMessages.push(m);
            }
            return finalMessages;
        };

        if (addonSet.size === 0) {
            const messages = [].concat(topMsgs);
            if (prompt?.trim()) messages.push({ role, content: prompt.trim() });
            messages.push(...bottomMsgs);
            const common = { messages, apiOptions, stop: parsedStop };
            if (nonstream) {
                try { if (lock) deactivateSendButtons(); } catch {}
                try {
                    await this._emitPromptReady(messages);
                    const finalText = await this.processGeneration(common, prompt || '', sessionId, false);
                    return String(finalText ?? '');
                } finally {
                    try { if (lock) activateSendButtons(); } catch {}
                }
            } else {
                try { if (lock) deactivateSendButtons(); } catch {}
                await this._emitPromptReady(messages);
                const p = this.processGeneration(common, prompt || '', sessionId, true);
                p.finally(() => { try { if (lock) activateSendButtons(); } catch {} });
                p.catch(() => {});
                return String(sessionId);
            }
        }
        if (nonstream) {
            try { if (lock) deactivateSendButtons(); } catch {}
            try {
                const finalMessages = await buildAddonFinalMessages();
                const common = { messages: finalMessages, apiOptions, stop: parsedStop };
                await this._emitPromptReady(finalMessages);
                const finalText = await this.processGeneration(common, prompt || '', sessionId, false);
                return String(finalText ?? '');
            } finally {
                try { if (lock) activateSendButtons(); } catch {}
            }
        } else {
            (async () => {
                try {
                    try { if (lock) deactivateSendButtons(); } catch {}
                    const finalMessages = await buildAddonFinalMessages();
                    const common = { messages: finalMessages, apiOptions, stop: parsedStop };
                    await this._emitPromptReady(finalMessages);
                    await this.processGeneration(common, prompt || '', sessionId, true);
                } catch {} finally {
                    try { if (lock) activateSendButtons(); } catch {}
                }
            })();
            return String(sessionId);
        }
    }

    async xbgenCommand(args, prompt) {
        if (!prompt?.trim()) return '';
        const role = ['user', 'system', 'assistant'].includes(args?.as) ? args.as : 'system';
        const sessionId = this._getSlotId(args?.id);
        const lockArg = String(args?.lock || '').toLowerCase();
        const lock = lockArg === 'on' || lockArg === 'true' || lockArg === '1';
        const nonstream = String(args?.nonstream || '').toLowerCase() === 'true';

        const buildGenDataWithOptions = async () => {
            const context = getContext();
            const tempMessage = {
                name: role === 'user' ? (name1 || 'User') : 'System',
                is_user: role === 'user',
                is_system: role === 'system',
                mes: prompt.trim(),
                send_date: new Date().toISOString(),
            };
            const originalLength = chat.length;
            chat.push(tempMessage);
            let capturedData = null;
            const dataListener = (data) => {
                if (data?.prompt && Array.isArray(data.prompt)) {
                    let messages = [...data.prompt];
                    const promptText = prompt.trim();
                    for (let i = messages.length - 1; i >= 0; i--) {
                        const m = messages[i];
                        if (m.content === promptText &&
                            ((role !== 'system' && m.role === 'system') ||
                             (role === 'system' && m.role === 'user'))) {
                            messages.splice(i, 1);
                            break;
                        }
                    }
                    capturedData = { ...data, prompt: messages };
                } else {
                    capturedData = data;
                }
            };
            eventSource.on(event_types.GENERATE_AFTER_DATA, dataListener);
            try {
                await context.generate('normal', {
                    quiet_prompt: prompt.trim(), quietToLoud: false,
                    skipWIAN: false, force_name2: true
                }, true);
            } finally {
                eventSource.removeListener(event_types.GENERATE_AFTER_DATA, dataListener);
                chat.length = originalLength;
            }
            const apiOptions = {
                api: args?.api, apiurl: args?.apiurl,
                apipassword: args?.apipassword, model: args?.model
            };
            const cd = capturedData;
            let finalPromptMessages = [];
            if (cd && typeof cd === 'object' && Array.isArray(cd.prompt)) {
                finalPromptMessages = cd.prompt.slice();
            } else if (Array.isArray(cd)) {
                finalPromptMessages = cd.slice();
            }
            const norm = this._normStrip;
            const promptNorm = norm(prompt);
            for (let i = finalPromptMessages.length - 1; i >= 0; i--) {
                if (norm(finalPromptMessages[i]?.content) === promptNorm) {
                    finalPromptMessages.splice(i, 1);
                }
            }
            const messageToInsert = { role, content: prompt.trim() };
            const position = ['history', 'after_history', 'afterhistory', 'chathistory']
                .includes(String(args?.position || '').toLowerCase()) ? 'history' : 'bottom';
            if (position === 'history') {
                const isFromChat = this._createIsFromChat();
                let lastHistoryIndex = -1;
                for (let i = 0; i < finalPromptMessages.length; i++) {
                    const m = finalPromptMessages[i];
                    if (m && (m.role === 'user' || m.role === 'assistant') && isFromChat(m.content)) {
                        lastHistoryIndex = i;
                    }
                }
                if (lastHistoryIndex >= 0) {
                    finalPromptMessages.splice(lastHistoryIndex + 1, 0, messageToInsert);
                } else {
                    finalPromptMessages.push(messageToInsert);
                }
            } else {
                finalPromptMessages.push(messageToInsert);
            }
            const cd2 = capturedData;
            let dataWithOptions;
            if (cd2 && typeof cd2 === 'object' && !Array.isArray(cd2)) {
                dataWithOptions = Object.assign({}, cd2, { prompt: finalPromptMessages, apiOptions });
            } else {
                dataWithOptions = { messages: finalPromptMessages, apiOptions };
            }
            return dataWithOptions;
        };

        if (nonstream) {
            try { if (lock) deactivateSendButtons(); } catch {}
            try {
                const dataWithOptions = await buildGenDataWithOptions();
                const chatMsgs = Array.isArray(dataWithOptions?.prompt) ? dataWithOptions.prompt
                    : (Array.isArray(dataWithOptions?.messages) ? dataWithOptions.messages : []);
                await this._emitPromptReady(chatMsgs);
                const finalText = await this.processGeneration(dataWithOptions, prompt, sessionId, false);
                return String(finalText ?? '');
            } finally {
                try { if (lock) activateSendButtons(); } catch {}
            }
        }
        (async () => {
            try {
                try { if (lock) deactivateSendButtons(); } catch {}
                const dataWithOptions = await buildGenDataWithOptions();
                const chatMsgs = Array.isArray(dataWithOptions?.prompt) ? dataWithOptions.prompt
                    : (Array.isArray(dataWithOptions?.messages) ? dataWithOptions.messages : []);
                await this._emitPromptReady(chatMsgs);
                const finalText = await this.processGeneration(dataWithOptions, prompt, sessionId, true);
                try { if (args && args._scope) args._scope.pipe = String(finalText ?? ''); } catch {}
            } catch {}
            finally {
                try { if (lock) activateSendButtons(); } catch {}
            }
        })();
        return String(sessionId);
    }

    registerCommands() {
        const commonArgs = [
            { name: 'id', description: '会话ID', typeList: [ARGUMENT_TYPE.STRING] },
            { name: 'api', description: '后端: openai/claude/gemini/cohere/deepseek/custom', typeList: [ARGUMENT_TYPE.STRING] },
            { name: 'apiurl', description: '自定义后端URL', typeList: [ARGUMENT_TYPE.STRING] },
            { name: 'apipassword', description: '后端密码', typeList: [ARGUMENT_TYPE.STRING] },
            { name: 'model', description: '模型名', typeList: [ARGUMENT_TYPE.STRING] },
            { name: 'position', description: '插入位置：bottom/history', typeList: [ARGUMENT_TYPE.STRING], enumList: ['bottom', 'history'] },
        ];
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'xbgen',
            callback: (args, prompt) => this.xbgenCommand(args, prompt),
            namedArgumentList: [
                { name: 'as', description: '消息角色', typeList: [ARGUMENT_TYPE.STRING], defaultValue: 'system', enumList: ['user', 'system', 'assistant'] },
                { name: 'nonstream', description: '非流式：true/false', typeList: [ARGUMENT_TYPE.STRING], enumList: ['true', 'false'] },
                { name: 'lock', description: '生成时锁定输入 on/off', typeList: [ARGUMENT_TYPE.STRING], enumList: ['on', 'off'] },
                ...commonArgs
            ].map(SlashCommandNamedArgument.fromProps),
            unnamedArgumentList: [SlashCommandArgument.fromProps({
                description: '生成提示文本', typeList: [ARGUMENT_TYPE.STRING], isRequired: true
            })],
            helpString: '使用完整上下文进行流式生成',
            returns: 'session ID'
        }));
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'xbgenraw',
            callback: (args, prompt) => this.xbgenrawCommand(args, prompt),
            namedArgumentList: [
                { name: 'as', description: '消息角色', typeList: [ARGUMENT_TYPE.STRING], defaultValue: 'user', enumList: ['user', 'system', 'assistant'] },
                { name: 'nonstream', description: '非流式：true/false', typeList: [ARGUMENT_TYPE.STRING], enumList: ['true', 'false'] },
                { name: 'lock', description: '生成时锁定输入 on/off', typeList: [ARGUMENT_TYPE.STRING], enumList: ['on', 'off'] },
                { name: 'addon', description: '附加上下文', typeList: [ARGUMENT_TYPE.STRING] },
                { name: 'topsys', description: '置顶 system', typeList: [ARGUMENT_TYPE.STRING] },
                { name: 'topuser', description: '置顶 user', typeList: [ARGUMENT_TYPE.STRING] },
                { name: 'topassistant', description: '置顶 assistant', typeList: [ARGUMENT_TYPE.STRING] },
                { name: 'bottomsys', description: '置底 system', typeList: [ARGUMENT_TYPE.STRING] },
                { name: 'bottomuser', description: '置底 user', typeList: [ARGUMENT_TYPE.STRING] },
                { name: 'bottomassistant', description: '置底 assistant', typeList: [ARGUMENT_TYPE.STRING] },
                { name: 'top', description: '复合置顶: assistant={A};user={B};sys={C}', typeList: [ARGUMENT_TYPE.STRING] },
                { name: 'bottom', description: '复合置底: assistant={C};sys={D1}', typeList: [ARGUMENT_TYPE.STRING] },
                ...commonArgs
            ].map(SlashCommandNamedArgument.fromProps),
            unnamedArgumentList: [SlashCommandArgument.fromProps({
                description: '原始提示文本', typeList: [ARGUMENT_TYPE.STRING], isRequired: true
            })],
            helpString: '使用原始提示进行流式生成',
            returns: 'session ID'
        }));
    }

    getLastGeneration = (sessionId) => sessionId !== undefined ?
        (this.sessions.get(this._getSlotId(sessionId))?.text || '') : this.tempreply;

    getStatus = (sessionId) => {
        if (sessionId !== undefined) {
            const sid = this._getSlotId(sessionId);
            const s = this.sessions.get(sid);
            return s ? { isStreaming: !!s.isStreaming, text: s.text, sessionId: sid }
                     : { isStreaming: false, text: '', sessionId: sid };
        }
        return { isStreaming: !!this.isStreaming, text: this.tempreply };
    };

    startSession = (id, prompt) => this._ensureSession(id, prompt).id;
    getLastSessionId = () => this.lastSessionId;

    cancel(sessionId) {
        const s = this.sessions.get(this._getSlotId(sessionId));
        s?.abortController?.abort();
    }

    cleanup() {
        this.sessions.forEach(s => s.abortController?.abort());
        Object.assign(this, {
            sessions: new Map(), tempreply: '', lastSessionId: null,
            activeCount: 0, isInitialized: false, isStreaming: false
        });
    }
}

const streamingGeneration = new StreamingGeneration();

export function initStreamingGeneration() {
    const w = window;
    if ((/** @type {any} */(w))?.isXiaobaixEnabled === false) return;
    streamingGeneration.init();
    (/** @type {any} */(w))?.registerModuleCleanup?.('streamingGeneration', () => streamingGeneration.cleanup());
}

export { streamingGeneration };

if (typeof window !== 'undefined') {
    Object.assign(window, {
        xiaobaixStreamingGeneration: streamingGeneration,
        eventSource: (/** @type {any} */(window))?.eventSource || eventSource
    });
}
