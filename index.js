import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types, getRequestHeaders } from "../../../../script.js";
import { statsTracker } from "./relationship-metrics.js";
import { initTasks } from "./scheduledTasks.js";
import { initScriptAssistant } from "./scriptAssistant.js";
import { initMessagePreview, addHistoryButtonsDebounced } from "./message-preview.js";
import { initImmersiveMode } from "./immersive-mode.js";
import { initTemplateEditor, templateSettings } from "./template-editor.js";
import { initWallhavenBackground } from "./wallhaven-background.js";
import { initCharacterUpdater } from "./character-updater.js";
import { initDynamicPrompt } from "./dynamic-prompt.js";
import { initButtonCollapse } from "./button-collapse.js";
import { initVariablesPanel, getVariablesPanelInstance, cleanupVariablesPanel } from "./variables-panel.js";
import { initStreamingGeneration } from "./streaming-generation.js";

const EXT_ID = "LittleWhiteBox";
const EXT_NAME = "小白X";
const MODULE_NAME = "xiaobaix-memory";
const extensionFolderPath = `scripts/extensions/third-party/${EXT_ID}`;

extension_settings[EXT_ID] = extension_settings[EXT_ID] || {
    enabled: true,
    sandboxMode: false,
    memoryEnabled: false,
    memoryInjectEnabled: false,
    memoryInjectDepth: 4,
    recorded: { enabled: true },
    templateEditor: { enabled: true, characterBindings: {} },
    tasks: { enabled: true, globalTasks: [], processedMessages: [], character_allowed_tasks: [] },
    scriptAssistant: { enabled: false },
    preview: { enabled: false },
    wallhaven: { enabled: false },
    immersive: { enabled: false },
    characterUpdater: { enabled: true, showNotifications: true, serverUrl: "https://db.littlewhitebox.qzz.io" },
    dynamicPrompt: { enabled: true },
    variablesPanel: { enabled: false },
    useBlob: false
};

const settings = extension_settings[EXT_ID];
let isXiaobaixEnabled = settings.enabled;
let moduleInstances = { statsTracker: null };
let globalEventListeners = [];
let globalTimers = [];
let moduleCleanupFunctions = new Map();
let updateCheckPerformed = false;
let isGenerating = false;

const winMap = new Map();
const lastHeights = new WeakMap();
let resizeRafPending = false;
let blobUrls = new WeakMap();

window.isXiaobaixEnabled = isXiaobaixEnabled;
window.testLittleWhiteBoxUpdate = async () => {
    updateCheckPerformed = false;
    await performExtensionUpdateCheck();
};
window.testUpdateUI = () => {
    updateExtensionHeaderWithUpdateNotice();
};
window.testRemoveUpdateUI = () => {
    removeAllUpdateNotices();
};

async function checkLittleWhiteBoxUpdate() {
    try {
        const timestamp = Date.now();
        const localRes = await fetch(`${extensionFolderPath}/manifest.json?t=${timestamp}`, { cache: 'no-cache' });
        if (!localRes.ok) return null;
        const localManifest = await localRes.json();
        const localVersion = localManifest.version;
        const remoteRes = await fetch(`https://api.github.com/repos/RT15548/LittleWhiteBox/contents/manifest.json?t=${timestamp}`, { cache: 'no-cache' });
        if (!remoteRes.ok) return null;
        const remoteData = await remoteRes.json();
        const remoteManifest = JSON.parse(atob(remoteData.content));
        const remoteVersion = remoteManifest.version;
        return localVersion !== remoteVersion ? { isUpToDate: false, localVersion, remoteVersion } : { isUpToDate: true, localVersion, remoteVersion };
    } catch (e) {
        return null;
    }
}

async function updateLittleWhiteBoxExtension() {
    try {
        const response = await fetch('/api/extensions/update', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ extensionName: 'LittleWhiteBox', global: true }),
        });
        if (!response.ok) {
            const text = await response.text();
            toastr.error(text || response.statusText, '小白X更新失败', { timeOut: 5000 });
            return false;
        }
        const data = await response.json();
        const message = data.isUpToDate ? '小白X已是最新版本' : `小白X已更新`;
        const title = data.isUpToDate ? '' : '请刷新页面以应用更新';
        toastr.success(message, title);
        return true;
    } catch (error) {
        toastr.error('更新过程中发生错误', '小白X更新失败');
        return false;
    }
}

function updateExtensionHeaderWithUpdateNotice() {
    addUpdateTextNotice();
    addUpdateDownloadButton();
}

function addUpdateTextNotice() {
    const selectors = [
        '.inline-drawer-toggle.inline-drawer-header b',
        '.inline-drawer-header b',
        '.littlewhitebox .inline-drawer-header b',
        'div[class*="inline-drawer"] b'
    ];
    let headerElement = null;
    for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
            if (element.textContent && element.textContent.includes('小白X')) {
                headerElement = element;
                break;
            }
        }
        if (headerElement) break;
    }
    if (!headerElement) {
        setTimeout(() => addUpdateTextNotice(), 1000);
        return;
    }
    if (headerElement.querySelector('.littlewhitebox-update-text')) return;
    const updateTextSmall = document.createElement('small');
    updateTextSmall.className = 'littlewhitebox-update-text';
    updateTextSmall.textContent = '(有可用更新)';
    headerElement.appendChild(updateTextSmall);
}

function addUpdateDownloadButton() {
    const sectionDividers = document.querySelectorAll('.section-divider');
    let totalSwitchDivider = null;
    for (const divider of sectionDividers) {
        if (divider.textContent && divider.textContent.includes('总开关')) {
            totalSwitchDivider = divider;
            break;
        }
    }
    if (!totalSwitchDivider) {
        setTimeout(() => addUpdateDownloadButton(), 1000);
        return;
    }
    if (document.querySelector('#littlewhitebox-update-extension')) return;
    const updateButton = document.createElement('div');
    updateButton.id = 'littlewhitebox-update-extension';
    updateButton.className = 'menu_button fa-solid fa-cloud-arrow-down interactable has-update';
    updateButton.title = '下载并安装小白x的更新';
    updateButton.tabIndex = 0;
    try {
        totalSwitchDivider.style.display = 'flex';
        totalSwitchDivider.style.alignItems = 'center';
        totalSwitchDivider.style.justifyContent = 'flex-start';
    } catch (e) {}
    totalSwitchDivider.appendChild(updateButton);
    try {
        if (window.setupUpdateButtonInSettings) {
            window.setupUpdateButtonInSettings();
        }
    } catch (e) {}
}

function removeAllUpdateNotices() {
    const textNotice = document.querySelector('.littlewhitebox-update-text');
    const downloadButton = document.querySelector('#littlewhitebox-update-extension');
    if (textNotice) textNotice.remove();
    if (downloadButton) downloadButton.remove();
}

async function performExtensionUpdateCheck() {
    if (updateCheckPerformed) return;
    updateCheckPerformed = true;
    try {
        const versionData = await checkLittleWhiteBoxUpdate();
        if (versionData && versionData.isUpToDate === false) {
            updateExtensionHeaderWithUpdateNotice();
        }
    } catch (error) {}
}

function registerModuleCleanup(moduleName, cleanupFunction) {
    moduleCleanupFunctions.set(moduleName, cleanupFunction);
}

function addGlobalEventListener(target, event, handler, options) {
    target.addEventListener(event, handler, options);
    globalEventListeners.push({ target, event, handler, options });
}

function addGlobalTimer(timerId) {
    globalTimers.push(timerId);
}

function removeSkeletonStyles() {
    try {
        document.querySelectorAll('.xiaobaix-skel').forEach(el => {
            try { el.remove(); } catch (e) {}
        });
        document.getElementById('xiaobaix-skeleton-style')?.remove();
    } catch (e) {}
}

function cleanupAllResources() {
    globalEventListeners.forEach(({ target, event, handler, options, isEventSource }) => {
        try {
            if (isEventSource && target.removeListener) {
                target.removeListener(event, handler);
            } else {
                target.removeEventListener(event, handler, options);
            }
        } catch (e) {}
    });
    globalEventListeners.length = 0;
    globalTimers.forEach(timerId => {
        try {
            clearTimeout(timerId);
            clearInterval(timerId);
        } catch (e) {}
    });
    globalTimers.length = 0;
    moduleCleanupFunctions.forEach((cleanupFn) => {
        try {
            cleanupFn();
        } catch (e) {}
    });
    moduleCleanupFunctions.clear();
    document.querySelectorAll('iframe.xiaobaix-iframe').forEach(ifr => {
        try { ifr.src = 'about:blank'; } catch(e) {}
        releaseIframeBlob(ifr);
    });
    document.querySelectorAll('iframe.xiaobaix-iframe, .xiaobaix-iframe-wrapper').forEach(el => el.remove());
    winMap.clear();
    document.querySelectorAll('.memory-button, .mes_history_preview').forEach(btn => btn.remove());
    document.querySelectorAll('#message_preview_btn').forEach(btn => {
        if (btn instanceof HTMLElement) {
            btn.style.display = 'none';
        }
    });
    document.getElementById('xiaobaix-hide-code')?.remove();
    document.body.classList.remove('xiaobaix-active');
    document.querySelectorAll('pre[data-xiaobaix-bound="true"]').forEach(pre => {
        pre.classList.remove('xb-show');
        pre.removeAttribute('data-xbfinal');
        delete pre.dataset.xbFinal;
        pre.style.display = '';
        delete pre.dataset.xiaobaixBound;
    });
    removeSkeletonStyles();
}

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

function shouldRenderContentByBlock(codeBlock) {
    if (!codeBlock) return false;
    const content = (codeBlock.textContent || '').trim().toLowerCase();
    if (!content) return false;
    return content.includes('<!doctype') || content.includes('<html') || content.includes('<script');
}

function createIframeApi() {
    return `
    const originalGetElementById=document.getElementById;document.getElementById=function(id){try{return originalGetElementById.call(document,id)}catch(e){return null}};
    window.STBridge={sendMessageToST:function(type,data={}){try{window.parent.postMessage({source:'xiaobaix-iframe',type,...data},'*')}catch(e){}},updateHeight:function(){try{const h1=document.documentElement.scrollHeight||0;const h2=document.body.scrollHeight||0;const height=Math.max(h1,h2);if(height>0){this.sendMessageToST('resize',{height})}}catch(e){}}};
    const updateHeightDebounced=(()=>{let t=0,raf=0;const delay=80;return()=>{if(t)return;t=setTimeout(()=>{t=0;if(raf)cancelAnimationFrame(raf);raf=requestAnimationFrame(()=>window.STBridge.updateHeight())},delay)}})();
    window.STscript=async function(command){return new Promise((resolve,reject)=>{try{if(!command){reject(new Error('empty'));return}const id=Date.now().toString()+Math.random().toString(36).substring(2);window.STBridge.sendMessageToST('runCommand',{command,id});const listener=function(event){if(!event.data||event.data.source!=='xiaobaix-host')return;const data=event.data;if((data.type==='commandResult'||data.type==='commandError')&&data.id===id){window.removeEventListener('message',listener);if(data.type==='commandResult')resolve(data.result);else reject(new Error(data.error))}};window.addEventListener('message',listener);setTimeout(()=>{window.removeEventListener('message',listener);reject(new Error('Command timeout'))},180000)}catch(e){reject(e)}})};
    function setupAutoResize(){try{const ro=new ResizeObserver(()=>updateHeightDebounced());ro.observe(document.body)}catch(e){}window.addEventListener('load',()=>updateHeightDebounced());requestAnimationFrame(()=>{try{updateHeightDebounced()}catch(e){}});try{Array.from(document.images).forEach(img=>{if(!img.complete){img.loading='lazy';img.decoding='async';img.fetchPriority='low';img.addEventListener('load',updateHeightDebounced,{passive:true});img.addEventListener('error',updateHeightDebounced,{passive:true})}})}catch(e){}}
    function setupSecurity(){document.addEventListener('click',function(e){const link=e.target&&e.target.closest?e.target.closest('a'):null;if(link&&link.href&&link.href.startsWith('http')){if(link.target!=='_blank'){e.preventDefault();try{window.open(link.href,'_blank')}catch(e){}}}},{passive:false})}
    window.addEventListener('error',function(e){return true});
    function markReady(){try{updateHeightDebounced()}catch(e){}}
    if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',function(){setupAutoResize();setupSecurity();markReady()})}else{setupAutoResize();setupSecurity();markReady()}
    `;
}

async function executeSlashCommand(command) {
    try {
        if (!command) return { error: "命令为空" };
        if (!command.startsWith('/')) command = '/' + command;
        const { executeSlashCommands, substituteParams } = getContext();
        if (typeof executeSlashCommands !== 'function') throw new Error("executeSlashCommands 函数不可用");
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

function getOrCreateWrapper(preEl){
    let wrapper=preEl.previousElementSibling;
    if(!wrapper||!wrapper.classList.contains('xiaobaix-iframe-wrapper')){
        wrapper=document.createElement('div');
        wrapper.className='xiaobaix-iframe-wrapper';
        wrapper.style.cssText='margin:0;';
        preEl.parentNode.insertBefore(wrapper, preEl);
    }
    return wrapper;
}

const Skeleton = {
    minShowMs: 120,
    fadeMs: 180,
    create(preEl, estH=200){
        const wrapper=getOrCreateWrapper(preEl);
        const old=wrapper.querySelector('.xiaobaix-skel');
        if(old) return old;
        const el=document.createElement('div');
        el.className='xiaobaix-skel appear';
        el.style.height=Math.max(140, estH)+'px';
        el.dataset.ts=Date.now();
        wrapper.appendChild(el);
        return el;
    },
    removeByWrapper(wrapper){
        const el=wrapper?.querySelector?.('.xiaobaix-skel');
        if(!el) return;
        const elapsed=Date.now()-(+el.dataset.ts||0);
        const wait=Math.max(0, this.minShowMs - elapsed);
        setTimeout(()=>{
            el.classList.remove('appear');
            el.classList.add('hide');
            setTimeout(()=>{ try{el.remove()}catch(e){} }, this.fadeMs+10);
        }, wait);
    },
    removeByPre(preEl){
        const wrapper=preEl?.previousElementSibling;
        if(!wrapper) return;
        this.removeByWrapper(wrapper);
    },
    error(preEl){
        const wrapper=preEl?.previousElementSibling;
        const el=wrapper?.querySelector?.('.xiaobaix-skel');
        if(!el) return;
        el.style.boxShadow='0 6px 20px rgba(255,0,0,.12), inset 0 0 0 1px rgba(255,255,255,.15)';
    }
};

function estimateHeightFromContent(text){
    const lines=(text.match(/\n/g)||[]).length;
    const imgs=(text.match(/<img\b/gi)||[]).length;
    const len=text.length;
    return Math.min(1600, 240 + lines*6 + imgs*120 + Math.sqrt(len)*2);
}

function registerIframeMapping(iframe, wrapper) {
    const tryMap = () => {
        try {
            if (iframe && iframe.contentWindow) {
                winMap.set(iframe.contentWindow, { iframe, wrapper });
                return true;
            }
        } catch (e) {}
        return false;
    };
    if (tryMap()) return;
    let tries = 0;
    const t = setInterval(() => {
        tries++;
        if (tryMap() || tries > 20) clearInterval(t);
    }, 25);
    addGlobalTimer(t);
}

function handleIframeMessage(event) {
    if (!event.data || event.data.source !== 'xiaobaix-iframe') return;
    const { type, height, command, id } = event.data;
    if (type === 'resize') {
        const rec = winMap.get(event.source);
        if (rec && rec.iframe && rec.wrapper) {
            const prev = lastHeights.get(rec.iframe) || 0;
            if (Math.abs((height || 0) - prev) < 2) return;
            lastHeights.set(rec.iframe, height);
            if (!resizeRafPending) {
                resizeRafPending = true;
                requestAnimationFrame(() => {
                    resizeRafPending = false;
                    const r = winMap.get(event.source);
                    if (!r) return;
                    r.iframe.style.height = `${lastHeights.get(r.iframe) || 0}px`;
                    const hNow = lastHeights.get(r.iframe) || 0;
                    if (hNow > 24) Skeleton.removeByWrapper(r.wrapper);
                });
            }
            return;
        }
        const iframes = document.querySelectorAll('iframe.xiaobaix-iframe');
        for (const iframe of iframes) {
            if (iframe.contentWindow === event.source) {
                const prev = lastHeights.get(iframe) || 0;
                if (Math.abs((height || 0) - prev) < 2) return;
                lastHeights.set(iframe, height);
                if (!resizeRafPending) {
                    resizeRafPending = true;
                    requestAnimationFrame(() => {
                        resizeRafPending = false;
                        iframe.style.height = `${lastHeights.get(iframe) || 0}px`;
                        if ((lastHeights.get(iframe) || 0) > 24) {
                            const wrapper = iframe.parentElement;
                            Skeleton.removeByWrapper(wrapper);
                        }
                    });
                }
                break;
            }
        }
    } else if (type === 'runCommand') {
        executeSlashCommand(command)
            .then(result => event.source.postMessage({ source: 'xiaobaix-host', type: 'commandResult', id, result }, '*'))
            .catch(err => event.source.postMessage({ source: 'xiaobaix-host', type: 'commandError', id, error: err.message || String(err) }, '*'));
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
<style>body{margin:0;padding:10px;font-family:inherit;color:inherit;background:transparent}</style>
${apiScript}
</head>`;
    if (htmlContent.includes('<body') && htmlContent.includes('</body>')) {
        return baseTemplate + htmlContent + '</html>';
    }
    return baseTemplate + `<body>${htmlContent}</body></html>`;
}

function setIframeBlobHTML(iframe, fullHTML){
    try {
        const blob = new Blob([fullHTML], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        iframe.src = url;
        const prev = blobUrls.get(iframe);
        if (prev) URL.revokeObjectURL(prev);
        blobUrls.set(iframe, url);
    } catch (e) {}
}

function releaseIframeBlob(iframe){
    try {
        const url = blobUrls.get(iframe);
        if (url) URL.revokeObjectURL(url);
        blobUrls.delete(iframe);
    } catch (e) {}
}

function renderHtmlInIframe(htmlContent, container, preElement) {
    try {
        const iframe = document.createElement('iframe');
        iframe.id = generateUniqueId();
        iframe.className = 'xiaobaix-iframe';
        iframe.style.cssText = 'width:100%;border:none;background:transparent;overflow:hidden;height:0;margin:0;padding:0;display:block';
        iframe.setAttribute('frameborder', '0');
        iframe.setAttribute('scrolling', 'no');
        iframe.loading = 'lazy';
        if (settings.sandboxMode) {
            iframe.setAttribute('sandbox', 'allow-scripts allow-popups allow-forms allow-same-origin');
        }
        const wrapper = getOrCreateWrapper(preElement);
        try {
            wrapper.style.contentVisibility = 'auto';
            wrapper.style.contain = 'content';
        } catch (e) {}
        const est = Math.max(140, estimateHeightFromContent(htmlContent));
        Skeleton.create(preElement, est);
        wrapper.appendChild(iframe);
        preElement.classList.remove('xb-show');
        registerIframeMapping(iframe, wrapper);
        if (settings.useBlob) {
            const full = prepareHtmlContent(htmlContent);
            setIframeBlobHTML(iframe, full);
        } else {
            iframe.srcdoc = prepareHtmlContent(htmlContent);
        }
        return iframe;
    } catch (err) {
        return null;
    }
}

function toggleSettingsControls(enabled) {
    const controls = [
        'xiaobaix_sandbox', 'xiaobaix_memory_enabled', 'xiaobaix_memory_inject',
        'xiaobaix_memory_depth', 'xiaobaix_recorded_enabled', 'xiaobaix_preview_enabled',
        'xiaobaix_script_assistant', 'scheduled_tasks_enabled', 'xiaobaix_template_enabled',
        'wallhaven_enabled', 'wallhaven_bg_mode', 'wallhaven_category',
        'wallhaven_purity', 'wallhaven_opacity',
        'xiaobaix_immersive_enabled', 'character_updater_enabled', 'xiaobaix_dynamic_prompt_enabled',
        'xiaobaix_use_blob'
    ];
    controls.forEach(id => {
        $(`#${id}`).prop('disabled', !enabled).closest('.flex-container').toggleClass('disabled-control', !enabled);
    });
    const styleId = 'xiaobaix-disabled-style';
    if (!enabled && !document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `.disabled-control, .disabled-control * { opacity: 0.4 !important; pointer-events: none !important; cursor: not-allowed !important; }`;
        document.head.appendChild(style);
    } else if (enabled) {
        document.getElementById(styleId)?.remove();
    }
}

function setDefaultSettings() {
    settings.sandboxMode = false;
    settings.memoryEnabled = false;
    settings.memoryInjectEnabled = false;
    settings.memoryInjectDepth = 5;
    const defaultModules = [
        { module: 'templateEditor', control: 'xiaobaix_template_enabled', enabled: true },
        { module: 'tasks', control: 'scheduled_tasks_enabled', enabled: true },
        { module: 'recorded', control: 'xiaobaix_recorded_enabled', enabled: true },
        { module: 'characterUpdater', control: 'character_updater_enabled', enabled: true },
        { module: 'dynamicPrompt', control: 'xiaobaix_dynamic_prompt_enabled', enabled: true },
        { module: 'variablesPanel', control: 'xiaobaix_variables_panel_enabled', enabled: false },
        { module: 'preview', control: 'xiaobaix_preview_enabled', enabled: false },
        { module: 'scriptAssistant', control: 'xiaobaix_script_assistant', enabled: false }
    ];
    defaultModules.forEach(({ module, control, enabled }) => {
        if (!extension_settings[EXT_ID][module]) extension_settings[EXT_ID][module] = {};
        extension_settings[EXT_ID][module].enabled = enabled;
        $(`#${control}`).prop("checked", enabled);
    });
    $("#xiaobaix_sandbox").prop("checked", settings.sandboxMode);
    $("#xiaobaix_memory_enabled").prop("checked", settings.memoryEnabled);
    $("#xiaobaix_memory_inject").prop("checked", settings.memoryInjectEnabled);
    $("#xiaobaix_memory_depth").val(settings.memoryInjectDepth);
}

function ensureHideCodeStyle(enable) {
    const id = 'xiaobaix-hide-code';
    const old = document.getElementById(id);
    if (!enable) {
        old?.remove();
        return;
    }
    if (old) return;
    const hideCodeStyle = document.createElement('style');
    hideCodeStyle.id = id;
    hideCodeStyle.textContent = `
        .xiaobaix-active .mes_text pre { display: none !important; }
        .xiaobaix-active .mes_text pre.xb-show { display: block !important; }
    `;
    document.head.appendChild(hideCodeStyle);
}

function setActiveClass(enable) {
    document.body.classList.toggle('xiaobaix-active', !!enable);
}

function toggleAllFeatures(enabled) {
    if (enabled) {
        ensureHideCodeStyle(true);
        setActiveClass(true);
        setDefaultSettings();
        statsTracker.init(EXT_ID, MODULE_NAME, settings, executeSlashCommand);
        toggleSettingsControls(true);
        saveSettingsDebounced();
        processExistingMessages();
        setTimeout(() => processExistingMessages(), 100);
        setupEventListeners();
        const moduleInits = [
            { condition: extension_settings[EXT_ID].tasks?.enabled, init: initTasks },
            { condition: extension_settings[EXT_ID].scriptAssistant?.enabled, init: initScriptAssistant },
            { condition: extension_settings[EXT_ID].immersive?.enabled, init: initImmersiveMode },
            { condition: extension_settings[EXT_ID].templateEditor?.enabled, init: initTemplateEditor },
            { condition: extension_settings[EXT_ID].wallhaven?.enabled, init: initWallhavenBackground },
            { condition: extension_settings[EXT_ID].characterUpdater?.enabled, init: initCharacterUpdater },
            { condition: extension_settings[EXT_ID].dynamicPrompt?.enabled, init: initDynamicPrompt },
            { condition: extension_settings[EXT_ID].variablesPanel?.enabled, init: initVariablesPanel },
            { condition: true, init: initStreamingGeneration },
            { condition: true, init: initButtonCollapse } 
        ];
        moduleInits.forEach(({ condition, init }) => {
            if (condition) init();
        });
        if (extension_settings[EXT_ID].preview?.enabled || extension_settings[EXT_ID].recorded?.enabled) {
            setTimeout(initMessagePreview, 200);
        }
        if (settings.memoryEnabled && moduleInstances.statsTracker?.updateMemoryPrompt)
            setTimeout(() => moduleInstances.statsTracker.updateMemoryPrompt(), 300);
        if (extension_settings[EXT_ID].scriptAssistant?.enabled && window.injectScriptDocs)
            setTimeout(() => window.injectScriptDocs(), 400);
        if (extension_settings[EXT_ID].preview?.enabled)
            setTimeout(() => { document.querySelectorAll('#message_preview_btn').forEach(btn => btn.style.display = ''); }, 500);
        if (extension_settings[EXT_ID].recorded?.enabled)
            setTimeout(() => addHistoryButtonsDebounced(), 600);
        document.dispatchEvent(new CustomEvent('xiaobaixEnabledChanged', { detail: { enabled: true } }));
    } else {
        cleanupAllResources();
        if (window.messagePreviewCleanup) try { window.messagePreviewCleanup(); } catch (e) {}
        if (window.dynamicPromptCleanup) try { window.dynamicPromptCleanup(); } catch (e) {}
        if (window.buttonCollapseCleanup) try { window.buttonCollapseCleanup(); } catch (e) {}
        try { cleanupVariablesPanel(); } catch (e) {}
        Object.assign(settings, { sandboxMode: false, memoryEnabled: false, memoryInjectEnabled: false });
        ['recorded', 'preview', 'scriptAssistant', 'tasks', 'immersive', 'templateEditor', 'wallhaven', 'characterUpdater', 'dynamicPrompt', 'variablesPanel'].forEach(module => {
            if (!extension_settings[EXT_ID][module]) extension_settings[EXT_ID][module] = {};
            extension_settings[EXT_ID][module].enabled = false;
        });
        ["xiaobaix_sandbox", "xiaobaix_memory_enabled", "xiaobaix_memory_inject",
            "xiaobaix_recorded_enabled", "xiaobaix_preview_enabled", "xiaobaix_script_assistant",
            "scheduled_tasks_enabled", "xiaobaix_template_enabled", "wallhaven_enabled",
            "xiaobaix_immersive_enabled", "character_updater_enabled", "xiaobaix_dynamic_prompt_enabled",
            "xiaobaix_use_blob"].forEach(id => $(`#${id}`).prop("checked", false));
        toggleSettingsControls(false);
        document.getElementById('xiaobaix-hide-code')?.remove();
        setActiveClass(false);
        document.querySelectorAll('pre[data-xiaobaix-bound="true"]').forEach(pre => {
            pre.classList.remove('xb-show');
            pre.removeAttribute('data-xbfinal');
            delete pre.dataset.xbFinal;
            pre.style.display = '';
            delete pre.dataset.xiaobaixBound;
        });
        moduleInstances.statsTracker?.removeMemoryPrompt?.();
        window.removeScriptDocs?.();
        document.dispatchEvent(new CustomEvent('xiaobaixEnabledChanged', { detail: { enabled: false } }));
    }
}

function processMessageById(messageId, forceFinal = true) {
    const messageElement = document.querySelector(`div.mes[mesid="${messageId}"] .mes_text`);
    if (!messageElement) return;
    const codeBlocks = messageElement.querySelectorAll('pre > code');
    codeBlocks.forEach(codeBlock => {
        const preElement = codeBlock.parentElement;
        const shouldRender = shouldRenderContentByBlock(codeBlock);
        const prev = preElement.previousElementSibling;
        const wrapper = prev && prev.classList && prev.classList.contains('xiaobaix-iframe-wrapper') ? prev : null;
        if (wrapper) {
            const ifr = wrapper.querySelector('iframe.xiaobaix-iframe');
            if (ifr) { try { ifr.src='about:blank'; } catch(e) {} releaseIframeBlob(ifr); }
            wrapper.remove();
        }
        preElement.classList.remove('xb-show');
        preElement.removeAttribute('data-xbfinal');
        delete preElement.dataset.xbFinal;
        preElement.removeAttribute('data-xiaobaix-bound');
        delete preElement.dataset.xiaobaixBound;
        if (shouldRender) {
            const codeContent = codeBlock.textContent || '';
            const est = estimateHeightFromContent(codeContent);
            Skeleton.create(preElement, est);
            renderHtmlInIframe(codeContent, preElement.parentNode, preElement);
            if (forceFinal) preElement.dataset.xbFinal = 'true';
        } else {
            preElement.classList.add('xb-show');
        }
        preElement.dataset.xiaobaixBound = 'true';
    });
}

function processCodeBlocks(messageElement) {
    if (!settings.enabled || !isXiaobaixEnabled) return;
    try {
        const codeBlocks = messageElement.querySelectorAll('pre > code');
        const ctx = getContext();
        const lastId = ctx.chat?.length - 1;
        const mesEl = messageElement.closest('.mes');
        const mesId = mesEl ? Number(mesEl.getAttribute('mesid')) : null;
        if (isGenerating && mesId === lastId) {
            const alreadyFinal = messageElement.querySelector('pre[data-xbfinal="true"]');
            if (alreadyFinal) return;
        }
        codeBlocks.forEach(codeBlock => {
            const preElement = codeBlock.parentElement;
            const shouldRender = shouldRenderContentByBlock(codeBlock);
            const isFinal = preElement.dataset.xbFinal === 'true';
            if (isFinal) return;
            const alreadyBound = preElement.dataset.xiaobaixBound === 'true';
            if (!alreadyBound) {
                preElement.dataset.xiaobaixBound = 'true';
            }
            if (shouldRender) {
                const codeContent = codeBlock.textContent || '';
                preElement.classList.remove('xb-show');
                const prev = preElement.previousElementSibling;
                const wrapper = prev && prev.classList && prev.classList.contains('xiaobaix-iframe-wrapper') ? prev : null;
                if (wrapper) wrapper.querySelector('.xiaobaix-skel')?.remove();
                const est = estimateHeightFromContent(codeContent);
                Skeleton.create(preElement, est);
                renderHtmlInIframe(codeContent, preElement.parentNode, preElement);
                preElement.dataset.xbFinal = 'true';
            } else {
                preElement.classList.add('xb-show');
            }
        });
    } catch (err) {}
}

function processExistingMessages() {
    if (!settings.enabled || !isXiaobaixEnabled) return;
    document.querySelectorAll('.mes_text').forEach(processCodeBlocks);
    if (settings.memoryEnabled) {
        $('#chat .mes').each(function () {
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
        $("#xiaobaix_enabled").prop("checked", settings.enabled).on("change", function () {
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
        $("#xiaobaix_sandbox").prop("checked", settings.sandboxMode).on("change", function () {
            if (!isXiaobaixEnabled) return;
            settings.sandboxMode = $(this).prop("checked");
            saveSettingsDebounced();
        });
        $("#xiaobaix_memory_enabled").prop("checked", settings.memoryEnabled).on("change", function () {
            if (!isXiaobaixEnabled) return;
            settings.memoryEnabled = $(this).prop("checked");
            saveSettingsDebounced();
            if (!settings.memoryEnabled) {
                $('.memory-button').remove();
                statsTracker.removeMemoryPrompt();
            } else if (settings.memoryEnabled && settings.memoryInjectEnabled) {
                statsTracker.updateMemoryPrompt();
            }
        });
        $("#xiaobaix_memory_inject").prop("checked", settings.memoryInjectEnabled).on("change", function () {
            if (!isXiaobaixEnabled) return;
            settings.memoryInjectEnabled = $(this).prop("checked");
            saveSettingsDebounced();
            statsTracker.removeMemoryPrompt();
            if (settings.memoryEnabled && settings.memoryInjectEnabled) {
                statsTracker.updateMemoryPrompt();
            }
        });
        $("#xiaobaix_memory_depth").val(settings.memoryInjectDepth).on("change", function () {
            if (!isXiaobaixEnabled) return;
            const inputValue = $(this).val();
            const newDepth = inputValue === '' || inputValue === null || inputValue === undefined ? 4 : parseInt(inputValue);
            settings.memoryInjectDepth = newDepth;
            if (statsTracker && statsTracker.settings) {
                statsTracker.settings.memoryInjectDepth = newDepth;
            }
            saveSettingsDebounced();
            if (settings.memoryEnabled && settings.memoryInjectEnabled) {
                statsTracker.updateMemoryPrompt();
            }
        });
        const moduleConfigs = [
            { id: 'xiaobaix_recorded_enabled', key: 'recorded' },
            { id: 'xiaobaix_immersive_enabled', key: 'immersive', init: initImmersiveMode },
            { id: 'xiaobaix_preview_enabled', key: 'preview', init: initMessagePreview },
            { id: 'xiaobaix_script_assistant', key: 'scriptAssistant', init: initScriptAssistant },
            { id: 'scheduled_tasks_enabled', key: 'tasks', init: initTasks },
            { id: 'xiaobaix_template_enabled', key: 'templateEditor', init: initTemplateEditor },
            { id: 'wallhaven_enabled', key: 'wallhaven', init: initWallhavenBackground },
            { id: 'character_updater_enabled', key: 'characterUpdater', init: initCharacterUpdater },
            { id: 'xiaobaix_dynamic_prompt_enabled', key: 'dynamicPrompt', init: initDynamicPrompt },
            { id: 'xiaobaix_variables_panel_enabled', key: 'variablesPanel', init: initVariablesPanel }
        ];
        moduleConfigs.forEach(({ id, key, init }) => {
            $(`#${id}`).prop("checked", settings[key]?.enabled || false).on("change", function () {
                if (!isXiaobaixEnabled) return;
                const enabled = $(this).prop('checked');
                settings[key] = extension_settings[EXT_ID][key] || {};
                settings[key].enabled = enabled;
                if (key === 'characterUpdater') {
                    settings[key].showNotifications = enabled;
                }
                extension_settings[EXT_ID][key] = settings[key];
                saveSettingsDebounced();
                if (moduleCleanupFunctions.has(key)) {
                    moduleCleanupFunctions.get(key)();
                    moduleCleanupFunctions.delete(key);
                }
                if (enabled && init) init();
            });
        });
        $("#xiaobaix_use_blob").prop("checked", !!settings.useBlob).on("change", function () {
            if (!isXiaobaixEnabled) return;
            settings.useBlob = $(this).prop("checked");
            saveSettingsDebounced();
        });
    } catch (err) {}
}

function setupMenuTabs() {
    $(document).on('click', '.menu-tab', function () {
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

let scanTimer = 0;
let scanningActive = false;
let skeletonPlacedForMsg = new Map();

function scheduleScanForStreaming() { return; }
function startStreamingScan() { return; }
function stopStreamingScan() {
    scanningActive = false;
    clearTimeout(scanTimer);
    scanTimer = 0;
    skeletonPlacedForMsg.clear();
}

function setupEventListeners() {
    if (!isXiaobaixEnabled) return;
    const { eventSource, event_types } = getContext();
    const handleMessage = async (data, isReceived = false) => {
        if (!settings.enabled || !isXiaobaixEnabled) return;
        setTimeout(async () => {
            const messageId = typeof data === 'object' ? data.messageId : data;
            if (!messageId && messageId !== 0) return;
            const messageElement = document.querySelector(`div.mes[mesid="${messageId}"] .mes_text`);
            if (!messageElement) return;
            processCodeBlocks(messageElement);
            if (settings.memoryEnabled) {
                statsTracker.addMemoryButtonToMessage(messageId);
                if (isReceived) {
                    await statsTracker.updateStatisticsForNewMessage();
                    $(`.mes[mesid="${messageId}"] .memory-button`).addClass('has-memory');
                }
            }
        }, isReceived ? 300 : 100);
    };
    const onMessageReceived = (data) => handleMessage(data, true);
    const onMessageUpdated = (data) => {
        if (!isXiaobaixEnabled) return;
        const messageId = typeof data === 'object' ? data.messageId : data;
        if (messageId == null) return;
        processMessageById(messageId, true);
    };
    const onMessageSwiped = handleMessage;
    if (event_types.MESSAGE_RECEIVED) {
        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
        globalEventListeners.push({ target: eventSource, event: event_types.MESSAGE_RECEIVED, handler: onMessageReceived, isEventSource: true });
    }
    if (event_types.MESSAGE_UPDATED) {
        eventSource.on(event_types.MESSAGE_UPDATED, onMessageUpdated);
        globalEventListeners.push({ target: eventSource, event: event_types.MESSAGE_UPDATED, handler: onMessageUpdated, isEventSource: true });
    }
    if (event_types.MESSAGE_SWIPED) {
        eventSource.on(event_types.MESSAGE_SWIPED, onMessageSwiped);
        globalEventListeners.push({ target: eventSource, event: event_types.MESSAGE_SWIPED, handler: onMessageSwiped, isEventSource: true });
    }
    if (event_types.USER_MESSAGE_RENDERED) {
        eventSource.on(event_types.USER_MESSAGE_RENDERED, handleMessage);
        globalEventListeners.push({ target: eventSource, event: event_types.USER_MESSAGE_RENDERED, handler: handleMessage, isEventSource: true });
    }
    if (event_types.CHARACTER_MESSAGE_RENDERED) {
        eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, handleMessage);
        globalEventListeners.push({ target: eventSource, event: event_types.CHARACTER_MESSAGE_RENDERED, handler: handleMessage, isEventSource: true });
    }
    const CHAT_LOADED_EVENT = event_types.CHAT_CHANGED;
    const chatLoadedHandler = async () => {
        if (!isXiaobaixEnabled) return;
        const timer1 = setTimeout(() => processExistingMessages(), 200);
        addGlobalTimer(timer1);
        if (!settings.memoryEnabled) return;
        const timer2 = setTimeout(async () => {
            try {
                let stats = await executeSlashCommand('/getvar xiaobaix_stats');
                if (!stats || stats === "undefined") {
                    const messagesText = await executeSlashCommand('/messages names=on');
                    if (messagesText) {
                        const newStats = statsTracker.dataManager.createEmptyStats();
                        const messageBlocks = messagesText.split('\n\n');
                        for (const block of messageBlocks) {
                            const colonIndex = block.indexOf(':');
                            if (colonIndex !== -1) {
                                const name = block.substring(0, colonIndex).trim();
                                const content = block.substring(colonIndex + 1).trim();
                                if (name !== getContext().name1 && content) {
                                    statsTracker.textAnalysis.updateStatsFromText(newStats, content, name);
                                }
                            }
                        }
                        await executeSlashCommand(`/setvar key=xiaobaix_stats ${JSON.stringify(newStats)}`);
                        if (settings.memoryInjectEnabled) statsTracker.updateMemoryPrompt();
                    }
                } else if (settings.memoryInjectEnabled) {
                    statsTracker.updateMemoryPrompt();
                }
            } catch (error) {}
        }, 500);
        addGlobalTimer(timer2);
    };
    if (CHAT_LOADED_EVENT) {
        eventSource.on(CHAT_LOADED_EVENT, chatLoadedHandler);
        globalEventListeners.push({ target: eventSource, event: CHAT_LOADED_EVENT, handler: chatLoadedHandler, isEventSource: true });
    }
    if (event_types.GENERATION_STARTED) {
        const onGenStart = () => { if (isXiaobaixEnabled) isGenerating = true; };
        eventSource.on(event_types.GENERATION_STARTED, onGenStart);
        globalEventListeners.push({ target: eventSource, event: event_types.GENERATION_STARTED, handler: onGenStart, isEventSource: true });
    }
    if (event_types.GENERATION_ENDED) {
        const onGenEnd = () => {
            isGenerating = false;
            const ctx = getContext();
            const lastId = ctx.chat?.length - 1;
            if (lastId != null && lastId >= 0) {
                setTimeout(() => processMessageById(lastId, true), 60);
            }
            stopStreamingScan();
        };
        eventSource.on(event_types.GENERATION_ENDED, onGenEnd);
        globalEventListeners.push({ target: eventSource, event: event_types.GENERATION_ENDED, handler: onGenEnd, isEventSource: true });
    }
    addGlobalEventListener(window, 'message', handleIframeMessage);
}

window.processExistingMessages = processExistingMessages;
window.renderHtmlInIframe = renderHtmlInIframe;
window.registerModuleCleanup = registerModuleCleanup;
window.addGlobalEventListener = addGlobalEventListener;
window.addGlobalTimer = addGlobalTimer;
window.updateLittleWhiteBoxExtension = updateLittleWhiteBoxExtension;
window.removeAllUpdateNotices = removeAllUpdateNotices;

jQuery(async () => {
    try {
        isXiaobaixEnabled = settings.enabled;
        window.isXiaobaixEnabled = isXiaobaixEnabled;
        if (isXiaobaixEnabled) {
            ensureHideCodeStyle(true);
            setActiveClass(true);
        }
        if (!document.getElementById('xiaobaix-skeleton-style')) {
            const skelStyle = document.createElement('style');
            skelStyle.id = 'xiaobaix-skeleton-style';
            skelStyle.textContent = `
              .xiaobaix-iframe-wrapper{position:relative}
              .xiaobaix-skel{position:relative;height:180px;border-radius:14px;overflow:hidden;background:radial-gradient(1200px 300px at -10% -10%, rgba(255,255,255,.08), transparent 60%),radial-gradient(800px 200px at 110% 110%, rgba(255,255,255,.06), transparent 60%),linear-gradient(180deg, rgba(255,255,255,.04), rgba(255,255,255,.02));border:1px solid rgba(255,255,255,.08);box-shadow:0 6px 20px rgba(0,0,0,.12), inset 0 0 0 1px rgba(255,255,255,.04);isolation:isolate}
              .xiaobaix-skel::before{content:"";position:absolute;inset:0;background:linear-gradient(110deg, transparent 0%, rgba(255,255,255,.08) 40%, rgba(255,255,255,.18) 50%, rgba(255,255,255,.08) 60%, transparent 100%);background-size:200% 100%;animation:xb-shine 1.4s ease-in-out infinite;mix-blend-mode:overlay}
              .xiaobaix-skel::after{content:"";position:absolute;inset:-2px;border-radius:16px;box-shadow:0 0 0 1px color-mix(in oklab, var(--SmartThemeAccentColor, #66aaff) 45%, transparent);pointer-events:none}
              .xiaobaix-skel.appear{opacity:0;transform:translateY(6px);animation:xb-in .18s ease-out forwards}
              .xiaobaix-skel.hide{opacity:1;transform:translateY(0);animation:xb-out .18s ease-in forwards}
              @keyframes xb-shine{0%{background-position:200% 0}100%{background-position:-200% 0}}
              @keyframes xb-in{to{opacity:1;transform:translateY(0)}}
              @keyframes xb-out{to{opacity:0;transform:translateY(6px)}}
              @media (prefers-reduced-motion: reduce){.xiaobaix-skel::before{animation:none}.xiaobaix-skel.appear,.xiaobaix-skel.hide{animation:none}}
            `;
            document.head.appendChild(skelStyle);
        }
        const response = await fetch(`${extensionFolderPath}/style.css`);
        const styleElement = document.createElement('style');
        styleElement.textContent = await response.text();
        document.head.appendChild(styleElement);
        moduleInstances.statsTracker = statsTracker;
        statsTracker.init(EXT_ID, MODULE_NAME, settings, executeSlashCommand);
        await setupSettings();
        if (isXiaobaixEnabled) setupEventListeners();
        eventSource.on(event_types.APP_READY, () => {
            setTimeout(performExtensionUpdateCheck, 2000);
        });
        if (isXiaobaixEnabled) {
            const moduleInits = [
                { condition: settings.tasks?.enabled, init: initTasks },
                { condition: settings.scriptAssistant?.enabled, init: initScriptAssistant },
                { condition: settings.immersive?.enabled, init: initImmersiveMode },
                { condition: settings.templateEditor?.enabled, init: initTemplateEditor },
                { condition: settings.wallhaven?.enabled, init: initWallhavenBackground },
                { condition: settings.characterUpdater?.enabled, init: initCharacterUpdater },
                { condition: settings.dynamicPrompt?.enabled, init: initDynamicPrompt },
                { condition: settings.variablesPanel?.enabled, init: initVariablesPanel },
                { condition: true, init: initStreamingGeneration },
                { condition: true, init: initButtonCollapse }
            ];
            moduleInits.forEach(({ condition, init }) => { if (condition) init(); });
            if (settings.preview?.enabled || settings.recorded?.enabled) {
                const timer2 = setTimeout(initMessagePreview, 1500);
                addGlobalTimer(timer2);
            }
        }
        const timer1 = setTimeout(setupMenuTabs, 500);
        addGlobalTimer(timer1);
        addGlobalTimer(setTimeout(() => {
            if (window.messagePreviewCleanup) {
                registerModuleCleanup('messagePreview', window.messagePreviewCleanup);
            }
        }, 2000));
        const timer3 = setTimeout(async () => {
            if (isXiaobaixEnabled) {
                processExistingMessages();
                if (settings.memoryEnabled) {
                    const messages = await statsTracker.dataManager.processMessageHistory();
                    if (messages?.length > 0) {
                        const stats = statsTracker.dataManager.createEmptyStats();
                        messages.forEach(message => {
                            statsTracker.textAnalysis.updateStatsFromText(stats, message.content, message.name);
                        });
                        await executeSlashCommand(`/setvar key=xiaobaix_stats ${JSON.stringify(stats)}`);
                        if (settings.memoryInjectEnabled) statsTracker.updateMemoryPrompt();
                    }
                }
            }
        }, 1000);
        addGlobalTimer(timer3);
        const intervalId = setInterval(() => {
            if (isXiaobaixEnabled) processExistingMessages();
        }, 30000);
        addGlobalTimer(intervalId);
    } catch (err) {}
});

export { executeSlashCommand };