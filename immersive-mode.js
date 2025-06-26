import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types, this_chid, getCurrentChatId } from "../../../../script.js";
import { selected_group } from "../../../group-chats.js";

const EXT_ID = "LittleWhiteBox";
const MODULE_NAME = "immersive";

const defaultSettings = {
    enabled: false,
    showAllMessages: false,
    autoJumpOnAI: true
};

let isImmersiveModeActive = false;
let menuButtonAdded = false;
let chatObserver = null;

function initImmersiveMode() {
    if (!extension_settings[EXT_ID].immersive) {
        extension_settings[EXT_ID].immersive = structuredClone(defaultSettings);
    }
    
    const settings = extension_settings[EXT_ID].immersive;
    
    for (const key in defaultSettings) {
        if (settings[key] === undefined) {
            settings[key] = defaultSettings[key];
        }
    }
    
    const globalEnabled = window.isXiaobaixEnabled !== undefined ? window.isXiaobaixEnabled : true;
    
    if (globalEnabled) {
        addMenuButton();
        
        isImmersiveModeActive = settings.enabled;
        
        if (isImmersiveModeActive) {
            enableImmersiveMode();
        }
        
        updateMenuButtonState();
    }
    
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    document.addEventListener('xiaobaixEnabledChanged', handleGlobalStateChange);
    
    console.log(`[${EXT_ID}] 沉浸式显示模式功能已加载`);
}

function handleGlobalStateChange(event) {
    const globalEnabled = event.detail.enabled;
    
    if (globalEnabled) {
        addMenuButton();
        
        const settings = getImmersiveSettings();
        if (settings.enabled) {
            isImmersiveModeActive = true;
            enableImmersiveMode();
        }
    } else {
        if (isImmersiveModeActive) {
            disableImmersiveMode();
        }
        
        removeMenuButton();
        isImmersiveModeActive = false;
    }
    
    updateMenuButtonState();
}

function addMenuButton() {
    if (!menuButtonAdded && $('#immersive-mode-toggle').length === 0) {
        const buttonHtml = `
            <div id="immersive-mode-toggle" class="list-group-item flex-container flexGap5" title="切换沉浸式显示模式">
                <div class="fa-solid fa-eye extensionsMenuExtensionButton"></div>
                <span>沉浸式模式</span>
            </div>
        `;
        $('#extensionsMenu').append(buttonHtml);
        
        $('#immersive-mode-toggle').on('click', toggleImmersiveMode);
        
        menuButtonAdded = true;
    }
}

function removeMenuButton() {
    $('#immersive-mode-toggle').remove();
    menuButtonAdded = false;
}

function getImmersiveSettings() {
    return extension_settings[EXT_ID].immersive;
}

function toggleImmersiveMode() {
    const globalEnabled = window.isXiaobaixEnabled !== undefined ? window.isXiaobaixEnabled : true;
    if (!globalEnabled) return;
    
    const settings = getImmersiveSettings();
    settings.enabled = !settings.enabled;
    isImmersiveModeActive = settings.enabled;
    
    if (isImmersiveModeActive) {
        enableImmersiveMode();
    } else {
        disableImmersiveMode();
    }
    
    saveSettingsDebounced();
    updateMenuButtonState();
}

function enableImmersiveMode() {
    const globalEnabled = window.isXiaobaixEnabled !== undefined ? window.isXiaobaixEnabled : true;
    if (!globalEnabled) return;
    
    console.log('[小白X] 启用沉浸式显示模式');
    $('body').addClass('immersive-mode');
    updateMessageDisplay();
    showNavigationButtons();
    startChatObserver();
}

function disableImmersiveMode() {
    console.log('[小白X] 禁用沉浸式显示模式');
    $('body').removeClass('immersive-mode');
    $('#chat .mes').show();
    hideNavigationButtons();
    stopChatObserver();
}

function startChatObserver() {
    if (chatObserver) {
        stopChatObserver();
    }
    
    const chatContainer = document.getElementById('chat');
    if (!chatContainer) return;
    
    chatObserver = new MutationObserver((mutations) => {
        let hasValidAIMessage = false;
        
        mutations.forEach((mutation) => {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE && node.classList && node.classList.contains('mes')) {
                        // 檢查是否為AI消息：is_user="false" 且 is_system="false"
                        const isUser = node.getAttribute('is_user') === 'true';
                        const isSystem = node.getAttribute('is_system') === 'true';
                        
                        if (!isUser && !isSystem) {
                            hasValidAIMessage = true;
                            console.log('[小白X] 檢測到AI消息，準備切換頁面');
                        }
                    }
                });
            }
            
            // 監聽內容變化（打字效果等）
            if (mutation.type === 'subtree' || mutation.type === 'characterData') {
                const target = mutation.target;
                if (target && target.closest) {
                    const mesElement = target.closest('.mes');
                    if (mesElement) {
                        const isUser = mesElement.getAttribute('is_user') === 'true';
                        const isSystem = mesElement.getAttribute('is_system') === 'true';
                        
                        if (!isUser && !isSystem) {
                            hasValidAIMessage = true;
                        }
                    }
                }
            }
        });
        
        if (hasValidAIMessage) {
            handleChatUpdate();
        }
    });
    
    chatObserver.observe(chatContainer, {
        childList: true,
        subtree: true,
        characterData: true
    });
}

function stopChatObserver() {
    if (chatObserver) {
        chatObserver.disconnect();
        chatObserver = null;
    }
}

function handleChatUpdate() {
    if (!isImmersiveModeActive) return;
    
    const settings = getImmersiveSettings();
    
    if (settings.autoJumpOnAI && !settings.showAllMessages) {
        console.log('[小白X] AI消息檢測，保持單個消息顯示模式');
        updateMessageDisplay();
    } else if (settings.showAllMessages) {
        console.log('[小白X] AI消息檢測，但當前為多層模式，不進行跳轉');
        updateMessageDisplay();
    }
}

function updateMessageDisplay() {
    if (!isImmersiveModeActive) return;
    
    const messages = $('#chat .mes');
    const settings = getImmersiveSettings();
    
    if (messages.length === 0) return;
    
    if (settings.showAllMessages) {
        messages.show();
    } else {
        messages.hide();
        messages.last().show();
    }
    
    updateNavigationButtons();
}

function isInChat() {
    return this_chid !== undefined || selected_group || getCurrentChatId() !== undefined;
}

function showNavigationButtons() {
    if (!isInChat()) {
        hideNavigationButtons();
        return;
    }

    if ($('#immersive-navigation').length === 0) {
        const navigationHtml = `
            <div id="immersive-navigation" class="immersive-navigation">
                <button id="immersive-swipe-left" class="immersive-nav-btn" title="左滑消息">
                    <i class="fa-solid fa-chevron-left"></i>
                </button>
                <button id="immersive-toggle" class="immersive-nav-btn" title="切换显示模式">
                    <i class="fa-solid fa-expand"></i>
                </button>
                <button id="immersive-swipe-right" class="immersive-nav-btn" title="右滑消息">
                    <i class="fa-solid fa-chevron-right"></i>
                </button>
            </div>
        `;

        $('#chat').after(navigationHtml);

        const navActions = {
            '#immersive-swipe-left': () => handleSwipe('.swipe_left'),
            '#immersive-toggle': toggleDisplayMode,
            '#immersive-swipe-right': () => handleSwipe('.swipe_right')
        };

        Object.entries(navActions).forEach(([selector, handler]) => {
            $(selector).on('click', handler);
        });
    }

    updateNavigationButtons();
}

function hideNavigationButtons() {
    $('#immersive-navigation').remove();
}

function updateNavigationButtons() {
    if (!isImmersiveModeActive) return;
    
    const settings = getImmersiveSettings();
    const $toggleBtn = $('#immersive-toggle');
    
    if (settings.showAllMessages) {
        $toggleBtn.find('i').removeClass('fa-expand').addClass('fa-compress');
        $toggleBtn.attr('title', '切换到单层模式');
    } else {
        $toggleBtn.find('i').removeClass('fa-compress').addClass('fa-expand');
        $toggleBtn.attr('title', '切换到多层模式');
    }
}

function toggleDisplayMode() {
    if (!isImmersiveModeActive) return;
    
    const settings = getImmersiveSettings();
    settings.showAllMessages = !settings.showAllMessages;
    
    updateMessageDisplay();
    saveSettingsDebounced();
}

function handleSwipe(swipeSelector) {
    if (!isImmersiveModeActive) return;

    const currentMessage = $('#chat .mes:visible').last();
    const swipeBtn = currentMessage.find(swipeSelector);
    if (swipeBtn.length > 0) {
        swipeBtn.click();
    }
}

function updateMenuButtonState() {
    const $button = $('#immersive-mode-toggle');
    if ($button.length === 0) return;
    
    const settings = getImmersiveSettings();
    const iconClass = settings.enabled ? 'fa-eye-slash' : 'fa-eye';
    
    $button.toggleClass('active', settings.enabled);
    $button.find('.extensionsMenuExtensionButton').removeClass('fa-eye fa-eye-slash').addClass(iconClass);
}

function onChatChanged() {
    const globalEnabled = window.isXiaobaixEnabled !== undefined ? window.isXiaobaixEnabled : true;
    if (!globalEnabled) return;
    
    if (isImmersiveModeActive) {
        setTimeout(() => {
            startChatObserver();
            updateMessageDisplay();
            showNavigationButtons();
        }, 100);
    }
}

export { initImmersiveMode };
