import {
    eventSource,
    event_types,
    main_api,
    chat,
    name1
} from "../../../../script.js";
import { sendOpenAIRequest } from "../../../openai.js";
import { getContext } from "../../../st-context.js";
import { SlashCommandParser } from "../../../slash-commands/SlashCommandParser.js";
import { SlashCommand } from "../../../slash-commands/SlashCommand.js";
import { ARGUMENT_TYPE, SlashCommandArgument, SlashCommandNamedArgument } from "../../../slash-commands/SlashCommandArgument.js";

const EVT_DONE = 'xiaobaix_streaming_completed';

class StreamingGeneration {
    constructor() {
        this.tempreply = '';
        this.debounceTimer = null;
        this.isInitialized = false;

        this.isStreaming = false;
        this.sessions = new Map(); // id -> { id, text, isStreaming, prompt, updatedAt, abortController }
        this.lastSessionId = null;
        this.activeCount = 0;
    }

    init() {
        if (this.isInitialized) return;
        this.registerCommands();
        this.isInitialized = true;
        console.log('[小白X-流式生成] 初始化');
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
            // 检查会话数量，超过10个则清理最旧的
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
        // 按updatedAt排序，删除最旧的会话直到只剩9个
        const sessions = Array.from(this.sessions.entries())
            .sort(([,a], [,b]) => a.updatedAt - b.updatedAt);
        
        const toDelete = sessions.slice(0, sessions.length - 9);
        toDelete.forEach(([sessionId, session]) => {
            // 取消正在进行的请求
            if (session.abortController && !session.abortController.signal.aborted) {
                session.abortController.abort();
            }
            this.sessions.delete(sessionId);
        });
        
        console.log(`[小白X-流式生成] 清理了 ${toDelete.length} 个旧会话`);
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
        if (main_api !== 'openai') throw new Error(`流式生成仅支持OpenAI API，当前API: ${main_api}`);
        const messages = Array.isArray(generateData) ? generateData : (generateData?.prompt || generateData?.messages || generateData);
        return sendOpenAIRequest('xiaobaix_streaming', messages, abortSignal);
    }

    _extractContent(chunk) {
        if (typeof chunk === 'string') return chunk;
        if (!chunk || typeof chunk !== 'object') return '';
        return chunk.content
            || chunk.text
            || chunk.message
            || chunk.delta?.content
            || chunk.choices?.[0]?.delta?.content
            || '';
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
            } else if (generator?.[Symbol.asyncIterator]) {
                for await (const c of generator) processChunk(c);
            } else {
                processChunk(generator);
            }

            const payload = { finalText: session.text, originalPrompt: prompt, sessionId: session.id };
            try { eventSource?.emit?.(EVT_DONE, payload); } catch {}
            this.postToFrames(EVT_DONE, payload);
            return String(session.text || '');
        } catch (error) {
            console.error('[小白X-流式生成] 错误:', error);
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

        this.processStreaming(messages, prompt, sessionId).catch(e => console.error('[小白X-流式生成] xbgenraw异步错误:', e));
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

                await this.processStreaming(capturedData, prompt, sessionId);
            } catch (e) {
                console.error('[小白X-流式生成] xbgen异步错误:', e);
            }
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
                    SlashCommandNamedArgument.fromProps({ name: 'id', description: '可选：会话ID（不填则自动生成）', typeList: [ARGUMENT_TYPE.STRING] })
                ],
                unnamedArgumentList: [SlashCommandArgument.fromProps({ description: '生成提示文本', typeList: [ARGUMENT_TYPE.STRING], isRequired: true })],
                helpString: `<div>使用完整上下文进行流式生成，返回会话ID</div><div><code>/xbgen 写一个故事</code></div><div><code>/xbgen as=user 继续对话</code></div><div><code>/xbgen id=xxx 自定义会话ID</code></div>`
            },
            {
                name: 'xbgenraw',
                callback: (args, prompt) => this.xbgenrawCommand(args, prompt),
                namedArgumentList: [
                    SlashCommandNamedArgument.fromProps({ name: 'as', description: '消息角色', typeList: [ARGUMENT_TYPE.STRING], defaultValue: 'user', enumList: ['user', 'system', 'assistant'] }),
                    SlashCommandNamedArgument.fromProps({ name: 'id', description: '可选：会话ID（不填则自动生成）', typeList: [ARGUMENT_TYPE.STRING] })
                ],
                unnamedArgumentList: [SlashCommandArgument.fromProps({ description: '原始提示文本', typeList: [ARGUMENT_TYPE.STRING], isRequired: true })],
                helpString: `<div>使用原始提示进行流式生成（无上下文），返回会话ID</div><div><code>/xbgenraw 写一个故事</code></div><div><code>/xbgenraw id=xxx 自定义会话ID</code></div>`
            }
        ];
        commands.forEach(c => SlashCommandParser.addCommandObject(SlashCommand.fromProps({ ...c, returns: 'session ID' })));
        console.log('[小白X-流式生成] 命令注册');
    }

    // Multi-session API
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
        console.log('[小白X-流式生成] 清理完成');
    }
}

const streamingGeneration = new StreamingGeneration();

export function initStreamingGeneration() {
    const globalEnabled = window.isXiaobaixEnabled !== false;
    if (!globalEnabled) return;
    streamingGeneration.init();
    if (window.registerModuleCleanup) {
        window.registerModuleCleanup('streamingGeneration', () => streamingGeneration.cleanup());
    }
}

export { streamingGeneration };

if (typeof window !== 'undefined') {
    window.xiaobaixStreamingGeneration = streamingGeneration;
    if (!window.eventSource) window.eventSource = eventSource;
}