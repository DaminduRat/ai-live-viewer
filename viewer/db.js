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
function debouncedRefreshSidebar() {
  if (refreshTimeout) clearTimeout(refreshTimeout);
  refreshTimeout = setTimeout(() => refreshSidebar(), 300);
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
  
  debouncedRefreshSidebar();
}

async function getChatResponses(chatId) {
  return await db.responses.where('chatId').equals(chatId).sortBy('timestamp');
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

async function refreshSidebar() {
  const sessions = await db.sessions.orderBy('timestamp').reverse().toArray();
  const list = document.getElementById('history-list');
  if (!list) return;
  list.innerHTML = '';

  // Group by aiModel
  const models = {};
  for (const session of sessions) {
    const model = session.aiModel || "Unknown AI";
    if (!models[model]) models[model] = [];
    models[model].push(session);
  }

  for (const [aiModel, modelSessions] of Object.entries(models)) {
    const modelExpanded = isExpanded('models', aiModel);
    
    // Model Folder Header
    const modelHeader = document.createElement('div');
    modelHeader.className = 'history-model-header';
    modelHeader.style.cursor = 'pointer';
    modelHeader.style.userSelect = 'none';
    modelHeader.innerHTML = `<span style="display:inline-block;transition:transform 0.2s;transform:rotate(${modelExpanded ? '0' : '-90'}deg);margin-right:6px;font-size:0.7rem;">▼</span> 📁 ${aiModel}`;
    modelHeader.addEventListener('click', () => {
      expandedState.models[aiModel] = !isExpanded('models', aiModel);
      refreshSidebar();
    });
    list.appendChild(modelHeader);

    if (!modelExpanded) continue;

    for (const session of modelSessions) {
      const sessionExpanded = isExpanded('sessions', session.chatId);
      
      // Chat Topic
      const topicDiv = document.createElement('div');
      topicDiv.className = 'history-item';
      topicDiv.style.borderLeft = '4px solid var(--btn-primary)';
      topicDiv.style.marginLeft = '10px';
      topicDiv.style.position = 'relative';
      
      topicDiv.innerHTML = `
        <div class="history-item-title" style="display:flex;align-items:center;">
          <span class="expand-toggle" style="display:inline-block;transition:transform 0.2s;transform:rotate(${sessionExpanded ? '0' : '-90'}deg);margin-right:6px;font-size:0.7rem;cursor:pointer;">▼</span>
          <span style="flex:1;">${session.title}</span>
          <span class="delete-btn" title="Delete chat" style="color:#ff4444;font-size:1rem;cursor:pointer;margin-left:8px;opacity:0.6;">✕</span>
        </div>
        <div class="history-item-date">${new Date(session.timestamp).toLocaleString()}</div>
      `;
      
      // Expand/collapse toggle
      topicDiv.querySelector('.expand-toggle').addEventListener('click', (e) => {
        e.stopPropagation();
        expandedState.sessions[session.chatId] = !isExpanded('sessions', session.chatId);
        refreshSidebar();
      });
      
      // Delete button
      topicDiv.querySelector('.delete-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteSession(session.chatId);
      });
      
      // Click to load full chat
      topicDiv.addEventListener('click', () => {
        window.loadFullChat(session.chatId, session.title);
      });
      
      list.appendChild(topicDiv);
      
      if (!sessionExpanded) continue;
      
      // Sub-responses
      const responses = await getChatResponses(session.chatId);
      responses.forEach((resp, index) => {
        const subDiv = document.createElement('div');
        subDiv.className = 'history-item sub-topic';
        subDiv.style.paddingLeft = '30px';
        subDiv.style.marginLeft = '10px';
        subDiv.innerHTML = `
          <div class="history-item-title" style="font-size:0.85rem;font-weight:normal;display:flex;align-items:center;">
            <span style="flex:1;">Response #${index + 1}</span>
            <span class="delete-resp-btn" title="Delete response" style="color:#ff4444;font-size:0.85rem;cursor:pointer;opacity:0.6;">✕</span>
          </div>
          <div class="history-item-date">${new Date(resp.timestamp).toLocaleTimeString()}</div>
        `;
        
        subDiv.querySelector('.delete-resp-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          deleteResponse(resp.id);
        });
        
        subDiv.addEventListener('click', () => {
          window.loadSingleResponseIntoEditor(resp.html, `${aiModel}: ${session.title} - Response #${index + 1}`);
        });
        
        list.appendChild(subDiv);
      });
    }
  }
}
