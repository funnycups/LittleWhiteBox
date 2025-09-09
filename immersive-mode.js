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

const SEL = {
  chat: '#chat',
  mes: '#chat .mes',
  ai: '#chat .mes[is_user="false"][is_system="false"]',
  user: '#chat .mes[is_user="true"]',
};

let state = {
  isActive: false,
  eventsBound: false,
  eventHandlers: {},
  messageEventsBound: false,
  autoScrollPaused: false,
  pauseUntilGenEnd: false,
  isGenerating: false,
  lastScrollTop: null
};

let observer = null;
let resizeObs = null;
let resizeObservedEl = null;
let recalcT = null;
let scrollT = null;

const isGlobalEnabled = () => window.isXiaobaixEnabled ?? true;
const getSettings = () => extension_settings[EXT_ID].immersive;
const isInChat = () => this_chid !== undefined || selected_group || getCurrentChatId() !== undefined;

function initImmersiveMode() {
  initSettings();
  setupEventListeners();
  if (isGlobalEnabled()) {
    state.isActive = getSettings().enabled;
    if (state.isActive) enableImmersiveMode();
    bindSettingsEvents();
  }
}

function initSettings() {
  extension_settings[EXT_ID] ||= {};
  extension_settings[EXT_ID].immersive ||= structuredClone(defaultSettings);
  const settings = extension_settings[EXT_ID].immersive;
  Object.keys(defaultSettings).forEach(k => settings[k] = settings[k] ?? defaultSettings[k]);
  updateControlState();
}

function setupEventListeners() {
  state.eventHandlers = {
    chatChanged: onChatChanged,
    globalStateChange: handleGlobalStateChange
  };
  eventSource.on(event_types.CHAT_CHANGED, state.eventHandlers.chatChanged);
  document.addEventListener('xiaobaixEnabledChanged', state.eventHandlers.globalStateChange);
  if (window.registerModuleCleanup) window.registerModuleCleanup('immersiveMode', cleanup);
}

function setupDOMObserver() {
  if (observer) return;
  const chatContainer = document.getElementById('chat');
  if (!chatContainer) return;
  observer = new MutationObserver((mutations) => {
    if (!state.isActive) return;
    let needRecalc = false;
    let needScroll = false;
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        if (mutation.addedNodes?.length) {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === 1 && node.classList?.contains('mes')) {
              processSingleMessage(node);
              needRecalc = true;
              needScroll = true;
            }
          });
        }
        if (mutation.removedNodes?.length) {
          mutation.removedNodes.forEach((node) => {
            if (node.nodeType === 1 && node.classList?.contains('mes')) {
              needRecalc = true;
              needScroll = true;
            }
          });
        }
      } else if (mutation.type === 'characterData') {
        needScroll = true;
      }
    }
    if (needRecalc) {
      if (recalcT) clearTimeout(recalcT);
      recalcT = setTimeout(updateMessageDisplay, 20);
    } else if (needScroll) {
      scheduleScrollToBottom();
    }
  });
  observer.observe(chatContainer, { childList: true, subtree: true, characterData: true, attributes: false });
}

function processSingleMessage(mesElement) {
  const $mes = $(mesElement);
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
}

function destroyDOMObserver() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}

function updateControlState() {
  const enabled = isGlobalEnabled();
  $('#xiaobaix_immersive_enabled').prop('disabled', !enabled).toggleClass('disabled-control', !enabled);
}

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

function bindMessageEvents() {
  if (!eventSource || state.messageEventsBound) return;

  const refresh = () => state.isActive && updateMessageDisplay();
  const scroll = () => scheduleScrollToBottom();

  state.eventHandlers.onSent = () => { refresh(); scroll(); };
  state.eventHandlers.onReceived = () => { refresh(); scroll(); };
  state.eventHandlers.onDeleted = refresh;
  state.eventHandlers.onUpdated = () => { refresh(); scroll(); };
  state.eventHandlers.onSwiped = () => { refresh(); scroll(); };
  state.eventHandlers.onGenStart = () => {
    state.isGenerating = true;
    state.autoScrollPaused = false;
    state.pauseUntilGenEnd = false;
    refresh();
    setTimeout(scroll, 30);
  };
  state.eventHandlers.onGenEnd = () => {
    state.isGenerating = false;
    state.autoScrollPaused = false;
    state.pauseUntilGenEnd = false;
    refresh();
  };

  eventSource.on(event_types.MESSAGE_SENT, state.eventHandlers.onSent);
  eventSource.on(event_types.MESSAGE_RECEIVED, state.eventHandlers.onReceived);
  eventSource.on(event_types.MESSAGE_DELETED, state.eventHandlers.onDeleted);
  eventSource.on(event_types.MESSAGE_UPDATED, state.eventHandlers.onUpdated);
  eventSource.on(event_types.MESSAGE_SWIPED, state.eventHandlers.onSwiped);
  if (event_types.GENERATION_STARTED) eventSource.on(event_types.GENERATION_STARTED, state.eventHandlers.onGenStart);
  eventSource.on(event_types.GENERATION_ENDED, state.eventHandlers.onGenEnd);

  state.messageEventsBound = true;
}

function unbindMessageEvents() {
  if (!eventSource || !state.messageEventsBound) return;
  eventSource.off(event_types.MESSAGE_SENT, state.eventHandlers.onSent);
  eventSource.off(event_types.MESSAGE_RECEIVED, state.eventHandlers.onReceived);
  eventSource.off(event_types.MESSAGE_DELETED, state.eventHandlers.onDeleted);
  eventSource.off(event_types.MESSAGE_UPDATED, state.eventHandlers.onUpdated);
  eventSource.off(event_types.MESSAGE_SWIPED, state.eventHandlers.onSwiped);
  if (event_types.GENERATION_STARTED) eventSource.off(event_types.GENERATION_STARTED, state.eventHandlers.onGenStart);
  eventSource.off(event_types.GENERATION_ENDED, state.eventHandlers.onGenEnd);
  state.messageEventsBound = false;
}

// 仅在沉浸模式的“单回合模式”下隐藏 show_more_messages
function injectImmersiveStyles() {
  let style = document.getElementById('immersive-style-tag');
  if (!style) {
    style = document.createElement('style');
    style.id = 'immersive-style-tag';
    document.head.appendChild(style);
  }
  style.textContent = `
    body.immersive-mode.immersive-single #show_more_messages { display: none !important; }
  `;
}

function applyModeClasses() {
  const settings = getSettings();
  $('body')
    .toggleClass('immersive-single', !settings.showAllMessages)
    .toggleClass('immersive-all', settings.showAllMessages);
}

function enableImmersiveMode() {
  if (!isGlobalEnabled()) return;
  injectImmersiveStyles();
  $('body').addClass('immersive-mode');
  applyModeClasses();
  moveAvatarWrappers();
  bindMessageEvents();
  bindScrollGuard();
  updateMessageDisplay();
  setupDOMObserver();
  scheduleScrollToBottom(true);
}

function disableImmersiveMode() {
  $('body').removeClass('immersive-mode immersive-single immersive-all');
  restoreAvatarWrappers();
  $(`${SEL.mes}`).show();
  hideNavigationButtons();
  $('.swipe_left, .swipeRightBlock').show();
  unbindMessageEvents();
  unbindScrollGuard();
  detachResizeObserver();
  destroyDOMObserver();
  state.autoScrollPaused = false;
  state.pauseUntilGenEnd = false;
  state.isGenerating = false;
  state.lastScrollTop = null;
}

function moveAvatarWrappers() {
  $(`${SEL.mes}`).each(function() { processSingleMessage(this); });
}

function restoreAvatarWrappers() {
  $(`${SEL.mes}`).each(function() {
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
      if ($flexContainer.length && $chName.length) $chName.prepend($flexContainer);
      if ($nameText.length) {
        const $originalContainer = $mes.find('.flex-container.alignItemsBaseline');
        if ($originalContainer.length) $originalContainer.prepend($nameText);
      }
      $verticalWrapper.remove();
    }
  });
}

function findLastAIMessage() {
  const $aiMessages = $(SEL.ai);
  return $aiMessages.length ? $($aiMessages[$aiMessages.length - 1]) : null;
}

function findLastUserMessage() {
  const $userMessages = $(SEL.user);
  return $userMessages.length ? $($userMessages[$userMessages.length - 1]) : null;
}

function isUser($mes) {
  return $mes && $mes.length && $mes.attr('is_user') === 'true';
}

function showSingleModeMessages() {
  const $messages = $(SEL.mes);
  if (!$messages.length) return;
  $messages.hide();

  const $last = $messages.last();
  if ($last.length && isUser($last)) {
    $last.show();
    showNavAndCounters($last);
    return;
  }

  let $targetAI = findLastAIMessage();
  if ($targetAI && $targetAI.length) {
    $targetAI.show();
    const $prev = $targetAI.prevAll('.mes').first();
    if ($prev.length && $prev.attr('is_user') === 'true') $prev.show();
    showNavAndCounters($targetAI);
  } else {
    const $lastUser = findLastUserMessage();
    if ($lastUser && $lastUser.length) {
      $lastUser.show();
      showNavAndCounters($lastUser);
    } else {
      const $fallback = $messages.last().show();
      showNavAndCounters($fallback);
    }
  }
}

function showNavAndCounters($mes) {
  showNavigationButtons($mes);
  updateSwipesCounter($mes);
  attachResizeObserverTo($mes[0]);
}

function updateMessageDisplay() {
  if (!state.isActive) return;
  const $messages = $(SEL.mes);
  if (!$messages.length) return;
  const settings = getSettings();

  if (settings.showAllMessages) {
    $messages.show();
    const $lastVisible = $(`${SEL.mes}:visible`).last();
    showNavAndCounters($lastVisible);
  } else {
    showSingleModeMessages();
  }
  scheduleScrollToBottom();
}

function showNavigationButtons($targetMes) {
  if (!isInChat()) return hideNavigationButtons();

  $('#immersive-navigation').remove();

  if (!$targetMes || !$targetMes.length) {
    $targetMes = $(`${SEL.mes}:visible[is_user="false"][is_system="false"]`).last();
    if (!$targetMes.length) $targetMes = $(`${SEL.mes}:visible`).last();
  }

  const $verticalWrapper = $targetMes.find('.xiaobaix-vertical-wrapper');
  if (!$verticalWrapper.length) return;

  const settings = getSettings();
  const buttonText = settings.showAllMessages ? '切换：锁定单回合' : '切换：传统多楼层';
  const navigationHtml = `
    <div id="immersive-navigation" class="immersive-navigation">
      <button id="immersive-swipe-left" class="immersive-nav-btn" title="左滑消息"><i class="fa-solid fa-chevron-left"></i></button>
      <button id="immersive-toggle" class="immersive-nav-btn" title="切换显示模式">|${buttonText}|</button>
      <button id="immersive-swipe-right" class="immersive-nav-btn" title="右滑消息" style="display: flex; align-items: center; gap: 1px;">
        <div class="swipes-counter" style="opacity: 0.7; justify-content: flex-end;margin-bottom: 0 !important;">1&ZeroWidthSpace;/&ZeroWidthSpace;1</div>
        <span><i class="fa-solid fa-chevron-right"></i></span>
      </button>
    </div>
  `;
  $verticalWrapper.append(navigationHtml);
  $('#immersive-swipe-left').on('click', () => handleSwipe('.swipe_left', $targetMes));
  $('#immersive-toggle').on('click', toggleDisplayMode);
  $('#immersive-swipe-right').on('click', () => handleSwipe('.swipe_right', $targetMes));
  updateNavigationButtons();
}

const hideNavigationButtons = () => $('#immersive-navigation').remove();

function updateNavigationButtons() {
  if (!state.isActive) return;
  const settings = getSettings();
  const $toggleBtn = $('#immersive-toggle');
  const buttonText = settings.showAllMessages ? '切换：锁定单回合' : '切换：传统多楼层';
  $toggleBtn.html(`|${buttonText}|`);
  $toggleBtn.attr('title', settings.showAllMessages ? '切换到单层模式' : '切换到多层模式');
}

function currentVisibleTarget($fallbackScope) {
  let $current = $fallbackScope && $fallbackScope.length ? $fallbackScope : $(`${SEL.mes}:visible[is_user="false"][is_system="false"]`).last();
  if (!$current.length) $current = $(`${SEL.mes}:visible`).last();
  return $current;
}

function updateSwipesCounter($targetMes) {
  if (!state.isActive) return;
  const $swipesCounter = $('.swipes-counter');
  if (!$swipesCounter.length) return;

  const $currentMessage = currentVisibleTarget($targetMes);
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
    } catch {}
  }
  $swipesCounter.html('1&ZeroWidthSpace;/&ZeroWidthSpace;1');
}

function toggleDisplayMode() {
  if (!state.isActive) return;
  const settings = getSettings();
  settings.showAllMessages = !settings.showAllMessages;
  applyModeClasses();
  updateMessageDisplay();
  if (settings.showAllMessages) {
    setTimeout(() => {
      const chatContainer = getChatContainer();
      if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
    }, 50);
  }
  saveSettingsDebounced();
}

function handleSwipe(swipeSelector, $targetMes) {
  if (!state.isActive) return;
  const $scope = currentVisibleTarget($targetMes);
  const $btn = $scope.find(swipeSelector);
  if ($btn.length) {
    $btn.click();
    setTimeout(() => {
      updateSwipesCounter($scope);
      scheduleScrollToBottom();
    }, 100);
  }
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
    moveAvatarWrappers();
    updateMessageDisplay();
  }, 100);
}

function cleanup() {
  if (state.isActive) disableImmersiveMode();
  destroyDOMObserver();
  if (typeof eventSource !== 'undefined') {
    if (state.eventHandlers.chatChanged) {
      eventSource.off(event_types.CHAT_CHANGED, state.eventHandlers.chatChanged);
    }
  }
  if (state.eventHandlers.globalStateChange) {
    document.removeEventListener('xiaobaixEnabledChanged', state.eventHandlers.globalStateChange);
  }
  unbindMessageEvents();
  unbindScrollGuard();
  detachResizeObserver();
  state = {
    isActive: false,
    eventsBound: false,
    eventHandlers: {},
    messageEventsBound: false,
    autoScrollPaused: false,
    pauseUntilGenEnd: false,
    isGenerating: false,
    lastScrollTop: null
  };
}

function getChatContainer() {
  return document.getElementById('chat');
}

function isNearBottom() {
  const el = getChatContainer();
  if (!el) return false;
  const threshold = 100;
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

function scrollToBottom(force = false) {
  const el = getChatContainer();
  if (!el) return;
  if (state.autoScrollPaused && !force) return;
  if (force || isNearBottom() || getSettings().autoJumpOnAI) {
    el.scrollTop = el.scrollHeight;
  }
}

function scheduleScrollToBottom(force = false) {
  if (state.autoScrollPaused && !force) return;
  if (scrollT) clearTimeout(scrollT);
  scrollT = setTimeout(() => {
    requestAnimationFrame(() => scrollToBottom(force));
  }, 20);
}

function attachResizeObserverTo(el) {
  if (!el) return;
  if (!resizeObs) {
    resizeObs = new ResizeObserver(() => {
      scheduleScrollToBottom();
    });
  }
  if (resizeObservedEl) detachResizeObserver();
  resizeObservedEl = el;
  resizeObs.observe(el);
}

function detachResizeObserver() {
  if (resizeObs && resizeObservedEl) {
    resizeObs.unobserve(resizeObservedEl);
  }
  resizeObservedEl = null;
}

function bindScrollGuard() {
  const el = getChatContainer();
  if (!el || state.eventHandlers.onScroll) return;
  state.lastScrollTop = el.scrollTop;
  state.eventHandlers.onScroll = () => {
    const cur = el.scrollTop;
    const delta = cur - (state.lastScrollTop ?? cur);
    state.lastScrollTop = cur;
    if (delta < 0) {
      state.autoScrollPaused = true;
      if (state.isGenerating) state.pauseUntilGenEnd = true;
    }
  };
  el.addEventListener('scroll', state.eventHandlers.onScroll, { passive: true });
}

function unbindScrollGuard() {
  const el = getChatContainer();
  if (el && state.eventHandlers.onScroll) el.removeEventListener('scroll', state.eventHandlers.onScroll);
  state.eventHandlers.onScroll = null;
}

export { initImmersiveMode, toggleImmersiveMode };
