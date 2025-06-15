import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";
import { statsTracker } from "./statsTracker.js";
import { initTasks } from "./scheduledTasks.js";
import { initScriptAssistant } from "./scriptAssistant.js";
import { initMessagePreview, addHistoryButtonsDebounced } from "./message-preview.js";

const EXT_ID = "LittleWhiteBox";
const EXT_NAME = "小白X";
const MODULE_NAME = "xiaobaix-memory";
const extensionFolderPath = `scripts/extensions/third-party/${EXT_ID}`;

extension_settings[EXT_ID] = extension_settings[EXT_ID] || {
    enabled: true,
    sandboxMode: false,
    memoryEnabled: true,
    memoryInjectEnabled: true,
    memoryInjectDepth: 2
};

const settings = extension_settings[EXT_ID];
let isXiaobaixEnabled = settings.enabled;
let moduleInstances = { statsTracker: null };
let savedSettings = {};

window.isXiaobaixEnabled = isXiaobaixEnabled;

async function waitForElement(selector, root = document, timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const element = root.querySelector(selector);
        if (element) return element;
        await new Promise(r => setTimeout(r, 100));
    }
    return null;
}

function generateUniqueId() {
    return `xiaobaix-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function shouldRenderContent(content) {
    if (!content || typeof content !== 'string') return false;
    const htmlTags = ['<html', '<!DOCTYPE', '<script'];
    return htmlTags.some(tag => content.includes(tag));
}

function createIframeApi() {
    return `
    window.STBridge = {
        sendMessageToST: function(type, data = {}) {
            try {
                window.parent.postMessage({
                    source: 'xiaobaix-iframe',
                    type: type, 
                    ...data
                }, '*');
            } catch(e) {}
        },
        
        updateHeight: function() {
            try {
                const height = document.body.scrollHeight;
                if (height > 0) {
                    this.sendMessageToST('resize', { height });
                }
            } catch(e) {}
        }
    };
    
    window.STscript = async function(command) {
        return new Promise((resolve, reject) => {
            try {
                const id = Date.now().toString() + Math.random().toString(36).substring(2);
                
                window.STBridge.sendMessageToST('runCommand', { command, id });
                
                const listener = function(event) {
                    if (!event.data || event.data.source !== 'xiaobaix-host') return;
                    
                    const data = event.data;
                    if ((data.type === 'commandResult' || data.type === 'commandError') && data.id === id) {
                        window.removeEventListener('message', listener);
                        
                        if (data.type === 'commandResult') {
                            resolve(data.result);
                        } else {
                            reject(new Error(data.error));
                        }
                    }
                };
                
                window.addEventListener('message', listener);
                
                setTimeout(() => {
                    window.removeEventListener('message', listener);
                    reject(new Error('Command timeout'));
                }, 30000);
            } catch(e) {
                reject(e);
            }
        });
    };
    
    function setupAutoResize() {
        window.STBridge.updateHeight();
        
        window.addEventListener('resize', () => window.STBridge.updateHeight());
        window.addEventListener('load', () => window.STBridge.updateHeight());
        
        try {
            const observer = new MutationObserver(() => window.STBridge.updateHeight());
            observer.observe(document.body, {
                attributes: true,
                childList: true,
                subtree: true,
                characterData: true
            });
        } catch(e) {}
        
        setInterval(() => window.STBridge.updateHeight(), 1000);
        
        window.addEventListener('load', function() {
            Array.from(document.images).forEach(img => {
                if (!img.complete) {
                    img.addEventListener('load', () => window.STBridge.updateHeight());
                    img.addEventListener('error', () => window.STBridge.updateHeight());
                }
            });
        });
    }
    
    function setupSecurity() {
        document.addEventListener('click', function(e) {
            const link = e.target.closest('a');
            if (link && link.href && link.href.startsWith('http')) {
                if (link.target !== '_blank') {
                    e.preventDefault();
                    window.open(link.href, '_blank');
                }
            }
        });
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            setupAutoResize();
            setupSecurity();
        });
    } else {
        setupAutoResize();
        setupSecurity();
    }
    `;
}

async function executeSlashCommand(command) {
    try {
        if (!command) return { error: "命令为空" };
        if (!command.startsWith('/')) command = '/' + command;
        
        const { executeSlashCommands, substituteParams } = getContext();
        if (typeof executeSlashCommands !== 'function') {
            throw new Error("executeSlashCommands 函数不可用");
        }
        
        command = substituteParams(command);
        const result = await executeSlashCommands(command, true);
        
        if (result && typeof result === 'object' && result.pipe !== undefined) {
            const pipeValue = result.pipe;
            if (typeof pipeValue === 'string') {
                try { return JSON.parse(pipeValue); } catch { return pipeValue; }
            }
            return pipeValue;
        }
        
        if (typeof result === 'string' && result.trim()) {
            try { return JSON.parse(result); } catch { return result; }
        }
        
        return result === undefined ? "" : result;
    } catch (err) {
        throw err;
    }
}

function handleIframeMessage(event) {
    if (!event.data || event.data.source !== 'xiaobaix-iframe') return;
    
    const { type, height, command, id } = event.data;
    
    if (type === 'resize') {
        const iframes = document.querySelectorAll('iframe.xiaobaix-iframe');
        for (const iframe of iframes) {
            if (iframe.contentWindow === event.source) {
                iframe.style.height = `${height}px`;
                break;
            }
        }
    } else if (type === 'runCommand') {
        executeSlashCommand(command)
            .then(result => event.source.postMessage({
                source: 'xiaobaix-host', type: 'commandResult', id, result
            }, '*'))
            .catch(err => event.source.postMessage({
                source: 'xiaobaix-host', type: 'commandError', id, error: err.message || String(err)
            }, '*'));
    }
}

function prepareHtmlContent(htmlContent) {
    const apiScript = `<script>${createIframeApi()}</script>`;
    
    if (htmlContent.includes('<html') && htmlContent.includes('</html>')) {
        return htmlContent.replace('</head>', `${apiScript}</head>`);
    }
    
    const baseTemplate = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { margin: 0; padding: 10px; font-family: inherit; color: inherit; background: transparent; }
    </style>
    ${apiScript}
</head>`;
    
    if (htmlContent.includes('<body') && htmlContent.includes('</body>')) {
        return baseTemplate + htmlContent + '</html>';
    }
    
    return baseTemplate + `<body>${htmlContent}</body></html>`;
}

function renderHtmlInIframe(htmlContent, container, preElement) {  
    try {
        const iframe = document.createElement('iframe');
        iframe.id = generateUniqueId();
        iframe.className = 'xiaobaix-iframe';
        iframe.style.cssText = `
            width: 100%; border: none; background: transparent; overflow: hidden;
            height: 0; margin: 0; padding: 0; display: block;
        `;
        iframe.setAttribute('frameborder', '0');
        iframe.setAttribute('scrolling', 'no');
        
        if (settings.sandboxMode) {
            iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-forms');
        }
        
        const wrapper = document.createElement('div');
        wrapper.className = 'xiaobaix-iframe-wrapper';
        wrapper.style.cssText = 'margin: 10px 0;';  
        

        preElement.parentNode.insertBefore(wrapper, preElement);
        
        wrapper.appendChild(iframe);
        
        preElement.style.display = 'none';
        
        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
        iframeDoc.open();
        iframeDoc.write(prepareHtmlContent(htmlContent));
        iframeDoc.close();
        
        return iframe;
    } catch (err) {
        console.error('[小白X] 渲染iframe失败:', err);
        return null;
    }
}

function toggleSettingsControls(enabled) {
    const controls = [
        'xiaobaix_sandbox', 'xiaobaix_memory_enabled', 'xiaobaix_memory_inject', 
        'xiaobaix_memory_depth', 'xiaobaix_recorded_enabled', 'xiaobaix_preview_enabled',
        'xiaobaix_script_assistant', 'scheduled_tasks_enabled'
    ];
    
    controls.forEach(id => {
        $(`#${id}`).prop('disabled', !enabled).toggleClass('disabled-control', !enabled);
    });
    
    const styleId = 'xiaobaix-disabled-style';
    if (!enabled && !document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            .disabled-control, .disabled-control + label {
                opacity: 0.4 !important; pointer-events: none !important; cursor: not-allowed !important;
            }
        `;
        document.head.appendChild(style);
    } else if (enabled) {
        document.getElementById(styleId)?.remove();
    }
}

function saveCurrentSettings() {
    savedSettings = {
        sandboxMode: settings.sandboxMode,
        memoryEnabled: settings.memoryEnabled,
        memoryInjectEnabled: settings.memoryInjectEnabled,
        memoryInjectDepth: settings.memoryInjectDepth,
        recordedEnabled: extension_settings[EXT_ID].recorded?.enabled,
        previewEnabled: extension_settings[EXT_ID].preview?.enabled,
        scriptAssistantEnabled: extension_settings[EXT_ID].scriptAssistant?.enabled,
        scheduledTasksEnabled: extension_settings[EXT_ID].tasks?.enabled
    };
}

function restoreSettings() {
    if (savedSettings.sandboxMode !== null) {
        settings.sandboxMode = savedSettings.sandboxMode;
        $("#xiaobaix_sandbox").prop("checked", savedSettings.sandboxMode);
    }
    if (savedSettings.memoryEnabled !== null) {
        settings.memoryEnabled = savedSettings.memoryEnabled;
        $("#xiaobaix_memory_enabled").prop("checked", savedSettings.memoryEnabled);
    }
    if (savedSettings.memoryInjectEnabled !== null) {
        settings.memoryInjectEnabled = savedSettings.memoryInjectEnabled;
        $("#xiaobaix_memory_inject").prop("checked", savedSettings.memoryInjectEnabled);
    }
    if (savedSettings.memoryInjectDepth !== null) {
        settings.memoryInjectDepth = savedSettings.memoryInjectDepth;
        $("#xiaobaix_memory_depth").val(savedSettings.memoryInjectDepth);
    }
    
    const moduleSettings = [
        { key: 'recordedEnabled', module: 'recorded', control: 'xiaobaix_recorded_enabled' },
        { key: 'previewEnabled', module: 'preview', control: 'xiaobaix_preview_enabled' },
        { key: 'scriptAssistantEnabled', module: 'scriptAssistant', control: 'xiaobaix_script_assistant' },
        { key: 'scheduledTasksEnabled', module: 'tasks', control: 'scheduled_tasks_enabled' }
    ];
    
    moduleSettings.forEach(({ key, module, control }) => {
        if (savedSettings[key] !== null) {
            if (!extension_settings[EXT_ID][module]) extension_settings[EXT_ID][module] = {};
            extension_settings[EXT_ID][module].enabled = savedSettings[key];
            $(`#${control}`).prop("checked", savedSettings[key]);
        }
    });
}

function toggleAllFeatures(enabled) {
    if (enabled) {
        toggleSettingsControls(true);
        restoreSettings();
        saveSettingsDebounced();
        setTimeout(() => processExistingMessages(), 100);
        
        if (settings.memoryEnabled && moduleInstances.statsTracker?.updateMemoryPrompt) {
            setTimeout(() => moduleInstances.statsTracker.updateMemoryPrompt(), 200);
        }
        if (extension_settings[EXT_ID].scriptAssistant?.enabled && window.injectScriptDocs) {
            setTimeout(() => window.injectScriptDocs(), 300);
        }
        if (extension_settings[EXT_ID].preview?.enabled) {
            setTimeout(() => {
                document.querySelectorAll('#message_preview_btn').forEach(btn => btn.style.display = '');
            }, 400);
        }
        if (extension_settings[EXT_ID].recorded?.enabled) {
            setTimeout(() => addHistoryButtonsDebounced(), 500);
        }
    } else {
        saveCurrentSettings();
        
        Object.assign(settings, {
            sandboxMode: false, memoryEnabled: false, memoryInjectEnabled: false
        });
        
        ['recorded', 'preview', 'scriptAssistant', 'tasks'].forEach(module => {
            if (!extension_settings[EXT_ID][module]) extension_settings[EXT_ID][module] = {};
            extension_settings[EXT_ID][module].enabled = false;
        });
        
        ["xiaobaix_sandbox", "xiaobaix_memory_enabled", "xiaobaix_memory_inject", 
         "xiaobaix_recorded_enabled", "xiaobaix_preview_enabled", "xiaobaix_script_assistant", 
         "scheduled_tasks_enabled"].forEach(id => $(`#${id}`).prop("checked", false));
        
        toggleSettingsControls(false);

        document.querySelectorAll('iframe.xiaobaix-iframe').forEach(iframe => iframe.remove());
        document.querySelectorAll('pre[data-xiaobaix-bound="true"]').forEach(pre => {
            pre.style.display = '';
            delete pre.dataset.xiaobaixBound;
        });
        document.querySelectorAll('.memory-button, .mes_history_preview').forEach(btn => btn.remove());
        document.querySelectorAll('#message_preview_btn').forEach(btn => btn.style.display = 'none');

        moduleInstances.statsTracker?.removeMemoryPrompt?.();
        window.removeScriptDocs?.();
    }
}

function processCodeBlocks(messageElement) {
    if (!settings.enabled || !isXiaobaixEnabled) return;

    try {
        const codeBlocks = messageElement.querySelectorAll('pre > code');
        codeBlocks.forEach(codeBlock => {
            const preElement = codeBlock.parentElement;
            if (preElement.dataset.xiaobaixBound === 'true') return;
            
            preElement.dataset.xiaobaixBound = 'true';
            const codeContent = codeBlock.textContent || '';
            
            if (shouldRenderContent(codeContent)) {
                renderHtmlInIframe(codeContent, preElement.parentNode, preElement);
            }
        });
    } catch (err) {}
}

function processExistingMessages() {
    if (!settings.enabled || !isXiaobaixEnabled) return;
    
    document.querySelectorAll('.mes_text').forEach(processCodeBlocks);
    
    if (settings.memoryEnabled) {
        $('#chat .mes').each(function() {
            const messageId = $(this).attr('mesid');
            if (messageId) statsTracker.addMemoryButtonToMessage(messageId);
        });
    }
}


async function setupSettings() {
    try {
        const settingsContainer = await waitForElement("#extensions_settings");
        if (!settingsContainer) return;
        
        const response = await fetch(`${extensionFolderPath}/settings.html`);
        const settingsHtml = await response.text();
        $(settingsContainer).append(settingsHtml);

        $("#xiaobaix_enabled").prop("checked", settings.enabled).on("change", function() {
            const wasEnabled = settings.enabled;
            settings.enabled = $(this).prop("checked");
            isXiaobaixEnabled = settings.enabled;
            window.isXiaobaixEnabled = isXiaobaixEnabled;
            saveSettingsDebounced();

            if (settings.enabled !== wasEnabled) {
                toggleAllFeatures(settings.enabled);
            }
        });

        if (!settings.enabled) toggleSettingsControls(false);

        $("#xiaobaix_sandbox").prop("checked", settings.sandboxMode).on("change", function() {
            if (!isXiaobaixEnabled) return;
            settings.sandboxMode = $(this).prop("checked");
            saveSettingsDebounced();
        });

        $("#xiaobaix_memory_enabled").prop("checked", settings.memoryEnabled).on("change", function() {
            if (!isXiaobaixEnabled) return;
            settings.memoryEnabled = $(this).prop("checked");
            saveSettingsDebounced();

            if (settings.memoryEnabled && settings.memoryInjectEnabled) {
                statsTracker.updateMemoryPrompt();
            } else if (!settings.memoryEnabled) {
                statsTracker.removeMemoryPrompt();
            }
        });

        $("#xiaobaix_memory_inject").prop("checked", settings.memoryInjectEnabled).on("change", function() {
            if (!isXiaobaixEnabled) return;
            settings.memoryInjectEnabled = $(this).prop("checked");
            saveSettingsDebounced();

            if (settings.memoryEnabled && settings.memoryInjectEnabled) {
                statsTracker.updateMemoryPrompt();
            } else {
                statsTracker.removeMemoryPrompt();
            }
        });

        $("#xiaobaix_memory_depth").val(settings.memoryInjectDepth).on("change", function() {
            if (!isXiaobaixEnabled) return;
            settings.memoryInjectDepth = parseInt($(this).val()) || 2;
            saveSettingsDebounced();

            if (settings.memoryEnabled && settings.memoryInjectEnabled) {
                statsTracker.updateMemoryPrompt();
            }
        });
    } catch (err) {}
}

function setupMenuTabs() {
    $(document).on('click', '.menu-tab', function() {
        const targetId = $(this).attr('data-target');
        $('.menu-tab').removeClass('active');
        $('.settings-section').hide();
        $(this).addClass('active');
        $('.' + targetId).show();
    });

    setTimeout(() => {
        $('.js-memory').show();
        $('.task, .instructions').hide();
        $('.menu-tab[data-target="js-memory"]').addClass('active');
        $('.menu-tab[data-target="task"], .menu-tab[data-target="instructions"]').removeClass('active');
    }, 300);
}

function setupEventListeners() {
    const { eventSource, event_types } = getContext();
    
    const handleMessage = async (data, isReceived = false) => {
        if (!settings.enabled || !isXiaobaixEnabled) return;

        setTimeout(async () => {
            const messageId = typeof data === 'object' ? data.messageId : data;
            if (!messageId) return;

            const messageElement = document.querySelector(`div.mes[mesid="${messageId}"] .mes_text`);
            if (!messageElement) return;

            processCodeBlocks(messageElement);

            if (settings.memoryEnabled) {
                statsTracker.addMemoryButtonToMessage(messageId);
                
                if (isReceived) {
                    const messageText = messageElement.textContent || '';
                    const characterName = statsTracker.getCharacterFromMessage(messageElement);
                    await statsTracker.updateStatisticsForNewMessage(messageText, characterName);
                    $(`.mes[mesid="${messageId}"] .memory-button`).addClass('has-memory');
                }
            }
        }, isReceived ? 300 : 100);
    };

    eventSource.on(event_types.MESSAGE_RECEIVED, (data) => handleMessage(data, true));
    eventSource.on(event_types.USER_MESSAGE_RENDERED, handleMessage);
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, handleMessage);
    
    eventSource.on(event_types.CHAT_CHANGED, async () => {
        if (!settings.memoryEnabled || !isXiaobaixEnabled) return;

        setTimeout(async () => {
            try {
                let stats = await executeSlashCommand('/getvar xiaobaix_stats');
                
                if (!stats || stats === "undefined") {
                    const messages = await statsTracker.processMessageHistory();
                    if (messages?.length > 0) {
                        const newStats = statsTracker.createEmptyStats();
                        messages.forEach(message => {
                            statsTracker.updateStatsFromText(newStats, message.content, message.name);
                        });
                        
                        await executeSlashCommand(`/setvar key=xiaobaix_stats ${JSON.stringify(newStats)}`);
                        if (settings.memoryInjectEnabled) statsTracker.updateMemoryPrompt();
                    }
                } else if (settings.memoryInjectEnabled) {
                    statsTracker.updateMemoryPrompt();
                }
            } catch (error) {}
        }, 500);
    });
    
    window.addEventListener('message', handleIframeMessage);
}

jQuery(async () => {
    try {
        isXiaobaixEnabled = settings.enabled;
        window.isXiaobaixEnabled = isXiaobaixEnabled;

        const response = await fetch(`${extensionFolderPath}/style.css`);
        const styleElement = document.createElement('style');
        styleElement.textContent = await response.text();
        document.head.appendChild(styleElement);

        moduleInstances.statsTracker = statsTracker;
        statsTracker.init(EXT_ID, MODULE_NAME, settings, executeSlashCommand);

        await setupSettings();
        setupEventListeners();
        initTasks();
        initScriptAssistant();
        
        setTimeout(setupMenuTabs, 500);
        setTimeout(initMessagePreview, 1500);
        
        setTimeout(async () => {
            if (isXiaobaixEnabled) {
                processExistingMessages();
                
                if (settings.memoryEnabled) {
                    const messages = await statsTracker.processMessageHistory();
                    if (messages?.length > 0) {
                        const stats = statsTracker.createEmptyStats();
                        messages.forEach(message => {
                            statsTracker.updateStatsFromText(stats, message.content, message.name);
                        });
                        
                        await executeSlashCommand(`/setvar key=xiaobaix_stats ${JSON.stringify(stats)}`);
                        if (settings.memoryInjectEnabled) statsTracker.updateMemoryPrompt();
                    }
                }
            }
        }, 1000);

        setInterval(() => {
            if (isXiaobaixEnabled) processExistingMessages();
        }, 5000);
        
    } catch (err) {
        console.error('[小白X] 初始化出错:', err);
    }
});

export { executeSlashCommand };