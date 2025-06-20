import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types, this_chid, getCurrentChatId } from "../../../../script.js";
import { selected_group } from "../../../group-chats.js";

const EXT_ID = "LittleWhiteBox";
const MODULE_NAME = "immersive";

const defaultSettings = {
    enabled: false,
    currentFloor: -1,
    showNavigationButtons: true
};

let isImmersiveModeActive = false;
let totalMessages = 0;
let currentDisplayFloor = -1;
let menuButtonAdded = false;

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
    
    [event_types.MESSAGE_RECEIVED, event_types.MESSAGE_SENT].forEach(eventType => {
        eventSource.on(eventType, onMessageUpdate);
    });
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
}

function disableImmersiveMode() {
    console.log('[小白X] 禁用沉浸式显示模式');
    $('body').removeClass('immersive-mode');
    $('#chat .mes').show();
    hideNavigationButtons();
}

function updateMessageDisplay() {
    if (!isImmersiveModeActive) return;
    
    const messages = $('#chat .mes');
    totalMessages = messages.length;
    
    if (totalMessages === 0) return;
    
    messages.hide();
    
    const targetIndex = (currentDisplayFloor === -1 || currentDisplayFloor >= totalMessages) 
        ? totalMessages - 1 : currentDisplayFloor;
    
    if (targetIndex >= 0) {
        $(messages[targetIndex]).show();
        if (currentDisplayFloor >= totalMessages) currentDisplayFloor = -1;
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
                <button id="immersive-up" class="immersive-nav-btn" title="上一条消息">
                    <i class="fa-solid fa-chevron-up"></i>
                </button>
                <span id="immersive-counter" class="immersive-counter">1/1</span>
                <button id="immersive-down" class="immersive-nav-btn" title="下一条消息">
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
            '#immersive-counter': showFloorInput
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
    if (!isImmersiveModeActive || totalMessages === 0) return;
    
    const currentIndex = currentDisplayFloor === -1 ? totalMessages - 1 : currentDisplayFloor;
    $('#immersive-counter').text(`${currentIndex + 1}/${totalMessages}`);
    $('#immersive-up').prop('disabled', currentIndex <= 0);
    $('#immersive-down').prop('disabled', currentIndex >= totalMessages - 1);
}

function navigate(direction) {
    if (!isImmersiveModeActive || totalMessages === 0) return;
    
    const currentIndex = currentDisplayFloor === -1 ? totalMessages - 1 : currentDisplayFloor;
    const newIndex = currentIndex + direction;
    
    if (direction === -1 && newIndex >= 0) {
        currentDisplayFloor = newIndex;
        updateMessageDisplay();
    } else if (direction === 1) {
        if (newIndex < totalMessages - 1) {
            currentDisplayFloor = newIndex;
        } else {
            currentDisplayFloor = -1;
        }
        updateMessageDisplay();
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

function showFloorInput() {
    if (!isImmersiveModeActive || totalMessages === 0) return;

    const $counter = $('#immersive-counter');
    const currentIndex = currentDisplayFloor === -1 ? totalMessages - 1 : currentDisplayFloor;
    const $input = $(`<input type="number" class="immersive-floor-input" min="1" max="${totalMessages}" value="${currentIndex + 1}">`);

    $counter.replaceWith($input);
    $input.focus().select();

    $input.on('blur keydown', function(e) {
        const shouldApply = e.type === 'blur' || e.key === 'Enter';
        const shouldCancel = e.key === 'Escape';
        
        if (shouldApply || shouldCancel) {
            if (shouldApply && !shouldCancel) {
                const inputValue = parseInt($(this).val());
                if (!isNaN(inputValue) && inputValue >= 1 && inputValue <= totalMessages) {
                    currentDisplayFloor = inputValue - 1;
                    updateMessageDisplay();
                }
            }

            const $newCounter = $('<span id="immersive-counter" class="immersive-counter">1/1</span>');
            $(this).replaceWith($newCounter);
            $newCounter.on('click', showFloorInput);
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

function findLastAIMessage() {
    const messages = $('#chat .mes');
    for (let i = messages.length - 1; i >= 0; i--) {
        const $message = $(messages[i]);
        if (!$message.hasClass('is_user')) {
            return i;
        }
    }
    return -1;
}

function onMessageUpdate() {
    const globalEnabled = window.isXiaobaixEnabled !== undefined ? window.isXiaobaixEnabled : true;
    if (!globalEnabled) return;
    
    if (isImmersiveModeActive) {
        setTimeout(() => {
            const lastAIMessageIndex = findLastAIMessage();
            if (lastAIMessageIndex !== -1) {
                currentDisplayFloor = lastAIMessageIndex;
            } else if (currentDisplayFloor === -1) {
                currentDisplayFloor = -1;
            }

            updateMessageDisplay();
        }, 100);
    }
}

function onChatChanged() {
    const globalEnabled = window.isXiaobaixEnabled !== undefined ? window.isXiaobaixEnabled : true;
    if (!globalEnabled) return;
    
    if (isImmersiveModeActive) {
        currentDisplayFloor = -1;
        setTimeout(() => {
            updateMessageDisplay();
            showNavigationButtons();
        }, 100);
    }
}

export { initImmersiveMode };
