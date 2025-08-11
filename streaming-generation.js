import {
    eventSource,
    event_types,
    main_api,
    chat,
    name1,
    getRequestHeaders,
} from "../../../../script.js";
import { getStreamingReply, chat_completion_sources } from "../../../openai.js";
import { getEventSourceStream } from "../../../sse-stream.js";
import { getContext } from "../../../st-context.js";
import { SlashCommandParser } from "../../../slash-commands/SlashCommandParser.js";
import { SlashCommand } from "../../../slash-commands/SlashCommand.js";
import { ARGUMENT_TYPE, SlashCommandArgument, SlashCommandNamedArgument } from "../../../slash-commands/SlashCommandArgument.js";

const EVT_DONE = 'xiaobaix_streaming_completed';

function inferFromMainApi() {
    const m = String(main_api || '').toLowerCase();
    if (m.includes('deepseek')) return 'deepseek';
    if (m.includes('claude')) return 'claude';
    if (m.includes('maker') || m.includes('gemini') || m.includes('google')) return 'gemini';
    if (m.includes('cohere')) return 'cohere';
    if (m.includes('openai')) return 'openai';
    return null;
}

class StreamingGeneration {
    constructor() {
        this.tempreply = '';
        this.debounceTimer = null;
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
        const xb = String(id).match(/^xb(\d+)$/i);
        if (xb) {
            const n = +xb[1];
            if (n >= 1 && n <= 10) return `xb${n}`;
        }
        const n = parseInt(id, 10);
        if (n >= 1 && n <= 10) return n;
        return 1;
    }

    _ensureSession(id, prompt) {
        const slotId = this._getSlotId(id);
        if (!this.sessions.has(slotId)) {
            if (this.sessions.size >= 10) {
                this._cleanupOldestSessions();
            }
            this.sessions.set(slotId, {
                id: slotId,
                text: '',
                isStreaming: false,
                prompt: prompt || '',
                updatedAt: Date.now(),
                abortController: null
            });
        }
        this.lastSessionId = slotId;
        return this.sessions.get(slotId);
    }

    _cleanupOldestSessions() {
        const sessions = Array.from(this.sessions.entries()).sort(([, a], [, b]) => a.updatedAt - b.updatedAt);
        const toDelete = sessions.slice(0, sessions.length - 9);
        toDelete.forEach(([sessionId, session]) => {
            if (session.abortController && !session.abortController.signal.aborted) {
                session.abortController.abort();
            }
            this.sessions.delete(sessionId);
        });
    }

    updateTempReply(value, sessionId) {
        const text = value || '';
        if (sessionId !== undefined) {
            const sid = this._getSlotId(sessionId);
            const s = this.sessions.get(sid) || { id: sid, text: '', isStreaming: false, prompt: '', updatedAt: 0, abortController: null };
            s.text = text;
            s.updatedAt = Date.now();
            this.sessions.set(sid, s);
            this.lastSessionId = sid;
        }
        this.tempreply = text;
    }

    postToFrames(name, payload) {
        try {
            if (!window?.frames) return;
            const msg = { type: name, payload, from: 'xiaobaix' };
            for (let i = 0; i < window.frames.length; i++) {
                try { window.frames[i].postMessage(msg, '*'); } catch {}
            }
        } catch {}
    }

    async callStreamingAPI(generateData, abortSignal) {
        const messages = Array.isArray(generateData) ? generateData : (generateData?.prompt || generateData?.messages || generateData);
        const apiOptions = (!Array.isArray(generateData) && generateData?.apiOptions) ? generateData.apiOptions : {};
        if (!apiOptions.api) {
            if (String(main_api || '').toLowerCase() === 'openai') {
                const { sendOpenAIRequest } = await import("../../../openai.js");
                return sendOpenAIRequest('xiaobaix_streaming', messages, abortSignal);
            }
            const inferred = inferFromMainApi();
            if (inferred) {
                apiOptions.api = inferred;
            } else {
                throw new Error('未指定 api，且主 API 非 openai，且无法从主 API 推断 provider。');
            }
        }
        const apiLower = String(apiOptions.api || '').toLowerCase();
        const apiMap = {
            openai: chat_completion_sources.OPENAI,
            claude: chat_completion_sources.CLAUDE,
            gemini: chat_completion_sources.MAKERSUITE,
            google: chat_completion_sources.MAKERSUITE,
            googlegemini: chat_completion_sources.MAKERSUITE,
            cohere: chat_completion_sources.COHERE,
            deepseek: chat_completion_sources.DEEPSEEK,
        };
        const source = apiMap[apiLower];
        if (!source) {
            throw new Error(`不支持的 api: ${apiOptions.api}. 允许值: openai/claude/gemini/cohere/deepseek`);
        }
        let model = String(apiOptions.model || '').trim();
        if (!model) {
            const defaults = {
                [chat_completion_sources.OPENAI]: 'gpt-4o-mini',
                [chat_completion_sources.CLAUDE]: 'claude-3-5-sonnet-20240620',
                [chat_completion_sources.MAKERSUITE]: 'gemini-1.5-pro',
                [chat_completion_sources.COHERE]: 'command-r',
                [chat_completion_sources.DEEPSEEK]: 'deepseek-chat',
            };
            model = defaults[source];
        }
        const body = {
            messages,
            model,
            stream: true,
            chat_completion_source: source,
        };
        const supportsProxy = [
            chat_completion_sources.OPENAI,
            chat_completion_sources.CLAUDE,
            chat_completion_sources.MAKERSUITE,
            chat_completion_sources.VERTEXAI,
            chat_completion_sources.MISTRALAI,
            chat_completion_sources.DEEPSEEK,
            chat_completion_sources.XAI,
        ];
        const reverseProxy = String(apiOptions.apiurl || '').trim();
        const proxyPassword = String(apiOptions.apipassword || '').trim();
        if (reverseProxy && supportsProxy.includes(source)) {
            body.reverse_proxy = reverseProxy.replace(/\/?$/, '');
            if (proxyPassword) body.proxy_password = proxyPassword;
        }
        const generateUrl = '/api/backends/chat-completions/generate';
        const response = await fetch(generateUrl, {
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
        return async function* () {
            let text = '';
            const state = { reasoning: '', image: '' };
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) return;
                    const raw = value?.data;
                    if (!raw || raw === '[DONE]') return;
                    let parsed;
                    try { parsed = JSON.parse(raw); } catch { continue; }
                    const chunk = getStreamingReply(parsed, state, { chatCompletionSource: source });
                    if (typeof chunk === 'string' && chunk) {
                        text += chunk;
                        yield text;
                    }
                }
            } catch (err) {
                if (err && typeof err === 'object' && err.name === 'AbortError') {
                    return;
                }
                return;
            } finally {
                try { reader.releaseLock?.(); } catch {}
            }
        };
    }

    _extractContent(chunk) {
        if (typeof chunk === 'string') return chunk;
        if (!chunk || typeof chunk !== 'object') return '';
        return chunk.content || chunk.text || chunk.message || chunk.delta?.content || chunk.choices?.[0]?.delta?.content || '';
    }

    async processStreaming(generateData, prompt, sessionId) {
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
            const generator = await this.callStreamingAPI(generateData, abortController.signal);
            const processChunk = (c) => {
                const content = this._extractContent(c);
                if (content) this.updateTempReply(content, session.id);
            };
            if (typeof generator === 'function') {
                for await (const c of generator()) processChunk(c);
            } else if (generator && typeof generator[Symbol.asyncIterator] === 'function') {
                for await (const c of generator) processChunk(c);
            } else {
                processChunk(generator);
            }
            const payload = { finalText: session.text, originalPrompt: prompt, sessionId: session.id };
            try { eventSource?.emit?.(EVT_DONE, payload); } catch {}
            this.postToFrames(EVT_DONE, payload);
            return String(session.text || '');
        } catch (error) {
            return String(session.text || '');
        } finally {
            session.isStreaming = false;
            this.activeCount = Math.max(0, this.activeCount - 1);
            if (this.activeCount === 0) this.isStreaming = false;
            if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null; }
            if (!abortController.signal.aborted) abortController.abort();
        }
    }

    async xbgenrawCommand(args, prompt) {
        if (!prompt?.trim()) return '';
        const role = ['user', 'system', 'assistant'].includes(args?.as) ? args.as : 'user';
        const messages = [{ role, content: prompt.trim() }];
        const sessionId = this._getSlotId(args?.id);
        const apiOptions = {
            api: args?.api,
            apiurl: args?.apiurl,
            apipassword: args?.apipassword,
            model: args?.model,
        };
        this.processStreaming({ messages, apiOptions }, prompt, sessionId).catch(e => {});
        return String(sessionId);
    }

    async xbgenCommand(args, prompt) {
        if (!prompt?.trim()) return '';
        const role = ['user', 'system', 'assistant'].includes(args?.as) ? args.as : 'system';
        const sessionId = this._getSlotId(args?.id);
        (async () => {
            try {
                const context = getContext();
                const tempMessage = {
                    name: role === 'user' ? (name1 || 'User') : 'System',
                    is_user: role === 'user',
                    is_system: role === 'system',
                    mes: prompt.trim(),
                    send_date: new Date().toISOString()
                };
                const originalLength = chat.length;
                chat.push(tempMessage);
                let capturedData = null;
                const dataListener = (data) => {
                    if (data?.prompt && Array.isArray(data.prompt)) {
                        const messages = [...data.prompt];
                        const promptText = prompt.trim();
                        for (let i = messages.length - 1; i >= 0; i--) {
                            if (messages[i].content === promptText && ((role !== 'system' && messages[i].role === 'system') || (role === 'system' && messages[i].role === 'user'))) {
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
                    await context.generate('normal', { quiet_prompt: prompt.trim(), quietToLoud: false, skipWIAN: false, force_name2: true }, true);
                } catch {} finally {
                    eventSource.removeListener(event_types.GENERATE_AFTER_DATA, dataListener);
                    chat.length = originalLength;
                }
                const apiOptions = {
                    api: args?.api,
                    apiurl: args?.apiurl,
                    apipassword: args?.apipassword,
                    model: args?.model,
                };
                const baseObj = (capturedData && typeof capturedData === 'object') ? capturedData : null;
                const dataWithOptions = baseObj ? Object.assign({}, baseObj, { apiOptions }) : { messages: Array.isArray(capturedData) ? capturedData : [], apiOptions };
                await this.processStreaming(dataWithOptions, prompt, sessionId);
            } catch (e) {}
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
                ],
                unnamedArgumentList: [SlashCommandArgument.fromProps({ description: '生成提示文本', typeList: [ARGUMENT_TYPE.STRING], isRequired: true })],
                helpString: `<div>使用完整上下文进行流式生成，返回会话ID</div>
<div><code>/xbgen 写一个故事</code></div>
<div><code>/xbgen as=user 继续对话</code></div>
<div><code>/xbgen id=xxx 自定义会话ID</code></div>
<div><code>/xbgen api=gemini apiurl=http://192.45.34.7:8000/v1 model=gemini-2.5-pro</code></div>`
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
                ],
                unnamedArgumentList: [SlashCommandArgument.fromProps({ description: '原始提示文本', typeList: [ARGUMENT_TYPE.STRING], isRequired: true })],
                helpString: `<div>使用原始提示进行流式生成（无上下文），返回会话ID</div>
<div><code>/xbgenraw 写一个故事</code></div>
<div><code>/xbgenraw id=xxx 自定义会话ID</code></div>
<div><code>/xbgenraw api=claude model=claude-3-5-sonnet-20240620</code></div>`
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

    startSession(id, prompt) {
        return this._ensureSession(id, prompt).id;
    }

    getLastSessionId() { return this.lastSessionId; }

    cancel(sessionId) {
        const s = this.sessions.get(this._getSlotId(sessionId));
        if (s?.abortController && !s.abortController.signal.aborted) s.abortController.abort();
    }

    cleanup() {
        if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null; }
        this.sessions.forEach(s => { try { if (s.abortController && !s.abortController.signal.aborted) s.abortController.abort(); } catch {} });
        this.sessions.clear();
        this.tempreply = '';
        this.lastSessionId = null;
        this.activeCount = 0;
        this.isInitialized = false;
        this.isStreaming = false;
    }
}

const streamingGeneration = new StreamingGeneration();

export function initStreamingGeneration() {
    const w = window;
    const globalEnabled = w?.isXiaobaixEnabled !== false;
    if (!globalEnabled) return;
    streamingGeneration.init();
    if (w?.registerModuleCleanup) {
        w.registerModuleCleanup('streamingGeneration', () => streamingGeneration.cleanup());
    }
}

export { streamingGeneration };

if (typeof window !== 'undefined') {
    const w = window;
    w.xiaobaixStreamingGeneration = streamingGeneration;
    if (!w.eventSource) w.eventSource = eventSource;
}