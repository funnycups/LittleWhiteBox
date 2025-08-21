import { extension_settings, getContext, saveMetadataDebounced } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types, chat_metadata } from "../../../../script.js";
import { getLocalVariable, setLocalVariable, getGlobalVariable, setGlobalVariable } from "../../../variables.js";
import { callGenericPopup, POPUP_TYPE, POPUP_RESULT } from '../../../popup.js';

const CONFIG = {
  extensionName: "variables-panel",
  extensionFolderPath: "scripts/extensions/third-party/LittleWhiteBox",
  defaultSettings: { enabled: false },
  defaultFolderName: 'LittleWhiteBox',
  autoClassifyVars: ['prompt1','prompt2','prompt3','prompt4','xiaobaix_stats'],
  watchInterval: 1500, touchTimeout: 4000, longPressDelay: 700, folderLongPressDelay: 1000
};

const EMBEDDED_CSS = `
.vm-container{color:var(--SmartThemeBodyColor);background:var(--SmartThemeBlurTintColor);flex-direction:column;overflow-y:auto;z-index:3000;position:fixed;display:none}
.vm-container:not([style*="display: none"]){display:flex}
@media (min-width: 1000px){.vm-container:not([style*="display: none"]){width:calc((100vw - var(--sheldWidth)) / 2);border-left:1px solid var(--SmartThemeBorderColor);right:0;top:0;height:100vh}}
@media (max-width: 999px){.vm-container:not([style*="display: none"]){max-height:calc(100svh - var(--topBarBlockSize));top:var(--topBarBlockSize);width:100%;height:100vh;left:0}}
.vm-header,.vm-section,.vm-item-content{border-bottom:.5px solid var(--SmartThemeBorderColor)}
.vm-header,.vm-section-header{display:flex;justify-content:space-between;align-items:center}
.vm-title,.vm-item-name,.vm-folder .vm-item-name{font-weight:bold}
.vm-header{padding:15px}.vm-title{font-size:16px}
.vm-section-header{padding:5px 15px;border-bottom:5px solid var(--SmartThemeBorderColor);font-size:14px;color:var(--SmartThemeEmColor)}
.vm-close,.vm-btn{background:none;border:none;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.vm-close{font-size:18px;padding:5px}
.vm-btn{border:1px solid var(--SmartThemeBorderColor);border-radius:3px;font-size:12px;padding:2px 4px;color:var(--SmartThemeBodyColor)}
.vm-search-container{padding:10px;border-bottom:1px solid var(--SmartThemeBorderColor)}
.vm-search-input{width:100%;padding:3px 6px}
.vm-clear-all-btn{color:#ff6b6b;border-color:#ff6b6b;opacity:.3}
.vm-list{flex:1;overflow-y:auto;padding:10px}
.vm-item{border:1px solid var(--SmartThemeBorderColor);opacity:.7}
.vm-item.expanded{opacity:1}
.vm-item-header{display:flex;justify-content:space-between;align-items:center;cursor:pointer;padding-left:5px}
.vm-item-name{font-size:13px}
.vm-item-controls{background:var(--SmartThemeChatTintColor);display:flex;gap:5px;position:absolute;right:5px;opacity:0;visibility:hidden}
.vm-item-content{border-top:1px solid var(--SmartThemeBorderColor);display:none}
.vm-item.expanded>.vm-item-content,.vm-folder.expanded>.vm-item-content,.vm-folder[data-expanded="true"]>.vm-item-content{display:block}
.vm-folder{border-left:3px solid #ffa500}
.vm-folder>.vm-item-header .vm-item-controls{opacity:1!important;visibility:visible!important}
.vm-folder-content{padding-left:5px}
.vm-inline-form{background:var(--SmartThemeChatTintColor);border:1px solid var(--SmartThemeBorderColor);border-top:none;padding:10px;margin:0;display:none}
.vm-inline-form.active{display:block;animation:slideDown .2s ease-out}
@keyframes slideDown{from{opacity:0;max-height:0;padding-top:0;padding-bottom:0}to{opacity:1;max-height:200px;padding-top:10px;padding-bottom:10px}}
@media (hover:hover){.vm-close:hover,.vm-btn:hover{opacity:.8}.vm-close:hover{color:red}.vm-clear-all-btn:hover{opacity:1}.vm-item:hover>.vm-item-header .vm-item-controls{opacity:1;visibility:visible}.vm-list::-webkit-scrollbar-thumb:hover{background:var(--SmartThemeQuoteColor)}.vm-variable-checkbox:hover{background-color:rgba(255,255,255,.1)}}
@media (hover:none){.vm-close:active,.vm-btn:active{opacity:.8}.vm-close:active{color:red}.vm-clear-all-btn:active{opacity:1}.vm-item:active>.vm-item-header .vm-item-controls,.vm-item.touched>.vm-item-header .vm-item-controls{opacity:1;visibility:visible}.vm-item.touched>.vm-item-header{background-color:rgba(255,255,255,.05)}.vm-btn:active{background-color:rgba(255,255,255,.1);transform:scale(.95)}.vm-variable-checkbox:active{background-color:rgba(255,255,255,.1)}}
.vm-item:not([data-level]).expanded .vm-item[data-level="1"]{--level-color:hsl(36,100%,50%)}
.vm-item[data-level="1"].expanded .vm-item[data-level="2"]{--level-color:hsl(60,100%,50%)}
.vm-item[data-level="2"].expanded .vm-item[data-level="3"]{--level-color:hsl(120,100%,50%)}
.vm-item[data-level="3"].expanded .vm-item[data-level="4"]{--level-color:hsl(180,100%,50%)}
.vm-item[data-level="4"].expanded .vm-item[data-level="5"]{--level-color:hsl(240,100%,50%)}
.vm-item[data-level="5"].expanded .vm-item[data-level="6"]{--level-color:hsl(280,100%,50%)}
.vm-item[data-level="6"].expanded .vm-item[data-level="7"]{--level-color:hsl(320,100%,50%)}
.vm-item[data-level="7"].expanded .vm-item[data-level="8"]{--level-color:hsl(200,100%,50%)}
.vm-item[data-level="8"].expanded .vm-item[data-level="9"]{--level-color:hsl(160,100%,50%)}
.vm-item[data-level]{border-left:2px solid var(--level-color);margin-left:6px}
.vm-item[data-level]:last-child{border-bottom:2px solid var(--level-color)}
.vm-tree-value,.vm-variable-checkbox span{font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vm-tree-value{color:inherit;font-size:12px;flex:1;margin:0 10px}
.vm-input,.vm-textarea{border:1px solid var(--SmartThemeBorderColor);border-radius:3px;background-color:var(--SmartThemeChatTintColor);font-size:12px;margin:3px 0}
.vm-textarea{min-height:60px;padding:5px;font-family:monospace;resize:vertical}
.vm-add-form{padding:10px;border-top:1px solid var(--SmartThemeBorderColor);display:none}
.vm-add-form.active{display:block}
.vm-form-row{display:flex;gap:10px;margin-bottom:10px;align-items:center}
.vm-form-label{min-width:30px;font-size:12px;font-weight:bold}
.vm-form-input{flex:1}
.vm-form-buttons{display:flex;gap:5px;justify-content:flex-end}
.vm-list::-webkit-scrollbar{width:6px}
.vm-list::-webkit-scrollbar-track{background:var(--SmartThemeBodyColor)}
.vm-list::-webkit-scrollbar-thumb{background:var(--SmartThemeBorderColor);border-radius:3px}
.vm-move-variables-container{text-align:left}
.vm-move-variables-container p{margin-bottom:15px;font-size:14px}
.vm-variables-list{max-height:300px;overflow-y:auto;border:1px solid var(--SmartThemeBorderColor);border-radius:5px;padding:10px;background:var(--SmartThemeChatTintColor);display:flex;flex-wrap:wrap;justify-content:flex-start;align-items:flex-start;gap:0;margin-top:10px}
.vm-variable-checkbox{display:inline-flex!important;align-items:center!important;margin:4px 5px!important;padding:5px 8px;border-radius:3px;cursor:pointer;transition:background-color .2s;vertical-align:top;box-sizing:border-box}
.vm-variable-checkbox input[type="checkbox"]{margin-right:8px!important;flex-shrink:0}
.vm-variable-checkbox span{font-size:13px}
.vm-empty-message{padding:20px;text-align:center;color:#888}
.vm-folder-icon{margin:5px}
.vm-folder-count,.vm-object-count,.vm-formatted-value{opacity:.7}
.vm-item-name-visible{opacity:1}
.vm-item-separator{opacity:.3}
.vm-null-value{opacity:.6}
.mes_btn.mes_variables_panel{opacity:.6}
.mes_btn.mes_variables_panel:hover{opacity:1}
`;

const EMBEDDED_HTML = `
<div id="vm-container" class="vm-container" style="display:none">
  <div class="vm-header">
    <div class="vm-title">变量面板</div>
    <button id="vm-close" class="vm-close"><i class="fa-solid fa-times"></i></button>
  </div>
  <div class="vm-content">
    ${['character','global'].map(t=>`
      <div class="vm-section" id="${t}-variables-section">
        <div class="vm-section-header">
          <div class="vm-section-title"><i class="fa-solid ${t==='character'?'fa-user':'fa-globe'}"></i>${t==='character'?' 本地变量':' 全局变量'}</div>
          <div class="vm-section-controls">
            <button class="vm-btn" data-type="${t}" data-act="import" title="导入变量"><i class="fa-solid fa-upload"></i></button>
            <button class="vm-btn" data-type="${t}" data-act="export" title="导出变量"><i class="fa-solid fa-download"></i></button>
            <button class="vm-btn" data-type="${t}" data-act="add" title="添加变量，长按为添加文件夹"><i class="fa-solid fa-plus"></i></button>
            <button class="vm-btn" data-type="${t}" data-act="collapse" title="展开/折叠所有"><i class="fa-solid fa-chevron-down"></i></button>
            <button class="vm-btn vm-clear-all-btn" data-type="${t}" data-act="clear-all" title="清除所有变量"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>
        <div class="vm-search-container"><input type="text" class="vm-input vm-search-input" id="${t}-vm-search" placeholder="搜索${t==='character'?'本地':'全局'}变量..."></div>
        <div class="vm-list" id="${t}-variables-list"></div>
        <div class="vm-add-form" id="${t}-vm-add-form">
          <div class="vm-form-row"><label class="vm-form-label">名称:</label><input type="text" class="vm-input vm-form-input" id="${t}-vm-name" placeholder="变量名称"></div>
          <div class="vm-form-row"><label class="vm-form-label">值:</label><textarea class="vm-textarea vm-form-input" id="${t}-vm-value" placeholder="变量值 (支持JSON格式)"></textarea></div>
          <div class="vm-form-buttons">
            <button class="vm-btn" data-type="${t}" data-act="save-add"><i class="fa-solid fa-floppy-disk"></i>保存</button>
            <button class="vm-btn" data-type="${t}" data-act="cancel-add">取消</button>
          </div>
        </div>
      </div>`).join('')}
  </div>
</div>
`;

const VARIABLE_TYPES = {
  character: {
    getter: getLocalVariable, setter: setLocalVariable,
    storage: () => chat_metadata?.variables || (chat_metadata.variables = {}),
    folderStorage: () => chat_metadata?.variableFolders || (chat_metadata.variableFolders = {}),
    save: saveMetadataDebounced,
  },
  global: {
    getter: getGlobalVariable, setter: setGlobalVariable,
    storage: () => extension_settings.variables?.global || ((extension_settings.variables = { global: {} }).global),
    folderStorage: () => extension_settings.variables?.globalFolders || (extension_settings.variables.globalFolders = {}),
    save: saveSettingsDebounced,
  }
};

class VariablesPanel {
  constructor(){
    this.state = { isOpen:false, isEnabled:false, container:null, timers:{ watcher:null, longPress:null, touch:new Map() }, currentInlineForm:null, formState:{} };
    this.variableSnapshot = null; this.eventHandlers = {}; this.savingInProgress = false;
    this.sharedBtn = null; this.lastMesId = null;
  }

  async init(){
    this.loadUI(); this.bindControlToggle();
    const s = this.getSettings(); this.state.isEnabled = s.enabled; this.syncCheckboxState();
    if (s.enabled) this.enable();
  }

  loadUI(){
    if (!document.getElementById('variables-panel-css')) {
      const st = document.createElement('style'); st.id='variables-panel-css'; st.textContent = EMBEDDED_CSS; document.head.appendChild(st);
    }
    this.containerHtml = EMBEDDED_HTML;
  }

  getSettings(){ extension_settings.LittleWhiteBox ??= {}; return extension_settings.LittleWhiteBox.variablesPanel ??= { ...CONFIG.defaultSettings }; }
  vt(t){ return VARIABLE_TYPES[t]; }
  store(t){ return this.vt(t).storage(); }
  fstore(t){ return this.vt(t).folderStorage(); }

  enable(){ this.createContainer(); this.bindEvents(); this.autoClassifyAllVariables(); this.loadVariables(); this.addMessageButtons(); }
  disable(){ this.cleanup(); }

  cleanup(){
    this.stopWatcher(); this.unbindEvents(); this.unbindControlToggle(); this.removeContainer(); this.removeMessageButtons();
    const t=this.state.timers; if(t.watcher)clearInterval(t.watcher); if(t.longPress)clearTimeout(t.longPress);
    t.touch.forEach(x=>clearTimeout(x)); t.touch.clear();
    Object.assign(this.state,{ isOpen:false, timers:{ watcher:null,longPress:null,touch:new Map()}, currentInlineForm:null, formState:{} });
    this.variableSnapshot=null; this.savingInProgress=false; this.lastMesId=null;
  }

  createContainer(){
    if (!this.state.container?.length) {
      $('body').append(this.containerHtml);
      this.state.container = $("#vm-container");
      $("#vm-close").off('click').on('click',()=>this.close());
    }
  }
  removeContainer(){ this.state.container?.remove(); this.state.container=null; }

  open(){ if(!this.state.isEnabled) return toastr.warning('请先启用变量面板'); this.createContainer(); this.bindEvents(); this.state.isOpen=true; this.state.container.show(); this.loadVariables(); this.startWatcher(); }
  close(){ this.state.isOpen=false; this.stopWatcher(); this.unbindEvents(); this.removeContainer(); }

  bindControlToggle(){
    const id='xiaobaix_variables_panel_enabled';
    const bind=()=>{
      const cb=document.getElementById(id); if(!cb) return false;
      this.handleCheckboxChange && cb.removeEventListener('change', this.handleCheckboxChange);
      this.handleCheckboxChange=(e)=>this.toggleEnabled(e.target.checked);
      cb.addEventListener('change', this.handleCheckboxChange); cb.checked=this.state.isEnabled; return true;
    };
    if(!bind()) setTimeout(bind,100);
  }
  unbindControlToggle(){ const cb=document.getElementById('xiaobaix_variables_panel_enabled'); if(cb && this.handleCheckboxChange) cb.removeEventListener('change', this.handleCheckboxChange); this.handleCheckboxChange=null; }
  syncCheckboxState(){ const cb=document.getElementById('xiaobaix_variables_panel_enabled'); if(cb) cb.checked=this.state.isEnabled; }

  bindEvents(){
    if (!this.state.container?.length) return;
    this.unbindEvents();
    const ns = '.vm';
    $(document).on(`click${ns}`, '.vm-section [data-act]', (e)=>this.onHeaderAction(e));
    this.bindLongPress('.vm-section [data-act="add"]', (e)=>this.showAddForm($(e.currentTarget).data('type')), (e)=>this.createFolderDialog($(e.currentTarget).data('type')), CONFIG.folderLongPressDelay);
    ['character','global'].forEach(t=> $(`#${t}-vm-search`).on('input', e=>this.searchVariables(t,e.target.value)));
    $(document)
      .on(`touchstart${ns}`, '.vm-item>.vm-item-header', (e)=>this.handleTouch(e))
      .on(`click${ns}`, '.vm-item>.vm-item-header', (e)=>this.handleItemClick(e))
      .on(`click${ns}`, '.vm-item-controls [data-act]', (e)=>this.onItemAction(e))
      .on(`click${ns}`, '.vm-inline-form [data-act]', (e)=>this.onInlineAction(e));
    $(document).on(`mousedown${ns} touchstart${ns}`, '[data-act="copy"]', (e)=>this.bindCopyPress(e));
  }
  unbindEvents(){ $(document).off('.vm'); ['character','global'].forEach(t=> $(`#${t}-vm-search`).off('input')); }

  onHeaderAction(e){
    e.preventDefault(); e.stopPropagation();
    const btn=$(e.currentTarget), act=btn.data('act'), t=btn.data('type');
    ({ import:()=>this.importVariables(t), export:()=>this.exportVariables(t), add:()=>this.showAddForm(t), collapse:()=>this.collapseAll(t), 'clear-all':()=>this.clearAllVariables(t), 'save-add':()=>this.saveAddVariable(t), 'cancel-add':()=>this.hideAddForm(t) }[act]||(()=>{}))();
  }

  onItemAction(e){
    e.preventDefault(); e.stopPropagation();
    const btn=$(e.currentTarget), act=btn.data('act'), item=btn.closest('.vm-item'), t=this.getVariableType(item), path=this.getItemPath(item);
    ({
      edit: ()=>this.editAction(item,'edit',t,path),
      'add-child': ()=>this.editAction(item,'addChild',t,path),
      delete: ()=>this.handleDelete(item,t,path),
      'edit-folder': ()=>this.handleEditFolder(item),
      'delete-folder': ()=>this.handleDeleteFolder(item),
      'move-to-folder': ()=>this.handleMoveToFolder(item),
      copy: ()=>{}
    }[act]||(()=>{}))();
  }

  onInlineAction(e){ e.preventDefault(); e.stopPropagation(); const btn=$(e.currentTarget), act=btn.data('act'); if(act==='inline-save') this.handleInlineSave(btn.closest('.vm-inline-form')); else this.hideInlineForm(); }

  bindCopyPress(e){
    e.preventDefault(); e.stopPropagation();
    const start=Date.now();
    this.state.timers.longPress=setTimeout(()=>{ this.handleCopy(e,true); this.state.timers.longPress=null; }, CONFIG.longPressDelay);
    const release=(re)=>{
      if(this.state.timers.longPress){ clearTimeout(this.state.timers.longPress); this.state.timers.longPress=null; if(re.type!=='mouseleave' && (Date.now()-start)<CONFIG.longPressDelay) this.handleCopy(e,false); }
      $(document).off('mouseup.vm touchend.vm mouseleave.vm', release);
    };
    $(document).on('mouseup.vm touchend.vm mouseleave.vm', release);
  }

  bindLongPress(sel, shortHandler, longHandler, dur){
    const el=$(sel); let timer=null;
    el.on('mousedown touchstart',(e)=>{ e.preventDefault(); timer=setTimeout(()=>{ timer=null; longHandler(e); }, dur); })
      .on('mouseup touchend mouseleave',(e)=>{ if(timer){ clearTimeout(timer); timer=null; if(e.type!=='mouseleave') shortHandler(e); } });
  }

  startWatcher(){ this.stopWatcher(); this.updateSnapshot(); this.state.timers.watcher=setInterval(()=> this.state.isOpen && this.checkChanges(), CONFIG.watchInterval); }
  stopWatcher(){ if(this.state.timers.watcher){ clearInterval(this.state.timers.watcher); this.state.timers.watcher=null; } }
  updateSnapshot(){ this.variableSnapshot={ character:JSON.stringify(this.store('character')), global:JSON.stringify(this.store('global')), characterFolders:JSON.stringify(this.fstore('character')), globalFolders:JSON.stringify(this.fstore('global')) }; }
  checkChanges(){
    try{
      const cur={ character:JSON.stringify(this.store('character')), global:JSON.stringify(this.store('global')), characterFolders:JSON.stringify(this.fstore('character')), globalFolders:JSON.stringify(this.fstore('global')) };
      if(Object.keys(cur).some(k=>cur[k]!==this.variableSnapshot[k])){ const states=this.saveAllExpandedStates(); this.variableSnapshot=cur; this.loadVariables(); this.restoreAllExpandedStates(states); }
    }catch(e){ console.warn('[Variables Panel] watch error:', e); }
  }

  folder = {
    get: (t)=>this.fstore(t),
    create: (t,n)=>{ const f=this.fstore(t); const id=`folder_${Date.now()}_${Math.random().toString(36).slice(2,9)}`; f[id]={ name:n, variables:[], created:Date.now(), expanded:false }; this.vt(t).save(); return id; },
    delete: (t,id)=>{ const f=this.fstore(t); const moved=f[id]?.variables||[]; delete f[id]; this.vt(t).save(); return moved; },
    rename: (t,id,n)=>{ const f=this.fstore(t); if(!f[id]) return false; f[id].name=n; this.vt(t).save(); return true; },
    moveVariable: (t,v,id)=>{ const f=this.fstore(t); if(!f[id]) return false; Object.values(f).forEach(fo=>{ const i=fo.variables?.indexOf(v); if(i>-1) fo.variables.splice(i,1); }); f[id].variables??=[]; if(!f[id].variables.includes(v)) f[id].variables.push(v); this.vt(t).save(); return true; },
    removeVariable: (t,v)=>{ const f=this.fstore(t); Object.values(f).forEach(fo=>{ const i=fo.variables?.indexOf(v); if(i>-1) fo.variables.splice(i,1); }); this.vt(t).save(); },
    getVariableFolder: (t,v)=>{ const f=this.fstore(t); return Object.entries(f).find(([,fo])=>fo.variables?.includes(v))?.[0]; },
    toggle: (t,id)=>{ const f=this.fstore(t); if(!f[id]) return false; f[id].expanded=!f[id].expanded; this.vt(t).save(); return f[id].expanded; }
  };

  loadVariables(){ ['character','global'].forEach(t=>{ this.autoClassifyVariables(t); this.renderVariables(t); $(`#${t}-variables-section [data-act="collapse"] i`).removeClass('fa-chevron-up').addClass('fa-chevron-down'); }); }
  renderVariables(t){
    const c=$(`#${t}-variables-list`).empty(), s=this.store(t), f=this.fstore(t), inF=new Set();
    Object.values(f).forEach(fo=> fo.variables?.forEach(vn=>inF.add(vn)));
    Object.entries(f).forEach(([id,fo])=> c.append(this.createFolderItem(t,id,fo)));
    const root=Object.entries(s).filter(([k])=>!inF.has(k));
    if(!Object.keys(f).length && !root.length) c.append('<div class="vm-empty-message">暂无变量</div>');
    else root.forEach(([k,v])=> c.append(this.createVariableItem(t,k,v)));
  }
  createFolderItem(t,id,fo){
    const { variables=[], expanded=false, name }=fo, s=this.store(t);
    return $(`<div class="vm-item vm-folder ${expanded?'expanded':''}" data-folder-id="${id}" data-type="${t}">
      <div class="vm-item-header">
        <div class="vm-item-name vm-item-name-visible"><i class="fa-solid ${expanded?'fa-folder-open':'fa-folder'} vm-folder-icon"></i>${this.escape(name||'未命名文件夹')}</div>
        <div class="vm-tree-value"><span class="vm-folder-count">[${variables.length} 个变量]</span></div>
        <div class="vm-item-controls">${this.createButtons('folder')}</div>
      </div>
      <div class="vm-item-content"><div class="vm-folder-content">${
        variables.map(vn=> s[vn]!==undefined ? this.createVariableItem(t,vn,s[vn],0)[0].outerHTML : '').filter(Boolean).join('')
      }</div></div>
    </div>`);
  }
  createVariableItem(t,k,v,l=0){
    const disp=l===0?this.formatTopLevelValue(v):this.formatValue(v), parsed=this.parseValue(v), hasChildren=typeof parsed==='object'&&parsed!==null;
    return $(`<div class="vm-item ${l>0?'vm-tree-level-var':''}" data-key="${k}" data-type="${t||''}" ${l>0?`data-level="${l}"`:''}>
      <div class="vm-item-header">
        <div class="vm-item-name vm-item-name-visible">${this.escape(k)}<span class="vm-item-separator">:</span></div>
        <div class="vm-tree-value">${disp}</div>
        <div class="vm-item-controls">${this.createButtons('item', l)}</div>
      </div>
      ${hasChildren?`<div class="vm-item-content">${this.renderChildren(parsed,l+1)}</div>`:''}
    </div>`);
  }
  createButtons(type,level=0){
    const cfg={
      folder:[
        {act:'move-to-folder',icon:'fa-arrow-right',title:'移动变量到此文件夹'},
        {act:'edit-folder',icon:'fa-edit',title:'编辑文件夹名称'},
        {act:'delete-folder',icon:'fa-trash',title:'删除文件夹'},
      ],
      item:[
        {act:'edit',icon:'fa-edit',title:'编辑'},
        {act:'add-child',icon:'fa-plus-circle',title:'添加子变量'},
        ...(level<2?[{act:'copy',icon:'fa-code',title:level===0?'复制 (单击: {{getvar::}}格式, 长按: /getvar格式)':'复制 (长按: /getvar格式)'}]:[]),
        {act:'delete',icon:'fa-trash',title:'删除'},
      ]
    };
    return cfg[type].map(b=>`<button class="vm-btn" data-act="${b.act}" title="${b.title}"><i class="fa-solid ${b.icon}"></i></button>`).join('');
  }
  createInlineForm(t,targetItem,fs){
    const fid=`inline-form-${Date.now()}`;
    const inf=$(`<div class="vm-inline-form" id="${fid}" data-type="${t}">
      <div class="vm-form-row"><label class="vm-form-label">名称:</label><input type="text" class="vm-input vm-form-input inline-name" placeholder="变量名称"></div>
      <div class="vm-form-row"><label class="vm-form-label">值:</label><textarea class="vm-textarea vm-form-input inline-value" placeholder="变量值 (支持JSON格式)"></textarea></div>
      <div class="vm-form-buttons"><button class="vm-btn" data-act="inline-save"><i class="fa-solid fa-floppy-disk"></i>保存</button><button class="vm-btn" data-act="inline-cancel">取消</button></div>
    </div>`);
    this.state.currentInlineForm?.remove();
    targetItem.after(inf); this.state.currentInlineForm=inf; this.state.formState={...fs, formId:fid, targetItem};
    const ta=inf.find('.inline-value'); ta.on('input',()=>this.autoResizeTextarea(ta));
    setTimeout(()=>{ inf.addClass('active'); inf.find('.inline-name').focus(); },10);
    return inf;
  }
  renderChildren(obj,level){ return Object.entries(obj).map(([k,v])=>this.createVariableItem(null,k,v,level)[0].outerHTML).join(''); }

  handleTouch(e){
    if($(e.target).closest('.vm-item-controls').length) return;
    e.stopPropagation();
    const item=$(e.currentTarget).closest('.vm-item'); $('.vm-item').removeClass('touched'); item.addClass('touched');
    this.clearTouchTimer(item);
    const t=setTimeout(()=>{ item.removeClass('touched'); this.state.timers.touch.delete(item[0]); }, CONFIG.touchTimeout);
    this.state.timers.touch.set(item[0],t);
  }
  clearTouchTimer(i){ const t=this.state.timers.touch.get(i[0]); if(t){ clearTimeout(t); this.state.timers.touch.delete(i[0]); } }

  handleItemClick(e){
    if($(e.target).closest('.vm-item-controls').length) return;
    e.stopPropagation();
    const it=$(e.currentTarget).closest('.vm-item');
    if(it.hasClass('vm-folder')){
      const fid=it.data('folder-id'), t=it.data('type'), exp=this.folder.toggle(t,fid);
      it.find('.vm-item-name i').removeClass('fa-folder fa-folder-open').addClass(exp?'fa-folder-open':'fa-folder'); this.loadVariables();
    } else it.toggleClass('expanded');
  }

  handleCopy(e,longPress){
    const item=$(e.target).closest('.vm-item'), path=this.getItemPath(item), t=this.getVariableType(item), level=parseInt(item.attr('data-level'))||0;
    let cmd;
    if (longPress) {
      const c=t==='character'?'getvar':'getglobalvar';
      if (level===0) cmd=`/${c} ${path[0]}`;
      else if (level===1) cmd=`/${c} index=${path.slice(1).join('.')} ${path[0]}`;
      else return toastr.warning('长按复制仅适用于顶级和二级变量');
    } else {
      if (level===0) cmd=`{{getvar::${path[0]}}}`;
      else return toastr.warning('单击复制仅适用于顶级变量');
    }
    (async(txt)=>{
      try{
        if(navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(txt);
        else { const ta=document.createElement('textarea'); ta.value=txt; ta.style.cssText="position:fixed;top:0;left:0;width:2em;height:2em;padding:0;border:none;outline:none;box-shadow:none;background:transparent"; document.body.appendChild(ta); ta.focus(); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); }
        toastr.success(`已复制命令: ${cmd}`);
      }catch{ toastr.error('复制失败'); }
    })(cmd);
  }

  editAction(item, action, type, path){
    const inf=this.createInlineForm(type,item,{action,path,type});
    if(action==='edit'){
      const v=this.getValueByPath(type,path);
      setTimeout(()=>{ inf.find('.inline-name').val(path[path.length-1]); const ta=inf.find('.inline-value'); ta.val(typeof v==='object'?JSON.stringify(v,null,2):v); this.autoResizeTextarea(ta); },50);
    } else if(action==='addChild'){
      inf.find('.inline-name').attr('placeholder',`为 "${path.join('.')}" 添加子变量名称`);
      inf.find('.inline-value').attr('placeholder','子变量值 (支持JSON格式)');
    }
  }

  async handleMoveToFolder(item){ await this.showMoveVariableDialog(item.data('type'), item.data('folder-id')); }
  async showMoveVariableDialog(t,fid){
    const v=this.store(t), f=this.fstore(t), fn=f[fid]?.name||'', inF=new Set(); Object.values(f).forEach(fo=>fo.variables?.forEach(va=>inF.add(va)));
    const avail=Object.keys(v).filter(va=>!inF.has(va)); if(!avail.length) return toastr.warning('没有可移动的变量');
    const d=document.createElement('div');
    d.innerHTML=`<div class="vm-move-variables-container"><p>选择要移动到文件夹 "<strong>${fn}</strong>" 的变量:</p><div class="vm-variables-list">${
      avail.map(va=>`<label class="checkbox_label vm-variable-checkbox"><input type="checkbox" value="${va}"><span title="${va}">${va}</span></label>`).join('')
    }</div></div>`;
    const r=await callGenericPopup(d, POPUP_TYPE.CONFIRM, '', { okButton:'移动', cancelButton:'取消', wide:false, allowVerticalScrolling:true });
    if(r===POPUP_RESULT.AFFIRMATIVE){
      const sel=Array.from(d.querySelectorAll('input:checked')).map(cb=>cb.value);
      if(sel.length){ sel.forEach(va=>this.folder.moveVariable(t,va,fid)); this.loadVariables(); toastr.success(`已将 ${sel.length} 个变量移动到文件夹 "${fn}"`); }
    }
  }

  handleEditFolder(item){
    const fid=item.data('folder-id'), t=item.data('type'), cur=this.folder.get(t)[fid]?.name||'', nn=prompt('请输入新的文件夹名称:',cur);
    if(nn?.trim() && nn.trim()!==cur){ if(this.folder.rename(t,fid,nn.trim())){ this.loadVariables(); toastr.success(`文件夹已重命名为 "${nn}"`); } }
  }
  handleDeleteFolder(item){
    const fid=item.data('folder-id'), t=item.data('type'), n=this.folder.get(t)[fid]?.name||'';
    if(!confirm(`确定要删除文件夹 "${n}" 吗？文件夹中的变量将移回根目录。`)) return;
    const moved=this.folder.delete(t,fid); this.loadVariables(); toastr.success(`文件夹 "${n}" 已删除，${moved.length} 个变量已移回根目录`);
  }

  handleDelete(item,t,path){ const n=path[path.length-1]; if(!confirm(`确定要删除 "${n}" 吗？`)) return; this.folder.removeVariable(t,n); this.deleteByPath(t,path); }

  handleInlineSave(form){
    if(this.savingInProgress) return; this.savingInProgress=true;
    try{
      if(!form?.length) return toastr.error('表单未找到');
      const nameInput=form.find('.inline-name'), valueInput=form.find('.inline-value'), name=nameInput.val()?.trim(), value=valueInput.val()?.trim(), type=form.data('type');
      if(!name) return nameInput.focus(), toastr.error('请输入变量名称');
      const processedValue=this.processValue(value), {action, path}=this.state.formState, states=this.saveExpandedStates(type);
      if(action==='addChild') this.setValueByPath(type,[...path,name],processedValue);
      else if(action==='edit'){
        const on=path[path.length-1];
        if(name!==on){
          this.deleteByPathSilently(type,path); this.folder.removeVariable(type,on);
          if(path.length===1) this.vt(type).setter(name, processedValue);
          else this.setValueByPath(type,[...path.slice(0,-1),name],processedValue);
          const fid=this.folder.getVariableFolder(type,on); if(fid && path.length===1) this.folder.moveVariable(type,name,fid);
        } else this.setValueByPath(type,path,processedValue);
      } else this.vt(type).setter(name, processedValue);
      this.vt(type).save(); this.hideInlineForm(); this.loadVariables(); this.restoreExpandedStates(type,states); toastr.success('变量已保存');
    }catch(e){ console.error(e); toastr.error('JSON格式错误: '+e.message); }
    finally{ this.savingInProgress=false; }
  }
  hideInlineForm(){ if(this.state.currentInlineForm){ this.state.currentInlineForm.removeClass('active'); setTimeout(()=>{ this.state.currentInlineForm?.remove(); this.state.currentInlineForm=null; },200); } this.state.formState={}; }

  showAddForm(t){
    this.hideInlineForm();
    const f=$(`#${t}-vm-add-form`).addClass('active'), ta=$(`#${t}-vm-value`);
    $(`#${t}-vm-name`).val('').attr('placeholder','变量名称').focus();
    ta.val('').attr('placeholder','变量值 (支持JSON格式)');
    if(!ta.data('auto-resize-bound')){ ta.on('input',()=>this.autoResizeTextarea(ta)); ta.data('auto-resize-bound',true); }
  }
  hideAddForm(t){ $(`#${t}-vm-add-form`).removeClass('active'); $(`#${t}-vm-name, #${t}-vm-value`).val(''); this.state.formState={}; }
  saveAddVariable(t){
    if(this.savingInProgress) return; this.savingInProgress=true;
    try{
      const n=$(`#${t}-vm-name`).val().trim(), v=$(`#${t}-vm-value`).val().trim();
      if(!n) return toastr.error('请输入变量名称');
      const proc=this.processValue(v); this.vt(t).setter(n,proc); this.vt(t).save(); this.hideAddForm(t); this.loadVariables(); toastr.success('变量已保存');
    }catch(e){ toastr.error('JSON格式错误: '+e.message); }
    finally{ this.savingInProgress=false; }
  }

  getValueByPath(t,p){ if(p.length===1) return this.vt(t).getter(p[0]); let v=this.parseValue(this.vt(t).getter(p[0])); p.slice(1).forEach(k=>v=v?.[k]); return v; }
  setValueByPath(t,p,v){
    if(p.length===1){ this.vt(t).setter(p[0],v); return; }
    let root=this.parseValue(this.vt(t).getter(p[0])); if(typeof root!=='object'||root===null) root={};
    let tar=root; p.slice(1,-1).forEach(k=>{ if(typeof tar[k]!=='object'||tar[k]===null) tar[k]={}; tar=tar[k]; });
    tar[p[p.length-1]]=v; this.vt(t).setter(p[0], JSON.stringify(root));
  }
  deleteByPathSilently(t,p){
    if(p.length===1){ const s=this.store(t); delete s[p[0]]; return; }
    let root=this.parseValue(this.vt(t).getter(p[0])); if(typeof root!=='object'||root===null) return;
    let tar=root; p.slice(1,-1).forEach(k=>{ if(typeof tar[k]!=='object'||tar[k]===null) tar[k]={}; tar=tar[k]; });
    delete tar[p[p.length-1]]; this.vt(t).setter(p[0], JSON.stringify(root));
  }
  deleteByPath(t,p){ this.deleteByPathSilently(t,p); this.vt(t).save(); this.loadVariables(); toastr.success('变量已删除'); }

  getVariableType(it){ return it.data('type') || (it.closest('.vm-section').attr('id').includes('character')?'character':'global'); }
  getItemPath(i){ const p=[]; let c=i; while(c.length && c.hasClass('vm-item')){ const k=c.data('key'); if(k!==undefined) p.unshift(String(k)); if(!c.attr('data-level')) break; c=c.parent().closest('.vm-item'); } return p; }
  parseValue(v){ try{ return typeof v==='string'?JSON.parse(v):v; }catch{ return v; } }
  processValue(v){ return /^[\{\[]/.test(v) ? JSON.stringify(JSON.parse(v)) : v; }
  formatTopLevelValue(v){ const p=this.parseValue(v); if(typeof p==='object'&&p!==null){ const c=Array.isArray(p)?p.length:Object.keys(p).length; return `<span class="vm-object-count">[${c} items]</span>`; } return this.formatValue(p); }
  formatValue(v){ if(v==null) return `<span class="vm-null-value">${v}</span>`; const s=String(v), e=this.escape(s); return `<span class="vm-formatted-value">${e.length>50?`${e.substring(0,50)}...`:e}</span>`; }
  escape(t){ const d=document.createElement('div'); d.textContent=t; return d.innerHTML; }
  autoResizeTextarea(ta){ if(!ta?.length) return; const el=ta[0]; el.style.height='auto'; const sh=el.scrollHeight, lh=parseInt(window.getComputedStyle(el).lineHeight)||20; const min=60,max=Math.min(300,window.innerHeight*0.4),fh=Math.max(min,Math.min(max,sh+4)); el.style.height=fh+'px'; el.style.overflowY=sh>max-4?'auto':'hidden'; }
  searchVariables(t,q){ const l=q.toLowerCase().trim(); $(`#${t}-variables-list .vm-item`).each(function(){ $(this).toggle(!l || $(this).text().toLowerCase().includes(l)); }); }
  collapseAll(t){ const items=$(`#${t}-variables-list .vm-item`), icon=$(`#${t}-variables-section [data-act="collapse"] i`); const hasExpanded=items.filter('.expanded').length>0; items.toggleClass('expanded', !hasExpanded); icon.toggleClass('fa-chevron-up', !hasExpanded).toggleClass('fa-chevron-down', hasExpanded); }

  clearAllVariables(t){ if(!confirm(`确定要清除所有${t==='character'?'角色':'全局'}变量吗？`)) return; const s=this.store(t); Object.keys(s).forEach(k=>delete s[k]); this.vt(t).save(); this.loadVariables(); toastr.success('变量已清除'); }
  async importVariables(t){
    const inp=document.createElement('input'); inp.type='file'; inp.accept='.json';
    inp.onchange=async(e)=>{ try{ const txt=await e.target.files[0].text(); const v=JSON.parse(txt); Object.entries(v).forEach(([k,va])=> this.vt(t).setter(k, typeof va==='object'?JSON.stringify(va):va)); this.vt(t).save(); this.loadVariables(); toastr.success(`成功导入 ${Object.keys(v).length} 个变量`); }catch{ toastr.error('文件格式错误'); } };
    inp.click();
  }
  exportVariables(t){ const v=this.store(t), b=new Blob([JSON.stringify(v,null,2)],{type:'application/json'}), a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download=`${t}-variables-${new Date().toISOString().split('T')[0]}.json`; a.click(); toastr.success('变量已导出'); }

  saveExpandedStates(t){ const s=new Set(); $(`#${t}-variables-list .vm-item.expanded`).each(function(){ const k=$(this).data('key'); if(k!==undefined) s.add(String(k)); }); return s; }
  saveAllExpandedStates(){ return { character:this.saveExpandedStates('character'), global:this.saveExpandedStates('global') }; }
  restoreExpandedStates(t,s){ if(!s?.size) return; setTimeout(()=>{ $(`#${t}-variables-list .vm-item`).each(function(){ const k=$(this).data('key'); if(k!==undefined && s.has(String(k))) $(this).addClass('expanded'); }); },50); }
  restoreAllExpandedStates(states){ Object.entries(states).forEach(([t,s])=>this.restoreExpandedStates(t,s)); }

  autoClassifyAllVariables(){ ['character','global'].forEach(t=>this.autoClassifyVariables(t)); }
  autoClassifyVariables(t){
    const v=this.store(t), dfid=this.ensureDefaultFolder(t); let c=0;
    CONFIG.autoClassifyVars.forEach(vn=>{ if(v.hasOwnProperty(vn) && !this.folder.getVariableFolder(t,vn)){ this.folder.moveVariable(t,vn,dfid); c++; } });
    return c;
  }
  ensureDefaultFolder(t){ const f=this.fstore(t), ex=Object.entries(f).find(([,fo])=>fo.name===CONFIG.defaultFolderName); return ex?ex[0]:this.folder.create(t,CONFIG.defaultFolderName); }

  toggleEnabled(en){
    const s=this.getSettings(); s.enabled=this.state.isEnabled=en; saveSettingsDebounced(); this.syncCheckboxState();
    if(en){ this.enable(); if(!this.state.isOpen) this.open(); } else this.disable();
  }
  createFolderDialog(t){ const n=prompt('请输入文件夹名称:','新文件夹'); if(n?.trim()){ this.folder.create(t,n.trim()); this.loadVariables(); toastr.success(`文件夹 "${n}" 已创建`); } }

  ensureSharedButton(){
    if (this.sharedBtn) return this.sharedBtn;
    const btn=document.createElement('div'); btn.title='变量面板'; btn.className='mes_btn mes_variables_panel'; btn.innerHTML='<i class="fa-solid fa-database"></i>';
    btn.addEventListener('click',(e)=>{ e.preventDefault(); e.stopPropagation(); this.open(); });
    this.sharedBtn=btn; return btn;
  }
  placeBtnToLast(){
    const last=document.querySelector('#chat>.mes:last-child'); if(!last) return;
    const id=last.getAttribute('mesid'); if(!id) return;
    if(id===this.lastMesId && this.sharedBtn) return;
    this.lastMesId=id;
    const btn=this.ensureSharedButton();
    if (typeof window.registerButtonToSubContainer === 'function') window.registerButtonToSubContainer(id, btn);
  }
  addMessageButtons(){
    if (typeof eventSource !== 'undefined') {
      if (this.eventHandlers.messageRendered) {
        eventSource.removeListener(event_types.CHARACTER_MESSAGE_RENDERED, this.eventHandlers.messageRendered);
        eventSource.removeListener(event_types.CHAT_CHANGED, this.eventHandlers.chatChanged);
      }
      this.eventHandlers={
        messageRendered: ()=>this.placeBtnToLast(),
        chatChanged: ()=>{ this.lastMesId=null; this.placeBtnToLast(); }
      };
      eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, this.eventHandlers.messageRendered);
      eventSource.on(event_types.CHAT_CHANGED, this.eventHandlers.chatChanged);
    }
    this.placeBtnToLast();
  }
  removeMessageButtons(){
    if (typeof eventSource !== 'undefined' && this.eventHandlers) {
      eventSource.removeListener(event_types.CHARACTER_MESSAGE_RENDERED, this.eventHandlers.messageRendered);
      eventSource.removeListener(event_types.CHAT_CHANGED, this.eventHandlers.chatChanged);
      this.eventHandlers={};
    }
    if (this.sharedBtn?.parentNode) this.sharedBtn.parentNode.removeChild(this.sharedBtn);
    this.sharedBtn=null; this.lastMesId=null;
  }
}

let variablesPanelInstance=null;

export async function initVariablesPanel(){
  try{
    extension_settings.variables ??= { global:{} };
    if(variablesPanelInstance) variablesPanelInstance.cleanup();
    variablesPanelInstance=new VariablesPanel();
    await variablesPanelInstance.init();
    console.log(`[${CONFIG.extensionName}] Variables Panel已加载`);
    return variablesPanelInstance;
  }catch(e){
    console.error(`[${CONFIG.extensionName}] 加载失败:`, e);
    toastr?.error?.('Variables Panel加载失败');
    throw e;
  }
}

export function getVariablesPanelInstance(){ return variablesPanelInstance; }
export function cleanupVariablesPanel(){ if(variablesPanelInstance){ variablesPanelInstance.cleanup(); variablesPanelInstance=null; } }

