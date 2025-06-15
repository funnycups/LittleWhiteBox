import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";
import { callGenericPopup, POPUP_TYPE } from "../../../popup.js";

const EXT_ID = "LittleWhiteBox";
const CONSTANTS = {
    MAX_HISTORY_RECORDS: 10,
    CHECK_INTERVAL: 200,
    DEBOUNCE_DELAY: 300,
    CLEANUP_INTERVAL: 300000,
    TARGET_ENDPOINT: '/api/backends/chat-completions/generate',
    DEFAULT_TIMEOUT_SECONDS: 30,
    MESSAGE_ASSOCIATION_DELAY: 1000,
    RECENT_REQUEST_WINDOW: 30000
};

let isPreviewMode = false;
let capturedPreviewData = null;
let originalFetch = null;
let previewMessageIds = new Set();
let apiRequestHistory = [];
let isInterceptorActive = false;
let cleanupTimer = null;
let eventListeners = [];
let previewPromiseResolve = null;
let previewPromiseReject = null;
let sendButtonState = { wasDisabled: false };

function getSettings() {
    if (!extension_settings[EXT_ID]) {
        extension_settings[EXT_ID] = {};
    }
    if (!extension_settings[EXT_ID].preview) {
        extension_settings[EXT_ID].preview = {
            enabled: true,
            timeoutSeconds: CONSTANTS.DEFAULT_TIMEOUT_SECONDS
        };
    }
    if (!extension_settings[EXT_ID].recorded) {
        extension_settings[EXT_ID].recorded = {
            enabled: true
        };
    }

    const settings = extension_settings[EXT_ID];
    settings.preview.timeoutSeconds = CONSTANTS.DEFAULT_TIMEOUT_SECONDS;
    return settings;
}

function highlightXmlTags(text) {
    if (typeof text !== 'string') return text;
    return text.replace(/<([^>]+)>/g, '<span style="color:rgb(153, 153, 153); font-weight: bold;">&lt;$1&gt;</span>');
}

function isTargetApiRequest(url, options = {}) {
    return url?.includes(CONSTANTS.TARGET_ENDPOINT) && options.body?.includes('"messages"');
}

function setupInterceptor() {
    if (isInterceptorActive) return;

    originalFetch = window.fetch;
    isInterceptorActive = true;

    window.fetch = function(url, options = {}) {
        if (isTargetApiRequest(url, options)) {
            if (isPreviewMode) {
                return handlePreviewInterception(url, options)
                    .catch(error => {
                        return new Response(JSON.stringify({
                            error: { message: "预览失败，请手动中止消息生成。" }
                        }), { 
                            status: 500, 
                            headers: { 'Content-Type': 'application/json' } 
                        });
                    });
            } else {
                recordRealApiRequest(url, options);
                return originalFetch.call(window, url, options);
            }
        }
        return originalFetch.call(window, url, options);
    };
}

function restoreOriginalFetch() {
    if (originalFetch && isInterceptorActive) {
        window.fetch = originalFetch;
        originalFetch = null;
        isInterceptorActive = false;
    }
}

function manageSendButton(disable = true) {
    const $sendBtn = $('#send_but');
    if (disable) {
        sendButtonState.wasDisabled = $sendBtn.prop('disabled');
        $sendBtn.prop('disabled', true);
        $sendBtn.off('click.preview-block').on('click.preview-block', e => {
            e.preventDefault();
            e.stopImmediatePropagation();
            return false;
        });
    } else {
        $sendBtn.prop('disabled', sendButtonState.wasDisabled);
        $sendBtn.off('click.preview-block');
        sendButtonState.wasDisabled = false;
    }
}

function triggerSendSafely() {
    const $sendBtn = $('#send_but');
    const $textarea = $('#send_textarea');

    if (!$textarea.val().trim()) return false;

    const wasDisabled = $sendBtn.prop('disabled');
    $sendBtn.prop('disabled', false);

    $sendBtn[0].dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window
    }));

    if (wasDisabled) $sendBtn.prop('disabled', true);
    return true;
}

function recordRealApiRequest(url, options) {
    try {
        const requestData = JSON.parse(options.body);
        const context = getContext();
        const userInput = extractUserInputFromMessages(requestData.messages || []);
    
        const historyItem = {
            url,
            method: options.method || 'POST',
            requestData,
            messages: requestData.messages || [],
            model: requestData.model || 'Unknown',
            timestamp: Date.now(),
            messageId: context.chat?.length || 0,
            characterName: context.characters?.[context.characterId]?.name || 'Unknown',
            userInput,
            isRealRequest: true
        };
    
        apiRequestHistory.unshift(historyItem);
        if (apiRequestHistory.length > CONSTANTS.MAX_HISTORY_RECORDS) {
            apiRequestHistory = apiRequestHistory.slice(0, CONSTANTS.MAX_HISTORY_RECORDS);
        }
    
        setTimeout(() => {
            if (apiRequestHistory[0] && !apiRequestHistory[0].associatedMessageId) {
                apiRequestHistory[0].associatedMessageId = context.chat?.length || 0;
            }
        }, CONSTANTS.MESSAGE_ASSOCIATION_DELAY);
    
    } catch (error) {
    }
}

async function handlePreviewInterception(url, options) {
    try {
        const requestData = JSON.parse(options.body);
        const userInput = extractUserInputFromMessages(requestData?.messages || []);
    
        capturedPreviewData = {
            url,
            method: options.method || 'POST',
            requestData,
            messages: requestData?.messages || [],
            model: requestData?.model || 'Unknown',
            timestamp: Date.now(),
            userInput,
            isPreview: true
        };
    
        if (previewPromiseResolve) {
            previewPromiseResolve({ success: true, data: capturedPreviewData });
            previewPromiseResolve = null;
            previewPromiseReject = null;
        }
    
        return new Response(JSON.stringify({
            choices: [{
                message: { content: "预览模式" },
                finish_reason: "stop"
            }]
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    
    } catch (error) {
        if (previewPromiseReject) {
            previewPromiseReject(error);
            previewPromiseResolve = null;
            previewPromiseReject = null;
        }
        throw error;
    }
}

function interceptMessageCreation() {
    const context = getContext();
    const originalPush = context.chat.push;

    context.chat.push = function(...items) {
        if (isPreviewMode) {
            const startId = context.chat.length;
            const result = originalPush.apply(this, items);
            for (let i = 0; i < items.length; i++) {
                previewMessageIds.add(startId + i);
            }
            return result;
        }
        return originalPush.apply(this, items);
    };

    const originalAppendChild = Element.prototype.appendChild;
    Element.prototype.appendChild = function(child) {
        if (isPreviewMode && child?.classList?.contains('mes')) {
            return child;
        }
        return originalAppendChild.call(this, child);
    };

    return function restore() {
        context.chat.push = originalPush;
        Element.prototype.appendChild = originalAppendChild;
    
        if (previewMessageIds.size > 0) {
            const idsToDelete = Array.from(previewMessageIds).sort((a, b) => b - a);
            idsToDelete.forEach(id => {
                if (id < context.chat.length) {
                    context.chat.splice(id, 1);
                }
            });
            previewMessageIds.clear();
        }
    };
}

function extractUserInputFromMessages(messages) {
    if (!Array.isArray(messages)) return '';
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]?.role === 'user') {
            return messages[i].content || '';
        }
    }
    return '';
}

function waitForPreviewInterception() {
    const settings = getSettings();
    const timeoutMs = settings.preview.timeoutSeconds * 1000;

    return new Promise((resolve, reject) => {
        previewPromiseResolve = resolve;
        previewPromiseReject = reject;
    
        const timeoutId = setTimeout(() => {
            if (previewPromiseResolve) {
                previewPromiseResolve({ 
                    success: false, 
                    error: `等待超时 (${settings.preview.timeoutSeconds}秒)`
                });
                previewPromiseResolve = null;
                previewPromiseReject = null;
            }
        }, timeoutMs);
    
        const originalResolve = previewPromiseResolve;
        const originalReject = previewPromiseReject;
    
        previewPromiseResolve = (value) => {
            clearTimeout(timeoutId);
            if (originalResolve) originalResolve(value);
        };
    
        previewPromiseReject = (error) => {
            clearTimeout(timeoutId);
            if (originalReject) originalReject(error);
        };
    });
}

let previewAbortController = null;

async function showMessagePreview() {
    let restoreMessageCreation = null;
    let loadingToast = null;

    try {
        const settings = getSettings();
        const globalEnabled = window.isXiaobaixEnabled !== undefined ? window.isXiaobaixEnabled : true;
        if (!settings.preview.enabled || !globalEnabled) {
            toastr.warning('消息预览功能未启用');
            return;
        }
    
        const textareaText = String($('#send_textarea').val()).trim();
        if (!textareaText) {
            toastr.error('请先输入消息内容');
            return;
        }
    
        manageSendButton(true);
        isPreviewMode = true;
        capturedPreviewData = null;
        previewMessageIds.clear();
    
        previewAbortController = new AbortController();
        restoreMessageCreation = interceptMessageCreation();
    
        loadingToast = toastr.info(`正在预览请求...（${settings.preview.timeoutSeconds}秒超时）`, '消息预览', { 
            timeOut: 0, 
            tapToDismiss: false 
        });
    
        const sendTriggered = triggerSendSafely();
        if (!sendTriggered) {
            throw new Error('无法触发发送事件');
        }
    
        const result = await waitForPreviewInterception().catch(error => ({
            success: false, 
            error: error.message 
        }));
    
        if (loadingToast) {
            toastr.clear(loadingToast);
            loadingToast = null;
        }
    
        if (result.success) {
            await displayPreviewResult(result.data, textareaText);
            toastr.success('预览成功！', '', { timeOut: 3000 });
        } else {
            toastr.error(`预览失败: ${result.error}`, '', { timeOut: 5000 });
        }
    
    } catch (error) {
        if (loadingToast) {
            toastr.clear(loadingToast);
            loadingToast = null;
        }
        toastr.error(`预览异常: ${error.message}`, '', { timeOut: 5000 });
    
    } finally {
        if (previewAbortController) {
            try {
                previewAbortController.abort('预览结束');
            } catch (abortError) {
            }
            previewAbortController = null;
        }
    
        if (previewPromiseResolve) {
            previewPromiseResolve({ 
                success: false, 
                error: '预览已取消' 
            });
        }
        previewPromiseResolve = null;
        previewPromiseReject = null;
    
        if (restoreMessageCreation) {
            try {
                restoreMessageCreation();
            } catch (cleanupError) {
            }
        }
    
        isPreviewMode = false;
        capturedPreviewData = null;
        manageSendButton(false);
    }
}

async function displayPreviewResult(data, userInput) {
    try {
        const formattedContent = formatPreviewContent(data, userInput, false);
        const popupContent = `<div class="message-preview-container"><div class="message-preview-content-box">${formattedContent}</div></div>`;
    
        await callGenericPopup(popupContent, POPUP_TYPE.TEXT, '消息预览', { 
            wide: true, 
            large: true 
        });
    
    } catch (error) {
        toastr.error('显示预览失败');
    }
}

function findApiRequestForMessage(messageId) {
    if (apiRequestHistory.length === 0) return null;

    const strategies = [
        record => record.associatedMessageId === messageId,
        record => record.messageId === messageId,
        record => record.messageId === messageId - 1,
        record => Math.abs(record.messageId - messageId) <= 1
    ];

    for (const strategy of strategies) {
        const match = apiRequestHistory.find(strategy);
        if (match) return match;
    }

    const candidates = apiRequestHistory.filter(record => record.messageId <= messageId + 2);
    return candidates.length > 0 ? 
        candidates.sort((a, b) => b.messageId - a.messageId)[0] : 
        apiRequestHistory[0];
}

async function showMessageHistoryPreview(messageId) {
    try {
        const settings = getSettings();
        const globalEnabled = window.isXiaobaixEnabled !== undefined ? window.isXiaobaixEnabled : true;
        if (!settings.recorded.enabled || !globalEnabled) return;
        const apiRecord = findApiRequestForMessage(messageId);
    
        if (apiRecord?.messages?.length > 0) {
            const messageData = {
                ...apiRecord,
                isHistoryPreview: true,
                targetMessageId: messageId
            };
            const formattedContent = formatPreviewContent(messageData, messageData.userInput, true);
            const popupContent = `<div class="message-preview-container"><div class="message-preview-content-box">${formattedContent}</div></div>`;
        
            await callGenericPopup(popupContent, POPUP_TYPE.TEXT, 
                `消息历史预览 - 第 ${messageId + 1} 条消息`, { 
                wide: true, 
                large: true 
            });
        } else {
            toastr.warning(`未找到第 ${messageId + 1} 条消息的API请求记录`);
        }
    } catch (error) {
        toastr.error('历史预览失败');
    }
}

function formatPreviewContent(data, userInput, isHistory = false) {
    let content = '';

    content += `${'='.repeat(60)}\n`;
    content += isHistory ? 
        `消息历史预览 - 第 ${data.targetMessageId + 1} 条\n` : 
        `● LLM API请求预览\n`;
    content += `${'='.repeat(60)}\n\n`;

    content += `API信息:\n${'-'.repeat(30)}\n`;
    content += `URL: ${data.url}\nMethod: ${data.method || 'POST'}\n`;
    content += `Model: ${data.model || 'Unknown'}\nMessages: ${data.messages.length}\n`;
    content += `Time: ${new Date(data.timestamp).toLocaleString()}\n`;

    if (data.characterName) content += `Character: ${data.characterName}\n`;
    if (userInput) {
        const displayInput = userInput.length > 100 ? userInput.substring(0, 100) + '...' : userInput;
        content += `✎ 用户输入: "${displayInput}"\n`;
    }

    content += `\n${'─'.repeat(50)}\n\n`;
    content += formatMessagesArray(data.messages);
    content += `\n${'='.repeat(60)}`;

    return content;
}

function formatMessagesArray(messages) {
    let content = `💬 Messages (${messages.length}):\n${'-'.repeat(30)}\n`;

    let processedMessages = [...messages];

    if (processedMessages.length >= 2) {
        const [lastMsg, secondLastMsg] = processedMessages.slice(-2);
        if (lastMsg.role === 'user' && secondLastMsg.role === 'user' && 
            lastMsg.content === secondLastMsg.content) {
            processedMessages.pop();
        }
    }

    processedMessages.forEach((msg, index) => {
        const msgContent = msg.content || '';
        const roleIcon = msg.role === 'system' ? '☼' : 
                         msg.role === 'user' ? '✎' : '♪';
    
        content += `\n[${index + 1}] ${roleIcon} ${msg.role.toUpperCase()}\n`;
    
        if (/<[^>]+>/g.test(msgContent)) {
            content += `【包含XML标记】\n`;
            content += `<pre style="white-space: pre-wrap;">${highlightXmlTags(msgContent)}</pre>\n`;
        } else {
            content += `${msgContent}\n`;
        }
    
        if (index < processedMessages.length - 1) {
            content += `${'-'.repeat(20)}\n`;
        }
    });

    return content;
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

const addHistoryButtonsDebounced = debounce(() => {
    const settings = getSettings();
    const globalEnabled = window.isXiaobaixEnabled !== undefined ? window.isXiaobaixEnabled : true;
    if (!settings.recorded.enabled || !globalEnabled) return;
    $('.mes_history_preview').remove();
    $('#chat .mes').each(function() {
        const mesId = parseInt($(this).attr('mesid'));
        if (mesId <= 0) return;
        const flexContainer = $(this).find('.flex-container.flex1.alignitemscenter');
        if (flexContainer.length > 0) {
            const historyButton = $(`<div class="mes_btn mes_history_preview" title="查看历史API请求">
                                        <i class="fa-regular fa-note-sticky"></i>
                                     </div>`)
                .on('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    showMessageHistoryPreview(mesId);
                });
        
            flexContainer.append(historyButton);
        }
    });
}, CONSTANTS.DEBOUNCE_DELAY);


function cleanupMemory() {
    if (apiRequestHistory.length > CONSTANTS.MAX_HISTORY_RECORDS) {
        apiRequestHistory = apiRequestHistory.slice(0, CONSTANTS.MAX_HISTORY_RECORDS);
    }
    previewMessageIds.clear();
    capturedPreviewData = null;

    $('.mes_history_preview').each(function() {
        if (!$(this).closest('.mes').length) {
            $(this).remove();
        }
    });
}

function addEventListeners() {
    const listeners = [
        { event: event_types.MESSAGE_RECEIVED, handler: addHistoryButtonsDebounced },
        { event: event_types.CHARACTER_MESSAGE_RENDERED, handler: addHistoryButtonsDebounced },
        { event: event_types.USER_MESSAGE_RENDERED, handler: addHistoryButtonsDebounced },
        { 
            event: event_types.CHAT_CHANGED, 
            handler: () => {
                apiRequestHistory = [];
                setTimeout(addHistoryButtonsDebounced, CONSTANTS.CHECK_INTERVAL);
            }
        },
        {
            event: event_types.MESSAGE_RECEIVED,
            handler: (messageId) => {
                setTimeout(() => {
                    const recentRequest = apiRequestHistory.find(record =>
                        !record.associatedMessageId && 
                        (Date.now() - record.timestamp) < CONSTANTS.RECENT_REQUEST_WINDOW
                    );
                    if (recentRequest) {
                        recentRequest.associatedMessageId = messageId;
                    }
                }, 100);
            }
        }
    ];

    listeners.forEach(({ event, handler }) => {
        eventSource.on(event, handler);
        eventListeners.push({ event, handler });
    });
}

function removeEventListeners() {
    eventListeners.forEach(({ event, handler }) => {
        eventSource.off(event, handler);
    });
    eventListeners = [];
}

function cleanup() {
    if (cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
    }
    removeEventListeners();
    restoreOriginalFetch();
    manageSendButton(false);
    $('.mes_history_preview').remove();
    $('#message_preview_btn').remove();
    cleanupMemory();

    previewPromiseResolve = null;
    previewPromiseReject = null;
    isPreviewMode = false;
    sendButtonState = { wasDisabled: false };
}

function initMessagePreview() {
    try {
        cleanup();
    
        const settings = getSettings();
    
        const previewButton = $(`<div id="message_preview_btn" class="fa-regular fa-note-sticky interactable" title="预览消息"></div>`)
            .on('click', showMessagePreview);
    
        $("#send_but").before(previewButton);
    
        $("#xiaobaix_preview_enabled").prop("checked", settings.preview.enabled).on("change", function() {
            const globalEnabled = window.isXiaobaixEnabled !== undefined ? window.isXiaobaixEnabled : true;
            if (!globalEnabled) return;

            settings.preview.enabled = $(this).prop("checked");
            saveSettingsDebounced();
            $('#message_preview_btn').toggle(settings.preview.enabled);
        });

        $("#xiaobaix_recorded_enabled").prop("checked", settings.recorded.enabled).on("change", function() {
            const globalEnabled = window.isXiaobaixEnabled !== undefined ? window.isXiaobaixEnabled : true;
            if (!globalEnabled) return;
            settings.recorded.enabled = $(this).prop("checked");
            saveSettingsDebounced();

            if (settings.recorded.enabled) {
                addHistoryButtonsDebounced();
            } else {
                $('.mes_history_preview').remove();
            }
        });
    
        if (!settings.preview.enabled) $('#message_preview_btn').hide();
    
        setupInterceptor();
    
        if (settings.recorded.enabled) {
            addHistoryButtonsDebounced();
        }
    
        addEventListeners();
    
        if (settings.preview.enabled) {
            cleanupTimer = setInterval(cleanupMemory, CONSTANTS.CLEANUP_INTERVAL);
        }
    
    } catch (error) {
        toastr.error('模块初始化失败');
    }
}

window.addEventListener('beforeunload', cleanup);

export { initMessagePreview, addHistoryButtonsDebounced };
