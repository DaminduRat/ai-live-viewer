let observer = null;
let aiResponseSelector = '.ds-markdown, .prose, .markdown, .markdown-body, message-content, [class*="message-content"], .font-claude-message';

function getChatIdFromUrl(url) {
  try {
    const urlObj = new URL(url);
    const host = urlObj.hostname.toLowerCase();
    const path = urlObj.pathname;
    
    if (host.includes("chatgpt.com")) {
      const match = path.match(/\/c\/([a-zA-Z0-9-]+)/);
      if (match) return "chatgpt_" + match[1];
    }
    if (host.includes("claude.ai")) {
      const match = path.match(/\/chat\/([a-zA-Z0-9-]+)/);
      if (match) return "claude_" + match[1];
    }
    if (host.includes("deepseek.com")) {
      const match = path.match(/\/chat\/s\/([a-zA-Z0-9-]+)/) || path.match(/\/s\/([a-zA-Z0-9-]+)/);
      if (match) return "deepseek_" + match[1];
    }
    if (host.includes("gemini.google.com")) {
      const match = path.match(/\/app\/([a-zA-Z0-9_-]+)/);
      if (match) return "gemini_" + match[1];
    }
  } catch (e) {
    console.error("Error parsing chat ID from URL:", e);
  }
  return null;
}

let currentChatId = getChatIdFromUrl(location.href) || ("temp_" + Date.now().toString());

function getActiveAIResponseElement() {
  const elements = document.querySelectorAll(aiResponseSelector);
  if (elements.length > 0) {
    return elements[elements.length - 1];
  }
  return null;
}

function getAiModel() {
  const host = location.hostname;
  if (host.includes("chatgpt.com")) return "ChatGPT";
  if (host.includes("claude.ai")) return "Claude";
  if (host.includes("gemini.google.com")) return "Gemini";
  if (host.includes("deepseek.com")) return "DeepSeek";
  return "AI Assistant";
}

function extractTopic() {
  const host = location.hostname.toLowerCase();
  const path = location.pathname;
  
  // 1. URL Path Matching in Sidebar (extremely robust)
  try {
    if (host.includes("chatgpt.com")) {
      const match = path.match(/\/c\/([a-zA-Z0-9-]+)/);
      if (match) {
        const link = document.querySelector(`nav a[href*="${match[1]}"]`);
        if (link) {
          const textEl = link.querySelector('div') || link;
          if (textEl && textEl.textContent.trim()) {
            const titleText = textEl.textContent.trim().split('\n')[0].trim();
            if (titleText && titleText !== "New chat") return titleText;
          }
        }
      }
    }
    if (host.includes("claude.ai")) {
      const match = path.match(/\/chat\/([a-zA-Z0-9-]+)/);
      if (match) {
        const link = document.querySelector(`a[href*="${match[1]}"]`);
        if (link && link.textContent.trim()) {
          return link.textContent.trim().split('\n')[0].trim();
        }
      }
    }
    if (host.includes("deepseek.com")) {
      const match = path.match(/\/chat\/s\/([a-zA-Z0-9-]+)/) || path.match(/\/s\/([a-zA-Z0-9-]+)/);
      if (match) {
        // Deepseek might use <a> tags or special item classes
        const link = document.querySelector(`a[href*="${match[1]}"]`) || document.querySelector(`.ds-chat-item.active .ds-chat-item-title`);
        if (link && link.textContent.trim()) {
          return link.textContent.trim().split('\n')[0].trim();
        }
      }
    }
  } catch (e) {
    console.error("Error matching sidebar link:", e);
  }

  // 2. Legacy Class-based active sidebar items
  const dsActive = document.querySelector('.ds-chat-item.active .ds-chat-item-title, .chat-item.active .chat-item-title');
  if (dsActive && dsActive.textContent.trim()) return dsActive.textContent.trim();

  const gptActive = document.querySelector('nav a.bg-token-sidebar-surface-secondary');
  if (gptActive && gptActive.textContent.trim()) return gptActive.textContent.trim();

  // 3. Fallback: extract first line of the first user message on page
  const userMsgSelectors = [
    '[data-message-author-role="user"]',
    '.font-user-message',
    '[data-testid="user-message"]',
    '.query-text',
    'div[class*="UserMessage"]',
    '.ds-message-wrapper'
  ];
  for (const selector of userMsgSelectors) {
    const userMsg = document.querySelector(selector);
    if (userMsg) {
      if (selector === '.ds-message-wrapper' && userMsg.querySelector('.ds-markdown')) {
        continue;
      }
      const text = userMsg.textContent.trim().replace(/\s+/g, ' ').substring(0, 50);
      if (text) return text + (userMsg.textContent.trim().length > 50 ? '...' : '');
    }
  }

  // 4. Fallback: first 40 characters of AI response
  const activeElement = getActiveAIResponseElement();
  if (activeElement) {
    const text = activeElement.innerText.trim().replace(/\s+/g, ' ').substring(0, 45);
    if (text) return text + (activeElement.innerText.trim().length > 45 ? '...' : '');
  }

  // 5. Try document title but clean it
  let title = document.title || "";
  title = title.replace(/^DeepSeek\s*[-–—]\s*/i, '')
               .replace(/^ChatGPT\s*[-–—]\s*/i, '')
               .replace(/^Claude\s*[-–—]\s*/i, '')
               .replace(/^Gemini\s*[-–—]\s*/i, '');
  
  const cleanTitle = title.trim().toLowerCase();
  const isBrand = ['deepseek', 'chatgpt', 'claude', 'gemini'].includes(cleanTitle);
  if (title && title.trim() && !isBrand) {
    return title.trim();
  }

  return "AI Chat " + new Date().toLocaleTimeString();
}

let lastElementsCount = 0;
let currentResponseId = null;

let localSettings = { enabled: true, sites: {} };

function updateLocalSettings() {
  chrome.storage.local.get(['extensionEnabled', 'viewerSettings'], (data) => {
    localSettings.enabled = data.extensionEnabled !== false;
    localSettings.sites = data.viewerSettings || {};
  });
}

// Watch for settings changes
chrome.storage.onChanged.addListener(() => updateLocalSettings());
updateLocalSettings();

function startObserving() {
  if (observer) observer.disconnect();
  const aiModel = getAiModel();
  const host = location.hostname.toLowerCase();
  
  observer = new MutationObserver((mutations) => {
    // Safety check for extension context
    if (!chrome.runtime?.id) {
      if (observer) observer.disconnect();
      return;
    }

    if (!localSettings.enabled) return;
    
    // Site-specific check from cache
    if (host.includes("chatgpt.com") && localSettings.sites.chatgpt === false) return;
    if (host.includes("gemini.google.com") && localSettings.sites.gemini === false) return;
    if (host.includes("claude.ai") && localSettings.sites.claude === false) return;
    if (host.includes("deepseek.com") && localSettings.sites.deepseek === false) return;

    const elements = document.querySelectorAll(aiResponseSelector);
    const elementsCount = elements.length;
    if (elementsCount === 0) return;

    const activeElement = elements[elementsCount - 1];
    const textContent = activeElement.innerText.trim();
    
    if (!activeElement.dataset.viewerResponseId) {
      if (elementsCount === lastElementsCount && currentResponseId) {
        activeElement.dataset.viewerResponseId = currentResponseId;
      } else {
        const sensitivity = localSettings.sites.sensitivity !== undefined ? localSettings.sites.sensitivity : 50;
        const minLength = Math.max(1, Math.round((100 - sensitivity) / 10));
        const timeGap = (100 - sensitivity) * 40;
        
        if (textContent.length > minLength) {
          const now = Date.now();
          if (window._lastResponseTrigger && (now - window._lastResponseTrigger < timeGap)) {
             return;
          }
          window._lastResponseTrigger = now;
          
          currentResponseId = now.toString() + "_" + Math.random().toString(36).substring(7);
          activeElement.dataset.viewerResponseId = currentResponseId;
          lastElementsCount = elementsCount;
          safeSendMessage({ type: "OPEN_VIEWER" });
        }
      }
    }

    if (activeElement.dataset.viewerResponseId) {
      currentResponseId = activeElement.dataset.viewerResponseId;
      lastElementsCount = elementsCount;

      safeSendMessage({
        type: "LIVE_STREAM",
        data: {
          chatId: currentChatId,
          responseId: activeElement.dataset.viewerResponseId,
          topic: extractTopic(),
          aiModel: aiModel,
          html: activeElement.innerHTML,
          isStreaming: true
        }
      });
    }
  });

  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

function safeSendMessage(message) {
  try {
    if (chrome.runtime?.id) {
      chrome.runtime.sendMessage(message, () => {
        const lastError = chrome.runtime.lastError;
        if (lastError && lastError.message.includes("context invalidated")) {
          if (observer) observer.disconnect();
        }
      });
    }
  } catch (e) {
    if (e.message.includes("context invalidated")) {
      if (observer) observer.disconnect();
    }
  }
}

// Run immediately or when ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startObserving);
} else {
  startObserving();
}

// Watch for URL changes (SPA navigation) to reset/upgrade chat ID
let lastUrl = location.href; 
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    const oldUrl = lastUrl;
    lastUrl = url;
    
    const newId = getChatIdFromUrl(url);
    if (newId) {
      if (currentChatId.startsWith("temp_")) {
        // Upgrade temporary ID to permanent ID
        const oldId = currentChatId;
        currentChatId = newId;
        safeSendMessage({
          type: "UPGRADE_CHAT_ID",
          data: {
            oldChatId: oldId,
            newChatId: newId
          }
        });
      } else if (newId !== currentChatId) {
        // Switched to another existing chat
        currentChatId = newId;
      }
    } else {
      // Switched to home or something without ID
      currentChatId = "temp_" + Date.now().toString();
    }
  }
}).observe(document, {subtree: true, childList: true});
