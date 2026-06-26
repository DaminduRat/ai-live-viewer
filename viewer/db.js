// Initialize Dexie
const db = new Dexie("AILiveViewerDB");

// Define Schema - keep old versions for proper migration
db.version(2).stores({
  sessions: 'chatId, title, aiModel, timestamp',
  responses: '++id, chatId, html, timestamp'
});

db.version(3).stores({
  sessions: 'chatId, title, aiModel, timestamp',
  responses: '++id, chatId, responseId, html, timestamp'
}).upgrade(trans => {
  return trans.table('responses').toCollection().modify(resp => {
    if (!resp.responseId) {
      resp.responseId = 'legacy_' + resp.id + '_' + Date.now();
    }
  });
});

let refreshTimeout = null;
function debouncedRefreshSidebar(activeChatId = null, activeResponseId = null) {
  if (refreshTimeout) clearTimeout(refreshTimeout);
  refreshTimeout = setTimeout(() => refreshSidebar(activeChatId, activeResponseId), 500);
}

// Expand/collapse state
const expandedState = { models: {}, sessions: {} };

function isExpanded(type, id) {
  return expandedState[type][id] !== false; // default expanded
}

async function saveLiveResponse(chatId, responseId, topicTitle, aiModel, html) {
  let session = await db.sessions.get(chatId);
  if (!session) {
    await db.sessions.put({
      chatId: chatId,
      title: topicTitle,
      aiModel: aiModel,
      timestamp: Date.now()
    });
  } else if (session.title !== topicTitle && topicTitle && !topicTitle.startsWith('AI Chat')) {
    // Update title if it changed (e.g., DeepSeek updates title after first message)
    await db.sessions.update(chatId, { title: topicTitle });
  }

  const existingResponse = await db.responses.where('responseId').equals(responseId).first();
  
  if (existingResponse) {
    await db.responses.update(existingResponse.id, { html: html, timestamp: Date.now() });
  } else {
    await db.responses.add({
      chatId: chatId,
      responseId: responseId,
      html: html,
      timestamp: Date.now()
    });
  }
  
  debouncedRefreshSidebar(chatId, responseId);
}

async function getChatResponses(chatId) {
  return await db.responses.where('chatId').equals(chatId).sortBy('timestamp');
}

async function upgradeChatId(oldChatId, newChatId) {
  const session = await db.sessions.get(oldChatId);
  if (session) {
    const existingTarget = await db.sessions.get(newChatId);
    if (!existingTarget) {
      await db.sessions.put({
        chatId: newChatId,
        title: session.title,
        aiModel: session.aiModel,
        timestamp: session.timestamp
      });
    }
    await db.sessions.delete(oldChatId);
  }
  
  await db.responses.where('chatId').equals(oldChatId).modify(resp => {
    resp.chatId = newChatId;
  });
  
  debouncedRefreshSidebar(newChatId);
}

// Delete functions
async function deleteSession(chatId) {
  if (!confirm('Are you sure you want to delete this entire chat?')) return;
  await db.responses.where('chatId').equals(chatId).delete();
  await db.sessions.delete(chatId);
  refreshSidebar();
}

async function deleteResponse(responseDbId) {
  if (!confirm('Delete this response?')) return;
  await db.responses.delete(responseDbId);
  refreshSidebar();
}

const SVGS = {
  chevronRight: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="tree-chevron"><path d="m9 18 6-6-6-6"/></svg>`,
  chevronDown: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="tree-chevron expanded"><path d="m6 9 6 6 6-6"/></svg>`,
  folder: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tree-icon"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`,
  folderOpen: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tree-icon"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="m16 10-4 4-4-4"/></svg>`,
  chatFolder: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tree-icon"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  file: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tree-icon"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>`,
  trash: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`
};

function getBrandColorClass(modelName) {
  const name = modelName.toLowerCase();
  if (name.includes("chatgpt")) return "color-chatgpt";
  if (name.includes("claude")) return "color-claude";
  if (name.includes("gemini")) return "color-gemini";
  if (name.includes("deepseek")) return "color-deepseek";
  return "color-chat";
}

const BRAND_ICONS = {
  gemini: "https://helios-i.mashable.com/imagery/articles/00zEnhbB6mXQs8x5yXw38bT/images-3.fit_lim.size_376x.webp",
  chatgpt: "https://freepnglogo.com/images/all_img/1690998448chat-gpt-logo-png.png",
  claude: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRnM91o7r1wba01xcHW15PLqbe-ONaTIjOO3g&s",
  deepseek: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/ba/Deepseek-logo-icon.svg/3840px-Deepseek-logo-icon.svg.png"
};

function getBrandIconHtml(modelName) {
  const name = modelName.toLowerCase();
  let url = "";
  if (name.includes("chatgpt")) url = BRAND_ICONS.chatgpt;
  else if (name.includes("claude")) url = BRAND_ICONS.claude;
  else if (name.includes("gemini")) url = BRAND_ICONS.gemini;
  else if (name.includes("deepseek")) url = BRAND_ICONS.deepseek;
  
  if (url) {
    return `<img src="${url}" class="brand-avatar-icon" alt="${modelName}">`;
  }
  return SVGS.folder;
}

async function refreshSidebar(activeChatId = null, activeResponseId = null) {
  const searchQuery = (document.getElementById('search-history')?.value || '').trim().toLowerCase();
  const sessions = await db.sessions.orderBy('timestamp').reverse().toArray();
  const list = document.getElementById('history-list');
  if (!list) return;
  
  const container = document.createDocumentFragment();

  // Group by aiModel
  const models = {};
  for (const session of sessions) {
    if (searchQuery && !session.title.toLowerCase().includes(searchQuery)) {
      continue;
    }
    const model = session.aiModel || "Unknown AI";
    if (!models[model]) models[model] = [];
    models[model].push(session);
  }

  for (const [aiModel, modelSessions] of Object.entries(models)) {
    if (modelSessions.length === 0) continue;
    const modelExpanded = isExpanded('models', aiModel);
    const brandClass = getBrandColorClass(aiModel);
    
    // Model Folder Header Container
    const modelContainer = document.createElement('div');
    modelContainer.className = 'tree-model-container';
    
    // Model Folder Header
    const modelHeader = document.createElement('div');
    modelHeader.className = `tree-item level-0 ${modelExpanded ? 'expanded' : ''}`;
    modelHeader.innerHTML = `
      <span class="chevron-wrapper">${modelExpanded ? SVGS.chevronDown : SVGS.chevronRight}</span>
      <span class="icon-wrapper">${getBrandIconHtml(aiModel)}</span>
      <span class="tree-label">${aiModel}</span>
      <span class="tree-badge">${modelSessions.length}</span>
    `;
    
    modelHeader.addEventListener('click', () => {
      expandedState.models[aiModel] = !isExpanded('models', aiModel);
      refreshSidebar(activeChatId, activeResponseId);
    });
    modelContainer.appendChild(modelHeader);

    if (modelExpanded) {
      const childrenContainer = document.createElement('div');
      childrenContainer.className = 'tree-children';
      
      for (const session of modelSessions) {
        const sessionExpanded = isExpanded('sessions', session.chatId);
        const isSessionActive = activeChatId === session.chatId && !activeResponseId;
        
        const sessionContainer = document.createElement('div');
        sessionContainer.className = 'tree-session-container';
        
        const sessionHeader = document.createElement('div');
        sessionHeader.className = `tree-item level-1 ${sessionExpanded ? 'expanded' : ''} ${isSessionActive ? 'active' : ''}`;
        
        sessionHeader.innerHTML = `
          <span class="chevron-wrapper">${sessionExpanded ? SVGS.chevronDown : SVGS.chevronRight}</span>
          <span class="icon-wrapper color-chat">${SVGS.chatFolder}</span>
          <span class="tree-label" title="${session.title}">${session.title}.chat</span>
          <span class="tree-item-meta">
            <button class="tree-action-btn delete-session-btn" title="Delete chat">${SVGS.trash}</button>
          </span>
        `;
        
        // Chevron click toggles expansion
        sessionHeader.querySelector('.chevron-wrapper').addEventListener('click', (e) => {
          e.stopPropagation();
          expandedState.sessions[session.chatId] = !isExpanded('sessions', session.chatId);
          refreshSidebar(activeChatId, activeResponseId);
        });
        
        // Delete button
        sessionHeader.querySelector('.delete-session-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          deleteSession(session.chatId);
        });
        
        // Click to load full chat
        sessionHeader.addEventListener('click', () => {
          window.loadFullChat(session.chatId, session.title);
        });
        
        sessionContainer.appendChild(sessionHeader);
        
        if (sessionExpanded) {
          const subChildrenContainer = document.createElement('div');
          subChildrenContainer.className = 'tree-children level-1-children';
          
          const responses = await getChatResponses(session.chatId);
          responses.forEach((resp, index) => {
            const isResponseActive = activeResponseId === resp.responseId;
            
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = resp.html;
            let snippet = tempDiv.innerText.trim().replace(/\s+/g, ' ').substring(0, 40);
            if (!snippet) snippet = `Response #${index + 1}`;
            else if (tempDiv.innerText.trim().length > 40) snippet += '...';
            
            const subItem = document.createElement('div');
            subItem.className = `tree-item level-2 ${isResponseActive ? 'active' : ''}`;
            
            const fileNum = String(index + 1).padStart(2, '0');
            subItem.innerHTML = `
              <span class="icon-wrapper color-file">${SVGS.file}</span>
              <span class="tree-label" title="${tempDiv.innerText.substring(0, 200)}">response_${fileNum}.md</span>
              <span class="tree-item-meta">
                <button class="tree-action-btn delete-response-btn" title="Delete response">${SVGS.trash}</button>
              </span>
            `;
            
            subItem.querySelector('.delete-response-btn').addEventListener('click', (e) => {
              e.stopPropagation();
              deleteResponse(resp.id);
            });
            
            subItem.addEventListener('click', (e) => {
              e.stopPropagation();
              window.loadSingleResponseIntoEditor(resp.html, `${aiModel}: ${session.title} - Response #${index + 1}`, session.chatId, resp.responseId);
            });
            
            subChildrenContainer.appendChild(subItem);
          });
          
          sessionContainer.appendChild(subChildrenContainer);
        }
        
        childrenContainer.appendChild(sessionContainer);
      }
      
      modelContainer.appendChild(childrenContainer);
    }
    
    container.appendChild(modelContainer);
  }

  // Final swap to prevent flickering
  list.innerHTML = '';
  list.appendChild(container);
}
async function clearAllHistory() {
  await db.sessions.clear();
  await db.responses.clear();
}

window.clearAllHistory = clearAllHistory;
window.deleteSession = deleteSession;
window.deleteResponse = deleteResponse;
window.refreshSidebar = refreshSidebar;
window.saveLiveResponse = saveLiveResponse;
window.getChatResponses = getChatResponses;
window.upgradeChatId = upgradeChatId;
