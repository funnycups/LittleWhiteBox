let stylesInjected = false;

const SELECTORS = {
  chat: '#chat',
  messages: '.mes',
  flex: '.flex-container.flex1.alignitemscenter',
  baseline: '.flex-container.alignItemsBaseline',
  timestamp: 'small.timestamp[title]',
  buttons: '.memory-button, .dynamic-prompt-analysis-btn, .mes_history_preview',
  collapse: '.xiaobaix-collapse-btn',
};

const injectStyles = () => {
  if (stylesInjected) return;
  const css = `
.xiaobaix-collapse-btn{
  position:relative;display:inline-flex;width:32px;height:32px;align-items:center;justify-content:center;
  border-radius:50%;background:var(--SmartThemeBlurTintColor);opacity:.95;cursor:pointer;z-index:1;
  box-shadow:inset 0 0 15px rgba(0,0,0,.6),0 2px 8px rgba(0,0,0,.2);
  transition:opacity .15s ease,transform .15s ease;-webkit-tap-highlight-color:transparent;touch-action:manipulation;
}
.xiaobaix-collapse-btn.open{opacity:1;transform:scale(1.06);}
.xiaobaix-xstack{position:relative;display:inline-flex;align-items:center;justify-content:center;pointer-events:none;}
.xiaobaix-xstack span{
  position:absolute;font:italic 900 20px 'Arial Black',sans-serif;letter-spacing:-2px;transform:scaleX(.8);
  text-shadow:0 0 10px rgba(255,255,255,.5),0 0 20px rgba(100,200,255,.3);color:#fff;
}
.xiaobaix-xstack span:nth-child(1){color:rgba(255,255,255,.1);transform:scaleX(.8) translateX(-8px);text-shadow:none}
.xiaobaix-xstack span:nth-child(2){color:rgba(255,255,255,.2);transform:scaleX(.8) translateX(-4px);text-shadow:none}
.xiaobaix-xstack span:nth-child(3){color:rgba(255,255,255,.4);transform:scaleX(.8) translateX(-2px);text-shadow:none}
.xiaobaix-sub-container{
  display:none;position:absolute;left:38px;top:50%;transform:translateY(-50%);
  background:var(--SmartThemeBlurTintColor);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
  border:1px solid var(--SmartThemeBorderColor);border-radius:8px;padding:4px;gap:8px;pointer-events:auto;
  box-shadow:0 4px 16px rgba(0,100,255,.2), inset 0 1px 0 rgba(255,255,255,.05);z-index:999;
  transition:background-color .15s ease,box-shadow .15s ease,border-color .15s ease,opacity .15s ease;
}
.xiaobaix-collapse-btn.open .xiaobaix-sub-container{
  display:flex;background:var(--SmartThemeBlurTintColor);
}
.xiaobaix-sub-container, .xiaobaix-sub-container *{pointer-events:auto !important;}
.xiaobaix-sub-container .memory-button,
.xiaobaix-sub-container .dynamic-prompt-analysis-btn,
.xiaobaix-sub-container .mes_history_preview{opacity:1 !important;filter:none !important;}
`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  stylesInjected = true;
};

const createCollapseButton = () => {
  injectStyles();
  const btn = document.createElement('div');
  btn.className = 'mes_btn xiaobaix-collapse-btn';
  btn.innerHTML = `
    <div class="xiaobaix-xstack"><span>X</span><span>X</span><span>X</span><span>X</span></div>
    <div class="xiaobaix-sub-container"></div>
  `;
  const sub = btn.lastElementChild;
  ['click','pointerdown','pointerup'].forEach(t => {
    sub.addEventListener(t, e => e.stopPropagation(), { passive: true });
  });
  btn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    btn.classList.toggle('open');
  }, { passive: false });
  return btn;
};

const shouldPlaceAtEnd = (messageEl) => {
  const baseline = messageEl?.querySelector(SELECTORS.baseline);
  const ts = baseline?.querySelector(SELECTORS.timestamp);
  return !!ts && getComputedStyle(ts).display === 'none';
};

const placeButton = (flex, btn, atEnd) => {
  if (!flex || !btn) return;
  if (atEnd) {
    if (flex.lastElementChild !== btn) flex.append(btn);
  } else {
    if (flex.firstElementChild !== btn) flex.prepend(btn);
  }
};

const ensureCollapseForMessage = (messageEl) => {
  const flex = messageEl?.querySelector(SELECTORS.flex);
  if (!flex) return null;
  let collapseBtn = flex.querySelector(SELECTORS.collapse);
  if (!collapseBtn) collapseBtn = createCollapseButton();
  placeButton(flex, collapseBtn, shouldPlaceAtEnd(messageEl));
  return collapseBtn;
};

let processed = new WeakSet();
let io, mo;

const processOneMessage = (message) => {
  if (!message || processed.has(message)) return;
  const flex = message.querySelector(SELECTORS.flex);
  if (!flex) { processed.add(message); return; }
  const targetBtns = flex.querySelectorAll(SELECTORS.buttons);
  if (!targetBtns.length) { processed.add(message); return; }
  const collapseBtn = ensureCollapseForMessage(message);
  if (!collapseBtn) { processed.add(message); return; }
  const sub = collapseBtn.querySelector('.xiaobaix-sub-container');
  const frag = document.createDocumentFragment();
  targetBtns.forEach(b => frag.appendChild(b));
  sub.appendChild(frag);
  processed.add(message);
};

const observeVisibility = (nodes) => {
  if (!io) {
    io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (processed.has(e.target)) { io.unobserve(e.target); continue; }
        if (e.isIntersecting) {
          processOneMessage(e.target);
          io.unobserve(e.target);
        }
      }
    }, {
      root: document.querySelector(SELECTORS.chat) || null,
      rootMargin: '200px 0px',
      threshold: 0
    });
  }
  const root = io.root || null;
  const rootRect = (root || document.documentElement).getBoundingClientRect();
  const maxDistancePx = 3000;
  nodes.forEach(n => {
    if (!n || processed.has(n)) return;
    let r;
    try { r = n.getBoundingClientRect(); } catch { r = null; }
    if (!r) { io.observe(n); return; }
    const beyond = r.bottom < rootRect.top - maxDistancePx || r.top > rootRect.bottom + maxDistancePx;
    if (!beyond) io.observe(n);
  });
};

let moQueued = false, moAddedBuffer = [];
const hookMutations = () => {
  const chat = document.querySelector(SELECTORS.chat);
  if (!chat) return;
  if (!mo) {
    mo = new MutationObserver((muts) => {
      for (const m of muts) {
        m.addedNodes && m.addedNodes.forEach(n => {
          if (n.nodeType !== 1) return;
          if (n.matches?.(SELECTORS.messages)) {
            moAddedBuffer.push(n);
          } else {
            const list = n.querySelectorAll?.(SELECTORS.messages);
            if (list?.length) moAddedBuffer.push(...list);
          }
        });
      }
      if (!moQueued && moAddedBuffer.length) {
        moQueued = true;
        requestAnimationFrame(() => {
          const batch = moAddedBuffer;
          moAddedBuffer = [];
          moQueued = false;
          observeVisibility(batch);
        });
      }
    });
  }
  mo.observe(chat, { childList: true, subtree: true });
};

const processExistingVisible = () => {
  const all = document.querySelectorAll(`${SELECTORS.chat} ${SELECTORS.messages}`);
  if (!all.length) return;
  const unprocessed = [];
  all.forEach(n => { if (!processed.has(n)) unprocessed.push(n); });
  if (unprocessed.length) observeVisibility(unprocessed);
};

const initButtonCollapse = () => {
  injectStyles();
  hookMutations();
  processExistingVisible();
  if (window.registerModuleCleanup) {
    try { window.registerModuleCleanup('buttonCollapse', cleanup); } catch (e) {}
  }
};

const processButtonCollapse = () => {
  processExistingVisible();
};

const registerButtonToSubContainer = (messageId, buttonEl) => {
  if (!buttonEl) return false;
  const message = document.querySelector(`${SELECTORS.chat} ${SELECTORS.messages}[mesid="${messageId}"]`);
  if (!message) return false;
  processOneMessage(message);
  const collapseBtn = message.querySelector(SELECTORS.collapse) || ensureCollapseForMessage(message);
  if (!collapseBtn) return false;
  const sub = collapseBtn.querySelector('.xiaobaix-sub-container');
  sub.appendChild(buttonEl);
  buttonEl.style.pointerEvents = 'auto';
  buttonEl.style.opacity = '1';
  return true;
};

const cleanup = () => {
  io?.disconnect(); io = null;
  mo?.disconnect(); mo = null;
  moAddedBuffer = [];
  moQueued = false;
  const collapseBtns = document.querySelectorAll(SELECTORS.collapse);
  collapseBtns.forEach(btn => {
    const sub = btn.querySelector('.xiaobaix-sub-container');
    const flex = btn.closest(SELECTORS.flex);
    if (sub && flex) {
      const frag = document.createDocumentFragment();
      while (sub.firstChild) frag.appendChild(sub.firstChild);
      flex.appendChild(frag);
    }
    btn.remove();
  });
  processed = new WeakSet();
};

if (typeof window !== 'undefined') {
  Object.assign(window, {
    initButtonCollapse,
    cleanupButtonCollapse: cleanup,
    registerButtonToSubContainer,
    processButtonCollapse,
  });
  document.addEventListener('xiaobaixEnabledChanged', (e) => {
    const en = e && e.detail && e.detail.enabled;
    if (!en) cleanup();
  });
}

export { initButtonCollapse, cleanup, registerButtonToSubContainer, processButtonCollapse };
