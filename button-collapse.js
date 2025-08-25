import { eventSource, event_types } from "../../../../script.js";

let processTimeout = null;
let isProcessing = false;

const CONFIG = { DELAY: 50, HIDE_DELAY: 5000 };
const SELECTORS = {
    messages: '#chat .mes',
    flex: '.flex-container.flex1.alignitemscenter', 
    buttons: '.memory-button, .dynamic-prompt-analysis-btn, .mes_history_preview',
    collapse: '.xiaobaix-collapse-btn'
};

const cache = new Map();
const isEnabled = () => window.isXiaobaixEnabled === true;

const createCollapseButton = () => {
    const btn = document.createElement('div');
    btn.className = 'mes_btn xiaobaix-collapse-btn';
    btn.style.cssText = `
        opacity: 0.85;
        cursor: pointer;
        display: flex;
        width: 32px;
        height: 32px;
        align-items: center;
        justify-content: center;
        gap: inherit;
        background: radial-gradient(ellipse at top, rgba(40,40,45,0.9) 0%, rgba(0,0,0,0.95) 70%);
        border-radius: 50%;
        position: relative;
        transition: all 0.3s ease;
        box-shadow: 
            inset 0 2px 4px rgba(255,255,255,0.1),
            0 4px 12px rgba(0,100,255,0.2),
            0 0 20px rgba(0,150,255,0.1);
        -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
    `;
    
    btn.innerHTML = `
        <div style="position: relative; display: flex; align-items: center; justify-content: center; pointer-events: none;">
            <span style="
                position: absolute;
                color: rgba(255,255,255,0.1);
                font-size: 20px;
                font-family: 'Arial Black', sans-serif;
                font-weight: 900;
                font-style: italic;
                letter-spacing: -2px;
                transform: scaleX(0.8) translateX(-8px);
            ">X</span>
            <span style="
                position: absolute;
                color: rgba(255,255,255,0.2);
                font-size: 20px;
                font-family: 'Arial Black', sans-serif;
                font-weight: 900;
                font-style: italic;
                letter-spacing: -2px;
                transform: scaleX(0.8) translateX(-4px);
            ">X</span>
            <span style="
                position: absolute;
                color: rgba(255,255,255,0.4);
                font-size: 20px;
                font-family: 'Arial Black', sans-serif;
                font-weight: 900;
                font-style: italic;
                letter-spacing: -2px;
                transform: scaleX(0.8) translateX(-2px);
            ">X</span>
            <span style="
                color: #FFFFFF;
                font-size: 20px;
                font-family: 'Arial Black', sans-serif;
                font-weight: 900;
                font-style: italic;
                letter-spacing: -2px;
                text-shadow: 
                    0 0 10px rgba(255,255,255,0.5),
                    0 0 20px rgba(100,200,255,0.3);
                transform: scaleX(0.8);
            ">X</span>
        </div>
        <div class="xiaobaix-sub-container" style="
            display: none;
            position: absolute;
            left: 38px;
            top: 50%;
            transform: translateY(-50%);
            background: linear-gradient(135deg, rgba(20,20,25,0.95) 0%, rgba(0,0,0,0.98) 100%);
            border: 1px solid rgba(100,150,255,0.2);
            border-radius: 8px;
            padding: 4px;
            gap: 8px;
            box-shadow: 
                0 4px 16px rgba(0,100,255,0.2),
                inset 0 1px 0 rgba(255,255,255,0.05);
            backdrop-filter: blur(10px);
            z-index: 1000;
        "></div>
    `;
  
    const sub = btn.lastElementChild;
    let timer = null;
  
    const hide = (delay = CONFIG.HIDE_DELAY) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            sub.style.display = 'none';
            btn.style.opacity = '0.85';
            btn.style.transform = 'scale(1)';
        }, delay);
    };

    btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        const isHidden = sub.style.display === 'none';
        sub.style.display = isHidden ? 'flex' : 'none';
        btn.style.opacity = isHidden ? '1' : '0.85';
        btn.style.transform = isHidden ? 'scale(1.1)' : 'scale(1)';
        
        if (isHidden) {
            hide();
        } else {
            clearTimeout(timer);
        }
    });

    btn.addEventListener('touchstart', function(e) {
        e.stopPropagation();
    }, { passive: true });
  
    return btn;
};

const processMessages = () => {
    if (!isEnabled() || isProcessing) return;
  
    isProcessing = true;
  
    requestAnimationFrame(() => {
        const messages = document.querySelectorAll(SELECTORS.messages);
        
        messages.forEach(message => {
            const flex = message.querySelector(SELECTORS.flex);
            if (!flex || flex.querySelector(SELECTORS.collapse)) return;
          
            const targetBtns = flex.querySelectorAll(SELECTORS.buttons);
            if (!targetBtns.length) return;

            const collapseBtn = createCollapseButton();
            const sub = collapseBtn.lastElementChild;
          
            targetBtns.forEach(btn => {
                const clonedBtn = btn.cloneNode(true);
                
                clonedBtn.onclick = btn.onclick;
                
                if (btn._listeners) {
                    clonedBtn._listeners = btn._listeners;
                }
                
                btn.remove();
                sub.appendChild(clonedBtn);
            });
          
            flex.appendChild(collapseBtn);
        });
      
        isProcessing = false;
    });
};

const registerButton = (messageId, buttonElement) => {
    if (!isEnabled() || !buttonElement) return false;
  
    const message = document.querySelector(`${SELECTORS.messages}[mesid="${messageId}"]`);
    if (!message) return false;
    
    const flex = message.querySelector(SELECTORS.flex);
    if (!flex) return false;

    let collapseBtn = flex.querySelector(SELECTORS.collapse);
    if (!collapseBtn) {
        collapseBtn = createCollapseButton();
        flex.appendChild(collapseBtn);
    }

    collapseBtn.lastElementChild.appendChild(buttonElement);
    return true;
};

const cleanup = () => {
    clearTimeout(processTimeout);
    processTimeout = null;
    isProcessing = false;
    cache.clear();
  
    const collapseBtns = document.querySelectorAll(SELECTORS.collapse);
    
    collapseBtns.forEach(btn => {
        const sub = btn.lastElementChild;
        const flex = btn.closest(SELECTORS.flex);
      
        if (sub && flex) {
            while(sub.firstChild) {
                flex.appendChild(sub.firstChild);
            }
        }
        btn.remove();
    });
};

const debounce = () => {
    clearTimeout(processTimeout);
    processTimeout = setTimeout(processMessages, CONFIG.DELAY);
};

const init = () => {
    const events = [
        event_types.CHAT_CHANGED,
        event_types.MESSAGE_RECEIVED,
        event_types.CHARACTER_MESSAGE_RENDERED,
        event_types.USER_MESSAGE_RENDERED,
        event_types.MESSAGE_SWIPED,
        event_types.MESSAGE_EDITED,
        event_types.MESSAGE_UPDATED
    ];
    
    events.forEach(event => {
        if (event) {
            eventSource.on(event, () => {
                if (isEnabled()) {
                    setTimeout(() => {
                        requestAnimationFrame(debounce);
                    }, 150);
                }
            });
        }
    });

    document.addEventListener('xiaobaixEnabledChanged', e => {
        if (e?.detail?.enabled) {
            setTimeout(() => {
                requestAnimationFrame(debounce);
            }, 200);
        } else {
            cleanup();
        }
    }, { passive: true });
};

const exports = { init, cleanup, registerButton };
if (typeof window !== 'undefined') {
    Object.assign(window, { 
        buttonCollapseCleanup: cleanup, 
        processLastTwoCollapseMessages: processMessages, 
        registerButtonToSubContainer: registerButton 
    });
}

export { init as initButtonCollapse, cleanup, registerButton as registerButtonToSubContainer };
