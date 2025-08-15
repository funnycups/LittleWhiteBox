import {
    eventSource, event_types, main_api, chat, name1, getRequestHeaders,
    getCharacterCardFields, setExtensionPrompt, extension_prompt_types,
    extension_prompt_roles, extractMessageFromData,
} from "../../../../script.js";
import { getStreamingReply, chat_completion_sources, oai_settings, promptManager } from "../../../openai.js";
import { ChatCompletionService } from "../../../custom-request.js";
import { getEventSourceStream } from "../../../sse-stream.js";
import { getContext } from "../../../st-context.js";
import { SlashCommandParser } from "../../../slash-commands/SlashCommandParser.js";
import { SlashCommand } from "../../../slash-commands/SlashCommand.js";
import { ARGUMENT_TYPE, SlashCommandArgument, SlashCommandNamedArgument } from "../../../slash-commands/SlashCommandArgument.js";

const EVT_DONE = 'xiaobaix_streaming_completed';
const SOURCE_MAP = {
    openai: chat_completion_sources.OPENAI, claude: chat_completion_sources.CLAUDE,
    gemini: chat_completion_sources.MAKERSUITE, google: chat_completion_sources.MAKERSUITE,
    googlegemini: chat_completion_sources.MAKERSUITE, cohere: chat_completion_sources.COHERE,
    deepseek: chat_completion_sources.DEEPSEEK,
};

const getUiDefaultModel = (source) => {
    const models = {
        [chat_completion_sources.OPENAI]: oai_settings?.openai_model,
        [chat_completion_sources.CLAUDE]: oai_settings?.claude_model,
        [chat_completion_sources.MAKERSUITE]: oai_settings?.google_model,
        [chat_completion_sources.COHERE]: oai_settings?.cohere_model,
        [chat_completion_sources.DEEPSEEK]: oai_settings?.deepseek_model,
    };
    return String(models[source] || '').trim();
};

const PROXY_SUPPORTED = new Set([
    chat_completion_sources.OPENAI, chat_completion_sources.CLAUDE,
    chat_completion_sources.MAKERSUITE, chat_completion_sources.COHERE,
    chat_completion_sources.DEEPSEEK,
]);

const inferFromMainApi = () => {
    const m = String(main_api || '').toLowerCase();
    return ['deepseek', 'claude', 'gemini', 'cohere', 'openai'].find(api =>
        m.includes(api) || (api === 'gemini' && (m.includes('maker') || m.includes('google')))
    ) || null;
};

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

    async callAPI(generateData, abortSignal, stream = true) {
        const messages = Array.isArray(generateData) ? generateData :
            (generateData?.prompt || generateData?.messages || generateData);
        const apiOptions = (!Array.isArray(generateData) && generateData?.apiOptions) ?
            generateData.apiOptions : {};

        if (!apiOptions.api) {
            const inferred = inferFromMainApi();
            if (inferred) apiOptions.api = inferred;
            else throw new Error('未指定 api，且无法从主 API 推断 provider。');
        }

        const source = SOURCE_MAP[String(apiOptions.api || '').toLowerCase()];
        if (!source) throw new Error(`不支持的 api: ${apiOptions.api}`);

        const model = String(apiOptions.model || '').trim() || getUiDefaultModel(source);
        if (!model) throw new Error('未指定模型，且主界面当前提供商未选择模型。');

        const body = {
            messages, model, stream,
            chat_completion_source: source,
            max_tokens: Number(oai_settings?.openai_max_tokens ?? 0) || 1024,
            temperature: Number(oai_settings?.temp_openai ?? ''),
            top_p: Number(oai_settings?.top_p_openai ?? ''),
            presence_penalty: Number(oai_settings?.pres_pen_openai ?? ''),
            frequency_penalty: Number(oai_settings?.freq_pen_openai ?? ''),
            stop: Array.isArray(generateData?.stop) ? generateData.stop : undefined,
        };

        const reverseProxy = String(apiOptions.apiurl || oai_settings?.reverse_proxy || '').trim();
        const proxyPassword = String(apiOptions.apipassword || oai_settings?.proxy_password || '').trim();

        if (PROXY_SUPPORTED.has(source) && reverseProxy) {
            body.reverse_proxy = reverseProxy.replace(/\/?$/, '');
            if (proxyPassword) body.proxy_password = proxyPassword;
        }

        if (stream) {
            const response = await fetch('/api/backends/chat-completions/generate', {
                method: 'POST', body: JSON.stringify(body),
                headers: getRequestHeaders(), signal: abortSignal,
            });

            if (!response.ok) throw new Error(`后端响应错误: ${response.status}`);

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

    _normalize = (s) => String(s || '').replace(/[\r\t\u200B\u00A0]/g, '').replace(/\s+/g, ' ')
        .replace(/^["'""'']+|["'""'']+$/g, '').trim();
    _stripNamePrefix = (s) => String(s || '').replace(/^\s*[^:]{1,32}:\s*/, '');
    _normStrip = (s) => this._normalize(this._stripNamePrefix(s));

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

	/**
	 * 临时切换 PromptManager 中各项启用状态，执行回调后还原。
	 * @param {Set<string>} addonSet - 传入的 addon 集合
	 * @param {Function} fn - 实际执行函数，应返回 Promise
	 */
	async _withTemporaryPromptToggles(addonSet, fn) {
		await this._waitForToggleFree();
		this._toggleBusy = true;
		let snapshot = [];
		try {
			const pm = promptManager;
			const activeChar = pm?.activeCharacter ?? null;
			const order = pm?.getPromptOrderForCharacter(activeChar) ?? [];

			// 快照原始 enabled 状态
			snapshot = order.map(e => ({ identifier: e.identifier, enabled: !!e.enabled }));
			this._lastToggleSnapshot = snapshot.map(s => ({ ...s }));

			// 先全部禁用（含 main）
			order.forEach(e => { e.enabled = false; });

			// addon 映射
			const enableIds = new Set();

			// preset: 启用“原预设中原本启用”的项，但排除指定 6 类（除非这些类别也显式出现在 addon 中）
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

			// 单项 addon 精确开启
			if (addonSet.has('chatHistory')) enableIds.add('chatHistory');
			if (addonSet.has('worldInfo')) { enableIds.add('worldInfoBefore'); enableIds.add('worldInfoAfter'); }
			if (addonSet.has('charDescription')) enableIds.add('charDescription');
			if (addonSet.has('charPersonality')) enableIds.add('charPersonality');
			if (addonSet.has('scenario')) enableIds.add('scenario');
			if (addonSet.has('personaDescription')) enableIds.add('personaDescription');

			// 如果仅请求 worldInfo 而未请求 chatHistory，则为触发深度/作者注释注入，临时启用 chatHistory（捕获后会剔除历史内容）
			if (addonSet.has('worldInfo') && !addonSet.has('chatHistory')) enableIds.add('chatHistory');

			// 应用启用集
			order.forEach(e => { if (enableIds.has(e.identifier)) e.enabled = true; });

			// 执行回调
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

    async xbgenrawCommand(args, prompt) {
        if (!prompt?.trim()) return '';

        const role = ['user', 'system', 'assistant'].includes(args?.as) ? args.as : 'user';
        const sessionId = this._getSlotId(args?.id);
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
            ['sys', 'user', 'assistant'].forEach(role => {
                const content = String(args?.[`${prefix}${role === 'sys' ? 'sys' : role}`] || '').trim();
                if (content) msgs.push({ role: role === 'sys' ? 'system' : role, content });
            });
            return msgs;
        };

        const [topMsgs, bottomMsgs] = [createMsgs('top'), createMsgs('bottom')];

        if (addonSet.size === 0) {
            const messages = [...topMsgs, { role, content: prompt.trim() }, ...bottomMsgs];
            const common = { messages, apiOptions, stop: parsedStop };
            this.processGeneration(common, prompt, sessionId, !nonstream).catch(() => {});
            return String(sessionId);
        }

        // 异步处理复杂逻辑
        (async () => {
            try {
				const context = getContext();
				/** @type {any} */
				/** @type {any} */
				let capturedData = null;

                const dataListener = (data) => {
                    capturedData = (data && typeof data === 'object' && !Array.isArray(data) && Array.isArray(data.prompt))
                        ? { ...data, prompt: data.prompt.slice() }
                        : (Array.isArray(data) ? data.slice() : data);
                };

                eventSource.on(event_types.GENERATE_AFTER_DATA, dataListener);

				const tempKeys = [];
				const pushTemp = () => {};
				// 不再在捕获阶段注入 top/bottom，避免重复进入 capturedData

			// 计算 skipWIAN：仅当显式需要 worldInfo 时才包含世界书；
			// addon=preset 时默认跳过 WI（你的要求）
			const skipWIAN = addonSet.has('worldInfo') ? false : true;

			// 临时开关：默认全关，按 addon 开
			await this._withTemporaryPromptToggles(addonSet, async () => {
				// 方案A：若仅 worldInfo，需要历史锚点触发深度与作者注释，但无需真实大历史 → 注入极简占位历史
				const sandboxed = addonSet.has('worldInfo') && !addonSet.has('chatHistory');
				let chatBackup = null;
				if (sandboxed) {
					try {
						chatBackup = chat.slice();
						// 用一条极简占位消息作为历史锚点
						chat.length = 0;
						chat.push({ name: name1 || 'User', is_user: true, is_system: false, mes: '[hist]', send_date: new Date().toISOString() });
					} catch {}
				}

				try {
					await context.generate('normal', {
						quiet_prompt: prompt.trim(), quietToLoud: false,
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
			tempKeys.forEach(key => {
                setExtensionPrompt(key, '', extension_prompt_types.IN_CHAT, 0, false, extension_prompt_roles.SYSTEM);
            });

				let src = [];
				if (capturedData && typeof capturedData === 'object' && Array.isArray(capturedData?.prompt)) {
					src = capturedData.prompt.slice();
				} else if (Array.isArray(capturedData)) {
					src = capturedData.slice();
				}

				// 直接使用捕获的 prompt；若为 sandbox 模式（仅 worldInfo），剔除历史 user/assistant
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
				// 轻量地让 position 生效：如果捕获中已有与当前提示相同内容，则将其移动到指定位置
				const position = ['history', 'after_history', 'afterhistory', 'chathistory']
					.includes(String(args?.position || '').toLowerCase()) ? 'history' : 'bottom';
				const targetIdx = finalPromptMessages.findIndex(m => m && typeof m.content === 'string' && norm(m.content) === norm(prompt));
				if (targetIdx !== -1) {
					const [msg] = finalPromptMessages.splice(targetIdx, 1);
					if (position === 'history') {
						let lastHistoryIndex = -1;
						const isFromChat = this._createIsFromChat();
						for (let i = 0; i < finalPromptMessages.length; i++) {
							const m = finalPromptMessages[i];
							if (m && (m.role === 'user' || m.role === 'assistant') && isFromChat(m.content)) {
								lastHistoryIndex = i;
							}
						}
						// 极轻：若找不到历史锚点（例如未启用 chatHistory），则插入到最后一个 system 之后；再不然插到数组末尾
						if (lastHistoryIndex >= 0) finalPromptMessages.splice(lastHistoryIndex + 1, 0, msg);
						else {
							let lastSystemIndex = -1;
							for (let i = 0; i < finalPromptMessages.length; i++) {
								if (finalPromptMessages[i]?.role === 'system') lastSystemIndex = i;
							}
							if (lastSystemIndex >= 0) finalPromptMessages.splice(lastSystemIndex + 1, 0, msg);
							else finalPromptMessages.push(msg);
						}
					} else {
						finalPromptMessages.push(msg);
					}
				}

				// 合并 top/bottom 与捕获内容，并去重相同 role+content 的重复项（避免 top/bottom 重复）
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

                const common = { messages: finalMessages, apiOptions, stop: parsedStop };
                await this.processGeneration(common, prompt, sessionId, !nonstream);
            } catch {}
        })();

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

                /** @type {any} */
                const cd = capturedData;
				let finalPromptMessages = [];
				if (cd && typeof cd === 'object' && Array.isArray(cd.prompt)) {
					finalPromptMessages = cd.prompt.slice();
				} else if (Array.isArray(cd)) {
					finalPromptMessages = cd.slice();
				}

                // 去重并插入消息
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

				/** @type {any} */
				const cd2 = capturedData;
				let dataWithOptions;
				if (cd2 && typeof cd2 === 'object' && !Array.isArray(cd2)) {
					dataWithOptions = Object.assign({}, cd2, { prompt: finalPromptMessages, apiOptions });
				} else {
					dataWithOptions = { messages: finalPromptMessages, apiOptions };
				}

                await this.processGeneration(dataWithOptions, prompt, sessionId);
            } catch {}
        })();

        return String(sessionId);
    }

    registerCommands() {
        const commonArgs = [
            { name: 'id', description: '会话ID', typeList: [ARGUMENT_TYPE.STRING] },
            { name: 'api', description: '后端: openai/claude/gemini/cohere/deepseek', typeList: [ARGUMENT_TYPE.STRING] },
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
                { name: 'addon', description: '附加上下文', typeList: [ARGUMENT_TYPE.STRING] },
                { name: 'topsys', description: '置顶 system', typeList: [ARGUMENT_TYPE.STRING] },
                { name: 'topuser', description: '置顶 user', typeList: [ARGUMENT_TYPE.STRING] },
                { name: 'topassistant', description: '置顶 assistant', typeList: [ARGUMENT_TYPE.STRING] },
                { name: 'bottomsys', description: '置底 system', typeList: [ARGUMENT_TYPE.STRING] },
                { name: 'bottomuser', description: '置底 user', typeList: [ARGUMENT_TYPE.STRING] },
                { name: 'bottomassistant', description: '置底 assistant', typeList: [ARGUMENT_TYPE.STRING] },
                ...commonArgs
            ].map(SlashCommandNamedArgument.fromProps),
            unnamedArgumentList: [SlashCommandArgument.fromProps({
                description: '原始提示文本', typeList: [ARGUMENT_TYPE.STRING], isRequired: true
            })],
            helpString: '使用原始提示进行流式生成',
            returns: 'session ID'
        }));
    }

    // 简化的工具方法
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
    if (/** @type {any} */(w)?.isXiaobaixEnabled === false) return;
    streamingGeneration.init();
    (/** @type {any} */(w))?.registerModuleCleanup?.('streamingGeneration', () => streamingGeneration.cleanup());
}

export { streamingGeneration };

if (typeof window !== 'undefined') {
    Object.assign(window, {
        xiaobaixStreamingGeneration: streamingGeneration,
        eventSource: (/** @type {any} */(window)).eventSource || eventSource
    });
}
