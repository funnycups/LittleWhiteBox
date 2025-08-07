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

class StreamingGeneration {
    constructor() {
        this.tempreply = '';
        this.debounceTimer = null;
        this.isInitialized = false;
    }

    init() {
        if (this.isInitialized) return;
        
        this.registerCommands();
        this.isInitialized = true;
        
        console.log('[小白X-流式生成] 模块初始化完成');
    }

    updateTempReply(value) {
        this.tempreply = value;
        console.log('[小白X-流式生成] 流式更新:', value.length, '字符');
    }

    async callStreamingAPI(generateData, abortSignal) {
        if (main_api !== 'openai') {
            throw new Error(`流式生成仅支持OpenAI API，当前API: ${main_api}`);
        }

        const messages = Array.isArray(generateData) ? generateData :
                        (generateData.prompt || generateData.messages || generateData);

        return sendOpenAIRequest('xiaobaix_streaming', messages, abortSignal);
    }

    async processStreaming(generateData, prompt) {
        const abortController = new AbortController();

        try {
            this.tempreply = '';
            console.log('[小白X-流式生成] 开始流式生成');

            const generator = await this.callStreamingAPI(generateData, abortController.signal);

            const processChunk = (chunk) => {
                let content = '';

                if (typeof chunk === 'string') {
                    content = chunk;
                } else if (chunk && typeof chunk === 'object') {
                    content = chunk.content || chunk.text || chunk.message || 
                            chunk.delta?.content || chunk.choices?.[0]?.delta?.content || '';
                }

                if (content) {
                    this.updateTempReply(content);
                }
            };

            if (typeof generator === 'function') {
                for await (const chunk of generator()) {
                    processChunk(chunk);
                }
            } else if (generator && typeof generator[Symbol.asyncIterator] === 'function') {
                for await (const chunk of generator) {
                    processChunk(chunk);
                }
            } else {
                processChunk(generator);
            }

            this.updateTempReply(this.tempreply);
            console.log('[小白X-流式生成] 流式生成完成:', this.tempreply.length, '字符');

            eventSource.emit('xiaobaix_streaming_completed', {
                finalText: this.tempreply,
                originalPrompt: prompt
            });

            return String(this.tempreply || '');

        } catch (error) {
            console.error('[小白X-流式生成] 生成错误:', error);
            return String(this.tempreply || '');
        } finally {
            if (this.debounceTimer) {
                clearTimeout(this.debounceTimer);
                this.debounceTimer = null;
            }
            if (!abortController.signal.aborted) {
                abortController.abort();
            }
        }
    }

    async xbgenrawCommand(args, prompt) {
        if (!prompt?.trim()) {
            console.warn('[小白X-流式生成] 请提供生成提示文本');
            return '';
        }

        const role = ['user', 'system', 'assistant'].includes(args?.as) ? args.as : 'user';
        const messages = [{ role, content: prompt.trim() }];

        console.log('[小白X-流式生成] RAW模式生成');

        try {
            return await this.processStreaming(messages, prompt);
        } catch (error) {
            console.error('[小白X-流式生成] xbgenraw 执行错误:', error);
            return '';
        }
    }

    async xbgenCommand(args, prompt) {
        if (!prompt?.trim()) {
            console.warn('[小白X-流式生成] 请提供生成提示文本');
            return '';
        }

        const role = ['user', 'system', 'assistant'].includes(args?.as) ? args.as : 'system';

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
                    if (messages[i].content === promptText && 
                        ((role !== 'system' && messages[i].role === 'system') ||
                         (role === 'system' && messages[i].role === 'user'))) {
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
                quiet_prompt: prompt.trim(),
                quietToLoud: false,
                skipWIAN: false,
                force_name2: true
            }, true);
        } catch (error) {
            console.error('[小白X-流式生成] 生成上下文失败:', error);
        } finally {
            eventSource.removeListener(event_types.GENERATE_AFTER_DATA, dataListener);
            chat.length = originalLength;
        }

        try {
            return await this.processStreaming(capturedData, prompt);
        } catch (error) {
            console.error('[小白X-流式生成] xbgen 执行错误:', error);
            return '';
        }
    }

    registerCommands() {
        const commands = [
            {
                name: 'xbgen',
                callback: (args, prompt) => this.xbgenCommand(args, prompt),
                namedArgumentList: [
                    SlashCommandNamedArgument.fromProps({
                        name: 'as',
                        description: '消息角色',
                        typeList: [ARGUMENT_TYPE.STRING],
                        defaultValue: 'system',
                        enumList: ['user', 'system', 'assistant'],
                    }),
                ],
                unnamedArgumentList: [
                    SlashCommandArgument.fromProps({
                        description: '生成提示文本',
                        typeList: [ARGUMENT_TYPE.STRING],
                        isRequired: true,
                    }),
                ],
                helpString: `
                    <div>使用完整上下文进行流式生成</div>
                    <div><strong>示例:</strong></div>
                    <div><code>/xbgen 写一个故事</code></div>
                    <div><code>/xbgen as=user 继续对话</code></div>
                    <div><code>/xbgen 分析情感 | /setvar key=analysis</code></div>
                    <div><code>/xbgen 生成标签 | /createentry file=chatLore key=新角色</code></div>
                `,
            },
            {
                name: 'xbgenraw',
                callback: (args, prompt) => this.xbgenrawCommand(args, prompt),
                namedArgumentList: [
                    SlashCommandNamedArgument.fromProps({
                        name: 'as',
                        description: '消息角色',
                        typeList: [ARGUMENT_TYPE.STRING],
                        defaultValue: 'user',
                        enumList: ['user', 'system', 'assistant'],
                    }),
                ],
                unnamedArgumentList: [
                    SlashCommandArgument.fromProps({
                        description: '原始提示文本',
                        typeList: [ARGUMENT_TYPE.STRING],
                        isRequired: true,
                    }),
                ],
                helpString: `
                    <div>使用原始提示进行流式生成（无上下文）</div>
                    <div><strong>示例:</strong></div>
                    <div><code>/xbgenraw 写一个故事</code></div>
                    <div><code>/xbgenraw as=assistant 解释概念</code></div>
                    <div><code>/xbgenraw 翻译文本 | /echo</code></div>
                `,
            }
        ];

        commands.forEach(cmd => {
            SlashCommandParser.addCommandObject(SlashCommand.fromProps({
                ...cmd,
                returns: 'generated text'
            }));
        });

        console.log('[小白X-流式生成] 斜杠命令注册完成');
    }

    getLastGeneration() {
        return this.tempreply;
    }

    cleanup() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        this.tempreply = '';
        this.isInitialized = false;
        
        console.log('[小白X-流式生成] 模块清理完成');
    }
}

const streamingGeneration = new StreamingGeneration();

export function initStreamingGeneration() {
    const globalEnabled = window.isXiaobaixEnabled !== false;
    if (!globalEnabled) return;

    streamingGeneration.init();

    if (window.registerModuleCleanup) {
        window.registerModuleCleanup('streamingGeneration', () => {
            streamingGeneration.cleanup();
        });
    }
}

export { streamingGeneration };

if (typeof window !== 'undefined') {
    window.xiaobaixStreamingGeneration = streamingGeneration;
}
