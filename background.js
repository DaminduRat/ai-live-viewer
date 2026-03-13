let viewerTabId = null;

// Open viewer window when action icon is clicked
chrome.action.onClicked.addListener((tab) => {
  openViewer();
});

// Create or focus viewer
function openViewer() {
  if (viewerTabId === null) {
    chrome.windows.create({
      url: chrome.runtime.getURL("viewer/index.html"),
      type: "popup",
      width: 1200,
      height: 800
    }, (win) => {
      viewerTabId = win.tabs[0].id;
    });
  } else {
    chrome.tabs.get(viewerTabId, (tab) => {
      if (chrome.runtime.lastError) {
        viewerTabId = null;
        openViewer();
      } else {
        chrome.windows.update(tab.windowId, { focused: true });
      }
    });
  }
}

// Listen for messages from content.js or viewer window
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "LIVE_STREAM") {
    // Forward live stream to the viewer tab if it's open
    if (viewerTabId !== null) {
      chrome.tabs.sendMessage(viewerTabId, request, () => {
        // Ignore errors if viewer is not ready
        chrome.runtime.lastError;
      });
    }
  } else if (request.type === "OPEN_VIEWER") {
    openViewer();
  }
});

// Clear viewer tab ID when closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === viewerTabId) {
    viewerTabId = null;
  }
});
