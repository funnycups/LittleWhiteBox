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
    }

    init() {
        if (this.isInitialized) return;
        this.registerCommands();
        this.isInitialized = true;
        console.log('[小白X-流式生成] 初始化');
    }

    updateTempReply(value) {
        this.tempreply = value || '';
    }

    postToFrames(name, payload) {
        try {
            if (!window || !window.frames) return;
            const msg = { type: name, payload, from: 'xiaobaix' };
            for (let i = 0; i < window.frames.length; i++) {
                try { window.frames[i].postMessage(msg, '*'); } catch(e) {}
            }
        } catch(e) {}
    }

    async callStreamingAPI(generateData, abortSignal) {
        if (main_api !== 'openai') throw new Error(`流式生成仅支持OpenAI API，当前API: ${main_api}`);
        const messages = Array.isArray(generateData) ? generateData : (generateData?.prompt || generateData?.messages || generateData);
        return sendOpenAIRequest('xiaobaix_streaming', messages, abortSignal);
    }

    async processStreaming(generateData, prompt) {
        const abortController = new AbortController();
        try {
            this.isStreaming = true;
            this.tempreply = '';
            const generator = await this.callStreamingAPI(generateData, abortController.signal);

            const processChunk = (chunk) => {
                let content = '';
                if (typeof chunk === 'string') content = chunk;
                else if (chunk && typeof chunk === 'object') content = chunk.content || chunk.text || chunk.message || chunk.delta?.content || chunk.choices?.[0]?.delta?.content || '';
                if (content) this.updateTempReply(content);
            };

            if (typeof generator === 'function') {
                for await (const c of generator()) processChunk(c);
            } else if (generator && typeof generator[Symbol.asyncIterator] === 'function') {
                for await (const c of generator) processChunk(c);
            } else {
                processChunk(generator);
            }

            const payload = { finalText: this.tempreply, originalPrompt: prompt };
            try { eventSource?.emit?.(EVT_DONE, payload); } catch(e) {}
            this.postToFrames(EVT_DONE, payload);
            return String(this.tempreply || '');
        } catch (error) {
            console.error('[小白X-流式生成] 错误:', error);
            return String(this.tempreply || '');
        } finally {
            this.isStreaming = false;
            if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null; }
            if (!abortController.signal.aborted) abortController.abort();
        }
    }

    async xbgenrawCommand(args, prompt) {
        if (!prompt?.trim()) return '';
        const role = ['user', 'system', 'assistant'].includes(args?.as) ? args.as : 'user';
        const messages = [{ role, content: prompt.trim() }];
        try { return await this.processStreaming(messages, prompt); } catch { return ''; }
    }

    async xbgenCommand(args, prompt) {
        if (!prompt?.trim()) return '';
        const role = ['user', 'system', 'assistant'].includes(args?.as) ? args.as : 'system';
        const context = getContext();
        const tempMessage = { name: role === 'user' ? (name1 || 'User') : 'System', is_user: role === 'user', is_system: role === 'system', mes: prompt.trim(), send_date: new Date().toISOString() };
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
        } catch(e) {} finally {
            eventSource.removeListener(event_types.GENERATE_AFTER_DATA, dataListener);
            chat.length = originalLength;
        }

        try { return await this.processStreaming(capturedData, prompt); } catch { return ''; }
    }

    registerCommands() {
        const commands = [
            {
                name: 'xbgen',
                callback: (args, prompt) => this.xbgenCommand(args, prompt),
                namedArgumentList: [SlashCommandNamedArgument.fromProps({ name: 'as', description: '消息角色', typeList: [ARGUMENT_TYPE.STRING], defaultValue: 'system', enumList: ['user', 'system', 'assistant'] })],
                unnamedArgumentList: [SlashCommandArgument.fromProps({ description: '生成提示文本', typeList: [ARGUMENT_TYPE.STRING], isRequired: true })],
                helpString: `<div>使用完整上下文进行流式生成</div><div><code>/xbgen 写一个故事</code></div><div><code>/xbgen as=user 继续对话</code></div>`
            },
            {
                name: 'xbgenraw',
                callback: (args, prompt) => this.xbgenrawCommand(args, prompt),
                namedArgumentList: [SlashCommandNamedArgument.fromProps({ name: 'as', description: '消息角色', typeList: [ARGUMENT_TYPE.STRING], defaultValue: 'user', enumList: ['user', 'system', 'assistant'] })],
                unnamedArgumentList: [SlashCommandArgument.fromProps({ description: '原始提示文本', typeList: [ARGUMENT_TYPE.STRING], isRequired: true })],
                helpString: `<div>使用原始提示进行流式生成（无上下文）</div><div><code>/xbgenraw 写一个故事</code></div>`
            }
        ];
        commands.forEach(cmd => SlashCommandParser.addCommandObject(SlashCommand.fromProps({ ...cmd, returns: 'generated text' })));
        console.log('[小白X-流式生成] 命令注册');
    }

    getLastGeneration() { return this.tempreply; }
    getStatus() { return { isStreaming: !!this.isStreaming, text: this.tempreply }; }

    cleanup() {
        if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null; }
        this.tempreply = '';
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
