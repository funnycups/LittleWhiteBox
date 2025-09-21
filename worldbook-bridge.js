// @ts-nocheck

// Host Bridge for worldbook (lorebook) operations
// Semantics aligned with STscript commands, implemented via lower-level APIs.

import { eventSource, event_types } from "../../../../script.js";
import { getContext } from "../../../st-context.js";
import {
    loadWorldInfo,
    saveWorldInfo,
    reloadEditor,
    updateWorldInfoList,
    createNewWorldInfo,
    createWorldInfoEntry,
    deleteWorldInfoEntry,
    newWorldInfoEntryTemplate,
    setWIOriginalDataValue,
    originalWIDataKeyMap,
    METADATA_KEY,
    world_info,
    selected_world_info,
    world_names,
    onWorldInfoChange,
} from "../../../world-info.js";
import { getCharaFilename, findChar } from "../../../utils.js";

const SOURCE_TAG = "xiaobaix-host";

function isString(value) {
    return typeof value === 'string';
}

function parseStringArray(input) {
    if (input === undefined || input === null) return [];
    const str = String(input).trim();
    try {
        if (str.startsWith('[')) {
            const arr = JSON.parse(str);
            return Array.isArray(arr) ? arr.map(x => String(x).trim()).filter(Boolean) : [];
        }
    } catch {}
    return str.split(',').map(x => x.trim()).filter(Boolean);
}

function isTrueBoolean(value) {
    const v = String(value).trim().toLowerCase();
    return v === 'true' || v === '1' || v === 'on' || v === 'yes';
}

function isFalseBoolean(value) {
    const v = String(value).trim().toLowerCase();
    return v === 'false' || v === '0' || v === 'off' || v === 'no';
}

function ensureTimedWorldInfo(ctx) {
    if (!ctx.chatMetadata.timedWorldInfo) ctx.chatMetadata.timedWorldInfo = {};
    return ctx.chatMetadata.timedWorldInfo;
}

class WorldbookBridgeService {
    constructor() {
        this._listener = null;
        this._forwardEvents = false;
        this._attached = false;
    }

    normalizeError(err, fallbackCode = 'API_ERROR', details = null) {
        try {
            if (!err) return { code: fallbackCode, message: 'Unknown error', details };
            if (typeof err === 'string') return { code: fallbackCode, message: err, details };
            const msg = err?.message || String(err);
            return { code: fallbackCode, message: msg, details };
        } catch {
            return { code: fallbackCode, message: 'Error serialization failed', details };
        }
    }

    sendResult(target, requestId, result) {
        try { target?.postMessage({ source: SOURCE_TAG, type: 'worldbookResult', id: requestId, result }, '*'); } catch {}
    }

    sendError(target, requestId, err, fallbackCode = 'API_ERROR', details = null) {
        const e = this.normalizeError(err, fallbackCode, details);
        try { target?.postMessage({ source: SOURCE_TAG, type: 'worldbookError', id: requestId, error: e }, '*'); } catch {}
    }

    postEvent(event, payload) {
        try { window?.postMessage({ source: SOURCE_TAG, type: 'worldbookEvent', event, payload }, '*'); } catch {}
    }

    async ensureWorldExists(name, autoCreate) {
        if (!isString(name) || !name.trim()) throw new Error('MISSING_PARAMS');
        if (world_names?.includes(name)) return name;
        if (!autoCreate) throw new Error(`Worldbook not found: ${name}`);
        await createNewWorldInfo(name, { interactive: false });
        await updateWorldInfoList();
        return name;
    }

    // ===== Basic actions =====
    async getChatBook(params) {
        const ctx = getContext();
        const name = ctx.chatMetadata?.[METADATA_KEY];
        if (name && world_names?.includes(name)) return name;
        const desired = isString(params?.name) ? String(params.name) : null;
        const newName = desired && !world_names.includes(desired)
            ? desired
            : `Chat Book ${ctx.getCurrentChatId?.() || ''}`.replace(/[^a-z0-9]/gi, '_').replace(/_{2,}/g, '_').substring(0, 64);
        await createNewWorldInfo(newName, { interactive: false });
        ctx.chatMetadata[METADATA_KEY] = newName;
        await ctx.saveMetadata();
        return newName;
    }

    async getGlobalBooks() {
        if (!selected_world_info?.length) return JSON.stringify([]);
        return JSON.stringify(selected_world_info.slice());
    }

    async listWorldbooks() {
        return Array.isArray(world_names) ? world_names.slice() : [];
    }

    async getPersonaBook() {
        const ctx = getContext();
        return ctx.powerUserSettings?.persona_description_lorebook || '';
    }

    async getCharBook(params) {
        const ctx = getContext();
        const type = String(params?.type ?? 'primary').toLowerCase();
        let characterName = params?.name ?? null;
        if (!characterName) {
            const active = ctx.characters?.[ctx.characterId];
            characterName = active?.avatar || active?.name || '';
        }
        const character = findChar({ name: characterName, allowAvatar: true, preferCurrentChar: false, quiet: true });
        if (!character) return type === 'primary' ? '' : JSON.stringify([]);

        const books = [];
        if (type === 'all' || type === 'primary') {
            books.push(character.data?.extensions?.world);
        }
        if (type === 'all' || type === 'additional') {
            const fileName = getCharaFilename(null, { manualAvatarKey: character.avatar });
            const extraCharLore = world_info.charLore?.find((e) => e.name === fileName);
            if (extraCharLore && Array.isArray(extraCharLore.extraBooks)) books.push(...extraCharLore.extraBooks);
        }
        if (type === 'primary') return books[0] ?? '';
        return JSON.stringify(books.filter(Boolean));
    }

    async world(params) {
        const state = params?.state ?? undefined; // 'on'|'off'|'toggle'|undefined
        const silent = !!params?.silent;
        const name = isString(params?.name) ? params.name : '';
        // Use internal callback to ensure parity with STscript behavior
        await onWorldInfoChange({ state, silent }, name);
        return '';
    }

    // ===== Entries =====
    async findEntry(params) {
        const file = params?.file;
        const field = params?.field || 'key';
        const text = String(params?.text ?? '').trim();
        if (!file || !world_names.includes(file)) throw new Error('VALIDATION_FAILED: file');
        const data = await loadWorldInfo(file);
        if (!data || !data.entries) return '';
        const entries = Object.values(data.entries);
        if (!entries.length) return '';

        let needle = text;
        if (typeof newWorldInfoEntryTemplate[field] === 'boolean') {
            if (isTrueBoolean(text)) needle = 'true';
            else if (isFalseBoolean(text)) needle = 'false';
        }

        let FuseRef = null;
        try { FuseRef = window?.Fuse || Fuse; } catch {}
        if (FuseRef) {
            const fuse = new FuseRef(entries, { keys: [{ name: field, weight: 1 }], includeScore: true, threshold: 0.3 });
            const results = fuse.search(needle);
            const uid = results?.[0]?.item?.uid;
            return uid === undefined ? '' : String(uid);
        } else {
            // Fallback: simple includes on stringified field
            const f = entries.find(e => String((Array.isArray(e[field]) ? e[field].join(' ') : e[field]) ?? '').toLowerCase().includes(needle.toLowerCase()));
            return f?.uid !== undefined ? String(f.uid) : '';
        }
    }

    async getEntryField(params) {
        const file = params?.file;
        const field = params?.field || 'content';
        const uid = String(params?.uid ?? '').trim();
        if (!file || !world_names.includes(file)) throw new Error('VALIDATION_FAILED: file');
        const data = await loadWorldInfo(file);
        if (!data || !data.entries) return '';
        const entry = data.entries[uid];
        if (!entry) return '';
        if (newWorldInfoEntryTemplate[field] === undefined) return '';

        const ctx = getContext();
        const tags = ctx.tags || [];

        let fieldValue;
        switch (field) {
            case 'characterFilterNames':
                fieldValue = entry.characterFilter ? entry.characterFilter.names : undefined;
                if (Array.isArray(fieldValue)) {
                    // Map avatar keys back to friendly names if possible (best-effort)
                    return JSON.stringify(fieldValue.slice());
                }
                break;
            case 'characterFilterTags':
                fieldValue = entry.characterFilter ? entry.characterFilter.tags : undefined;
                if (!Array.isArray(fieldValue)) return '';
                return JSON.stringify(tags.filter(tag => fieldValue.includes(tag.id)).map(tag => tag.name));
            case 'characterFilterExclude':
                fieldValue = entry.characterFilter ? entry.characterFilter.isExclude : undefined;
                break;
            default:
                fieldValue = entry[field];
        }

        if (fieldValue === undefined) return '';
        if (Array.isArray(fieldValue)) return JSON.stringify(fieldValue.map(x => String(x)));
        return String(fieldValue);
    }

    async setEntryField(params) {
        const file = params?.file;
        const uid = String(params?.uid ?? '').trim();
        const field = params?.field || 'content';
        let value = params?.value;
        if (value === undefined) throw new Error('MISSING_PARAMS');
        if (!file || !world_names.includes(file)) throw new Error('VALIDATION_FAILED: file');

        const data = await loadWorldInfo(file);
        if (!data || !data.entries) throw new Error('NOT_FOUND');
        const entry = data.entries[uid];
        if (!entry) throw new Error('NOT_FOUND');
        if (newWorldInfoEntryTemplate[field] === undefined) throw new Error('VALIDATION_FAILED: field');

        const ctx = getContext();
        const tags = ctx.tags || [];

        const ensureCharacterFilterObject = () => {
            if (!entry.characterFilter) {
                Object.assign(entry, { characterFilter: { isExclude: false, names: [], tags: [] } });
            }
        };

        // Unescape escaped special chars (compat with STscript input style)
        value = String(value).replace(/\\([{}|])/g, '$1');

        switch (field) {
            case 'characterFilterNames': {
                ensureCharacterFilterObject();
                const names = parseStringArray(value);
                const avatars = names
                    .map((name) => findChar({ name, allowAvatar: true, preferCurrentChar: false, quiet: true })?.avatar)
                    .filter(Boolean);
                // Convert to canonical filenames
                entry.characterFilter.names = avatars
                    .map((avatarKey) => getCharaFilename(null, { manualAvatarKey: avatarKey }))
                    .filter(Boolean);
                setWIOriginalDataValue(data, uid, 'character_filter', entry.characterFilter);
                break;
            }
            case 'characterFilterTags': {
                ensureCharacterFilterObject();
                const tagNames = parseStringArray(value);
                entry.characterFilter.tags = tags.filter((t) => tagNames.includes(t.name)).map((t) => t.id);
                setWIOriginalDataValue(data, uid, 'character_filter', entry.characterFilter);
                break;
            }
            case 'characterFilterExclude': {
                ensureCharacterFilterObject();
                entry.characterFilter.isExclude = isTrueBoolean(value);
                setWIOriginalDataValue(data, uid, 'character_filter', entry.characterFilter);
                break;
            }
            default: {
                if (Array.isArray(entry[field])) {
                    entry[field] = parseStringArray(value);
                } else if (typeof entry[field] === 'boolean') {
                    entry[field] = isTrueBoolean(value);
                } else if (typeof entry[field] === 'number') {
                    entry[field] = Number(value);
                } else {
                    entry[field] = String(value);
                }
                if (originalWIDataKeyMap[field]) {
                    setWIOriginalDataValue(data, uid, originalWIDataKeyMap[field], entry[field]);
                }
                break;
            }
        }

        await saveWorldInfo(file, data, true);
        reloadEditor(file);
        return '';
    }

    async createEntry(params) {
        const file = params?.file;
        const key = params?.key;
        const content = params?.content;
        if (!file || !world_names.includes(file)) throw new Error('VALIDATION_FAILED: file');
        const data = await loadWorldInfo(file);
        if (!data || !data.entries) throw new Error('NOT_FOUND');
        const entry = createWorldInfoEntry(file, data);
        if (key) { entry.key.push(String(key)); entry.addMemo = true; entry.comment = String(key); }
        if (content) entry.content = String(content);
        await saveWorldInfo(file, data, true);
        reloadEditor(file);
        return String(entry.uid);
    }

    async listEntries(params) {
        const file = params?.file;
        if (!file || !world_names.includes(file)) throw new Error('VALIDATION_FAILED: file');
        const data = await loadWorldInfo(file);
        if (!data || !data.entries) return [];
        return Object.values(data.entries).map(e => ({
            uid: e.uid,
            comment: e.comment || '',
            key: Array.isArray(e.key) ? e.key.slice() : [],
            keysecondary: Array.isArray(e.keysecondary) ? e.keysecondary.slice() : [],
            position: e.position,
            depth: e.depth,
            order: e.order,
            probability: e.probability,
            useProbability: !!e.useProbability,
            disable: !!e.disable,
        }));
    }

    async deleteEntry(params) {
        const file = params?.file;
        const uid = String(params?.uid ?? '').trim();
        if (!file || !world_names.includes(file)) throw new Error('VALIDATION_FAILED: file');
        const data = await loadWorldInfo(file);
        if (!data || !data.entries) throw new Error('NOT_FOUND');
        const ok = await deleteWorldInfoEntry(data, uid, { silent: true });
        if (ok) {
            await saveWorldInfo(file, data, true);
            reloadEditor(file);
        }
        return ok ? 'ok' : '';
    }

    // ===== Timed effects (minimal parity) =====
    async wiGetTimedEffect(params) {
        const file = params?.file;
        const uid = String(params?.uid ?? '').trim();
        const effect = String(params?.effect ?? '').trim().toLowerCase(); // 'sticky'|'cooldown'
        const format = String(params?.format ?? 'bool').trim().toLowerCase(); // 'bool'|'number'
        if (!file || !world_names.includes(file)) throw new Error('VALIDATION_FAILED: file');
        if (!uid) throw new Error('MISSING_PARAMS');
        if (!['sticky', 'cooldown'].includes(effect)) throw new Error('VALIDATION_FAILED: effect');
        const ctx = getContext();
        const key = `${file}.${uid}`;
        const t = ensureTimedWorldInfo(ctx);
        const store = t[effect] || {};
        const meta = store[key];
        if (format === 'number') {
            const remaining = meta ? Math.max(0, Number(meta.end || 0) - (ctx.chat?.length || 0)) : 0;
            return String(remaining);
        }
        return String(!!meta);
    }

    async wiSetTimedEffect(params) {
        const file = params?.file;
        const uid = String(params?.uid ?? '').trim();
        const effect = String(params?.effect ?? '').trim().toLowerCase(); // 'sticky'|'cooldown'
        let value = params?.value; // 'toggle'|'true'|'false'|boolean
        if (!file || !world_names.includes(file)) throw new Error('VALIDATION_FAILED: file');
        if (!uid) throw new Error('MISSING_PARAMS');
        if (!['sticky', 'cooldown'].includes(effect)) throw new Error('VALIDATION_FAILED: effect');
        const data = await loadWorldInfo(file);
        if (!data || !data.entries) throw new Error('NOT_FOUND');
        const entry = data.entries[uid];
        if (!entry) throw new Error('NOT_FOUND');
        if (!entry[effect]) throw new Error('VALIDATION_FAILED: entry has no effect configured');

        const ctx = getContext();
        const key = `${file}.${uid}`;
        const t = ensureTimedWorldInfo(ctx);
        if (!t[effect] || typeof t[effect] !== 'object') t[effect] = {};
        const store = t[effect];
        const current = !!store[key];

        let newState;
        const vs = String(value ?? '').trim().toLowerCase();
        if (vs === 'toggle' || vs === '') newState = !current;
        else if (isTrueBoolean(vs)) newState = true;
        else if (isFalseBoolean(vs)) newState = false;
        else newState = current;

        if (newState) {
            const duration = Number(entry[effect]) || 0;
            store[key] = { end: (ctx.chat?.length || 0) + duration, world: file, uid };
        } else {
            delete store[key];
        }
        await ctx.saveMetadata();
        return '';
    }

    // ===== Bind / Unbind =====
    async bindWorldbookToChat(params) {
        const name = await this.ensureWorldExists(params?.worldbookName, !!params?.autoCreate);
        const ctx = getContext();
        ctx.chatMetadata[METADATA_KEY] = name;
        await ctx.saveMetadata();
        return { name };
    }

    async unbindWorldbookFromChat() {
        const ctx = getContext();
        delete ctx.chatMetadata[METADATA_KEY];
        await ctx.saveMetadata();
        return { name: '' };
    }

    async bindWorldbookToCharacter(params) {
        const ctx = getContext();
        const target = String(params?.target ?? 'primary').toLowerCase();
        const name = await this.ensureWorldExists(params?.worldbookName, !!params?.autoCreate);

        const charName = params?.character?.name || ctx.characters?.[ctx.characterId]?.avatar || ctx.characters?.[ctx.characterId]?.name;
        const character = findChar({ name: charName, allowAvatar: true, preferCurrentChar: true, quiet: true });
        if (!character) throw new Error('NOT_FOUND: character');

        if (target === 'primary') {
            if (typeof ctx.writeExtensionField === 'function') {
                await ctx.writeExtensionField('world', name);
            } else {
                // Fallback: set on active character only
                const active = ctx.characters?.[ctx.characterId];
                if (active) {
                    active.data = active.data || {};
                    active.data.extensions = active.data.extensions || {};
                    active.data.extensions.world = name;
                }
            }
            return { primary: name };
        }

        // additional => world_info.charLore
        const fileName = getCharaFilename(null, { manualAvatarKey: character.avatar });
        let list = world_info.charLore || [];
        const idx = list.findIndex(e => e.name === fileName);
        if (idx === -1) {
            list.push({ name: fileName, extraBooks: [name] });
        } else {
            const eb = new Set(list[idx].extraBooks || []);
            eb.add(name);
            list[idx].extraBooks = Array.from(eb);
        }
        world_info.charLore = list;
        getContext().saveSettingsDebounced?.();
        return { additional: (world_info.charLore.find(e => e.name === fileName)?.extraBooks) || [name] };
    }

    async unbindWorldbookFromCharacter(params) {
        const ctx = getContext();
        const target = String(params?.target ?? 'primary').toLowerCase();
        const name = isString(params?.worldbookName) ? params.worldbookName : null;
        const charName = params?.character?.name || ctx.characters?.[ctx.characterId]?.avatar || ctx.characters?.[ctx.characterId]?.name;
        const character = findChar({ name: charName, allowAvatar: true, preferCurrentChar: true, quiet: true });
        if (!character) throw new Error('NOT_FOUND: character');

        const result = {};
        if (target === 'primary' || target === 'all') {
            if (typeof ctx.writeExtensionField === 'function') {
                await ctx.writeExtensionField('world', '');
            } else {
                const active = ctx.characters?.[ctx.characterId];
                if (active?.data?.extensions) active.data.extensions.world = '';
            }
            result.primary = '';
        }

        if (target === 'additional' || target === 'all') {
            const fileName = getCharaFilename(null, { manualAvatarKey: character.avatar });
            let list = world_info.charLore || [];
            const idx = list.findIndex(e => e.name === fileName);
            if (idx !== -1) {
                if (name) {
                    list[idx].extraBooks = (list[idx].extraBooks || []).filter(e => e !== name);
                    if (list[idx].extraBooks.length === 0) list.splice(idx, 1);
                } else {
                    // remove all
                    list.splice(idx, 1);
                }
                world_info.charLore = list;
                getContext().saveSettingsDebounced?.();
                result.additional = world_info.charLore.find(e => e.name === fileName)?.extraBooks || [];
            } else {
                result.additional = [];
            }
        }
        return result;
    }

    // ===== Dispatcher =====
    async handleRequest(action, params) {
        switch (action) {
            case 'getChatBook': return await this.getChatBook(params);
            case 'getGlobalBooks': return await this.getGlobalBooks(params);
            case 'listWorldbooks': return await this.listWorldbooks(params);
            case 'getPersonaBook': return await this.getPersonaBook(params);
            case 'getCharBook': return await this.getCharBook(params);
            case 'world': return await this.world(params);
            case 'findEntry': return await this.findEntry(params);
            case 'getEntryField': return await this.getEntryField(params);
            case 'setEntryField': return await this.setEntryField(params);
            case 'createEntry': return await this.createEntry(params);
            case 'listEntries': return await this.listEntries(params);
            case 'deleteEntry': return await this.deleteEntry(params);
            case 'wiGetTimedEffect': return await this.wiGetTimedEffect(params);
            case 'wiSetTimedEffect': return await this.wiSetTimedEffect(params);
            case 'bindWorldbookToChat': return await this.bindWorldbookToChat(params);
            case 'unbindWorldbookFromChat': return await this.unbindWorldbookFromChat(params);
            case 'bindWorldbookToCharacter': return await this.bindWorldbookToCharacter(params);
            case 'unbindWorldbookFromCharacter': return await this.unbindWorldbookFromCharacter(params);
            default: throw new Error('INVALID_ACTION');
        }
    }

    attachEventsForwarding() {
        if (this._forwardEvents) return;
        this._onWIUpdated = (name, data) => this.postEvent('WORLDBOOK_UPDATED', { name });
        this._onWISettings = () => this.postEvent('WORLDBOOK_SETTINGS_UPDATED', {});
        this._onWIActivated = (entries) => this.postEvent('WORLDBOOK_ACTIVATED', { entries });
        eventSource.on(event_types.WORLDINFO_UPDATED, this._onWIUpdated);
        eventSource.on(event_types.WORLDINFO_SETTINGS_UPDATED, this._onWISettings);
        eventSource.on(event_types.WORLD_INFO_ACTIVATED, this._onWIActivated);
        this._forwardEvents = true;
    }

    detachEventsForwarding() {
        if (!this._forwardEvents) return;
        try { eventSource.removeListener(event_types.WORLDINFO_UPDATED, this._onWIUpdated); } catch {}
        try { eventSource.removeListener(event_types.WORLDINFO_SETTINGS_UPDATED, this._onWISettings); } catch {}
        try { eventSource.removeListener(event_types.WORLD_INFO_ACTIVATED, this._onWIActivated); } catch {}
        this._forwardEvents = false;
    }

    init({ forwardEvents = false } = {}) {
        if (this._attached) return;
        const self = this;
        this._listener = async function (event) {
            try {
                const data = event && event.data || {};
                if (!data || data.type !== 'worldbookRequest') return;
                const id = data.id;
                const action = data.action;
                const params = data.params || {};
                try {
                    const result = await self.handleRequest(action, params);
                    self.sendResult(event.source || window, id, result);
                } catch (err) {
                    self.sendError(event.source || window, id, err);
                }
            } catch {}
        };
        try { window.addEventListener('message', this._listener); } catch {}
        this._attached = true;
        if (forwardEvents) this.attachEventsForwarding();
    }

    cleanup() {
        if (!this._attached) return;
        try { window.removeEventListener('message', this._listener); } catch {}
        this._attached = false;
        this._listener = null;
        this.detachEventsForwarding();
    }
}

const worldbookBridge = new WorldbookBridgeService();

export function initWorldbookHostBridge(options) {
    try { worldbookBridge.init(options || {}); } catch {}
}

export function cleanupWorldbookHostBridge() {
    try { worldbookBridge.cleanup(); } catch {}
}

if (typeof window !== 'undefined') {
    Object.assign(window, { xiaobaixWorldbookService: worldbookBridge, initWorldbookHostBridge, cleanupWorldbookHostBridge });
    try { initWorldbookHostBridge({ forwardEvents: true }); } catch {}
    try {
        window.addEventListener('xiaobaixEnabledChanged', (e) => {
            try {
                const enabled = e && e.detail && e.detail.enabled === true;
                if (enabled) initWorldbookHostBridge({ forwardEvents: true }); else cleanupWorldbookHostBridge();
            } catch (_) {}
        });
        document.addEventListener('xiaobaixEnabledChanged', (e) => {
            try {
                const enabled = e && e.detail && e.detail.enabled === true;
                if (enabled) initWorldbookHostBridge({ forwardEvents: true }); else cleanupWorldbookHostBridge();
            } catch (_) {}
        });
        window.addEventListener('beforeunload', () => { try { cleanupWorldbookHostBridge(); } catch (_) {} });
    } catch (_) {}
}


