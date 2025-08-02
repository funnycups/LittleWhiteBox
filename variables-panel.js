import { extension_settings, getContext, saveMetadataDebounced } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types, chat_metadata } from "../../../../script.js";
import { getLocalVariable, setLocalVariable, getGlobalVariable, setGlobalVariable } from "../../../variables.js";
import { callGenericPopup, POPUP_TYPE, POPUP_RESULT } from '../../../popup.js';

const CONFIG = {
    extensionName: "variables-panel", extensionFolderPath: "scripts/extensions/third-party/LittleWhiteBox",
    defaultSettings: { enabled: true }, defaultFolderName: 'LittleWhiteBox',
    autoClassifyVars: ['chat_summary', 'user_psychology_guide', 'ai_style_guide', 'xiaobaix_stats'],
    watchInterval: 1500, touchTimeout: 4000, longPressDelay: 700, folderLongPressDelay: 1000
};

const EMBEDDED_CSS = `
.vm-container {
   color: var(--SmartThemeBodyColor);
   background: var(--SmartThemeBlurTintColor);
   flex-direction: column;
   overflow-y: auto;
   z-index: 3000;
   position: fixed;
   display: none;
}

.vm-container:not([style*="display: none"]) { display: flex; }

@media (min-width: 1000px) {
   .vm-container:not([style*="display: none"]) {
       width: calc((100vw - var(--sheldWidth)) / 2);
       border-left: 1px solid var(--SmartThemeBorderColor);
       right: 0; top: 0; height: 100vh;
   }
}

@media (max-width: 999px) {
   .vm-container:not([style*="display: none"]) {
       max-height: calc(100svh - var(--topBarBlockSize));
       top: var(--topBarBlockSize);
       width: 100%; height: 100vh; left: 0;
   }
}

.vm-header, .vm-section, .vm-item-content { border-bottom: 0.5px solid var(--SmartThemeBorderColor); }
.vm-header, .vm-section-header { display: flex; justify-content: space-between; align-items: center; }
.vm-title, .vm-item-name, .vm-folder .vm-item-name { font-weight: bold; }

.vm-header { padding: 15px; }
.vm-title { font-size: 16px; }
.vm-section-header {
   padding: 5px 15px;
   border-bottom: 5px solid var(--SmartThemeBorderColor);
   font-size: 14px;
   color: var(--SmartThemeEmColor);
}

.vm-close, .vm-btn {
   background: none;
   border: none;
   cursor: pointer;
   display: inline-flex;
   align-items: center;
   justify-content: center;
}

.vm-close { font-size: 18px; padding: 5px; }
.vm-btn {
   border: 1px solid var(--SmartThemeBorderColor);
   border-radius: 3px;
   font-size: 12px;
   padding: 2px 4px;
   color: var(--SmartThemeBodyColor);
}

.vm-search-container { padding: 10px; border-bottom: 1px solid var(--SmartThemeBorderColor); }
.vm-search-input { width: 100%; padding: 3px 6px; }
.vm-clear-all-btn { color: #ff6b6b; border-color: #ff6b6b; opacity: 0.3; }

.vm-list { flex: 1; overflow-y: auto; padding: 10px; }
.vm-item {
   border: 1px solid var(--SmartThemeBorderColor);
   opacity: 0.7;
}
.vm-item.expanded { opacity: 1; }
.vm-item-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: pointer;
    padding-left: 5px;
}
.vm-item-name { font-size: 13px; }
.vm-item-controls {
   background: var(--SmartThemeChatTintColor);
   display: flex; gap: 5px; position: absolute; right: 5px;
   opacity: 0; visibility: hidden;
}
.vm-item-content { border-top: 1px solid var(--SmartThemeBorderColor); display: none; }

.vm-item.expanded > .vm-item-content,
.vm-folder.expanded > .vm-item-content,
.vm-folder[data-expanded="true"] > .vm-item-content { display: block; }

.vm-folder { border-left: 3px solid #ffa500; }
.vm-folder > .vm-item-header .vm-item-controls { opacity: 1 !important; visibility: visible !important; }
.vm-folder > .vm-item-header .vm-item-controls .vm-btn { display: inline-flex !important; }
.vm-folder-content { padding-left: 5px; }

.vm-inline-form {
    background: var(--SmartThemeChatTintColor);
    border: 1px solid var(--SmartThemeBorderColor);
    border-top: none;
    padding: 10px;
    margin: 0;
    display: none;
}

.vm-inline-form.active {
    display: block;
    animation: slideDown 0.2s ease-out;
}

@keyframes slideDown {
    from {
        opacity: 0;
        max-height: 0;
        padding-top: 0;
        padding-bottom: 0;
    }
    to {
        opacity: 1;
        max-height: 200px;
        padding-top: 10px;
        padding-bottom: 10px;
    }
}

@media (hover: hover) {
  .vm-close:hover, .vm-btn:hover { opacity: 0.8; }
  .vm-close:hover { color: red; }
  .vm-clear-all-btn:hover { opacity: 1; }
  .vm-item:hover > .vm-item-header .vm-item-controls { opacity: 1; visibility: visible; }
  .vm-list::-webkit-scrollbar-thumb:hover { background: var(--SmartThemeQuoteColor); }
  .vm-variable-checkbox:hover { background-color: rgba(255, 255, 255, 0.1); }
}

@media (hover: none) {
  .vm-close:active, .vm-btn:active { opacity: 0.8; }
  .vm-close:active { color: red; }
  .vm-clear-all-btn:active { opacity: 1; }
  .vm-item:active > .vm-item-header .vm-item-controls,
  .vm-item.touched > .vm-item-header .vm-item-controls { opacity: 1; visibility: visible; }
  .vm-item.touched > .vm-item-header { background-color: rgba(255, 255, 255, 0.05); }
  .vm-btn:active { background-color: rgba(255, 255, 255, 0.1); transform: scale(0.95); }
  .vm-variable-checkbox:active { background-color: rgba(255, 255, 255, 0.1); }
}

.vm-item:not([data-level]).expanded .vm-item[data-level="1"] { --level-color: hsl(36, 100%, 50%); }
.vm-item[data-level="1"].expanded .vm-item[data-level="2"] { --level-color: hsl(60, 100%, 50%); }
.vm-item[data-level="2"].expanded .vm-item[data-level="3"] { --level-color: hsl(120, 100%, 50%); }
.vm-item[data-level="3"].expanded .vm-item[data-level="4"] { --level-color: hsl(180, 100%, 50%); }
.vm-item[data-level="4"].expanded .vm-item[data-level="5"] { --level-color: hsl(240, 100%, 50%); }
.vm-item[data-level="5"].expanded .vm-item[data-level="6"] { --level-color: hsl(280, 100%, 50%); }
.vm-item[data-level="6"].expanded .vm-item[data-level="7"] { --level-color: hsl(320, 100%, 50%); }
.vm-item[data-level="7"].expanded .vm-item[data-level="8"] { --level-color: hsl(200, 100%, 50%); }
.vm-item[data-level="8"].expanded .vm-item[data-level="9"] { --level-color: hsl(160, 100%, 50%); }

.vm-item[data-level] { border-left: 2px solid var(--level-color); margin-left: 6px; }
.vm-item[data-level]:last-child { border-bottom: 2px solid var(--level-color); }

.vm-tree-value, .vm-variable-checkbox span {
   font-family: monospace;
   overflow: hidden;
   text-overflow: ellipsis;
   white-space: nowrap;
}
.vm-tree-value { color: inherit; font-size: 12px; flex: 1; margin: 0 10px; }

.vm-input, .vm-textarea {
   border: 1px solid var(--SmartThemeBorderColor);
   border-radius: 3px;
   background-color: var(--SmartThemeChatTintColor);
   font-size: 12px;
   margin: 3px 0;
}
.vm-textarea { min-height: 60px; padding: 5px; font-family: monospace; resize: vertical; }

.vm-add-form { padding: 10px; border-top: 1px solid var(--SmartThemeBorderColor); display: none; }
.vm-add-form.active { display: block; }
.vm-form-row { display: flex; gap: 10px; margin-bottom: 10px; align-items: center; }
.vm-form-label { min-width: 30px; font-size: 12px; font-weight: bold; }
.vm-form-input { flex: 1; }
.vm-form-buttons { display: flex; gap: 5px; justify-content: flex-end; }

.vm-list::-webkit-scrollbar { width: 6px; }
.vm-list::-webkit-scrollbar-track { background: var(--SmartThemeBodyColor); }
.vm-list::-webkit-scrollbar-thumb { background: var(--SmartThemeBorderColor); border-radius: 3px; }

.vm-move-variables-container { text-align: left; }
.vm-move-variables-container p { margin-bottom: 15px; font-size: 14px; }
.vm-variables-list {
   max-height: 300px; overflow-y: auto;
   border: 1px solid var(--SmartThemeBorderColor);
   border-radius: 5px; padding: 10px;
   background: var(--SmartThemeChatTintColor);
   display: flex; flex-wrap: wrap;
   justify-content: flex-start; align-items: flex-start;
   gap: 0; margin-top: 10px;
}

.vm-variable-checkbox {
   display: inline-flex !important; align-items: center !important;
   width: calc(50% - 10px) !important; margin: 4px 5px !important;
   padding: 5px 8px; border-radius: 3px; cursor: pointer;
   transition: background-color 0.2s; vertical-align: top; box-sizing: border-box;
}
.vm-variable-checkbox input[type="checkbox"] { margin-right: 8px !important; flex-shrink: 0; }
.vm-variable-checkbox span { font-size: 13px; }

.vm-empty-message { padding: 20px; text-align: center; color: #888; }
.vm-folder-icon { margin: 5px; }
.vm-folder-count, .vm-object-count, .vm-formatted-value { opacity: 0.7; }
.vm-item-name-visible { opacity: 1; }
.vm-item-separator { opacity: 0.3; }
.vm-null-value { opacity: 0.6; }

.mes_btn.mes_variables_panel {
    opacity: 0.6;
}

.mes_btn.mes_variables_panel:hover {
    opacity: 1;
}
`;

const EMBEDDED_HTML = `
<div id="vm-container" class="vm-container">
    <div class="vm-header">
        <div class="vm-title">
            变量面板
        </div>
        <button id="vm-close" class="vm-close">
            <i class="fa-solid fa-times"></i>
        </button>
    </div>

    <div class="vm-content">
        <div class="vm-section" id="character-variables-section">
            <div class="vm-section-header">
                <div class="vm-section-title">
                    <i class="fa-solid fa-user"></i>
                    本地变量
                </div>
                <div class="vm-section-controls">
                    <button class="vm-btn" id="import-character-variables" title="导入变量">
                        <i class="fa-solid fa-upload"></i>
                    </button>
                    <button class="vm-btn" id="export-character-variables" title="导出变量">
                        <i class="fa-solid fa-download"></i>
                    </button>
                    <button class="vm-btn" id="add-character-variable" title="添加变量">
                        <i class="fa-solid fa-plus"></i>
                    </button>
                    <button class="vm-btn" id="collapse-character-variables" title="展开/折叠所有">
                        <i class="fa-solid fa-chevron-down"></i>
                    </button>
                    <button class="vm-btn vm-clear-all-btn" id="clear-all-character-variables" title="清除所有本地变量">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
            <div class="vm-search-container" style="padding: 10px; border-bottom: 1px solid var(--SmartThemeBorderColor);">
                <input type="text" class="vm-input" id="character-vm-search" placeholder="搜索本地变量..." style="width: 100%;">
            </div>
            <div class="vm-list" id="character-variables-list">
            </div>
            <div class="vm-add-form" id="character-vm-add-form">
                <div class="vm-form-row">
                    <label class="vm-form-label">名称:</label>
                    <input type="text" class="vm-input vm-form-input" id="character-vm-name" placeholder="变量名称">
                </div>
                <div class="vm-form-row">
                    <label class="vm-form-label">值:</label>
                    <textarea class="vm-textarea vm-form-input" id="character-vm-value" placeholder="变量值 (支持JSON格式)"></textarea>
                </div>
                <div class="vm-form-buttons">
                    <button class="vm-btn" id="save-character-variable">
                        <i class="fa-solid fa-floppy-disk"></i>
                        保存
                    </button>
                    <button class="vm-btn" id="cancel-character-variable">
                        取消
                    </button>
                </div>
            </div>
        </div>

        <div class="vm-section" id="global-variables-section">
            <div class="vm-section-header">
                <div class="vm-section-title">
                    <i class="fa-solid fa-globe"></i>
                    全局变量
                </div>
                <div class="vm-section-controls">
                    <button class="vm-btn" id="import-global-variables" title="导入变量">
                        <i class="fa-solid fa-upload"></i>
                    </button>
                    <button class="vm-btn" id="export-global-variables" title="导出变量">
                        <i class="fa-solid fa-download"></i>
                    </button>
                    <button class="vm-btn" id="add-global-variable" title="添加变量">
                        <i class="fa-solid fa-plus"></i>
                    </button>
                    <button class="vm-btn" id="collapse-global-variables" title="展开/折叠所有">
                        <i class="fa-solid fa-chevron-down"></i>
                    </button>
                    <button class="vm-btn vm-clear-all-btn" id="clear-all-global-variables" title="清除所有全局变量">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
            <div class="vm-search-container" style="padding: 10px; border-bottom: 1px solid var(--SmartThemeBorderColor);">
                <input type="text" class="vm-input" id="global-vm-search" placeholder="搜索全局变量..." style="width: 100%;">
            </div>
            <div class="vm-list" id="global-variables-list">
            </div>
            <div class="vm-add-form" id="global-vm-add-form">
                <div class="vm-form-row">
                    <label class="vm-form-label">名称:</label>
                    <input type="text" class="vm-input vm-form-input" id="global-vm-name" placeholder="变量名称">
                </div>
                <div class="vm-form-row">
                    <label class="vm-form-label">值:</label>
                    <textarea class="vm-textarea vm-form-input" id="global-vm-value" placeholder="变量值 (支持JSON格式)"></textarea>
                </div>
                <div class="vm-form-buttons">
                    <button class="vm-btn" id="save-global-variable">
                        <i class="fa-solid fa-floppy-disk"></i>
                        保存
                    </button>
                    <button class="vm-btn" id="cancel-global-variable">
                        取消
                    </button>
                </div>
            </div>
        </div>
    </div>
</div>
`;

const VARIABLE_TYPES = {
    character: { getter: getLocalVariable, setter: setLocalVariable, storage: () => chat_metadata?.variables || (chat_metadata.variables = {}), folderStorage: () => chat_metadata?.variableFolders || (chat_metadata.variableFolders = {}), save: saveMetadataDebounced },
    global: { getter: getGlobalVariable, setter: setGlobalVariable, storage: () => extension_settings.variables?.global || ((extension_settings.variables = { global: {} }).global), folderStorage: () => extension_settings.variables?.globalFolders || (extension_settings.variables.globalFolders = {}), save: saveSettingsDebounced }
};

class VariablesPanel {
    constructor() {
        this.state = { isOpen: false, isEnabled: false, container: null, formState: {}, timers: { watcher: null, longPress: null, touch: new Map() }, currentInlineForm: null };
        this.variableSnapshot = null;
        this.eventHandlers = {};
        this.savingInProgress = false;
    }

    async init() {
        await this.loadUI();
        this.bindControlEvents();
        const s = this.getSettings();
        this.state.isEnabled = s.enabled;
        this.syncCheckboxState();
        if (s.enabled) this.enable();
    }

    async loadUI() {
        try {
            const cssId = 'variables-panel-css';
            if (!document.getElementById(cssId)) {
                const style = document.createElement('style');
                style.id = cssId;
                style.textContent = EMBEDDED_CSS;
                document.head.appendChild(style);
            }
            this.containerHtml = EMBEDDED_HTML;
        } catch (e) {
            console.error('[Variables Panel] 加载UI失败:', e);
            toastr?.error?.('Variables Panel UI加载失败');
        }
    }

    getSettings() {
        if (!extension_settings.LittleWhiteBox) extension_settings.LittleWhiteBox = {};
        if (!extension_settings.LittleWhiteBox.variablesPanel) extension_settings.LittleWhiteBox.variablesPanel = { ...CONFIG.defaultSettings };
        return extension_settings.LittleWhiteBox.variablesPanel;
    }

    enable() { this.createContainer(); this.bindEvents(); this.autoClassifyAllVariables(); this.loadVariables(); this.addMessageButtons(); if (this.state.container?.is(':visible')) this.open(); }
    disable() { this.cleanup(); }
    cleanup() { this.stopWatcher(); this.unbindEvents(); this.unbindControlEvents(); this.removeContainer(); this.removeMessageButtons(); this.resetState(); }
    resetState() { this.clearAllTimers(); Object.assign(this.state, { isOpen: false, formState: {}, timers: { watcher: null, longPress: null, touch: new Map() }, currentInlineForm: null }); this.variableSnapshot = null; this.savingInProgress = false; }
    clearAllTimers() { const { timers } = this.state; if (timers.watcher) clearInterval(timers.watcher); if (timers.longPress) clearTimeout(timers.longPress); timers.touch.forEach(t => clearTimeout(t)); timers.touch.clear(); }
    createContainer() { if (!this.state.container?.length) { $('body').append(this.containerHtml); this.state.container = $("#vm-container"); $("#vm-close").off('click').on('click', () => this.close()); } }
    removeContainer() { this.state.container?.remove(); this.state.container = null; }

    open() {
        if (!this.state.isEnabled) return toastr.warning('请先启用变量面板');
        this.createContainer(); this.bindEvents(); this.state.isOpen = true; this.state.container.show(); this.loadVariables(); this.startWatcher();
    }

    close() { this.state.isOpen = false; this.stopWatcher(); this.unbindEvents(); this.removeContainer(); this.resetState(); }

    bindControlEvents() {
        const id = 'xiaobaix_variables_panel_enabled';
        const bind = () => {
            const cb = document.getElementById(id);
            if (cb) {
                if (this.handleCheckboxChange) cb.removeEventListener('change', this.handleCheckboxChange);
                this.handleCheckboxChange = (e) => this.toggleEnabled(e.target.checked);
                cb.addEventListener('change', this.handleCheckboxChange);
                cb.checked = this.state.isEnabled;
                return true;
            }
            return false;
        };
        if (!bind()) setTimeout(bind, 100);
    }

    bindEvents() {
        if (!this.state.container?.length) return;
        this.unbindEvents();
        ['character', 'global'].forEach(t => { this.bindTypeEvents(t); $(`#${t}-vm-search`).on('input', (e) => this.searchVariables(t, e.target.value)); });
        this.bindTreeEvents();
    }

    bindTypeEvents(t) {
        const actions = { import: () => this.importVariables(t), export: () => this.exportVariables(t), add: () => this.showAddForm(t), collapse: () => this.collapseAll(t), save: () => this.saveVariable(t), cancel: () => this.hideAddForm(t), 'clear-all': () => this.clearAllVariables(t) };
        Object.entries(actions).forEach(([a, h]) => {
            const s = ['clear-all', 'collapse'].includes(a) ? 'variables' : 'variable';
            const sel = `#${a}-${t}-${s}`;
            if (a === 'add') this.bindLongPress(sel, h, () => this.createFolderDialog(t), CONFIG.folderLongPressDelay); else $(sel).on('click', h);
        });
    }

    bindTreeEvents() {
        const ns = '.vm-tree';
        $(document).off(ns);
        const handlers = {
            touchstart: { '.vm-item > .vm-item-header': this.handleTouch },
            click: { '.vm-item > .vm-item-header': this.handleItemClick, '.edit-btn': this.handleEdit, '.add-child-btn': this.handleAddChild, '.delete-btn': this.handleDelete, '.edit-folder-btn': this.handleEditFolder, '.delete-folder-btn': this.handleDeleteFolder, '.move-to-folder-btn': this.handleMoveToFolder, '.inline-save-btn': this.handleInlineSave, '.inline-cancel-btn': this.handleInlineCancel }
        };
        Object.entries(handlers).forEach(([e, eh]) => Object.entries(eh).forEach(([s, h]) => $(document).on(`${e}${ns}`, s, h.bind(this))));
        this.bindCopyEvents();
    }

    bindCopyEvents() {
        const ns = '.vm-tree';
        $(document).on(`mousedown${ns} touchstart${ns}`, '.copy-btn', (e) => {
            e.preventDefault(); e.stopPropagation();
            const startTime = Date.now();
            this.state.timers.longPress = setTimeout(() => { this.handleCopy(e, true); this.state.timers.longPress = null; }, CONFIG.longPressDelay);
            const release = (re) => {
                if (this.state.timers.longPress) {
                    clearTimeout(this.state.timers.longPress); this.state.timers.longPress = null;
                    if (re.type !== 'mouseleave' && (Date.now() - startTime) < CONFIG.longPressDelay) this.handleCopy(e, false);
                }
                $(document).off(`mouseup${ns} touchend${ns} mouseleave${ns}`, release);
            };
            $(document).on(`mouseup${ns} touchend${ns} mouseleave${ns}`, release);
        });
    }

    bindLongPress(sel, sh, lh, dur) {
        const el = $(sel); let timer = null;
        el.on('mousedown touchstart', (e) => { e.preventDefault(); timer = setTimeout(() => { timer = null; lh(e); }, dur); })
          .on('mouseup touchend mouseleave', (e) => { if (timer) { clearTimeout(timer); timer = null; if (e.type !== 'mouseleave') sh(e); } });
    }

    unbindEvents() {
        $(document).off('.vm-tree');
        ['character', 'global'].forEach(t => {
            ['import', 'export', 'add', 'collapse', 'save', 'cancel', 'clear-all'].forEach(a => {
                const s = ['clear-all', 'collapse'].includes(a) ? 'variables' : 'variable';
                $(`#${a}-${t}-${s}`).off();
            });
            $(`#${t}-vm-search`).off('input');
        });
    }

    unbindControlEvents() {
        const cb = document.getElementById('xiaobaix_variables_panel_enabled');
        if (cb && this.handleCheckboxChange) { cb.removeEventListener('change', this.handleCheckboxChange); this.handleCheckboxChange = null; }
    }

    syncCheckboxState() {
        const cb = document.getElementById('xiaobaix_variables_panel_enabled');
        if (cb) cb.checked = this.state.isEnabled;
    }

    startWatcher() { this.stopWatcher(); this.updateSnapshot(); this.state.timers.watcher = setInterval(() => { if (this.state.isOpen) this.checkChanges(); }, CONFIG.watchInterval); }
    stopWatcher() { if (this.state.timers.watcher) { clearInterval(this.state.timers.watcher); this.state.timers.watcher = null; } }
    updateSnapshot() { this.variableSnapshot = { character: JSON.stringify(VARIABLE_TYPES.character.storage()), global: JSON.stringify(VARIABLE_TYPES.global.storage()), characterFolders: JSON.stringify(VARIABLE_TYPES.character.folderStorage()), globalFolders: JSON.stringify(VARIABLE_TYPES.global.folderStorage()) }; }

    checkChanges() {
        try {
            const cur = { character: JSON.stringify(VARIABLE_TYPES.character.storage()), global: JSON.stringify(VARIABLE_TYPES.global.storage()), characterFolders: JSON.stringify(VARIABLE_TYPES.character.folderStorage()), globalFolders: JSON.stringify(VARIABLE_TYPES.global.folderStorage()) };
            if (Object.keys(cur).some(k => cur[k] !== this.variableSnapshot[k])) {
                const states = this.saveAllExpandedStates(); this.variableSnapshot = cur; this.loadVariables(); this.restoreAllExpandedStates(states);
            }
        } catch (e) { console.warn('[Variable Manager] Error checking changes:', e); }
    }

    autoResizeTextarea(ta) {
        if (!ta || !ta.length) return;
        const el = ta[0];
        el.style.height = 'auto';
        const sh = el.scrollHeight; const lh = parseInt(window.getComputedStyle(el).lineHeight) || 20;
        const min = 60; const max = Math.min(300, window.innerHeight * 0.4);
        const fh = Math.max(min, Math.min(max, sh + 4));
        el.style.height = fh + 'px';
        el.style.overflowY = sh > max - 4 ? 'auto' : 'hidden';
    }

    folder = {
        get: (t) => VARIABLE_TYPES[t].folderStorage(),
        create: (t, n) => { const f = this.folder.get(t); const id = `folder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`; f[id] = { name: n, variables: [], created: Date.now(), expanded: false }; VARIABLE_TYPES[t].save(); return id; },
        delete: (t, id) => { const f = this.folder.get(t); const v = f[id]?.variables || []; delete f[id]; VARIABLE_TYPES[t].save(); return v; },
        rename: (t, id, n) => { const f = this.folder.get(t); if (f[id]) { f[id].name = n; VARIABLE_TYPES[t].save(); return true; } return false; },
        moveVariable: (t, v, id) => { const f = this.folder.get(t); if (!f[id]) return false; Object.values(f).forEach(fo => { const i = fo.variables?.indexOf(v); if (i > -1) fo.variables.splice(i, 1); }); f[id].variables = f[id].variables || []; if (!f[id].variables.includes(v)) f[id].variables.push(v); VARIABLE_TYPES[t].save(); return true; },
        removeVariable: (t, v) => { const f = this.folder.get(t); Object.values(f).forEach(fo => { const i = fo.variables?.indexOf(v); if (i > -1) fo.variables.splice(i, 1); }); VARIABLE_TYPES[t].save(); },
        getVariableFolder: (t, v) => { const f = this.folder.get(t); return Object.entries(f).find(([_, fo]) => fo.variables?.includes(v))?.[0]; },
        toggle: (t, id) => { const f = this.folder.get(t); if (f[id]) { f[id].expanded = !f[id].expanded; VARIABLE_TYPES[t].save(); return f[id].expanded; } return false; }
    };

    loadVariables() { ['character', 'global'].forEach(t => { this.autoClassifyVariables(t); this.renderVariables(t); $(`#collapse-${t}-variables i`).removeClass('fa-chevron-up').addClass('fa-chevron-down'); }); }

    renderVariables(t) {
        const c = $(`#${t}-variables-list`).empty(); const v = VARIABLE_TYPES[t].storage(); const f = this.folder.get(t); const inF = new Set();
        Object.values(f).forEach(fo => fo.variables?.forEach(va => inF.add(va)));
        Object.entries(f).forEach(([id, fo]) => c.append(this.createFolderItem(t, id, fo)));
        const root = Object.entries(v).filter(([k]) => !inF.has(k));
        if (!Object.keys(f).length && !root.length) c.append('<div class="vm-empty-message">暂无变量</div>'); else root.forEach(([k, va]) => c.append(this.createVariableItem(t, k, va)));
    }

    createFolderItem(t, id, fo) {
        const { variables = [], expanded = false, name } = fo; const s = VARIABLE_TYPES[t].storage();
        return $(`<div class="vm-item vm-folder ${expanded ? 'expanded' : ''}" data-folder-id="${id}" data-type="${t}"><div class="vm-item-header"><div class="vm-item-name vm-item-name-visible"><i class="fa-solid ${expanded ? 'fa-folder-open' : 'fa-folder'} vm-folder-icon"></i>${this.escape(name || '未命名文件夹')}</div><div class="vm-tree-value"><span class="vm-folder-count">[${variables.length} 个变量]</span></div><div class="vm-item-controls">${this.createButtons('folder')}</div></div><div class="vm-item-content"><div class="vm-folder-content">${variables.map(vn => s[vn] !== undefined ? this.createVariableItem(t, vn, s[vn], 0)[0].outerHTML : '').filter(Boolean).join('')}</div></div></div>`);
    }

    createVariableItem(t, k, v, l = 0) {
        const dv = l === 0 ? this.formatTopLevelValue(v) : this.formatValue(v); const p = this.parseValue(v); const hc = typeof p === 'object' && p !== null;
        return $(`<div class="vm-item ${l > 0 ? 'vm-tree-level-var' : ''}" data-key="${k}" data-type="${t}" ${l > 0 ? `data-level="${l}" style="--tree-level: ${l}"` : ''}><div class="vm-item-header"><div class="vm-item-name vm-item-name-visible">${this.escape(k)}<span class="vm-item-separator">:</span></div><div class="vm-tree-value">${dv}</div><div class="vm-item-controls">${this.createButtons('item', l)}</div></div>${hc ? `<div class="vm-item-content">${this.renderChildren(p, l + 1)}</div>` : ''}</div>`);
    }

    createButtons(t, l = 0) {
        const cfgs = { folder: [{ action: 'move-to-folder', icon: 'fa-arrow-right', title: '移动变量到此文件夹' }, { action: 'edit-folder', icon: 'fa-edit', title: '编辑文件夹名称' }, { action: 'delete-folder', icon: 'fa-trash', title: '删除文件夹' }], item: [{ action: 'edit', icon: 'fa-edit', title: '编辑' }, { action: 'add-child', icon: 'fa-plus-circle', title: '添加子变量' }, ...(l < 2 ? [{ action: 'copy', icon: 'fa-code', title: l === 0 ? '复制 (单击: {{getvar::}}格式, 长按: /getvar格式)' : '复制 (长按: /getvar格式)' }] : []), { action: 'delete', icon: 'fa-trash', title: '删除' }] };
        return cfgs[t].map(({ action, icon, title }) => `<button class="vm-btn ${action}-btn" title="${title}"><i class="fa-solid ${icon}"></i></button>`).join('');
    }

    createInlineForm(t, ti, fs) {
        const fid = `inline-form-${Date.now()}`;
        const inf = $(`<div class="vm-inline-form" id="${fid}" data-type="${t}"><div class="vm-form-row"><label class="vm-form-label">名称:</label><input type="text" class="vm-input vm-form-input inline-name" placeholder="变量名称"></div><div class="vm-form-row"><label class="vm-form-label">值:</label><textarea class="vm-textarea vm-form-input inline-value" placeholder="变量值 (支持JSON格式)"></textarea></div><div class="vm-form-buttons"><button class="vm-btn inline-save-btn" data-form-id="${fid}"><i class="fa-solid fa-floppy-disk"></i>保存</button><button class="vm-btn inline-cancel-btn" data-form-id="${fid}">取消</button></div></div>`);
        if (this.state.currentInlineForm) this.state.currentInlineForm.remove();
        ti.after(inf); this.state.currentInlineForm = inf; this.state.formState = { ...fs, formId: fid, targetItem: ti };
        const ta = inf.find('.inline-value'); ta.on('input', () => this.autoResizeTextarea(ta));
        setTimeout(() => { inf.addClass('active'); inf.find('.inline-name').focus(); }, 10);
        return inf;
    }

    renderChildren(o, l) { return Object.entries(o).map(([k, v]) => this.createVariableItem(null, k, v, l)[0].outerHTML).join(''); }

    handleTouch(e) {
        if ($(e.target).closest('.vm-item-controls').length) return;
        e.stopPropagation(); const i = $(e.currentTarget).closest('.vm-item'); $('.vm-item').removeClass('touched'); i.addClass('touched'); this.clearTouchTimer(i);
        const t = setTimeout(() => { i.removeClass('touched'); this.state.timers.touch.delete(i[0]); }, CONFIG.touchTimeout);
        this.state.timers.touch.set(i[0], t);
    }

    clearTouchTimer(i) { const t = this.state.timers.touch.get(i[0]); if (t) { clearTimeout(t); this.state.timers.touch.delete(i[0]); } }

    handleItemClick(e) {
        if ($(e.target).closest('.vm-item-controls').length) return;
        e.stopPropagation(); const i = $(e.currentTarget).closest('.vm-item');
        if (i.hasClass('vm-folder')) {
            const fid = i.data('folder-id'); const t = i.data('type'); const exp = this.folder.toggle(t, fid);
            i.find('.vm-item-name i').removeClass('fa-folder fa-folder-open').addClass(exp ? 'fa-folder-open' : 'fa-folder');
            this.loadVariables();
        } else i.toggleClass('expanded');
    }

    handleCopy(e, lp) {
        e.stopPropagation(); const i = $(e.target).closest('.vm-item'); const p = this.getItemPath(i); const t = this.getVariableType(i); const l = parseInt(i.attr('data-level')) || 0;
        let cmd;
        if (lp) {
            const c = t === 'character' ? 'getvar' : 'getglobalvar';
            if (l === 0) cmd = `/${c} ${p[0]}`;
            else if (l === 1) cmd = `/${c} index=${p.slice(1).join('.')} ${p[0]}`;
            else return toastr.warning('长按复制仅适用于顶级和二级变量');
        } else {
            if (l === 0) cmd = `{{getvar::${p[0]}}}`;
            else return toastr.warning('单击复制仅适用于顶级变量');
        }
        if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(cmd).then(() => toastr.success(`已复制命令: ${cmd}`)).catch(() => toastr.error('复制失败'));
        else {
            try {
                const ta = document.createElement("textarea"); ta.value = cmd; ta.style.cssText = "position:fixed;top:0;left:0;width:2em;height:2em;padding:0;border:none;outline:none;box-shadow:none;background:transparent";
                document.body.appendChild(ta); ta.focus(); ta.select();
                const ok = document.execCommand('copy');
                if (ok) toastr.success(`已复制命令 (兼容模式): ${cmd}`); else toastr.error('复制失败 (兼容模式)');
                document.body.removeChild(ta);
            } catch (err) { console.error('Fallback copy failed', err); toastr.error('复制失败，请检查浏览器权限'); }
        }
    }

    handleEdit = (e) => this.editAction(e, 'edit');
    handleAddChild = (e) => this.editAction(e, 'addChild');

    editAction(e, a) {
        e.stopPropagation(); const i = $(e.target).closest('.vm-item'); const p = this.getItemPath(i); const t = this.getVariableType(i);
        const fs = { action: a, path: p, type: t }; const inf = this.createInlineForm(t, i, fs);
        if (a === 'edit') {
            const v = this.getValueByPath(t, p);
            setTimeout(() => {
                inf.find('.inline-name').val(p[p.length - 1]);
                const ta = inf.find('.inline-value'); const dv = typeof v === 'object' ? JSON.stringify(v, null, 2) : v;
                ta.val(dv); this.autoResizeTextarea(ta);
            }, 50);
        } else if (a === 'addChild') {
            inf.find('.inline-name').attr('placeholder', `为 "${p.join('.')}" 添加子变量名称`);
            inf.find('.inline-value').attr('placeholder', '子变量值 (支持JSON格式)');
        }
    }

handleInlineSave(e) {
    e.stopPropagation();
    e.preventDefault();

    if (this.savingInProgress) return;
    this.savingInProgress = true;

    try {
        const form = $(e.target).closest('.vm-inline-form');
        if (!form.length) {
            toastr.error('表单未找到');
            return;
        }

        const nameInput = form.find('.inline-name');
        const valueInput = form.find('.inline-value');

        if (!nameInput.length || !valueInput.length) {
            toastr.error('表单元素不完整');
            return;
        }

        const name = nameInput.val()?.trim();
        const value = valueInput.val()?.trim();
        const type = form.data('type');

        if (!name) {
            toastr.error('请输入变量名称');
            nameInput.focus();
            return;
        }

        const processedValue = this.processValue(value);
        const { action, path } = this.state.formState;

        const states = this.saveExpandedStates(type);

        if (action === 'addChild') {
            this.setValueByPath(type, [...path, name], processedValue);
        } else if (action === 'edit') {
            const oldName = path[path.length - 1];
            if (name !== oldName) {

                this.deleteByPath(type, path);
                this.folder.removeVariable(type, oldName);

                if (path.length === 1) {
                    VARIABLE_TYPES[type].setter(name, processedValue);
                } else {
                    this.setValueByPath(type, [...path.slice(0, -1), name], processedValue);
                }

                const folderId = this.folder.getVariableFolder(type, oldName);
                if (folderId && path.length === 1) {
                    this.folder.moveVariable(type, name, folderId);
                }
            } else {
                this.setValueByPath(type, path, processedValue);
            }
        } else {
            VARIABLE_TYPES[type].setter(name, processedValue);
        }

        this.hideInlineForm();
        this.loadVariables();
        this.restoreExpandedStates(type, states);

        toastr.success('变量已保存');

    } catch (error) {
        console.error('保存变量时出错:', error);
        toastr.error('JSON格式错误: ' + error.message);
    } finally {
        this.savingInProgress = false;
    }
}


    handleInlineCancel(e) { e.stopPropagation(); this.hideInlineForm(); }
    hideInlineForm() { if (this.state.currentInlineForm) { this.state.currentInlineForm.removeClass('active'); setTimeout(() => { this.state.currentInlineForm?.remove(); this.state.currentInlineForm = null; }, 200); } this.state.formState = {}; }

    handleDelete(e) {
        e.stopPropagation(); const i = $(e.target).closest('.vm-item'); const p = this.getItemPath(i); const n = p[p.length - 1];
        if (!confirm(`确定要删除 "${n}" 吗？`)) return;
        const t = this.getVariableType(i); this.folder.removeVariable(t, n); this.deleteByPath(t, p);
    }

    handleEditFolder(e) {
        e.stopPropagation(); const i = $(e.target).closest('.vm-folder'); const fid = i.data('folder-id'); const t = i.data('type'); const cur = this.folder.get(t)[fid]?.name || '';
        const nn = prompt('请输入新的文件夹名称:', cur);
        if (nn?.trim() && nn.trim() !== cur) {
            if (this.folder.rename(t, fid, nn.trim())) { this.loadVariables(); toastr.success(`文件夹已重命名为 "${nn}"`); }
        }
    }

    handleDeleteFolder(e) {
        e.stopPropagation(); const i = $(e.target).closest('.vm-folder'); const fid = i.data('folder-id'); const t = i.data('type'); const n = this.folder.get(t)[fid]?.name || '';
        if (!confirm(`确定要删除文件夹 "${n}" 吗？文件夹中的变量将移回根目录。`)) return;
        const moved = this.folder.delete(t, fid); this.loadVariables(); toastr.success(`文件夹 "${n}" 已删除，${moved.length} 个变量已移回根目录`);
    }

    async handleMoveToFolder(e) {
        e.stopPropagation(); const i = $(e.target).closest('.vm-folder'); const fid = i.data('folder-id'); const t = i.data('type');
        await this.showMoveVariableDialog(t, fid);
    }

    async showMoveVariableDialog(t, fid) {
        const v = VARIABLE_TYPES[t].storage(); const f = this.folder.get(t); const fn = f[fid]?.name || '';
        const inF = new Set(); Object.values(f).forEach(fo => fo.variables?.forEach(va => inF.add(va)));
        const avail = Object.keys(v).filter(va => !inF.has(va));
        if (!avail.length) return toastr.warning('没有可移动的变量');
        const d = document.createElement('div');
        d.innerHTML = `<div class="vm-move-variables-container"><p>选择要移动到文件夹 "<strong>${fn}</strong>" 的变量:</p><div class="vm-variables-list">${avail.map(va => `<label class="checkbox_label vm-variable-checkbox"><input type="checkbox" value="${va}"><span title="${va}">${va}</span></label>`).join('')}</div></div>`;
        const r = await callGenericPopup(d, POPUP_TYPE.CONFIRM, '', { okButton: '移动', cancelButton: '取消', wide: false, allowVerticalScrolling: true });
        if (r === POPUP_RESULT.AFFIRMATIVE) {
            const sel = Array.from(d.querySelectorAll('input:checked')).map(cb => cb.value);
            if (sel.length) { sel.forEach(va => this.folder.moveVariable(t, va, fid)); this.loadVariables(); toastr.success(`已将 ${sel.length} 个变量移动到文件夹 "${fn}"`); }
        }
    }

    showAddForm(t) {
        this.hideInlineForm(); const f = $(`#${t}-vm-add-form`); f.addClass('active');
        if (!this.state.formState.action || this.state.formState.action !== 'edit') {
            $(`#${t}-vm-name`).val('').attr('placeholder', '变量名称');
            const ta = $(`#${t}-vm-value`); ta.val('').attr('placeholder', '变量值 (支持JSON格式)');
            if (!ta.data('auto-resize-bound')) { ta.on('input', () => this.autoResizeTextarea(ta)); ta.data('auto-resize-bound', true); }
        }
        $(`#${t}-vm-name`).focus();
    }

    hideAddForm(t) { $(`#${t}-vm-add-form`).removeClass('active'); $(`#${t}-vm-name, #${t}-vm-value`).val(''); this.state.formState = {}; }

    saveVariable(t) {
        if (this.savingInProgress) return; this.savingInProgress = true;
        const n = $(`#${t}-vm-name`).val().trim(); const v = $(`#${t}-vm-value`).val().trim();
        if (!n) { toastr.error('请输入变量名称'); this.savingInProgress = false; return; }
        try {
            const proc = this.processValue(v); const { action, path } = this.state.formState; const states = this.saveExpandedStates(t);
            if (action === 'addChild') this.setValueByPath(t, [...path, n], proc);
            else if (action === 'edit') {
                const on = path[path.length - 1];
                if (n !== on) {
                    this.deleteByPath(t, path); this.folder.removeVariable(t, on);
                    if (path.length === 1) VARIABLE_TYPES[t].setter(n, proc); else this.setValueByPath(t, [...path.slice(0, -1), n], proc);
                    const fid = this.folder.getVariableFolder(t, on);
                    if (fid && path.length === 1) this.folder.moveVariable(t, n, fid);
                } else this.setValueByPath(t, path, proc);
            } else VARIABLE_TYPES[t].setter(n, proc);
            this.hideAddForm(t); this.loadVariables(); this.restoreExpandedStates(t, states); toastr.success('变量已保存');
        } catch (e) { toastr.error('JSON格式错误: ' + e.message); } finally { this.savingInProgress = false; }
    }

    getValueByPath(t, p) { if (p.length === 1) return VARIABLE_TYPES[t].getter(p[0]); let v = this.parseValue(VARIABLE_TYPES[t].getter(p[0])); p.slice(1).forEach(k => v = v?.[k]); return v; }

    setValueByPath(t, p, v) {
        this.modifyValueByPath(t, p, (tar, k) => {
            if (p.length > 1) {
                const pp = p.slice(0, -1); let par = this.getValueByPath(t, pp);
                if (typeof par !== 'object' || par === null) { par = {}; this.setValueByPath(t, pp, par); }
            }
            tar[k] = v;
        });
    }

    deleteByPath(t, p) { this.modifyValueByPath(t, p, (tar, k) => delete tar[k]); saveSettingsDebounced(); this.loadVariables(); toastr.success('变量已删除'); }

    modifyValueByPath(t, p, mod) {
        if (p.length === 1) {
            const s = VARIABLE_TYPES[t].storage(); mod(s, p[0]);
            if (mod.name.includes('delete')) saveSettingsDebounced();
        } else {
            let root = this.parseValue(VARIABLE_TYPES[t].getter(p[0]));
            if (typeof root !== 'object' || root === null) root = {};
            let tar = root;
            p.slice(1, -1).forEach(k => {
                if (typeof tar[k] !== 'object' || tar[k] === null) tar[k] = {};
                tar = tar[k];
            });
            mod(tar, p[p.length - 1]); VARIABLE_TYPES[t].setter(p[0], JSON.stringify(root));
        }
    }

    getVariableType(i) { return i.data('type') || (i.closest('.vm-section').attr('id').includes('character') ? 'character' : 'global'); }
    getItemPath(i) { const p = []; let c = i; while (c.length && c.hasClass('vm-item')) { const k = c.data('key'); if (k !== undefined) p.unshift(String(k)); if (!c.attr('data-level')) break; c = c.parent().closest('.vm-item'); } return p; }
    parseValue(v) { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return v; } }
    processValue(v) { return /^[\{\[]/.test(v) ? JSON.stringify(JSON.parse(v)) : v; }
    formatTopLevelValue(v) { const p = this.parseValue(v); if (typeof p === 'object' && p !== null) { const c = Array.isArray(p) ? p.length : Object.keys(p).length; return `<span class="vm-object-count">[${c} items]</span>`; } return this.formatValue(p); }
    formatValue(v) { if (v == null) return `<span class="vm-null-value">${v}</span>`; const s = String(v); const e = this.escape(s); const d = e.length > 50 ? `${e.substring(0, 50)}...` : e; return `<span class="vm-formatted-value">${d}</span>`; }
    escape(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
    searchVariables(t, q) { const l = q.toLowerCase().trim(); $(`#${t}-variables-list .vm-item`).each(function() { $(this).toggle(!l || $(this).text().toLowerCase().includes(l)); }); }
    collapseAll(t) { const i = $(`#${t}-variables-list .vm-item`); const ic = $(`#collapse-${t}-variables i`); const he = i.filter('.expanded').length > 0; i.toggleClass('expanded', !he); ic.toggleClass('fa-chevron-up', !he).toggleClass('fa-chevron-down', he); }

    clearAllVariables(t) {
        if (!confirm(`确定要清除所有${t === 'character' ? '角色' : '全局'}变量吗？`)) return;
        const s = VARIABLE_TYPES[t].storage(); Object.keys(s).forEach(k => delete s[k]); saveSettingsDebounced(); this.loadVariables(); toastr.success('变量已清除');
    }

    async importVariables(t) {
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json';
        inp.onchange = async (e) => {
            try {
                const txt = await e.target.files[0].text(); const v = JSON.parse(txt);
                Object.entries(v).forEach(([k, va]) => VARIABLE_TYPES[t].setter(k, typeof va === 'object' ? JSON.stringify(va) : va));
                this.loadVariables(); toastr.success(`成功导入 ${Object.keys(v).length} 个变量`);
            } catch { toastr.error('文件格式错误'); }
        };
        inp.click();
    }

    exportVariables(t) {
        const v = VARIABLE_TYPES[t].storage(); const b = new Blob([JSON.stringify(v, null, 2)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${t}-variables-${new Date().toISOString().split('T')[0]}.json`; a.click(); toastr.success('变量已导出');
    }

    saveExpandedStates(t) { const s = new Set(); $(`#${t}-variables-list .vm-item.expanded`).each(function() { const k = $(this).data('key'); if (k !== undefined) s.add(String(k)); }); return s; }
    saveAllExpandedStates() { return { character: this.saveExpandedStates('character'), global: this.saveExpandedStates('global') }; }
    restoreExpandedStates(t, s) { if (!s?.size) return; setTimeout(() => { $(`#${t}-variables-list .vm-item`).each(function() { const k = $(this).data('key'); if (k !== undefined && s.has(String(k))) $(this).addClass('expanded'); }); }, 50); }
    restoreAllExpandedStates(s) { Object.entries(s).forEach(([t, ts]) => this.restoreExpandedStates(t, ts)); }
    autoClassifyAllVariables() { ['character', 'global'].forEach(t => this.autoClassifyVariables(t)); }
    autoClassifyVariables(t) { const v = VARIABLE_TYPES[t].storage(); const dfid = this.ensureDefaultFolder(t); let c = 0; CONFIG.autoClassifyVars.forEach(vn => { if (v.hasOwnProperty(vn) && !this.folder.getVariableFolder(t, vn)) { this.folder.moveVariable(t, vn, dfid); c++; } }); return c; }
    ensureDefaultFolder(t) { const f = this.folder.get(t); const ex = Object.entries(f).find(([_, fo]) => fo.name === CONFIG.defaultFolderName); return ex ? ex[0] : this.folder.create(t, CONFIG.defaultFolderName); }

    toggleEnabled(en) {
        const s = this.getSettings(); s.enabled = this.state.isEnabled = en; saveSettingsDebounced(); this.syncCheckboxState();
        if (en) { this.enable(); if (!this.state.isOpen) this.open(); } else this.disable();
    }

    createFolderDialog(t) {
        const n = prompt('请输入文件夹名称:', '新文件夹');
        if (n?.trim()) { this.folder.create(t, n.trim()); this.loadVariables(); toastr.success(`文件夹 "${n}" 已创建`); }
    }

    addMessageButtons() {
        $(document).off('click.vm-message-button').on('click.vm-message-button', '.mes_btn.mes_variables_panel', () => this.open());
        if (typeof eventSource !== 'undefined') {
            if (this.eventHandlers.messageRendered) {
                eventSource.removeListener(event_types.CHARACTER_MESSAGE_RENDERED, this.eventHandlers.messageRendered);
                eventSource.removeListener(event_types.CHAT_CHANGED, this.eventHandlers.chatChanged);
            }
            this.eventHandlers = {
                messageRendered: () => setTimeout(() => this.updateMessageButtons(), 100),
                chatChanged: () => setTimeout(() => this.updateMessageButtons(), 200)
            };
            eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, this.eventHandlers.messageRendered);
            eventSource.on(event_types.CHAT_CHANGED, this.eventHandlers.chatChanged);
        }
        this.updateMessageButtons();
    }

    removeMessageButtons() {
        $(document).off('click.vm-message-button');
        if (typeof eventSource !== 'undefined' && this.eventHandlers) {
            eventSource.removeListener(event_types.CHARACTER_MESSAGE_RENDERED, this.eventHandlers.messageRendered);
            eventSource.removeListener(event_types.CHAT_CHANGED, this.eventHandlers.chatChanged);
            this.eventHandlers = {};
        }
        $('.mes_btn.mes_variables_panel').remove();
    }

    updateMessageButtons() {
        $('.mes_btn.mes_variables_panel').remove();
        $('#chat').children('.mes').slice(-1).each((_, el) => this.addButtonToMessage($(el)));
    }

    addButtonToMessage(msg) {
        const msgId = msg.attr('mesid');
        if (!msgId) return;

        if (msg.find('.mes_variables_panel').length) return;

        const btn = document.createElement('div');
        btn.title = 'Variables Panel';
        btn.className = 'mes_btn mes_variables_panel';
        btn.innerHTML = '<i class="fa-solid fa-database"></i>';

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.open();
        });

        if (typeof window.registerButtonToSubContainer === 'function' &&
            window.registerButtonToSubContainer(msgId, btn)) {
            return;
        }

        const btns = msg.find('.mes_buttons');
        const $btn = $(btn);
        const edit = btns.find('.mes_edit');
        if (edit.length) $btn.insertBefore(edit);
        else btns.append($btn);
    }
}

let variablesPanelInstance = null;

export async function initVariablesPanel() {
    try {
        extension_settings.variables ??= { global: {} };
        if (variablesPanelInstance) variablesPanelInstance.cleanup();
        variablesPanelInstance = new VariablesPanel();
        await variablesPanelInstance.init();
        console.log(`[${CONFIG.extensionName}] Variables Panel已加载`);
        return variablesPanelInstance;
    } catch (e) {
        console.error(`[${CONFIG.extensionName}] 加载失败:`, e);
        toastr?.error?.('Variables Panel加载失败');
        throw e;
    }
}

export function getVariablesPanelInstance() { return variablesPanelInstance; }
export function cleanupVariablesPanel() { if (variablesPanelInstance) { variablesPanelInstance.cleanup(); variablesPanelInstance = null; } }
