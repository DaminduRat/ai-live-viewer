let isOpeningViewer = false;

// Open viewer window when action icon is clicked
chrome.action.onClicked.addListener((tab) => {
  openViewer();
});

// Create or focus viewer
function openViewer() {
  if (isOpeningViewer) return;
  isOpeningViewer = true;

  const viewerUrl = chrome.runtime.getURL("viewer/index.html");
  
  chrome.windows.getAll({ populate: true, windowTypes: ['popup'] }, (windows) => {
    // Check if any popup window has our viewer URL
    const existingWindow = windows.find(win => 
      win.tabs && win.tabs.some(tab => tab.url && tab.url.includes(viewerUrl))
    );
    
    if (existingWindow) {
      chrome.windows.update(existingWindow.id, { focused: true }, () => {
        isOpeningViewer = false;
        if (chrome.runtime.lastError) {
          // Window might have just closed, try creating it next time
          console.error("Focus failed:", chrome.runtime.lastError.message);
        }
      });
    } else {
      chrome.windows.create({
        url: viewerUrl,
        type: "popup",
        width: 1200,
        height: 800
      }, () => {
        // Delay slightly before releasing lock to ensure window is registered
        setTimeout(() => {
          isOpeningViewer = false;
        }, 1000);
      });
    }
  });
}

// Listen for messages from content.js or viewer window
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "LIVE_STREAM" || request.type === "UPGRADE_CHAT_ID") {
    // Forward live stream or upgrade event to all viewer tabs (there should only be one)
    const viewerUrl = chrome.runtime.getURL("viewer/index.html");
    chrome.tabs.query({ url: viewerUrl }, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, request, () => {
          chrome.runtime.lastError;
        });
      });
    });
  } else if (request.type === "OPEN_VIEWER") {
    openViewer();
  }
});
