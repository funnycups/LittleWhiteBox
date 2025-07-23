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

let state = {
   isActive: false,
   chatObserver: null,
   eventsBound: false,
   eventHandlers: {}
};

// Initialize and settings management
function initImmersiveMode() {
   initSettings();
   setupEventListeners();

   if (isGlobalEnabled()) {
       state.isActive = getSettings().enabled;
       if (state.isActive) enableImmersiveMode();
       bindSettingsEvents();
   }

   console.log(`[${EXT_ID}] 沉浸式显示模式功能已加载`);
}

function initSettings() {
   if (!extension_settings[EXT_ID].immersive) {
       extension_settings[EXT_ID].immersive = structuredClone(defaultSettings);
   }

   const settings = extension_settings[EXT_ID].immersive;
   Object.keys(defaultSettings).forEach(key => {
       settings[key] = settings[key] ?? defaultSettings[key];
   });

   updateControlState();
}

function setupEventListeners() {
   state.eventHandlers = {
       chatChanged: onChatChanged,
       globalStateChange: handleGlobalStateChange
   };

   eventSource.on(event_types.CHAT_CHANGED, state.eventHandlers.chatChanged);
   document.addEventListener('xiaobaixEnabledChanged', state.eventHandlers.globalStateChange);

   if (window.registerModuleCleanup) {
       window.registerModuleCleanup('immersiveMode', cleanup);
   }
}

// Helper functions
const isGlobalEnabled = () => window.isXiaobaixEnabled ?? true;
const getSettings = () => extension_settings[EXT_ID].immersive;
const isInChat = () => this_chid !== undefined || selected_group || getCurrentChatId() !== undefined;

function updateControlState() {
   const enabled = isGlobalEnabled();
   $('#xiaobaix_immersive_enabled')
       .prop('disabled', !enabled)
       .toggleClass('disabled-control', !enabled);
}

// Settings event handlers
function bindSettingsEvents() {
   if (state.eventsBound) return;

   setTimeout(() => {
       const checkbox = document.getElementById('xiaobaix_immersive_enabled');
       if (checkbox && !state.eventsBound) {
           checkbox.checked = getSettings().enabled;
           checkbox.addEventListener('change', () => setImmersiveMode(checkbox.checked));
           state.eventsBound = true;
       }
   }, 500);
}

function unbindSettingsEvents() {
   const checkbox = document.getElementById('xiaobaix_immersive_enabled');
   if (checkbox) {
       const newCheckbox = checkbox.cloneNode(true);
       checkbox.parentNode.replaceChild(newCheckbox, checkbox);
   }
   state.eventsBound = false;
}

// Mode management
function setImmersiveMode(enabled) {
   const settings = getSettings();
   settings.enabled = enabled;
   state.isActive = enabled;

   const checkbox = document.getElementById('xiaobaix_immersive_enabled');
   if (checkbox) checkbox.checked = enabled;

   enabled ? enableImmersiveMode() : disableImmersiveMode();
   if (!enabled) cleanup();

   saveSettingsDebounced();
}

function toggleImmersiveMode() {
   if (!isGlobalEnabled()) return;
   setImmersiveMode(!getSettings().enabled);
}

function enableImmersiveMode() {
   if (!isGlobalEnabled()) return;

   console.log('[小白X] 启用沉浸式显示模式');
   $('body').addClass('immersive-mode');
   moveAvatarWrappers();
   updateMessageDisplay();
   showNavigationButtons();
   startChatObserver();
}

function disableImmersiveMode() {
   console.log('[小白X] 禁用沉浸式显示模式');
   $('body').removeClass('immersive-mode');
   restoreAvatarWrappers();
   $('#chat .mes').show();
   hideNavigationButtons();
   stopChatObserver();
   $('.swipe_left, .swipeRightBlock').show();
}

// Avatar management
function moveAvatarWrappers() {
   $('#chat .mes').each(function() {
       const $mes = $(this);
       const $avatarWrapper = $mes.find('.mesAvatarWrapper');
       const $chName = $mes.find('.ch_name.flex-container.justifySpaceBetween');
       const $targetSibling = $chName.find('.flex-container.flex1.alignitemscenter');
       const $nameText = $mes.find('.name_text');

       if ($avatarWrapper.length && $chName.length && $targetSibling.length && !$chName.find('.mesAvatarWrapper').length) {
           $targetSibling.before($avatarWrapper);

           if ($nameText.length && !$nameText.parent().hasClass('xiaobaix-vertical-wrapper')) {
               const $verticalWrapper = $('<div class="xiaobaix-vertical-wrapper" style="display: flex; flex-direction: column; flex: 1; margin-top: 5px; align-self: stretch; justify-content: space-between;"></div>');
               const $topGroup = $('<div class="xiaobaix-top-group"></div>');

               $topGroup.append($nameText.detach(), $targetSibling.detach());
               $verticalWrapper.append($topGroup);
               $avatarWrapper.after($verticalWrapper);
           }
       }
   });
}

function restoreAvatarWrappers() {
   $('#chat .mes').each(function() {
       const $mes = $(this);
       const $avatarWrapper = $mes.find('.mesAvatarWrapper');
       const $verticalWrapper = $mes.find('.xiaobaix-vertical-wrapper');

       if ($avatarWrapper.length && !$avatarWrapper.parent().hasClass('mes')) {
           $mes.prepend($avatarWrapper);
       }

       if ($verticalWrapper.length) {
           const $chName = $mes.find('.ch_name.flex-container.justifySpaceBetween');
           const $flexContainer = $mes.find('.flex-container.flex1.alignitemscenter');
           const $nameText = $mes.find('.name_text');

           if ($flexContainer.length) $chName.append($flexContainer);
           if ($nameText.length) {
               const $originalContainer = $mes.find('.flex-container.alignItemsBaseline');
               if ($originalContainer.length) $originalContainer.prepend($nameText);
           }

           $verticalWrapper.remove();
       }
   });
}

// Chat observer
function startChatObserver() {
   stopChatObserver();

   const chatContainer = document.getElementById('chat');
   if (!chatContainer) return;

   state.chatObserver = new MutationObserver((mutations) => {
       let hasValidAIMessage = false;

       mutations.forEach((mutation) => {
           if (mutation.type === 'childList') {
               mutation.addedNodes.forEach((node) => {
                   if (node.nodeType === Node.ELEMENT_NODE && node.classList?.contains('mes')) {
                       const isUser = node.getAttribute('is_user') === 'true';
                       const isSystem = node.getAttribute('is_system') === 'true';

                       if (!isUser && !isSystem) {
                           hasValidAIMessage = true;
                           console.log('[小白X] 检测到AI消息，准备切换页面');
                       }

                       setTimeout(() => {
                           moveAvatarWrappers();
                           showNavigationButtons();
                       }, 100);
                   }
               });
           }
       });

       if (hasValidAIMessage) handleChatUpdate();
   });

   state.chatObserver.observe(chatContainer, {
       childList: true,
       subtree: true,
       characterData: true
   });
}

function stopChatObserver() {
   if (state.chatObserver) {
       state.chatObserver.disconnect();
       state.chatObserver = null;
   }
}

// Navigation and display
function updateMessageDisplay() {
   if (!state.isActive) return;

   const messages = $('#chat .mes');
   if (!messages.length) return;

   const settings = getSettings();
   settings.showAllMessages ? messages.show() : messages.hide().last().show();

   updateNavigationButtons();
   updateSwipesCounter();
}

function showNavigationButtons() {
    if (!isInChat()) {
        hideNavigationButtons();
        return;
    }

    $('#immersive-navigation').remove();

    const $lastMes = $('#chat .mes.last_mes');
    const $verticalWrapper = $lastMes.find('.xiaobaix-vertical-wrapper');

    if ($lastMes.length && $verticalWrapper.length) {
        const settings = getSettings();
        const buttonText = settings.showAllMessages ? '切换：锁定单楼层' : '切换：传统多楼层';

        const navigationHtml = `
            <div id="immersive-navigation" class="immersive-navigation">
                <button id="immersive-swipe-left" class="immersive-nav-btn" title="左滑消息">
                    <i class="fa-solid fa-chevron-left"></i>
                </button>
                <button id="immersive-toggle" class="immersive-nav-btn" title="切换显示模式">
                    |${buttonText}|
                </button>
                <button id="immersive-swipe-right" class="immersive-nav-btn" title="右滑消息" style="display: flex; align-items: center; gap: 1px;">
                    <div class="swipes-counter" style="opacity: 0.7; justify-content: flex-end;margin-bottom: 0 !important;">1&ZeroWidthSpace;/&ZeroWidthSpace;1</div>
                    <span> <i class="fa-solid fa-chevron-right"></i></span>
                </button>
            </div>
        `;

        $verticalWrapper.append(navigationHtml);

        $('#immersive-swipe-left').on('click', () => handleSwipe('.swipe_left'));
        $('#immersive-toggle').on('click', toggleDisplayMode);
        $('#immersive-swipe-right').on('click', () => handleSwipe('.swipe_right'));
    }

    updateNavigationButtons();
    updateSwipesCounter();
 }


const hideNavigationButtons = () => $('#immersive-navigation').remove();

function updateNavigationButtons() {
    if (!state.isActive) return;

    const settings = getSettings();
    const $toggleBtn = $('#immersive-toggle');
    const buttonText = settings.showAllMessages ? '切换：锁定单楼层' : '切换：传统多楼层';

    $toggleBtn.html(`|${buttonText}|`);
    $toggleBtn.attr('title', settings.showAllMessages ? '切换到单层模式' : '切换到多层模式');
 }


function updateSwipesCounter() {
   if (!state.isActive) return;

   const $swipesCounter = $('.swipes-counter');
   if (!$swipesCounter.length) return;

   const $currentMessage = $('#chat .mes:visible').last();
   if (!$currentMessage.length) {
       $swipesCounter.text('1/1');
       return;
   }

   const mesId = $currentMessage.attr('mesid');
   if (mesId !== undefined) {
       try {
           const chat = getContext().chat;
           const mesIndex = parseInt(mesId);
           const message = chat?.[mesIndex];

           if (message?.swipes) {
               const currentSwipeIndex = message.swipe_id || 0;
               $swipesCounter.html(`${currentSwipeIndex + 1}&ZeroWidthSpace;/&ZeroWidthSpace;${message.swipes.length}`);
               return;
           }
       } catch (error) {}
   }

   $swipesCounter.html('1&ZeroWidthSpace;/&ZeroWidthSpace;1');
}

// User interactions
function toggleDisplayMode() {
   if (!state.isActive) return;

   const settings = getSettings();
   settings.showAllMessages = !settings.showAllMessages;
   updateMessageDisplay();

   if (settings.showAllMessages) {
       setTimeout(() => {
           const chatContainer = document.getElementById('chat');
           if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
       }, 50);
   }

   saveSettingsDebounced();
}

function handleSwipe(swipeSelector) {
   if (!state.isActive) return;

   const swipeBtn = $('#chat .mes:visible').last().find(swipeSelector);
   if (swipeBtn.length) {
       swipeBtn.click();
       setTimeout(updateSwipesCounter, 100);
   }
}

// Event handlers
function handleChatUpdate() {
   if (!state.isActive) return;

   const settings = getSettings();
   console.log(`[小白X] AI消息检测，${settings.showAllMessages ? '但当前为多层模式，不进行跳转' : '保持单个消息显示模式'}`);

   updateMessageDisplay();
   setTimeout(showNavigationButtons, 200);
}

function handleGlobalStateChange(event) {
   const enabled = event.detail.enabled;
   updateControlState();

   if (enabled) {
       const settings = getSettings();
       state.isActive = settings.enabled;

       if (state.isActive) enableImmersiveMode();
       bindSettingsEvents();

       setTimeout(() => {
           const checkbox = document.getElementById('xiaobaix_immersive_enabled');
           if (checkbox) checkbox.checked = settings.enabled;
       }, 100);
   } else {
       if (state.isActive) disableImmersiveMode();
       state.isActive = false;
       unbindSettingsEvents();
   }
}

function onChatChanged() {
   if (!isGlobalEnabled() || !state.isActive) return;

   setTimeout(() => {
       startChatObserver();
       moveAvatarWrappers();
       updateMessageDisplay();
       showNavigationButtons();
   }, 100);
}

// Cleanup
function cleanup() {
   if (state.isActive) disableImmersiveMode();

   Object.values(state.eventHandlers).forEach((handler, index) => {
       const events = [event_types.CHAT_CHANGED, 'xiaobaixEnabledChanged'];
       const targets = [eventSource, document];
       targets[index].removeListener?.(events[index], handler) ||
       targets[index].removeEventListener?.(events[index], handler);
   });

   stopChatObserver();
   state = { isActive: false, chatObserver: null, eventsBound: false, eventHandlers: {} };
}

export { initImmersiveMode, toggleImmersiveMode };
