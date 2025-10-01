import { extension_settings, getContext, writeExtensionField, renderExtensionTemplateAsync } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types, characters, this_chid, chat } from "../../../../script.js";
import { SlashCommandParser } from "../../../slash-commands/SlashCommandParser.js";
import { SlashCommand } from "../../../slash-commands/SlashCommand.js";
import { ARGUMENT_TYPE, SlashCommandArgument } from "../../../slash-commands/SlashCommandArgument.js";
import { callGenericPopup, POPUP_TYPE } from "../../../popup.js";
import { accountStorage } from "../../../util/AccountStorage.js";
import { download, getFileText, uuidv4, debounce, getSortableDelay } from "../../../utils.js";
import { executeSlashCommand } from "./index.js";

const TASKS_MODULE_NAME = "xiaobaix-tasks";
const EXT_ID = "LittleWhiteBox";
const defaultSettings = { enabled: true, globalTasks: [], processedMessages: [], character_allowed_tasks: [] };
const CONFIG = { MAX_PROCESSED: 20, MAX_COOLDOWN: 10, CLEANUP_INTERVAL: 30000, TASK_COOLDOWN: 50, DEBOUNCE_DELAY: 1000 };

let state = {
    currentEditingTask: null, currentEditingIndex: -1, lastChatId: null, chatJustChanged: false,
    isNewChat: false, lastTurnCount: 0, isExecutingTask: false, isCommandGenerated: false,
    taskLastExecutionTime: new Map(), cleanupTimer: null, lastTasksHash: '', taskBarVisible: true,
    processedMessagesSet: new Set(),
    taskBarSignature: ''
};

const debouncedSave = debounce(() => saveSettingsDebounced(), CONFIG.DEBOUNCE_DELAY);

const isGloballyEnabled = () => (window.isXiaobaixEnabled !== undefined ? window.isXiaobaixEnabled : true) && getSettings().enabled;
const allTasks = () => [...getSettings().globalTasks, ...getCharacterTasks()];
const clampInt = (v, min, max, d = 0) => (Number.isFinite(+v) ? Math.max(min, Math.min(max, +v)) : d);
const nowMs = () => Date.now();

function getSettings() {
    const ext = extension_settings[EXT_ID] || (extension_settings[EXT_ID] = {});
    if (!ext.tasks) {
        ext.tasks = structuredClone(defaultSettings);
        return ext.tasks;
    }
    const t = ext.tasks;
    if (typeof t.enabled !== 'boolean') t.enabled = defaultSettings.enabled;
    if (!Array.isArray(t.globalTasks)) t.globalTasks = [];
    if (!Array.isArray(t.processedMessages)) t.processedMessages = [];
    if (!Array.isArray(t.character_allowed_tasks)) t.character_allowed_tasks = [];
    return t;
}

function hydrateProcessedSetFromSettings() {
    try {
        state.processedMessagesSet = new Set(getSettings().processedMessages || []);
    } catch {}
}

function scheduleCleanup() {
    if (state.cleanupTimer) return;
    state.cleanupTimer = setInterval(() => {
        const n = nowMs();
        for (const [taskName, lastTime] of state.taskLastExecutionTime.entries()) {
            if (n - lastTime > CONFIG.TASK_COOLDOWN * 2) state.taskLastExecutionTime.delete(taskName);
        }
        if (state.taskLastExecutionTime.size > CONFIG.MAX_COOLDOWN) {
            const entries = [...state.taskLastExecutionTime.entries()].sort((a, b) => b[1] - a[1]).slice(0, CONFIG.MAX_COOLDOWN);
            state.taskLastExecutionTime.clear();
            entries.forEach(([k, v]) => state.taskLastExecutionTime.set(k, v));
        }
        const settings = getSettings();
        if (settings.processedMessages.length > CONFIG.MAX_PROCESSED) {
            settings.processedMessages = settings.processedMessages.slice(-CONFIG.MAX_PROCESSED);
            state.processedMessagesSet = new Set(settings.processedMessages);
            debouncedSave();
        }
    }, CONFIG.CLEANUP_INTERVAL);
}

const isTaskInCooldown = (name, t = nowMs()) => {
    const last = state.taskLastExecutionTime.get(name);
    return last && (t - last) < CONFIG.TASK_COOLDOWN;
};
const setTaskCooldown = (name) => state.taskLastExecutionTime.set(name, nowMs());

// ------------- Message processed cache ---
const isMessageProcessed = (key) => state.processedMessagesSet.has(key);
function markMessageAsProcessed(key) {
    if (state.processedMessagesSet.has(key)) return;
    state.processedMessagesSet.add(key);
    const settings = getSettings();
    settings.processedMessages.push(key);
    if (settings.processedMessages.length > CONFIG.MAX_PROCESSED) {
        settings.processedMessages = settings.processedMessages.slice(-Math.floor(CONFIG.MAX_PROCESSED / 2));
        state.processedMessagesSet = new Set(settings.processedMessages);
    }
    debouncedSave();
}

// ------------- Character tasks -----------
function getCharacterTasks() {
    if (!this_chid || !characters[this_chid]) return [];
    const c = characters[this_chid];
    if (!c.data?.extensions?.[TASKS_MODULE_NAME]) {
        if (!c.data) c.data = {};
        if (!c.data.extensions) c.data.extensions = {};
        c.data.extensions[TASKS_MODULE_NAME] = { tasks: [] };
    }
    return c.data.extensions[TASKS_MODULE_NAME].tasks || [];
}

async function saveCharacterTasks(tasks) {
    if (!this_chid || !characters[this_chid]) return;
    await writeExtensionField(Number(this_chid), TASKS_MODULE_NAME, { tasks });
    const settings = getSettings();
    const avatar = characters[this_chid].avatar;
    if (avatar && !settings.character_allowed_tasks?.includes(avatar)) {
        settings.character_allowed_tasks ??= [];
        settings.character_allowed_tasks.push(avatar);
        debouncedSave();
    }
}

const __taskRunMap = new Map();

async function __runTaskSingleInstance(taskName, jsRunner, signature = null) {
    const old = __taskRunMap.get(taskName);
    if (old) {
        if (signature && old.signature === signature) {
            return;
        }
        try { old.abort.abort(); } catch {}
        try {
            old.timers.forEach((id) => clearTimeout(id));
            old.intervals.forEach((id) => clearInterval(id));
        } catch {}
        __taskRunMap.delete(taskName);
    }

    const abort = new AbortController();
    const timers = new Set();
    const intervals = new Set();

    const addListener = (target, type, handler, opts = {}) => {
        if (!target?.addEventListener) return;
        target.addEventListener(type, handler, { ...opts, signal: abort.signal });
    };
    const setTimeoutSafe = (fn, t, ...a) => {
        const id = setTimeout(() => {
            timers.delete(id);
            try { fn(...a); } catch (e) { console.error(e); }
        }, t);
        timers.add(id);
        return id;
    };
    const clearTimeoutSafe = (id) => { clearTimeout(id); timers.delete(id); };
    const setIntervalSafe = (fn, t, ...a) => {
        const id = setInterval(fn, t, ...a);
        intervals.add(id);
        return id;
    };
    const clearIntervalSafe = (id) => { clearInterval(id); intervals.delete(id); };

    __taskRunMap.set(taskName, { abort, timers, intervals, signature });

    try {
        await jsRunner({ addListener, setTimeoutSafe, clearTimeoutSafe, setIntervalSafe, clearIntervalSafe, abortSignal: abort.signal });
    } finally {
        try { abort.abort(); } catch {}
        try {
            timers.forEach((id) => clearTimeout(id));
            intervals.forEach((id) => clearInterval(id));
        } catch {}
        __taskRunMap.delete(taskName);
    }
}

// ------------- Command execution ---------
async function executeCommands(commands, taskName) {
    if (!String(commands || '').trim()) return null;
    state.isCommandGenerated = state.isExecutingTask = true;
    try {
        return await processTaskCommands(commands, taskName);
    } finally {
        setTimeout(() => { state.isCommandGenerated = state.isExecutingTask = false; }, 500);
    }
}

async function processTaskCommands(commands, taskName) {
    const jsTagRegex = /<<taskjs>>([\s\S]*?)<<\/taskjs>>/g;
    let lastIndex = 0, result = null, match;

    while ((match = jsTagRegex.exec(commands)) !== null) {
        const beforeJs = commands.slice(lastIndex, match.index).trim();
        if (beforeJs) result = await executeSlashCommand(beforeJs);

        const jsCode = match[1].trim();
        if (jsCode) {
            try { await executeTaskJS(jsCode, taskName || 'AnonymousTask'); }
            catch (error) { console.error(`[任务JS执行错误] ${error.message}`); }
        }
        lastIndex = match.index + match[0].length;
    }

    if (lastIndex === 0) {
        result = await executeSlashCommand(commands);
    } else {
        const remaining = commands.slice(lastIndex).trim();
        if (remaining) result = await executeSlashCommand(remaining);
    }
    return result;
}

function __hashStringForKey(str) {
    try {
        let hash = 5381;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
        }
        return (hash >>> 0).toString(36);
    } catch {
        return Math.random().toString(36).slice(2);
    }
}

async function executeTaskJS(jsCode, taskName = 'AnonymousTask') {
    const STscript = async (command) => {
        if (!command) return { error: "命令为空" };
        if (!command.startsWith('/')) command = '/' + command;
        return await executeSlashCommand(command);
    };

    const codeSig = __hashStringForKey(String(jsCode || ''));
    const stableKey = (String(taskName || '').trim()) || `js-${codeSig}`;

    await __runTaskSingleInstance(stableKey, async (utils) => {
        const { addListener, setTimeoutSafe, clearTimeoutSafe, setIntervalSafe, clearIntervalSafe, abortSignal } = utils;

        const originalWindowFns = {
            setTimeout: window.setTimeout,
            clearTimeout: window.clearTimeout,
            setInterval: window.setInterval,
            clearInterval: window.clearInterval,
        };

        const originals = {
            setTimeout: originalWindowFns.setTimeout.bind(window),
            clearTimeout: originalWindowFns.clearTimeout.bind(window),
            setInterval: originalWindowFns.setInterval.bind(window),
            clearInterval: originalWindowFns.clearInterval.bind(window),
            addEventListener: EventTarget.prototype.addEventListener,
            removeEventListener: EventTarget.prototype.removeEventListener,
            appendChild: Node.prototype.appendChild,
            insertBefore: Node.prototype.insertBefore,
            replaceChild: Node.prototype.replaceChild,
        };

        const timeouts = new Set();
        const intervals = new Set();
        const listeners = [];
        const createdNodes = new Set();

        window.setTimeout = function(fn, t, ...args) {
            const id = originals.setTimeout(function(...inner) {
                try { fn?.(...inner); } finally { timeouts.delete(id); }
            }, t, ...args);
            timeouts.add(id);
            return id;
        };
        window.clearTimeout = function(id) {
            originals.clearTimeout(id);
            timeouts.delete(id);
        };

        window.setInterval = function(fn, t, ...args) {
            const id = originals.setInterval(fn, t, ...args);
            intervals.add(id);
            return id;
        };
        window.clearInterval = function(id) {
            originals.clearInterval(id);
            intervals.delete(id);
        };

        EventTarget.prototype.addEventListener = function(type, listener, options) {
            listeners.push({ target: this, type, listener, options });
            return originals.addEventListener.call(this, type, listener, options);
        };
        EventTarget.prototype.removeEventListener = function(type, listener, options) {
            return originals.removeEventListener.call(this, type, listener, options);
        };

        const trackNode = (node) => { try { if (node && node.nodeType === 1) createdNodes.add(node); } catch {} };
        Node.prototype.appendChild = function(child) { trackNode(child); return originals.appendChild.call(this, child); };
        Node.prototype.insertBefore = function(newNode, refNode) { trackNode(newNode); return originals.insertBefore.call(this, newNode, refNode); };
        Node.prototype.replaceChild = function(newNode, oldNode) { trackNode(newNode); return originals.replaceChild.call(this, newNode, oldNode); };

        const restoreGlobals = () => {
            window.setTimeout = originalWindowFns.setTimeout;
            window.clearTimeout = originalWindowFns.clearTimeout;
            window.setInterval = originalWindowFns.setInterval;
            window.clearInterval = originalWindowFns.clearInterval;
            EventTarget.prototype.addEventListener = originals.addEventListener;
            EventTarget.prototype.removeEventListener = originals.removeEventListener;
            Node.prototype.appendChild = originals.appendChild;
            Node.prototype.insertBefore = originals.insertBefore;
            Node.prototype.replaceChild = originals.replaceChild;
        };

        const hardCleanup = () => {
            try { timeouts.forEach(id => originals.clearTimeout(id)); } catch {}
            try { intervals.forEach(id => originals.clearInterval(id)); } catch {}
            try {
                listeners.forEach(({ target, type, listener, options }) => {
                    originals.removeEventListener.call(target, type, listener, options);
                });
            } catch {}
            try {
                createdNodes.forEach(node => {
                    if (!node?.parentNode) return;
                    if (node.id?.startsWith('xiaobaix_') || node.tagName === 'SCRIPT' || node.tagName === 'STYLE') {
                        try { node.parentNode.removeChild(node); } catch {}
                    }
                });
            } catch {}
        };

        const runInScope = async (code) => {
            const fn = new Function(
                'STscript',
                'addListener', 'setTimeoutSafe', 'clearTimeoutSafe', 'setIntervalSafe', 'clearIntervalSafe', 'abortSignal',
                `return (async () => { ${code} })();`
            );
            return await fn(
                STscript,
                addListener,
                setTimeoutSafe,
                clearTimeoutSafe,
                setIntervalSafe,
                clearIntervalSafe,
                abortSignal
            );
        };

        try {
            await runInScope(jsCode);
        } finally {
            try { hardCleanup(); } finally { restoreGlobals(); }
        }
    }, codeSig);
}

function handleTaskMessage(event) {
    if (!event.data || event.data.source !== 'xiaobaix-iframe' || event.data.type !== 'executeTaskJS') return;
    try {
        const script = document.createElement('script');
        script.textContent = event.data.code;
        event.source.document.head.appendChild(script);
        event.source.document.head.removeChild(script);
    } catch (error) { console.error('执行任务JS失败:', error); }
}

// ------------- Chat metrics --------------
function getFloorCounts() {
    if (!Array.isArray(chat) || chat.length === 0) return { all: 0, user: 0, llm: 0 };
    let user = 0, llm = 0, all = 0;
    for (const m of chat) {
        all++;
        if (m.is_system) continue;
        if (m.is_user) user++; else llm++;
    }
    return { all, user, llm };
}
function pickFloorByType(floorType, counts) {
    switch (floorType) {
        case 'user': return Math.max(0, counts.user - 1);
        case 'llm': return Math.max(0, counts.llm - 1);
        default:     return Math.max(0, counts.all - 1);
    }
}
function calculateTurnCount() {
    if (!Array.isArray(chat) || chat.length === 0) return 0;
    const userMessages = chat.filter(msg => msg.is_user && !msg.is_system).length;
    const aiMessages = chat.filter(msg => !msg.is_user && !msg.is_system).length;
    return Math.min(userMessages, aiMessages);
}

// ------------- Task trigger core ---------
function shouldSkipByContext(taskTriggerTiming, triggerContext) {
    if (taskTriggerTiming === 'initialization') return triggerContext !== 'chat_created';
    if (taskTriggerTiming === 'plugin_init') return triggerContext !== 'plugin_initialized';
    if (taskTriggerTiming === 'chat_changed') return triggerContext !== 'chat_changed';
    if (taskTriggerTiming === 'only_this_floor' || taskTriggerTiming === 'any_message') {
        return triggerContext !== 'before_user' && triggerContext !== 'after_ai';
    }
    return taskTriggerTiming !== triggerContext;
}
function matchInterval(task, counts, triggerContext) {
    const currentFloor = pickFloorByType(task.floorType || 'all', counts);
    if (currentFloor <= 0) return false;
    if (task.triggerTiming === 'only_this_floor') return currentFloor === task.interval;
    if (task.triggerTiming === 'any_message') return currentFloor % task.interval === 0;
    return currentFloor % task.interval === 0;
}

async function checkAndExecuteTasks(triggerContext = 'after_ai', overrideChatChanged = null, overrideNewChat = null) {
    if (!isGloballyEnabled() || state.isExecutingTask) return;

    const tasks = allTasks();
    if (tasks.length === 0) return;

    const n = nowMs();
    const counts = getFloorCounts();

    const tasksToExecute = tasks.filter(task => {
        if (task.disabled) return false;
        if (isTaskInCooldown(task.name, n)) return false;

        const tt = task.triggerTiming || 'after_ai';
        // 切换聊天后：忽略间隔与楼层，只要时机匹配则执行一次
        if (tt === 'chat_changed') {
            if (shouldSkipByContext(tt, triggerContext)) return false;
            return true;
        }
        if (tt === 'initialization') return triggerContext === 'chat_created';
        if (tt === 'plugin_init') return triggerContext === 'plugin_initialized';

        if ((overrideChatChanged ?? state.chatJustChanged) || (overrideNewChat ?? state.isNewChat)) return false;
        if (task.interval <= 0) return false;

        if (shouldSkipByContext(tt, triggerContext)) return false;
        return matchInterval(task, counts, triggerContext);
    });

    for (const task of tasksToExecute) {
        state.taskLastExecutionTime.set(task.name, n);
        await executeCommands(task.commands, task.name);
    }

    if (triggerContext === 'after_ai') state.lastTurnCount = calculateTurnCount();
}

// ------------- Event handlers ------------
async function onMessageReceived(messageId) {
    if (typeof messageId !== 'number' || messageId < 0 || !chat[messageId]) return;
    const message = chat[messageId];
    if (message.is_user || message.is_system || message.mes === '...' ||
        state.isCommandGenerated || state.isExecutingTask ||
        (message.swipe_id !== undefined && message.swipe_id > 0)) return;

    if (!isGloballyEnabled()) return;

    const messageKey = `${getContext().chatId}_${messageId}_${message.send_date || nowMs()}`;
    if (isMessageProcessed(messageKey)) return;

    markMessageAsProcessed(messageKey);
    await checkAndExecuteTasks('after_ai');
    state.chatJustChanged = state.isNewChat = false;
}

async function onUserMessage() {
    if (!isGloballyEnabled()) return;
    const messageKey = `${getContext().chatId}_user_${chat.length}`;
    if (isMessageProcessed(messageKey)) return;

    markMessageAsProcessed(messageKey);
    await checkAndExecuteTasks('before_user');
    state.chatJustChanged = state.isNewChat = false;
}

function onMessageDeleted() {
    const settings = getSettings();
    const chatId = getContext().chatId;
    settings.processedMessages = settings.processedMessages.filter(key => !key.startsWith(`${chatId}_`));
    state.processedMessagesSet = new Set(settings.processedMessages);
    state.isExecutingTask = state.isCommandGenerated = false;
    debouncedSave();
}

async function onChatChanged(chatId) {
    Object.assign(state, {
        chatJustChanged: true,
        isNewChat: state.lastChatId !== chatId && chat.length <= 1,
        lastChatId: chatId,
        lastTurnCount: 0,
        isExecutingTask: false,
        isCommandGenerated: false
    });
    state.taskLastExecutionTime.clear();

    const settings = getSettings();
    settings.processedMessages = settings.processedMessages.filter(key => !key.startsWith(`${chatId}_`));
    state.processedMessagesSet = new Set(settings.processedMessages);
    debouncedSave();

    checkEmbeddedTasks();
    refreshUI();
    try { await checkAndExecuteTasks('chat_changed', false, false); } catch (e) { console.debug(e); }
    setTimeout(() => { state.chatJustChanged = state.isNewChat = false; }, 2000);
}

async function onChatCreated() {
    await checkAndExecuteTasks('chat_created', false, false);
}

// ------------- UI: lists & items ----------
function getTasksHash() {
    const tasks = [...getSettings().globalTasks, ...getCharacterTasks()];
    return tasks.map(t => `${t.id}_${t.disabled}_${t.name}_${t.interval}_${t.floorType}_${t.triggerTiming || 'after_ai'}`).join('|');
}

function createTaskItem(task, index, isCharacterTask = false) {
    if (!task.id) task.id = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const taskType = isCharacterTask ? 'character' : 'global';
	const floorTypeText = { user: '用户楼层', llm: 'LLM楼层' }[task.floorType] || '全部楼层';
	const triggerTimingText = { before_user: '用户前', any_message: '任意对话', initialization: '角色卡初始化', plugin_init: '插件初始化', only_this_floor: '仅该楼层', chat_changed: '切换聊天后' }[task.triggerTiming] || 'AI后';

    let displayName;
	if (task.interval === 0) displayName = `${task.name} (手动触发)`;
	else if (task.triggerTiming === 'initialization') displayName = `${task.name} (角色卡初始化)`;
	else if (task.triggerTiming === 'plugin_init') displayName = `${task.name} (插件初始化)`;
	else if (task.triggerTiming === 'chat_changed') displayName = `${task.name} (切换聊天后)`;
    else if (task.triggerTiming === 'only_this_floor') displayName = `${task.name} (仅第${task.interval}${floorTypeText})`;
    else displayName = `${task.name} (每${task.interval}${floorTypeText}·${triggerTimingText})`;

    const taskElement = $('#task_item_template').children().first().clone();
    taskElement.attr({ id: task.id, 'data-index': index, 'data-type': taskType });
    taskElement.find('.task_name').attr('title', task.commands).text(displayName);
    taskElement.find('.disable_task').attr('id', `task_disable_${task.id}`).prop('checked', task.disabled);
    taskElement.find('label.checkbox').attr('for', `task_disable_${task.id}`);

    taskElement.find('.disable_task').on('input', () => {
        task.disabled = taskElement.find('.disable_task').prop('checked');
        saveTask(task, index, isCharacterTask);
    });
    taskElement.find('.edit_task').on('click', () => editTask(index, taskType));
    taskElement.find('.export_task').on('click', () => exportSingleTask(index, isCharacterTask));
    taskElement.find('.delete_task').on('click', () => deleteTask(index, taskType));

    return taskElement;
}

function initSortable($list, onUpdate) {
    const inst = (() => { try { return $list.sortable('instance'); } catch { return undefined; } })();
    if (inst) return;
    $list.sortable({
        delay: getSortableDelay?.() || 0,
        handle: '.drag-handle.menu-handle',
        items: '> .task-item',
        update: onUpdate
    });
}

function refreshTaskLists() {
    const currentHash = getTasksHash();
    if (currentHash === state.lastTasksHash) {
        updateTaskBar();
        return;
    }
    state.lastTasksHash = currentHash;

    const $globalList = $('#global_tasks_list');
    const $charList = $('#character_tasks_list');
    const globalTasks = getSettings().globalTasks;
    const characterTasks = getCharacterTasks();

    $globalList.empty();
    globalTasks.forEach((task, i) => $globalList.append(createTaskItem(task, i, false)));

    initSortable($globalList, function () {
        const newOrderIds = $globalList.sortable('toArray');
        const current = getSettings().globalTasks;
        const idToTask = new Map(current.map(t => [t.id, t]));
        const reordered = newOrderIds.map(id => idToTask.get(id)).filter(Boolean);
        const leftovers = current.filter(t => !newOrderIds.includes(t.id));
        getSettings().globalTasks = [...reordered, ...leftovers];
        debouncedSave();
        refreshTaskLists();
    });

    $charList.empty();
    characterTasks.forEach((task, i) => $charList.append(createTaskItem(task, i, true)));

    initSortable($charList, async function () {
        const newOrderIds = $charList.sortable('toArray');
        const current = getCharacterTasks();
        const idToTask = new Map(current.map(t => [t.id, t]));
        const reordered = newOrderIds.map(id => idToTask.get(id)).filter(Boolean);
        const leftovers = current.filter(t => !newOrderIds.includes(t.id));
        await saveCharacterTasks([...reordered, ...leftovers]);
        refreshTaskLists();
    });

    updateTaskBar();
}

// ------------- Task bar -------------------
const getActivatedTasks = () => allTasks().filter(t => t.buttonActivated && !t.disabled);

function createTaskBar() {
    const activatedTasks = getActivatedTasks();
    const signature = state.taskBarVisible ? activatedTasks.map(t => `${t.name}`).join('|') : 'hidden';
    if (signature === state.taskBarSignature) return;
    state.taskBarSignature = signature;

    $('#xiaobaix_task_bar').remove();
    if (activatedTasks.length === 0 || !state.taskBarVisible) return;

    const taskBar = $(`
        <div id="xiaobaix_task_bar">
            <div style="display: flex; flex-wrap: wrap; gap: 5px; justify-content: center; border: 1px solid var(--SmartThemeBorderColor); border-bottom:0;">
            </div>
        </div>
    `);

    const buttonContainer = taskBar.find('div').first();
    activatedTasks.forEach(task => {
        const button = $(`
            <button class="menu_button menu_button_icon xiaobaix-task-button"
                    data-task-name="${task.name}" style="margin:1px;">
                <span>${task.name}</span>
            </button>
        `);
        button.on('click', async () => {
            try { await window.xbqte(task.name); }
            catch (error) { console.error(`执行任务失败: ${error.message}`); }
        });
        buttonContainer.append(button);
    });

    const sendForm = $('#send_form');
    if (sendForm.length > 0) sendForm.before(taskBar);
}

const updateTaskBar = () => createTaskBar();

function toggleTaskBarVisibility() {
    state.taskBarVisible = !state.taskBarVisible;
    updateTaskBar();
    const toggleButton = $('#toggle_task_bar');
    const smallText = toggleButton.find('small');
    if (state.taskBarVisible) {
        smallText.css({ 'opacity': '1', 'text-decoration': 'none' });
        toggleButton.attr('title', '隐藏任务栏');
    } else {
        smallText.css({ 'opacity': '0.5', 'text-decoration': 'line-through' });
        toggleButton.attr('title', '显示任务栏');
    }
}

// ------------- Editor ---------------------
function showTaskEditor(task = null, isEdit = false, isCharacterTask = false) {
    state.currentEditingTask = task;
    state.currentEditingIndex = isEdit ? (isCharacterTask ? getCharacterTasks() : getSettings().globalTasks).indexOf(task) : -1;

    const editorTemplate = $('#task_editor_template').clone().removeAttr('id').show();
    editorTemplate.find('.task_name_edit').val(task?.name || '');
    editorTemplate.find('.task_commands_edit').val(task?.commands || '');
    editorTemplate.find('.task_interval_edit').val(task?.interval ?? 3);
    editorTemplate.find('.task_floor_type_edit').val(task?.floorType || 'all');
    editorTemplate.find('.task_trigger_timing_edit').val(task?.triggerTiming || 'after_ai');
    editorTemplate.find('.task_type_edit').val(isCharacterTask ? 'character' : 'global');
    editorTemplate.find('.task_enabled_edit').prop('checked', !task?.disabled);
    editorTemplate.find('.task_button_activated_edit').prop('checked', task?.buttonActivated || false);

    function updateWarningDisplay() {
        const interval = parseInt(editorTemplate.find('.task_interval_edit').val()) || 0;
        const triggerTiming = editorTemplate.find('.task_trigger_timing_edit').val();
        const floorType = editorTemplate.find('.task_floor_type_edit').val();

        let warningElement = editorTemplate.find('.trigger-timing-warning');
        if (warningElement.length === 0) {
            warningElement = $('<div class="trigger-timing-warning" style="color:#ff6b6b;font-size:.8em;margin-top:4px;"></div>');
            editorTemplate.find('.task_trigger_timing_edit').parent().append(warningElement);
        }

        const shouldShowWarning = interval > 0 && floorType === 'all' &&
                                 (triggerTiming === 'after_ai' || triggerTiming === 'before_user');
        if (shouldShowWarning) {
            warningElement.html('⚠️ 警告：选择"全部楼层"配合"AI消息后"或"用户消息前"可能因楼层编号不匹配而不触发').show();
        } else {
            warningElement.hide();
        }
    }

    function updateControlStates() {
        const interval = parseInt(editorTemplate.find('.task_interval_edit').val()) || 0;
        const triggerTiming = editorTemplate.find('.task_trigger_timing_edit').val();

        const intervalControl = editorTemplate.find('.task_interval_edit');
        const floorTypeControl = editorTemplate.find('.task_floor_type_edit');
        const triggerTimingControl = editorTemplate.find('.task_trigger_timing_edit');

        if (interval === 0) {
            floorTypeControl.prop('disabled', true).css('opacity', '0.5');
            triggerTimingControl.prop('disabled', true).css('opacity', '0.5');
            let manualTriggerHint = editorTemplate.find('.manual-trigger-hint');
            if (manualTriggerHint.length === 0) {
                manualTriggerHint = $('<small class="manual-trigger-hint" style="color:#888;">手动触发</small>');
                triggerTimingControl.parent().append(manualTriggerHint);
            }
            manualTriggerHint.show();
        } else {
            floorTypeControl.prop('disabled', false).css('opacity', '1');
            triggerTimingControl.prop('disabled', false).css('opacity', '1');
            editorTemplate.find('.manual-trigger-hint').hide();

            if (triggerTiming === 'initialization' || triggerTiming === 'plugin_init' || triggerTiming === 'chat_changed') {
                intervalControl.prop('disabled', true).css('opacity', '0.5');
                floorTypeControl.prop('disabled', true).css('opacity', '0.5');
            } else {
                intervalControl.prop('disabled', false).css('opacity', '1');
                floorTypeControl.prop('disabled', false).css('opacity', '1');
            }
        }
        updateWarningDisplay();
    }

    editorTemplate.find('.task_interval_edit').on('input', updateControlStates);
    editorTemplate.find('.task_trigger_timing_edit').on('change', updateControlStates);
    editorTemplate.find('.task_floor_type_edit').on('change', updateControlStates);
    updateControlStates();

    // 改为 callGenericPopup
    callGenericPopup(editorTemplate, POPUP_TYPE.CONFIRM, '', { okButton: '保存' }).then(result => {
        if (result) {
            const desiredName = (editorTemplate.find('.task_name_edit').val() || '').trim();
            const existingNames = new Set(allTasks().map(t => (t?.name || '').trim().toLowerCase()));
            let uniqueName = desiredName;
            if (desiredName && (!isEdit || (isEdit && task?.name?.toLowerCase() !== desiredName.toLowerCase()))) {
                if (existingNames.has(desiredName.toLowerCase())) {
                    let idx = 1;
                    while (existingNames.has(`${desiredName}${idx}`.toLowerCase())) idx++;
                    uniqueName = `${desiredName}${idx}`;
                }
            }

            const newTask = {
                id: task?.id || `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                name: uniqueName,
                commands: editorTemplate.find('.task_commands_edit').val().trim(),
                interval: parseInt(editorTemplate.find('.task_interval_edit').val()) || 0,
                floorType: editorTemplate.find('.task_floor_type_edit').val() || 'all',
                triggerTiming: editorTemplate.find('.task_trigger_timing_edit').val() || 'after_ai',
                disabled: !editorTemplate.find('.task_enabled_edit').prop('checked'),
                buttonActivated: editorTemplate.find('.task_button_activated_edit').prop('checked'),
                createdAt: task?.createdAt || new Date().toISOString()
            };
            saveTaskFromEditor(newTask, editorTemplate.find('.task_type_edit').val() === 'character');
        }
    });
}

function saveTaskFromEditor(task, isCharacterTask) {
    if (!task.name || !task.commands) return;
    if (isCharacterTask) {
        const tasks = getCharacterTasks();
        if (state.currentEditingIndex >= 0) tasks[state.currentEditingIndex] = task;
        else tasks.push(task);
        saveCharacterTasks(tasks);
    } else {
        const settings = getSettings();
        if (state.currentEditingIndex >= 0) settings.globalTasks[state.currentEditingIndex] = task;
        else settings.globalTasks.push(task);
        debouncedSave();
    }
    refreshUI();
}

function saveTask(task, index, isCharacterTask) {
    const tasks = isCharacterTask ? getCharacterTasks() : getSettings().globalTasks;
    if (index >= 0 && index < tasks.length) tasks[index] = task;
    if (isCharacterTask) saveCharacterTasks(tasks);
    else debouncedSave();
    refreshUI();
}

async function testTask(index, type) {
    const task = (type === 'character' ? getCharacterTasks() : getSettings().globalTasks)[index];
    if (task) await executeCommands(task.commands, task.name);
}

function editTask(index, type) {
    const task = (type === 'character' ? getCharacterTasks() : getSettings().globalTasks)[index];
    if (task) showTaskEditor(task, true, type === 'character');
}

function deleteTask(index, type) {
    const task = (type === 'character' ? getCharacterTasks() : getSettings().globalTasks)[index];
    if (!task) return;

    $(document).off('keydown.confirmmodal');
    $('.xiaobaix-confirm-modal').remove();

    const dialogHtml = `
    <div class="xiaobaix-confirm-modal">
        <div class="xiaobaix-confirm-content">
            <div class="xiaobaix-confirm-message">确定要删除任务 "${task.name}" 吗？</div>
            <div class="xiaobaix-confirm-buttons">
                <button class="xiaobaix-confirm-yes">确定</button>
                <button class="xiaobaix-confirm-no">取消</button>
            </div>
        </div>
    </div>`;

    $('body').append(dialogHtml);

    $('.xiaobaix-confirm-yes').on('click', function() {
        $('.xiaobaix-confirm-modal').remove();
        if (type === 'character') {
            const tasks = getCharacterTasks();
            tasks.splice(index, 1);
            saveCharacterTasks(tasks);
        } else {
            getSettings().globalTasks.splice(index, 1);
            debouncedSave();
        }
        refreshUI();
    });

    $('.xiaobaix-confirm-no, .xiaobaix-confirm-modal').on('click', function(e) {
        if (e.target === this) $('.xiaobaix-confirm-modal').remove();
    });

    $(document).on('keydown.confirmmodal', function(e) {
        if (e.key === 'Escape') {
            $('.xiaobaix-confirm-modal').remove();
            $(document).off('keydown.confirmmodal');
        }
    });
}

const getAllTaskNames = () => allTasks().filter(t => !t.disabled).map(t => t.name);

// ------------- Embedded tasks -------------
async function checkEmbeddedTasks() {
    if (!this_chid) return;
    const avatar = characters[this_chid]?.avatar;
    const tasks = characters[this_chid]?.data?.extensions?.[TASKS_MODULE_NAME]?.tasks;

    if (Array.isArray(tasks) && tasks.length > 0 && avatar) {
        const settings = getSettings();
        settings.character_allowed_tasks ??= [];

        if (!settings.character_allowed_tasks.includes(avatar)) {
            const checkKey = `AlertTasks_${avatar}`;
            if (!accountStorage.getItem(checkKey)) {
                accountStorage.setItem(checkKey, 'true');
                let result;
                try {
                    const templateFilePath = `scripts/extensions/third-party/LittleWhiteBox/embeddedTasks.html`;
                    const templateContent = await fetch(templateFilePath).then(r => r.text());
                    const templateElement = $(templateContent);
                    const taskListContainer = templateElement.find('#embedded-tasks-list');
                    tasks.forEach(task => {
                        const taskPreview = $('#task_preview_template').children().first().clone();
                        taskPreview.find('.task-preview-name').text(task.name);
                        taskPreview.find('.task-preview-interval').text(`(每${task.interval}回合)`);
                        taskPreview.find('.task-preview-commands').text(task.commands);
                        taskListContainer.append(taskPreview);
                    });
                    result = await callGenericPopup(templateElement, POPUP_TYPE.CONFIRM, '', { okButton: '允许' });
                } catch {
                    result = await callGenericPopup(`此角色包含 ${tasks.length} 个定时任务。是否允许使用？`, POPUP_TYPE.CONFIRM, '', { okButton: '允许' });
                }
                if (result) {
                    settings.character_allowed_tasks.push(avatar);
                    debouncedSave();
                }
            }
        }
    }
    refreshTaskLists();
}

// ------------- Import/Export --------------
async function exportGlobalTasks() {
    const tasks = getSettings().globalTasks;
    if (tasks.length === 0) return;
    const fileName = `global_tasks_${new Date().toISOString().split('T')[0]}.json`;
    const fileData = JSON.stringify({ type: 'global', exportDate: new Date().toISOString(), tasks }, null, 4);
    download(fileData, fileName, 'application/json');
}

function exportSingleTask(index, isCharacterTask) {
    const tasks = isCharacterTask ? getCharacterTasks() : getSettings().globalTasks;
    if (index < 0 || index >= tasks.length) return;
    const task = tasks[index];
    const type = isCharacterTask ? 'character' : 'global';
    const fileName = `${type}_task_${task?.name || 'unnamed'}_${new Date().toISOString().split('T')[0]}.json`;
    const fileData = JSON.stringify({ type, exportDate: new Date().toISOString(), tasks: [task] }, null, 4);
    download(fileData, fileName, 'application/json');
}

async function importGlobalTasks(file) {
    if (!file) return;
    try {
        const fileText = await getFileText(file);
        const raw = JSON.parse(fileText);
        let incomingTasks = [];
        // 识别文件类型（默认全局）
        let fileType = 'global';
        if (Array.isArray(raw)) {
            incomingTasks = raw;
            fileType = 'global';
        } else if (Array.isArray(raw?.tasks)) {
            incomingTasks = raw.tasks;
            if (raw?.type === 'character' || raw?.type === 'global') fileType = raw.type;
        } else if (raw && typeof raw === 'object' && raw.name && (raw.commands || raw.interval !== undefined)) {
            incomingTasks = [raw];
            if (raw?.type === 'character' || raw?.type === 'global') fileType = raw.type;
        }

        if (!Array.isArray(incomingTasks) || incomingTasks.length === 0) throw new Error('无效的任务文件格式');

        incomingTasks = incomingTasks.filter(t => (t?.name || '').trim() && (String(t?.commands || '').trim() || t.interval === 0));
        const tasksToImport = incomingTasks.map(task => ({
            id: uuidv4(),
            name: String(task.name || '').trim(),
            commands: String(task.commands || '').trim(),
            interval: clampInt(task.interval, 0, 99999, 0),
            floorType: ['all', 'user', 'llm'].includes(task.floorType) ? task.floorType : 'all',
            triggerTiming: ['after_ai','before_user','any_message','initialization','plugin_init','only_this_floor','chat_changed'].includes(task.triggerTiming)
                ? task.triggerTiming : (task.interval === 0 ? 'after_ai' : 'after_ai'),
            disabled: !!task.disabled,
            buttonActivated: !!task.buttonActivated,
            createdAt: task.createdAt || new Date().toISOString(),
            importedAt: new Date().toISOString(),
        }));

        if (fileType === 'character') {
            if (!this_chid || !characters[this_chid]) {
                await callGenericPopup('请选择角色导入。', POPUP_TYPE.TEXT, '', { okButton: '确定' });
                return;
            }
            const current = getCharacterTasks();
            await saveCharacterTasks([...current, ...tasksToImport]);
        } else {
            const settings = getSettings();
            settings.globalTasks = [...settings.globalTasks, ...tasksToImport];
            debouncedSave();
        }
        refreshTaskLists();
    } catch (error) {
        console.error('任务导入失败:', error);
    }
}

// ------------- Tools / Debug -------------
function clearProcessedMessages() {
    getSettings().processedMessages = [];
    state.processedMessagesSet.clear();
    debouncedSave();
}
function clearTaskCooldown(taskName = null) { taskName ? state.taskLastExecutionTime.delete(taskName) : state.taskLastExecutionTime.clear(); }
function getTaskCooldownStatus() {
    const status = {};
    for (const [taskName, lastTime] of state.taskLastExecutionTime.entries()) {
        const remaining = Math.max(0, CONFIG.TASK_COOLDOWN - (nowMs() - lastTime));
        status[taskName] = { lastExecutionTime: lastTime, remainingCooldown: remaining, isInCooldown: remaining > 0 };
    }
    return status;
}
function getMemoryUsage() {
    return {
        processedMessages: getSettings().processedMessages.length,
        taskCooldowns: state.taskLastExecutionTime.size,
        globalTasks: getSettings().globalTasks.length,
        characterTasks: getCharacterTasks().length,
        maxProcessedMessages: CONFIG.MAX_PROCESSED,
        maxCooldownEntries: CONFIG.MAX_COOLDOWN
    };
}

// ------------- UI Refresh/Cleanup --------
function refreshUI() { refreshTaskLists(); updateTaskBar(); }

function cleanup() {
    if (state.cleanupTimer) {
        clearInterval(state.cleanupTimer);
        state.cleanupTimer = null;
    }
    state.taskLastExecutionTime.clear();

    [event_types.CHARACTER_MESSAGE_RENDERED, event_types.USER_MESSAGE_RENDERED,
     event_types.CHAT_CHANGED, event_types.CHAT_CREATED, event_types.MESSAGE_DELETED,
     event_types.MESSAGE_SWIPED, event_types.CHARACTER_DELETED].forEach(eventType => {
        eventSource.removeListener(eventType);
    });

    window.removeEventListener('message', handleTaskMessage);
    $(window).off('beforeunload', cleanup);
}

// ------------- Public API ----------------
window.xbqte = async (name) => {
    try {
        if (!name?.trim()) throw new Error('请提供任务名称');
        const task = allTasks().find(t => t.name.toLowerCase() === name.toLowerCase());
        if (!task) throw new Error(`找不到名为 "${name}" 的任务`);
        if (task.disabled) throw new Error(`任务 "${name}" 已被禁用`);
        if (isTaskInCooldown(task.name)) {
            const cd = getTaskCooldownStatus()[task.name];
            throw new Error(`任务 "${name}" 仍在冷却中，剩余 ${cd.remainingCooldown}ms`);
        }
        setTaskCooldown(task.name);
        const result = await executeCommands(task.commands, task.name);
        return result || `已执行任务: ${task.name}`;
    } catch (error) {
        console.error(`执行任务失败: ${error.message}`);
        throw error;
    }
};

window.setScheduledTaskInterval = async (name, interval) => {
    if (!name?.trim()) throw new Error('请提供任务名称');
    const intervalNum = parseInt(interval);
    if (isNaN(intervalNum) || intervalNum < 0 || intervalNum > 99999) {
        throw new Error('间隔必须是 0-99999 之间的数字');
    }

    const settings = getSettings();
    const gi = settings.globalTasks.findIndex(t => t.name.toLowerCase() === name.toLowerCase());
    if (gi !== -1) {
        settings.globalTasks[gi].interval = intervalNum;
        debouncedSave();
        refreshTaskLists();
        return `已设置全局任务 "${name}" 的间隔为 ${intervalNum === 0 ? '手动激活' : `每${intervalNum}楼层`}`;
    }

    const cts = getCharacterTasks();
    const ci = cts.findIndex(t => t.name.toLowerCase() === name.toLowerCase());
    if (ci !== -1) {
        cts[ci].interval = intervalNum;
        await saveCharacterTasks(cts);
        refreshTaskLists();
        return `已设置角色任务 "${name}" 的间隔为 ${intervalNum === 0 ? '手动激活' : `每${intervalNum}楼层`}`;
    }
    throw new Error(`找不到名为 "${name}" 的任务`);
};

Object.assign(window, {
    clearTasksProcessedMessages: clearProcessedMessages,
    clearTaskCooldown,
    getTaskCooldownStatus,
    getTasksMemoryUsage: getMemoryUsage
});

// ------------- Slash commands -------------
function registerSlashCommands() {
    try {
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'xbqte',
            callback: async (args, value) => {
                if (!value) return '请提供任务名称。用法: /xbqte 任务名称';
                try { return await window.xbqte(value); }
                catch (error) { return `错误: ${error.message}`; }
            },
            unnamedArgumentList: [SlashCommandArgument.fromProps({
                description: '要执行的任务名称',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
                enumProvider: getAllTaskNames
            })],
            helpString: '执行指定名称的定时任务。例如: /xbqte 我的任务名称'
        }));

        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'xbset',
            callback: async (args, value) => {
                const valueStr = String(value || '').trim();
                const parts = valueStr.split(/\s+/);
                if (!parts || parts.length < 2) {
                    return '用法: /xbset 任务名称 间隔数字\n例如: /xbset 我的任务 5\n设为0表示手动激活';
                }
                const interval = parts.pop();
                const taskName = parts.join(' ');
                try { return await window.setScheduledTaskInterval(taskName, interval); }
                catch (error) { return `错误: ${error.message}`; }
            },
            unnamedArgumentList: [SlashCommandArgument.fromProps({
                description: '任务名称 间隔数字',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true
            })],
            helpString: '设置定时任务的触发间隔。用法: /xbset 任务名称 间隔数字\n例如: /xbset 我的任务 5 (每5楼层触发)\n设为0表示手动激活'
        }));
    } catch (error) {
        console.error("Error registering slash commands:", error);
    }
}

// ------------- Init -----------------------
function initTasks() {
    hydrateProcessedSetFromSettings();
    scheduleCleanup();

    if (!extension_settings[EXT_ID].tasks) {
        extension_settings[EXT_ID].tasks = structuredClone(defaultSettings);
    }

    if (window.registerModuleCleanup) {
        window.registerModuleCleanup('scheduledTasks', cleanup);
    }

    window.addEventListener('message', handleTaskMessage);

    $('#scheduled_tasks_enabled').on('input', e => {
        if (!isGloballyEnabled()) return;
        const enabled = $(e.target).prop('checked');
        getSettings().enabled = enabled;
        debouncedSave();
        if (!enabled) cleanup();
    });

    $('#add_global_task').on('click', () => showTaskEditor(null, false, false));
    $('#add_character_task').on('click', () => showTaskEditor(null, false, true));
    $('#toggle_task_bar').on('click', toggleTaskBarVisibility);
    $('#import_global_tasks').on('click', () => $('#import_tasks_file').trigger('click'));
    $('#import_tasks_file').on('change', function(e) {
        const file = e.target.files[0];
        if (file) {
            importGlobalTasks(file);
            $(this).val('');
        }
    });

    $('#scheduled_tasks_enabled').prop('checked', getSettings().enabled);
    refreshTaskLists();

    setTimeout(() => updateTaskBar(), 1000);

    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onMessageReceived);
    eventSource.on(event_types.USER_MESSAGE_RENDERED, onUserMessage);
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    eventSource.on(event_types.CHAT_CREATED, onChatCreated);
    eventSource.on(event_types.MESSAGE_DELETED, onMessageDeleted);
    eventSource.on(event_types.MESSAGE_SWIPED, () => {
        state.isExecutingTask = state.isCommandGenerated = false;
    });
    eventSource.on(event_types.CHARACTER_DELETED, ({ character }) => {
        const avatar = character?.avatar;
        const settings = getSettings();
        if (avatar && settings.character_allowed_tasks?.includes(avatar)) {
            const index = settings.character_allowed_tasks.indexOf(avatar);
            if (index !== -1) {
                settings.character_allowed_tasks.splice(index, 1);
                debouncedSave();
            }
        }
    });

    $(window).on('beforeunload', cleanup);
    registerSlashCommands();
    setTimeout(() => checkEmbeddedTasks(), 1000);

    setTimeout(() => { try { checkAndExecuteTasks('plugin_initialized', false, false); } catch (e) { console.debug(e); } }, 0);
}

export { initTasks };
