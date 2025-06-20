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
        let hasNewMessage = false;
        let hasAIMessage = false;
        
        mutations.forEach((mutation) => {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE && node.classList && node.classList.contains('mes')) {
                        hasNewMessage = true;
                        if (!node.classList.contains('is_user')) {
                            hasAIMessage = true;
                        }
                    }
                });
            }
            
            if (mutation.type === 'subtree' || mutation.type === 'characterData') {
                const target = mutation.target;
                if (target && target.closest && target.closest('.mes:not(.is_user)')) {
                    hasAIMessage = true;
                }
            }
        });
        
        if (hasNewMessage || hasAIMessage) {
            handleChatUpdate(hasAIMessage);
        }
    });
    
    chatObserver.observe(chatContainer, {
        childList: true,
        subtree: true,
        characterData: true
    });
    
    console.log('[小白X] 开始监听聊天DOM变化');
}

function stopChatObserver() {
    if (chatObserver) {
        chatObserver.disconnect();
        chatObserver = null;
        console.log('[小白X] 停止监听聊天DOM变化');
    }
}

function handleChatUpdate(hasAIMessage) {
    if (!isImmersiveModeActive) return;
    
    const settings = getImmersiveSettings();
    
    if (settings.autoJumpOnAI && hasAIMessage) {
        console.log('[小白X] 检测到AI消息，切换到最新消息模式');
        settings.showAllMessages = false;
        saveSettingsDebounced();
    }
    
    updateMessageDisplay();
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
                <button id="immersive-swipe-left" class="immersive-nav-btn" title="左滑">
                    <i class="fa-solid fa-chevron-left"></i>
                </button>
                <button id="immersive-up" class="immersive-nav-btn" title="上一页">
                    <i class="fa-solid fa-chevron-up"></i>
                </button>
                <span id="immersive-counter" class="immersive-counter">1/2</span>
                <button id="immersive-down" class="immersive-nav-btn" title="下一页">
                    <i class="fa-solid fa-chevron-down"></i>
                </button>
                <button id="immersive-swipe-right" class="immersive-nav-btn" title="右滑">
                    <i class="fa-solid fa-chevron-right"></i>
                </button>
            </div>
        `;

        $('#chat').after(navigationHtml);

        const navActions = {
            '#immersive-up': () => navigate(-1),
            '#immersive-down': () => navigate(1),
            '#immersive-swipe-left': () => handleSwipe('.swipe_left'),
            '#immersive-swipe-right': () => handleSwipe('.swipe_right'),
            '#immersive-counter': showPageInput
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
    const currentPage = settings.showAllMessages ? 1 : 2;
    
    $('#immersive-counter').text(`${currentPage}/2`);
    $('#immersive-up').prop('disabled', currentPage <= 1);
    $('#immersive-down').prop('disabled', currentPage >= 2);
}

function navigate(direction) {
    if (!isImmersiveModeActive) return;
    
    const settings = getImmersiveSettings();
    const currentPage = settings.showAllMessages ? 1 : 2;
    
    if (direction === -1 && currentPage > 1) {
        settings.showAllMessages = true;
        updateMessageDisplay();
        saveSettingsDebounced();
    } else if (direction === 1 && currentPage < 2) {
        settings.showAllMessages = false;
        updateMessageDisplay();
        saveSettingsDebounced();
    }
}

function handleSwipe(swipeSelector) {
    if (!isImmersiveModeActive) return;

    const currentMessage = $('#chat .mes:visible').last();
    const swipeBtn = currentMessage.find(swipeSelector);
    if (swipeBtn.length > 0) {
        swipeBtn.click();
    }
}

function showPageInput() {
    if (!isImmersiveModeActive) return;

    const $counter = $('#immersive-counter');
    const settings = getImmersiveSettings();
    const currentPage = settings.showAllMessages ? 1 : 2;
    const $input = $(`<input type="number" class="immersive-floor-input" min="1" max="2" value="${currentPage}">`);

    $counter.replaceWith($input);
    $input.focus().select();

    $input.on('blur keydown', function(e) {
        const shouldApply = e.type === 'blur' || e.key === 'Enter';
        const shouldCancel = e.key === 'Escape';
        
        if (shouldApply || shouldCancel) {
            if (shouldApply && !shouldCancel) {
                const inputValue = parseInt($(this).val());
                if (inputValue === 1 || inputValue === 2) {
                    settings.showAllMessages = (inputValue === 1);
                    updateMessageDisplay();
                    saveSettingsDebounced();
                }
            }

            const $newCounter = $('<span id="immersive-counter" class="immersive-counter">1/2</span>');
            $(this).replaceWith($newCounter);
            $newCounter.on('click', showPageInput);
            updateNavigationButtons();
        }
    });
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
