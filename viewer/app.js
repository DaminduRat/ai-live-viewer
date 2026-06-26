// Storage fallback wrapper (local storage if chrome.storage is not available)
const storage = {
  get: (keys, callback) => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(keys, callback);
    } else {
      const data = {};
      const keyList = Array.isArray(keys) ? keys : [keys];
      keyList.forEach(key => {
        try {
          const val = localStorage.getItem(key);
          data[key] = val ? JSON.parse(val) : undefined;
        } catch (e) {
          data[key] = localStorage.getItem(key);
        }
      });
      if (typeof keys === 'string') {
        const singleData = {};
        try {
          const val = localStorage.getItem(keys);
          singleData[keys] = val ? JSON.parse(val) : undefined;
          callback(singleData);
        } catch (e) {
          singleData[keys] = localStorage.getItem(keys);
          callback(singleData);
        }
      } else {
        callback(data);
      }
    }
  },
  set: (items, callback) => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set(items, callback);
    } else {
      Object.entries(items).forEach(([key, val]) => {
        localStorage.setItem(key, typeof val === 'object' ? JSON.stringify(val) : val);
      });
      if (callback) callback();
    }
  }
};

const editor = document.getElementById('editor');
const topicTitle = document.getElementById('current-topic');
const searchHistoryInput = document.getElementById('search-history');
let rootZoom = 1;

let currentActiveChatId = null;
let currentActiveResponseId = null;
let currentActiveType = null; // 'single', 'full', 'live'
let streamFinishedTimeout = null;

// Load History on Start
refreshSidebar();

// Search history event listener
if (searchHistoryInput) {
  searchHistoryInput.addEventListener('input', () => {
    refreshSidebar(currentActiveChatId, currentActiveResponseId);
  });
}

// Enable/Disable Toggle
const extensionToggle = document.getElementById('extension-toggle');
storage.get('extensionEnabled', (data) => {
  extensionToggle.checked = data.extensionEnabled !== false;
});

extensionToggle.onchange = () => {
  storage.set({ extensionEnabled: extensionToggle.checked });
};

// Handle Messages from Background
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "LIVE_STREAM") {
      const { chatId, responseId, topic, aiModel, html, isStreaming } = request.data;
      
      currentActiveChatId = chatId;
      currentActiveResponseId = responseId;
      currentActiveType = 'live';
      
      topicTitle.textContent = topic;
      editor.contentEditable = 'true';
      updateEditorContent(html);
      
      // Save to DB
      saveLiveResponse(chatId, responseId, topic, aiModel, html);

      // Auto-scroll logic
      storage.get('viewerSettings', (data) => {
        if (data.viewerSettings?.autoscroll !== false) {
          const wrapper = document.getElementById('editor-wrapper');
          wrapper.scrollTo({ top: wrapper.scrollHeight, behavior: 'smooth' });
        }
      });

      // Inactivity-based generation finish detection
      if (streamFinishedTimeout) clearTimeout(streamFinishedTimeout);
      streamFinishedTimeout = setTimeout(() => {
        onLiveStreamFinished();
      }, 2500);
    } else if (request.type === "UPGRADE_CHAT_ID") {
      const { oldChatId, newChatId } = request.data;
      if (currentActiveChatId === oldChatId) {
        currentActiveChatId = newChatId;
      }
      upgradeChatId(oldChatId, newChatId);
    }
  });
}

function onLiveStreamFinished() {
  currentActiveType = 'single';
  storage.get('viewerSettings', (data) => {
    const s = data.viewerSettings || {};
    if (s.autopdf) {
      triggerAutoPDFSave();
    }
    if (s.autocopy) {
      triggerAutoCopy();
    }
  });
}

function triggerAutoCopy() {
  const temp = document.createElement('div');
  temp.innerHTML = editor.innerHTML;
  temp.querySelectorAll('.custom-copy-btn').forEach(btn => btn.remove());
  const cleanText = temp.innerText.trim();
  navigator.clipboard.writeText(cleanText).then(() => {
    console.log("Auto-copied response to clipboard!");
  }).catch(err => {
    console.error("Auto-copy failed:", err);
  });
}

function triggerAutoPDFSave() {
  const content = getCleanEditorHTML();
  const element = document.createElement('div');
  element.innerHTML = content;
  element.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  element.style.padding = '20px';
  element.style.color = '#000000';
  element.style.backgroundColor = '#ffffff';
  
  const opt = {
    margin:       0.5,
    filename:     `${topicTitle.textContent}.pdf`,
    image:        { type: 'jpeg', quality: 0.98 },
    html2canvas:  { scale: 2, useCORS: true },
    jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' }
  };
  
  html2pdf().set(opt).from(element).save();
}

function updateEditorContent(html, isFullChat = false, responses = []) {
  storage.get('viewerSettings', (data) => {
    const s = data.viewerSettings || {};
    const isPlain = s.rendermode === 'plain';
    
    if (isPlain) {
      editor.style.whiteSpace = 'pre-wrap';
      editor.style.fontFamily = s.fontfamily === 'mono' ? 'var(--font-mono)' : (s.fontfamily === 'serif' ? 'Georgia, serif' : 'var(--font-sans)');
      
      if (isFullChat) {
        const text = responses.map((r, i) => {
          const temp = document.createElement('div');
          temp.innerHTML = r.html;
          return `=== Response #${i + 1} ===\n\n${temp.innerText.trim()}`;
        }).join('\n\n\n');
        editor.innerText = text;
      } else {
        const temp = document.createElement('div');
        temp.innerHTML = html;
        editor.innerText = temp.innerText.trim();
      }
    } else {
      editor.style.whiteSpace = 'normal';
      editor.innerHTML = html;
      addCopyButtons();
    }
  });
}

// Inject Copy Buttons to all code blocks
function addCopyButtons() {
  storage.get('viewerSettings', (data) => {
    const s = data.viewerSettings || {};
    if (s.rendermode === 'plain') return;

    const preElements = editor.querySelectorAll('pre, [class*="code-block"]');
    preElements.forEach(pre => {
      if (pre.querySelector('.custom-copy-btn')) return;
      pre.style.position = 'relative';
      
      const btn = document.createElement('button');
      btn.className = 'custom-copy-btn';
      btn.textContent = 'Copy';
      btn.setAttribute('contenteditable', 'false');
      
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const codeEl = pre.querySelector('code');
        let textToCopy = codeEl ? codeEl.innerText : pre.innerText;
        textToCopy = textToCopy.replace(/^Copy\n/i, '').trim();

        navigator.clipboard.writeText(textToCopy).then(() => {
          btn.textContent = 'Copied!';
          btn.classList.add('copied');
          setTimeout(() => {
            btn.textContent = 'Copy';
            btn.classList.remove('copied');
          }, 2000);
        }).catch(err => {
          console.error('Copy failed:', err);
          btn.textContent = 'Error';
        });
      };
      
      pre.appendChild(btn);
    });
  });
}

// Auto-run copy button injection when editor content changes
const editorObserver = new MutationObserver(() => addCopyButtons());
editorObserver.observe(editor, { childList: true, subtree: true });

// Expose selection functions to global for onclick handlers in db.js
window.loadSingleResponseIntoEditor = (html, title, chatId, responseId) => {
  currentActiveChatId = chatId;
  currentActiveResponseId = responseId;
  currentActiveType = 'single';
  
  topicTitle.textContent = title;
  editor.contentEditable = 'true';
  updateEditorContent(html);
  refreshSidebar(chatId, responseId);
};

window.loadFullChat = async (chatId, title) => {
  currentActiveChatId = chatId;
  currentActiveResponseId = null;
  currentActiveType = 'full';
  
  topicTitle.textContent = title;
  editor.contentEditable = 'false';
  
  const responses = await getChatResponses(chatId);
  const combinedHtml = responses.map((r, i) => `
    <div class="full-chat-response-wrapper" style="margin-bottom: 25px; padding-bottom: 25px; border-bottom: 1px solid var(--sidebar-border);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 12px; border-bottom: 1px dashed var(--sidebar-border); padding-bottom: 5px;">
        <h3 style="font-size: 1rem; color: var(--btn-primary); margin:0;">Response #${i + 1}</h3>
        <span style="font-size: 0.75rem; color: #888;">${new Date(r.timestamp).toLocaleString()}</span>
      </div>
      <div class="full-chat-response-content" contenteditable="true" data-response-id="${r.responseId}" style="outline: none;">
        ${r.html}
      </div>
    </div>
  `).join('');
  
  updateEditorContent(combinedHtml, true, responses);
  refreshSidebar(chatId);
};

// Auto-save edits on input
let saveTimeout = null;
function debouncedSaveResponse(chatId, responseId, html) {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    const existingResponse = await db.responses.where('responseId').equals(responseId).first();
    if (existingResponse) {
      await db.responses.update(existingResponse.id, { html: html, timestamp: Date.now() });
      refreshSidebar(currentActiveChatId, currentActiveResponseId);
    }
  }, 1000);
}

editor.addEventListener('input', (e) => {
  if (currentActiveType === 'single' || currentActiveType === 'live') {
    const html = editor.innerHTML;
    const temp = document.createElement('div');
    temp.innerHTML = html;
    temp.querySelectorAll('.custom-copy-btn').forEach(b => b.remove());
    debouncedSaveResponse(currentActiveChatId, currentActiveResponseId, temp.innerHTML);
  } else if (currentActiveType === 'full' && e.target.classList.contains('full-chat-response-content')) {
    const responseId = e.target.getAttribute('data-response-id');
    const html = e.target.innerHTML;
    const temp = document.createElement('div');
    temp.innerHTML = html;
    temp.querySelectorAll('.custom-copy-btn').forEach(b => b.remove());
    debouncedSaveResponse(currentActiveChatId, responseId, temp.innerHTML);
  }
});

// UI Buttons - Zoom
document.getElementById('btn-zoom-in').onclick = () => {
  rootZoom = Math.min(2.0, rootZoom + 0.1);
  editor.style.zoom = rootZoom;
};

document.getElementById('btn-zoom-out').onclick = () => {
  rootZoom = Math.max(0.5, rootZoom - 0.1);
  editor.style.zoom = rootZoom;
};

// UI Buttons - Theme Toggle
document.getElementById('btn-theme').onclick = () => {
  const isDark = document.body.classList.contains('dark-mode');
  const newTheme = isDark ? 'light' : 'dark';
  setTheme(newTheme);
  storage.set({ theme: newTheme });
};

function setTheme(theme) {
  const btnTheme = document.getElementById('btn-theme');
  if (theme === 'dark') {
    document.body.classList.remove('light-mode');
    document.body.classList.add('dark-mode');
    if (btnTheme) {
      btnTheme.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M4.93 4.93l1.41 1.41"/><path d="M17.66 17.66l1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M6.34 17.66l-1.41 1.41"/><path d="M19.07 4.93l-1.41 1.41"/></svg>`;
      btnTheme.title = "Switch to Light Theme";
    }
  } else {
    document.body.classList.remove('dark-mode');
    document.body.classList.add('light-mode');
    if (btnTheme) {
      btnTheme.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`;
      btnTheme.title = "Switch to Dark Theme";
    }
  }
}

// Restore saved theme on load
storage.get('theme', (data) => {
  const preferredTheme = data.theme || 'light';
  setTheme(preferredTheme);
});

// Sidebar Toggle Logic
const sidebar = document.querySelector('.sidebar');
const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');

function updateSidebarUI() {
  const isCollapsed = sidebar.classList.contains('collapsed');
  btnToggleSidebar.title = isCollapsed ? 'Show Sidebar' : 'Hide Sidebar';
}

// Init Sidebar State
if (localStorage.getItem('sidebarCollapsed') === 'true') {
  sidebar.classList.add('collapsed');
}
updateSidebarUI();

btnToggleSidebar.onclick = () => {
  sidebar.classList.toggle('collapsed');
  const isCollapsed = sidebar.classList.contains('collapsed');
  localStorage.setItem('sidebarCollapsed', isCollapsed);
  updateSidebarUI();
};

// Settings Modal Logic
const settingsModal = document.getElementById('settings-modal');
const btnSettings = document.getElementById('btn-settings');
const btnCloseSettings = document.getElementById('close-settings');
const btnSaveSettings = document.getElementById('save-settings');
const btnClearHistory = document.getElementById('btn-clear-history');

// Settings Elements
const settingsKeys = [
  'autoscroll', 'fontsize', 'codetheme', 'autopdf', 'autocopy', 'fontfamily', 'rendermode',
  'chatgpt', 'gemini', 'claude', 'deepseek',
  'customcss', 'debug', 'sensitivity'
];

btnSettings.onclick = () => {
  storage.get('viewerSettings', (data) => {
    const s = data.viewerSettings || {};
    // Load current values into form
    document.getElementById('setting-autoscroll').checked = s.autoscroll !== false;
    document.getElementById('setting-fontsize').value = s.fontsize || 16;
    document.getElementById('setting-codetheme').value = s.codetheme || 'default';
    document.getElementById('setting-autopdf').checked = !!s.autopdf;
    document.getElementById('setting-autocopy').checked = !!s.autocopy;
    document.getElementById('setting-fontfamily').value = s.fontfamily || 'sans';
    document.getElementById('setting-rendermode').value = s.rendermode || 'rich';
    
    document.getElementById('site-chatgpt').checked = s.chatgpt !== false;
    document.getElementById('site-gemini').checked = s.gemini !== false;
    document.getElementById('site-claude').checked = s.claude !== false;
    document.getElementById('site-deepseek').checked = s.deepseek !== false;
    
    document.getElementById('setting-customcss').value = s.customcss || '';
    document.getElementById('setting-debug').checked = !!s.debug;
    document.getElementById('setting-sensitivity').value = s.sensitivity || 50;
    
    settingsModal.classList.add('show');
  });
};

btnCloseSettings.onclick = () => settingsModal.classList.remove('show');

btnSaveSettings.onclick = () => {
  const newSettings = {
    autoscroll: document.getElementById('setting-autoscroll').checked,
    fontsize: parseInt(document.getElementById('setting-fontsize').value),
    codetheme: document.getElementById('setting-codetheme').value,
    autopdf: document.getElementById('setting-autopdf').checked,
    autocopy: document.getElementById('setting-autocopy').checked,
    fontfamily: document.getElementById('setting-fontfamily').value,
    rendermode: document.getElementById('setting-rendermode').value,
    chatgpt: document.getElementById('site-chatgpt').checked,
    gemini: document.getElementById('site-gemini').checked,
    claude: document.getElementById('site-claude').checked,
    deepseek: document.getElementById('site-deepseek').checked,
    customcss: document.getElementById('setting-customcss').value,
    debug: document.getElementById('setting-debug').checked,
    sensitivity: parseInt(document.getElementById('setting-sensitivity').value)
  };
  
  storage.set({ viewerSettings: newSettings }, () => {
    applySettings(newSettings);
    settingsModal.classList.remove('show');
  });
};

btnClearHistory.onclick = async () => {
  if (confirm('Are you sure you want to clear ALL chat history? This cannot be undone.')) {
    await clearAllHistory(); // From db.js
    refreshSidebar();
    editor.innerHTML = '';
    topicTitle.textContent = 'History Cleared';
    settingsModal.classList.remove('show');
  }
};

function applySettings(s) {
  const settings = s || {};
  // Apply Font Size
  editor.style.fontSize = `${settings.fontsize || 16}px`;
  
  // Apply Font Family
  if (settings.fontfamily === 'serif') {
    editor.style.fontFamily = 'Georgia, serif';
  } else if (settings.fontfamily === 'mono') {
    editor.style.fontFamily = 'var(--font-mono)';
  } else {
    editor.style.fontFamily = 'var(--font-sans)';
  }
  
  // Apply Code Block Theme
  editor.className = 'editor code-theme-' + (settings.codetheme || 'default');
  
  // Apply Custom CSS
  let styleTag = document.getElementById('custom-settings-style');
  if (!styleTag) {
    styleTag = document.createElement('style');
    styleTag.id = 'custom-settings-style';
    document.head.appendChild(styleTag);
  }
  styleTag.textContent = settings.customcss || '';
  
  // Refresh content if active to apply theme/fonts instantly
  if (currentActiveType === 'single' || currentActiveType === 'live') {
    updateEditorContent(editor.innerHTML);
  } else if (currentActiveType === 'full' && currentActiveChatId) {
    window.loadFullChat(currentActiveChatId, topicTitle.textContent);
  }
}

// Initial apply
storage.get('viewerSettings', (data) => applySettings(data.viewerSettings || { codetheme: 'default' }));

// Helper to get clean HTML for export (removes copy buttons and contenteditable)
function getCleanEditorHTML() {
  const clone = editor.cloneNode(true);
  clone.querySelectorAll('.custom-copy-btn').forEach(btn => btn.remove());
  clone.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));
  clone.querySelectorAll('.full-chat-response-content').forEach(el => {
    el.removeAttribute('contenteditable');
    el.style.outline = 'none';
  });
  return clone.innerHTML;
}

// Export - PDF (using DOC-style approach since html2pdf has issues in extensions)
document.getElementById('btn-export-pdf').onclick = () => {
  const content = getCleanEditorHTML();
  const printWindow = window.open('', '_blank', 'width=800,height=600');
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>${topicTitle.textContent}</title>
      <style>
        @page { margin: 0.5in; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Iskoola Pota", "Nirmala UI", "Noto Sans Sinhala", Helvetica, Arial, sans-serif;
          background: #ffffff !important;
          color: #000000 !important;
          padding: 20px;
          line-height: 1.6;
        }
        * { color: #000000 !important; }
        img { max-width: 100%; height: auto; }
        pre { background: #f5f5f5; padding: 10px; border-radius: 4px; overflow-x: auto; border: 1px solid #ccc; }
        code { background: #f0f0f0; padding: 2px 4px; border-radius: 3px; font-family: monospace; }
        pre code { background: transparent; padding: 0; }
        h1, h2, h3 { margin-top: 1em; margin-bottom: 0.5em; }
        p { margin-bottom: 0.8em; }
        table { border-collapse: collapse; width: 100%; margin: 1em 0; }
        th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
        .full-chat-response-wrapper { margin-bottom: 25px; padding-bottom: 25px; border-bottom: 1px solid #ccc; }
        h3 { font-size: 1.1rem; color: #000; margin-bottom: 5px; }
      </style>
    </head>
    <body>${content}</body>
    </html>
  `);
  printWindow.document.close();
  
  // Wait for images to load then print
  setTimeout(() => {
    printWindow.print();
    // Close after print dialog
    printWindow.onafterprint = () => printWindow.close();
  }, 500);
};

// Export - DOC
document.getElementById('btn-export-doc').onclick = () => {
  const header = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
  <head><meta charset='utf-8'><title>Export HTML to Word Document</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Iskoola Pota", "Nirmala UI", "Noto Sans Sinhala", Helvetica, Arial, sans-serif; background-color: #ffffff; color: #000000; }
    * { color: #000000 !important; }
    img { max-width: 100%; height: auto; }
    pre { background: #f5f5f5; padding: 10px; border-radius: 4px; border: 1px solid #ccc; }
    table { border-collapse: collapse; width: 100%; margin: 1em 0; }
    th, td { border: 1px solid #ccc; padding: 8px; }
    .full-chat-response-wrapper { margin-bottom: 25px; padding-bottom: 25px; border-bottom: 1px solid #ccc; }
  </style>
  </head><body>`;
  const footer = "</body></html>";
  const sourceHTML = header + getCleanEditorHTML() + footer;
  
  const source = 'data:application/vnd.ms-word;charset=utf-8,' + encodeURIComponent(sourceHTML);
  const fileDownload = document.createElement("a");
  document.body.appendChild(fileDownload);
  fileDownload.href = source;
  fileDownload.download = `${topicTitle.textContent}.doc`;
  fileDownload.click();
  document.body.removeChild(fileDownload);
};
