import {
    eventSource,
    event_types,
    main_api,
    chat,
    name1,
    getRequestHeaders,
    getCharacterCardFields,
} from "../../../../script.js";
import { getStreamingReply, chat_completion_sources, oai_settings } from "../../../openai.js";
import { getEventSourceStream } from "../../../sse-stream.js";
import { getContext } from "../../../st-context.js";
import { SlashCommandParser } from "../../../slash-commands/SlashCommandParser.js";
import { SlashCommand } from "../../../slash-commands/SlashCommand.js";
import { ARGUMENT_TYPE, SlashCommandArgument, SlashCommandNamedArgument } from "../../../slash-commands/SlashCommandArgument.js";

const EVT_DONE = 'xiaobaix_streaming_completed';

const SOURCE_MAP = {
    openai: chat_completion_sources.OPENAI,
    claude: chat_completion_sources.CLAUDE,
    gemini: chat_completion_sources.MAKERSUITE,
    google: chat_completion_sources.MAKERSUITE,
    googlegemini: chat_completion_sources.MAKERSUITE,
    cohere: chat_completion_sources.COHERE,
    deepseek: chat_completion_sources.DEEPSEEK,
};
function getUiDefaultModel(source) {
    try {
        switch (source) {
            case chat_completion_sources.OPENAI:
                return String(oai_settings?.openai_model || '').trim();
            case chat_completion_sources.CLAUDE:
                return String(oai_settings?.claude_model || '').trim();
            case chat_completion_sources.MAKERSUITE:
                return String(oai_settings?.google_model || '').trim();
            case chat_completion_sources.COHERE:
                return String(oai_settings?.cohere_model || '').trim();
            case chat_completion_sources.DEEPSEEK:
                return String(oai_settings?.deepseek_model || '').trim();
            default:
                return '';
        }
    } catch {
        return '';
    }
}
const PROXY_SUPPORTED = new Set([
    chat_completion_sources.OPENAI,
    chat_completion_sources.CLAUDE,
    chat_completion_sources.MAKERSUITE,
    chat_completion_sources.COHERE,
    chat_completion_sources.DEEPSEEK,
]);

function inferFromMainApi() {
    const m = String(main_api || '').toLowerCase();
    if (m.includes('deepseek')) return 'deepseek';
    if (m.includes('claude')) return 'claude';
    if (m.includes('maker') || m.includes('gemini') || m.includes('google')) return 'gemini';
    if (m.includes('cohere')) return 'cohere';
    if (m.includes('openai')) return 'openai';
    return null;
}
const parseApiOptions = (args) => ({
    api: args?.api,
    apiurl: args?.apiurl,
    apipassword: args?.apipassword,
    model: args?.model,
});

class StreamingGeneration {
    constructor() {
        this.tempreply = '';
        this.isInitialized = false;
        this.isStreaming = false;
        this.sessions = new Map();
        this.lastSessionId = null;
        this.activeCount = 0;
    }

    init() {
        if (this.isInitialized) return;
        this.registerCommands();
        this.isInitialized = true;
    }

    _getSlotId(id) {
        if (!id) return 1;
        const m = String(id).match(/^xb(\d+)$/i);
        if (m) {
            const n = +m[1];
            if (n >= 1 && n <= 10) return `xb${n}`;
        }
        const n = parseInt(id, 10);
        if (!isNaN(n) && n >= 1 && n <= 10) return n;
        return 1;
    }
    _ensureSession(id, prompt) {
        const slotId = this._getSlotId(id);
        if (!this.sessions.has(slotId)) {
            if (this.sessions.size >= 10) this._cleanupOldestSessions();
            this.sessions.set(slotId, { id: slotId, text: '', isStreaming: false, prompt: prompt || '', updatedAt: Date.now(), abortController: null });
        }
        this.lastSessionId = slotId;
        return this.sessions.get(slotId);
    }
    _cleanupOldestSessions() {
        const list = [...this.sessions.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
        for (const [sid, s] of list.slice(0, Math.max(0, list.length - 9))) {
            try { if (s.abortController && !s.abortController.signal.aborted) s.abortController.abort(); } catch {}
            this.sessions.delete(sid);
        }
    }

    updateTempReply(value, sessionId) {
        const text = String(value || '');
        if (sessionId !== undefined) {
            const sid = this._getSlotId(sessionId);
            const s = this.sessions.get(sid) || { id: sid, text: '', isStreaming: false, prompt: '', updatedAt: 0, abortController: null };
            s.text = text; s.updatedAt = Date.now();
            this.sessions.set(sid, s);
            this.lastSessionId = sid;
        }
        this.tempreply = text;
    }

    postToFrames(name, payload) {
        try {
            const frames = window?.frames; if (!frames || frames.length === 0) return;
            const msg = { type: name, payload, from: 'xiaobaix' };
            for (let i = 0; i < frames.length; i++) { try { frames[i].postMessage(msg, '*'); } catch {} }
        } catch {}
    }

    async callStreamingAPI(generateData, abortSignal) {
        const messages = Array.isArray(generateData) ? generateData : (generateData?.prompt || generateData?.messages || generateData);
        const apiOptions = (!Array.isArray(generateData) && generateData?.apiOptions) ? generateData.apiOptions : {};
        if (!apiOptions.api) {
            const inferred = inferFromMainApi();
            if (inferred) apiOptions.api = inferred; else throw new Error('未指定 api，且无法从主 API 推断 provider。');
        }
        const source = SOURCE_MAP[String(apiOptions.api || '').toLowerCase()];
        if (!source) throw new Error(`不支持的 api: ${apiOptions.api}. 允许值: openai/claude/gemini/cohere/deepseek`);
        const uiModel = getUiDefaultModel(source);
        const model = String(apiOptions.model || '').trim() || uiModel;
        if (!model) throw new Error('未指定模型，且主界面当前提供商未选择模型。');

        const body = { messages, model, stream: true, chat_completion_source: source };
        // Auto-reuse main UI reverse proxy settings when not provided in command
        const configuredReverseProxy = String(oai_settings?.reverse_proxy || '').trim();
        const configuredProxyPassword = String(oai_settings?.proxy_password || '').trim();
        const reverseProxy = String(apiOptions.apiurl || configuredReverseProxy || '').trim();
        const proxyPassword = String(apiOptions.apipassword || configuredProxyPassword || '').trim();
        if (PROXY_SUPPORTED.has(source) && reverseProxy) {
            body.reverse_proxy = reverseProxy.replace(/\/?$/, '');
            if (proxyPassword) body.proxy_password = proxyPassword;
        }

        const response = await fetch('/api/backends/chat-completions/generate', {
            method: 'POST',
            body: JSON.stringify(body),
            headers: getRequestHeaders(),
            signal: abortSignal,
        });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`后端响应错误: ${response.status} ${response.statusText} ${text}`);
        }

        const eventStream = getEventSourceStream();
        response.body.pipeThrough(eventStream);
        const reader = eventStream.readable.getReader();

        const state = { reasoning: '', image: '' };
        let text = '';
        async function* gen() {
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) return;
                    const raw = value?.data;
                    if (!raw || raw === '[DONE]') return;
                    let parsed; try { parsed = JSON.parse(raw); } catch { continue; }
                    const chunk = getStreamingReply(parsed, state, { chatCompletionSource: source });
                    if (typeof chunk === 'string' && chunk) { text += chunk; yield text; }
                }
            } catch (err) {
                if (err?.name === 'AbortError') return;
            } finally {
                try { reader.releaseLock?.(); } catch {}
            }
        }
        return gen();
    }

    async processStreaming(generateData, prompt, sessionId) {
        const session = this._ensureSession(sessionId, prompt);
        const abortController = new AbortController(); session.abortController = abortController;
        try {
            this.isStreaming = true; this.activeCount++; session.isStreaming = true; session.text = ''; session.updatedAt = Date.now(); this.tempreply = '';
            const generator = await this.callStreamingAPI(generateData, abortController.signal);
            for await (const c of generator) this.updateTempReply(c, session.id);
            const payload = { finalText: session.text, originalPrompt: prompt, sessionId: session.id };
            try { eventSource?.emit?.(EVT_DONE, payload); } catch {}
            this.postToFrames(EVT_DONE, payload);
            return String(session.text || '');
        } catch {
            return String(session.text || '');
        } finally {
            session.isStreaming = false;
            this.activeCount = Math.max(0, this.activeCount - 1);
            this.isStreaming = this.activeCount > 0;
            if (!abortController.signal.aborted) abortController.abort();
        }
    }

    _normalize(s) { return String(s || '').replace(/[\r\t]/g, '').replace(/[\u200B\u00A0]/g, '').replace(/\s+/g, ' ').replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim(); }
    _stripNamePrefix(s) { return String(s || '').replace(/^\s*[^:]{1,32}:\s*/, ''); }
    _normStrip(s) { return this._normalize(this._stripNamePrefix(s)); }

    _createIsFromChat() {
        const chatNorms = chat.map(m => this._normStrip(m?.mes)).filter(Boolean);
        const chatSet = new Set(chatNorms);
        return (content) => {
            const n = this._normStrip(content); if (!n) return false;
            if (chatSet.has(n)) return true;
            for (const c of chatNorms) {
                const a = n.length, b = c.length, minL = Math.min(a, b), maxL = Math.max(a, b);
                if (minL < 20) continue;
                if ((a >= b && n.includes(c)) || (b >= a && c.includes(n))) if (minL / maxL >= 0.8) return true;
            }
            return false;
        };
    }
    _pushIf(arr, role, content) { const t = String(content || '').trim(); if (t) arr.push({ role, content: t }); }

    async xbgenrawCommand(args, prompt) {
        if (!prompt?.trim()) return '';
        const role = ['user', 'system', 'assistant'].includes(args?.as) ? args.as : 'user';
        const position = ['history', 'after_history', 'afterhistory', 'chathistory'].includes(String(args?.position || '').toLowerCase()) ? 'history' : 'bottom';
        const sessionId = this._getSlotId(args?.id);
        const apiOptions = parseApiOptions(args);
        const addonSet = new Set(String(args?.addon || '').split(',').map(s => s.trim()).filter(Boolean));
        const topsys = String(args?.topsys || '').trim();
        const topuser = String(args?.topuser || '').trim();
        const topassistant = String(args?.topassistant || '').trim();
        const bottomHint = String(args?.bottom || '').trim();

        const topMsgs = [];
        if (topsys) topMsgs.push({ role: 'system', content: topsys });
        if (topuser) topMsgs.push({ role: 'user', content: topuser });
        if (topassistant) topMsgs.push({ role: 'assistant', content: topassistant });

        if (addonSet.size === 0) {
            const messages = [];
            if (topMsgs.length) messages.push(...topMsgs);
            messages.push({ role, content: prompt.trim() });
            if (bottomHint) messages.push({ role: 'assistant', content: bottomHint });
            this.processStreaming({ messages, apiOptions }, prompt, sessionId).catch(() => {});
            return String(sessionId);
        }

        (async () => {
            try {
                const context = getContext();
                /** @type {any} */
                let capturedData = null;
                /** @param {any} data */
                const dataListener = (data) => {
                    if (data && typeof data === 'object' && !Array.isArray(data) && Array.isArray(data.prompt)) {
                        capturedData = { ...data, prompt: data.prompt.slice() };
                    } else if (Array.isArray(data)) {
                        capturedData = data.slice();
                    } else {
                        capturedData = data;
                    }
                };
                eventSource.on(event_types.GENERATE_AFTER_DATA, dataListener);
                try {
                    await context.generate('normal', { quiet_prompt: prompt.trim(), quietToLoud: false, skipWIAN: false, force_name2: true }, true);
                } finally {
                    eventSource.removeListener(event_types.GENERATE_AFTER_DATA, dataListener);
                }

                const fields = getCharacterCardFields();
                const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
                const src = (isObj(capturedData) && Array.isArray(capturedData.prompt)) ? capturedData.prompt : (Array.isArray(capturedData) ? capturedData : []);
                const includePreset = addonSet.has('preset');
                const includeHistory = addonSet.has('chatHistory');
                const includeWorldInfo = addonSet.has('worldInfo');
                const includeCharDesc = addonSet.has('charDescription');
                const includeCharPersonality = addonSet.has('charPersonality');
                const includeScenario = addonSet.has('scenario');
                const includePersona = addonSet.has('personaDescription');
                const selected = [];
                const chatIndices = [];
                const isFromChat = this._createIsFromChat();
                const norm = (s) => this._normStrip(s);

                for (const m of src) {
                    if (!m) continue;
                    const contentRaw = String(m.content || '').trim(); if (!contentRaw) continue;
                    const isChat = (m.role === 'user' || m.role === 'assistant') && isFromChat(contentRaw);
                    if (includeHistory && isChat) { selected.push({ role: m.role, content: contentRaw }); chatIndices.push(selected.length - 1); continue; }
                    if (includePreset && !isChat && (m.role === 'system' || m.role === 'assistant' || m.role === 'user')) {
                        if (norm(contentRaw) === norm(prompt)) continue; selected.push({ role: m.role, content: contentRaw }); continue;
                    }
                    if (includeWorldInfo && m.role === 'system') selected.push({ role: m.role, content: contentRaw });
                }

                const promptNorm = norm(prompt);
                for (let i = selected.length - 1; i >= 0; i--) {
                    const m = selected[i];
                    if (!m || (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'system')) continue;
                    if (norm(m.content) === promptNorm) selected.splice(i, 1);
                }

                const messageToInsert = { role, content: String(prompt).trim() };
                if (position === 'history') {
                    if (chatIndices.length > 0) {
                        selected.splice(Math.max(...chatIndices) + 1, 0, messageToInsert);
                    } else {
                        let lastChatSrcIndex = -1;
                        for (let i = 0; i < src.length; i++) {
                            const mm = src[i]; if (!mm) continue;
                            if ((mm.role === 'user' || mm.role === 'assistant') && isFromChat(mm.content)) lastChatSrcIndex = i;
                        }
                        let insertAt = -1;
                        if (lastChatSrcIndex >= 0) {
                            for (let k = 0; k < selected.length; k++) {
                                const sel = selected[k];
                                const j = src.findIndex(mm => mm && mm.role === sel.role && norm(mm.content) === norm(sel.content));
                                if (j > lastChatSrcIndex) { insertAt = k; break; }
                            }
                        }
                        if (insertAt >= 0) selected.splice(insertAt, 0, messageToInsert); else selected.push(messageToInsert);
                    }
                } else {
                    selected.push(messageToInsert);
                }

                const extras = [];
                const same = (a, b) => norm(a) === norm(b);

                // 去重：若 topMsgs 与 extras/selected 重复，则先移除已存在的
                if (topMsgs.length) {
                    for (const t of topMsgs) {
                        for (let i = extras.length - 1; i >= 0; i--) if (extras[i]?.role === t.role && same(extras[i].content, t.content)) extras.splice(i, 1);
                        for (let i = selected.length - 1; i >= 0; i--) if (selected[i]?.role === t.role && same(selected[i].content, t.content)) selected.splice(i, 1);
                    }
                }
                if (bottomHint) {
                    for (let i = extras.length - 1; i >= 0; i--) if (extras[i]?.role === 'assistant' && same(extras[i].content, bottomHint)) extras.splice(i, 1);
                    for (let i = selected.length - 1; i >= 0; i--) if (selected[i]?.role === 'assistant' && same(selected[i].content, bottomHint)) selected.splice(i, 1);
                }

                if (includeCharDesc && fields?.description) this._pushIf(extras, 'system', fields.description);
                if (includeCharPersonality && fields?.personality) this._pushIf(extras, 'system', fields.personality);
                if (includeScenario && fields?.scenario) this._pushIf(extras, 'system', fields.scenario);
                if (includePersona && fields?.persona) this._pushIf(extras, 'system', fields.persona);

                const merged = [
                    ...topMsgs,
                    ...extras.filter(e => e && e.content && !selected.some(s => s && s.content && same(s.content, e.content) && s.role === e.role)),
                    ...selected,
                    ...(bottomHint ? [{ role: 'assistant', content: bottomHint }] : []),
                ];
                const seen = new Set(), finalMessages = [];
                for (const m of merged) {
                    if (!m?.content) continue;
                    const key = `${m.role}:${norm(m.content)}`;
                    if (seen.has(key)) continue; seen.add(key); finalMessages.push(m);
                }
                await this.processStreaming({ messages: finalMessages, apiOptions }, prompt, sessionId);
            } catch {}
        })();

        return String(sessionId);
    }

    async xbgenCommand(args, prompt) {
        if (!prompt?.trim()) return '';
        const role = ['user', 'system', 'assistant'].includes(args?.as) ? args.as : 'system';
        const position = ['history', 'after_history', 'afterhistory', 'chathistory'].includes(String(args?.position || '').toLowerCase()) ? 'history' : 'bottom';
        const sessionId = this._getSlotId(args?.id);

        (async () => {
            try {
                const context = getContext();
                /** @type {any[]} */
                let originalPromptMessages = [];
                let lastOriginalHistoryIndex = -1;
                const tempMessage = {
                    name: role === 'user' ? (name1 || 'User') : 'System',
                    is_user: role === 'user',
                    is_system: role === 'system',
                    mes: prompt.trim(),
                    send_date: new Date().toISOString(),
                };
                const originalLength = chat.length;
                chat.push(tempMessage);

                /** @type {any} */
                let capturedData = null;
                /** @param {any} data */
                const dataListener = (data) => {
                    if (data?.prompt && Array.isArray(data.prompt)) {
                        let messages = [...data.prompt];
                        originalPromptMessages = [...messages];
                        try {
                            const isFromChat = this._createIsFromChat();
                            for (let i = originalPromptMessages.length - 1; i >= 0; i--) {
                                const m = originalPromptMessages[i];
                                if (m && (m.role === 'user' || m.role === 'assistant') && isFromChat(m.content)) { lastOriginalHistoryIndex = i; break; }
                            }
                        } catch {}
                        const promptText = prompt.trim();
                        for (let i = messages.length - 1; i >= 0; i--) {
                            if (messages[i].content === promptText &&
                                ((role !== 'system' && messages[i].role === 'system') || (role === 'system' && messages[i].role === 'user'))) {
                                messages.splice(i, 1); break;
                            }
                        }
                        capturedData = { ...data, prompt: messages };
                    } else {
                        capturedData = data;
                    }
                };

                eventSource.on(event_types.GENERATE_AFTER_DATA, dataListener);
                try {
                    await context.generate('normal', { quiet_prompt: prompt.trim(), quietToLoud: false, skipWIAN: false, force_name2: true }, true);
                } finally {
                    eventSource.removeListener(event_types.GENERATE_AFTER_DATA, dataListener);
                    chat.length = originalLength;
                }

                const apiOptions = parseApiOptions(args);
                /** @type {any[]} */
                let finalPromptMessages = [];
                if (capturedData && typeof capturedData === 'object' && !Array.isArray(capturedData) && Array.isArray(capturedData.prompt)) finalPromptMessages = capturedData.prompt.slice();
                else if (Array.isArray(capturedData)) finalPromptMessages = capturedData.slice();

                const norm = (s) => this._normStrip(s);
                const promptNorm = norm(prompt);
                for (let i = finalPromptMessages.length - 1; i >= 0; i--) {
                    const m = finalPromptMessages[i];
                    if (!m || (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'system')) continue;
                    if (norm(m.content) === promptNorm) finalPromptMessages.splice(i, 1);
                }

                const messageToInsert = { role, content: String(prompt).trim() };
                if (position === 'history') {
                    const isFromChat = this._createIsFromChat();
                    let lastHistoryIndex = -1;
                    for (let i = 0; i < finalPromptMessages.length; i++) {
                        const m = finalPromptMessages[i];
                        if (m && (m.role === 'user' || m.role === 'assistant') && isFromChat(m.content)) lastHistoryIndex = i;
                    }
                    if (lastHistoryIndex >= 0) {
                        finalPromptMessages.splice(lastHistoryIndex + 1, 0, messageToInsert);
                    } else {
                        let insertAt = -1;
                        if (lastOriginalHistoryIndex >= 0 && Array.isArray(originalPromptMessages)) {
                            for (let k = 0; k < finalPromptMessages.length; k++) {
                                const sel = finalPromptMessages[k];
                                let idxInOrig = -1, selNorm = norm(sel.content);
                                for (let idx = 0; idx < originalPromptMessages.length; idx++) {
                                    const mm = originalPromptMessages[idx];
                                    if (mm && norm(mm.content) === selNorm) { idxInOrig = idx; break; }
                                }
                                if (idxInOrig > lastOriginalHistoryIndex) { insertAt = k; break; }
                            }
                        }
                        if (insertAt >= 0) finalPromptMessages.splice(insertAt, 0, messageToInsert);
                        else finalPromptMessages.push(messageToInsert);
                    }
                } else {
                    finalPromptMessages.push(messageToInsert);
                }

                const dataWithOptions = (capturedData && typeof capturedData === 'object' && !Array.isArray(capturedData))
                    ? { ...capturedData, prompt: finalPromptMessages, apiOptions }
                    : { messages: finalPromptMessages, apiOptions };

                await this.processStreaming(dataWithOptions, prompt, sessionId);
            } catch {}
        })();

        return String(sessionId);
    }

    registerCommands() {
        const commands = [
            {
                name: 'xbgen',
                callback: (args, prompt) => this.xbgenCommand(args, prompt),
                namedArgumentList: [
                    SlashCommandNamedArgument.fromProps({ name: 'as', description: '消息角色', typeList: [ARGUMENT_TYPE.STRING], defaultValue: 'system', enumList: ['user', 'system', 'assistant'] }),
                    SlashCommandNamedArgument.fromProps({ name: 'id', description: '可选：会话ID（不填则自动生成）', typeList: [ARGUMENT_TYPE.STRING] }),
                    SlashCommandNamedArgument.fromProps({ name: 'api', description: '后端: openai/claude/gemini/cohere/deepseek', typeList: [ARGUMENT_TYPE.STRING] }),
                    SlashCommandNamedArgument.fromProps({ name: 'apiurl', description: '可选：自定义后端URL（部分后端支持）', typeList: [ARGUMENT_TYPE.STRING] }),
                    SlashCommandNamedArgument.fromProps({ name: 'apipassword', description: '可选：后端密码/密钥（与 apiurl 配合使用）', typeList: [ARGUMENT_TYPE.STRING] }),
                    SlashCommandNamedArgument.fromProps({ name: 'model', description: '模型名', typeList: [ARGUMENT_TYPE.STRING] }),
                    SlashCommandNamedArgument.fromProps({ name: 'position', description: '插入位置：bottom（默认）或 history（紧跟 chatHistory 底部）', typeList: [ARGUMENT_TYPE.STRING], enumList: ['bottom', 'history'] }),
                ],
                unnamedArgumentList: [SlashCommandArgument.fromProps({ description: '生成提示文本', typeList: [ARGUMENT_TYPE.STRING], isRequired: true })],
                helpString: `<div>使用完整上下文进行流式生成，返回会话ID</div>
<div><code>/xbgen 写一个故事</code></div>
<div><code>/xbgen as=user 继续对话</code></div>
<div><code>/xbgen id=xxx 自定义会话ID</code></div>
<div><code>/xbgen api=gemini apiurl=http://192.45.34.7:8000/v1 model=gemini-2.5-pro</code></div>
<div><code>/xbgen position=history 让提示紧跟在 chatHistory 段落之后</code></div>`
            },
            {
                name: 'xbgenraw',
                callback: (args, prompt) => this.xbgenrawCommand(args, prompt),
                namedArgumentList: [
                    SlashCommandNamedArgument.fromProps({ name: 'as', description: '消息角色', typeList: [ARGUMENT_TYPE.STRING], defaultValue: 'user', enumList: ['user', 'system', 'assistant'] }),
                    SlashCommandNamedArgument.fromProps({ name: 'id', description: '可选：会话ID（不填则自动生成）', typeList: [ARGUMENT_TYPE.STRING] }),
                    SlashCommandNamedArgument.fromProps({ name: 'api', description: '后端: openai/claude/gemini/cohere/deepseek', typeList: [ARGUMENT_TYPE.STRING] }),
                    SlashCommandNamedArgument.fromProps({ name: 'apiurl', description: '可选：自定义后端URL（部分后端支持）', typeList: [ARGUMENT_TYPE.STRING] }),
                    SlashCommandNamedArgument.fromProps({ name: 'apipassword', description: '可选：后端密码/密钥（与 apiurl 配合使用）', typeList: [ARGUMENT_TYPE.STRING] }),
                    SlashCommandNamedArgument.fromProps({ name: 'model', description: '模型名', typeList: [ARGUMENT_TYPE.STRING] }),
                    SlashCommandNamedArgument.fromProps({ name: 'addon', description: '附加上下文：preset,chatHistory,worldInfo,charDescription,charPersonality,scenario,personaDescription（逗号分隔）', typeList: [ARGUMENT_TYPE.STRING] }),
                    SlashCommandNamedArgument.fromProps({ name: 'position', description: '插入位置：bottom（默认）或 history（紧跟 chatHistory 底部）', typeList: [ARGUMENT_TYPE.STRING], enumList: ['bottom', 'history'] }),
                    SlashCommandNamedArgument.fromProps({ name: 'topsys', description: '可选：置顶 system 提示词', typeList: [ARGUMENT_TYPE.STRING] }),
                    SlashCommandNamedArgument.fromProps({ name: 'topuser', description: '可选：置顶 user 提示词', typeList: [ARGUMENT_TYPE.STRING] }),
                    SlashCommandNamedArgument.fromProps({ name: 'topassistant', description: '可选：置顶 assistant 提示词', typeList: [ARGUMENT_TYPE.STRING] }),
                    SlashCommandNamedArgument.fromProps({ name: 'bottom', description: '可选：置底 assistant 提示词', typeList: [ARGUMENT_TYPE.STRING] }),
                ],
                unnamedArgumentList: [SlashCommandArgument.fromProps({ description: '原始提示文本', typeList: [ARGUMENT_TYPE.STRING], isRequired: true })],
                helpString: `<div>使用原始提示进行流式生成（默认无上下文），返回会话ID</div>
<div><code>/xbgenraw 写一个故事</code></div>
<div><code>/xbgenraw id=xxx 自定义会话ID</code></div>
<div><code>/xbgenraw api=claude model=claude-3-5-sonnet-20240620</code></div>
<div><code>/xbgenraw addon=chatHistory position=history 继续写作</code></div>
<div><code>/xbgenraw addon=preset 采用核心预设（含系统与非聊天块）</code></div>
<div><code>/xbgenraw addon=worldInfo 精确注入 WI（Before/After/Depth）</code></div>
<div><code>/xbgenraw addon=charDescription,charPersonality,scenario,personaDescription 精确注入卡面字段</code></div>
<div><code>/xbgenraw topsys=系统规则... topuser=用户背景... topassistant=示例回答... bottom=请严格按上述要求作答</code></div>`
            }
        ];
        commands.forEach(c => SlashCommandParser.addCommandObject(SlashCommand.fromProps({ ...c, returns: 'session ID' })));
    }

    getLastGeneration(sessionId) {
        if (sessionId !== undefined) {
            const sid = this._getSlotId(sessionId);
            return this.sessions.get(sid)?.text || '';
        }
        return this.tempreply;
    }
    getStatus(sessionId) {
        if (sessionId !== undefined) {
            const sid = this._getSlotId(sessionId);
            const s = this.sessions.get(sid);
            return s ? { isStreaming: !!s.isStreaming, text: s.text, sessionId: sid } : { isStreaming: false, text: '', sessionId: sid };
        }
        return { isStreaming: !!this.isStreaming, text: this.tempreply };
    }
    startSession(id, prompt) { return this._ensureSession(id, prompt).id; }
    getLastSessionId() { return this.lastSessionId; }
    cancel(sessionId) {
        const s = this.sessions.get(this._getSlotId(sessionId));
        if (s?.abortController && !s.abortController.signal.aborted) s.abortController.abort();
    }
    cleanup() {
        this.sessions.forEach(s => { try { if (s.abortController && !s.abortController.signal.aborted) s.abortController.abort(); } catch {} });
        this.sessions.clear(); this.tempreply = ''; this.lastSessionId = null; this.activeCount = 0; this.isInitialized = false; this.isStreaming = false;
    }
}

const streamingGeneration = new StreamingGeneration();

export function initStreamingGeneration() {
    const w = /** @type {any} */ (window);
    if (w?.isXiaobaixEnabled === false) return;
    streamingGeneration.init();
    if (w?.registerModuleCleanup) w.registerModuleCleanup('streamingGeneration', () => streamingGeneration.cleanup());
}

export { streamingGeneration };

if (typeof window !== 'undefined') {
    const w = /** @type {any} */ (window);
    w.xiaobaixStreamingGeneration = streamingGeneration;
    if (!w.eventSource) w.eventSource = eventSource;
}
