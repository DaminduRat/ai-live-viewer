let observer = null;
let currentChatId = Date.now().toString();
let aiResponseSelector = '.ds-markdown, .prose, .markdown, .markdown-body';

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
  // Try to get topic from the page - DeepSeek uses the chat title or first user message
  // 1. Try DeepSeek sidebar active chat title
  const dsActive = document.querySelector('.ds-chat-item.active .ds-chat-item-title, .chat-item.active .chat-item-title');
  if (dsActive && dsActive.textContent.trim()) return dsActive.textContent.trim();

  // 2. Try ChatGPT nav active item
  const gptActive = document.querySelector('nav a.bg-token-sidebar-surface-secondary');
  if (gptActive && gptActive.textContent.trim()) return gptActive.textContent.trim();
  
  // 3. Try document title but clean it
  let title = document.title || "AI Chat";
  // DeepSeek titles are often "DeepSeek - Into the Unknown" — extract the useful part
  title = title.replace(/^DeepSeek\s*[-–—]\s*/i, '').replace(/^ChatGPT\s*[-–—]\s*/i, '').replace(/^Claude\s*[-–—]\s*/i, '').replace(/^Gemini\s*[-–—]\s*/i, '');
  if (title && title.trim() && title.trim().toLowerCase() !== 'deepseek' && title.trim().toLowerCase() !== 'chatgpt' && title.trim().toLowerCase() !== 'claude' && title.trim().toLowerCase() !== 'gemini') {
    return title.trim();
  }
  
  // 4. Fallback: extract first line of the first user message on page
  const userMsg = document.querySelector('.ds-user-message, [data-message-author-role="user"]');
  if (userMsg) {
    const text = userMsg.textContent.trim().substring(0, 60);
    if (text) return text + (userMsg.textContent.trim().length > 60 ? '...' : '');
  }
  
  return "AI Chat " + new Date().toLocaleTimeString();
}

function startObserving() {
  if (observer) observer.disconnect();
  const aiModel = getAiModel();
  
  observer = new MutationObserver((mutations) => {
    const activeElement = getActiveAIResponseElement();
    
    if (activeElement) {
      if (!activeElement.dataset.viewerResponseId) {
        activeElement.dataset.viewerResponseId = Date.now().toString() + "_" + Math.random().toString(36).substring(7);
        chrome.runtime.sendMessage({ type: "OPEN_VIEWER" });
      }
      
      chrome.runtime.sendMessage({
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

setTimeout(startObserving, 2000);

// Watch for URL changes (SPA navigation) to reset chat ID
let lastUrl = location.href; 
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    currentChatId = Date.now().toString();
  }
}).observe(document, {subtree: true, childList: true});
