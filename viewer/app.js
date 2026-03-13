const editor = document.getElementById('editor');
const topicTitle = document.getElementById('current-topic');
let rootZoom = 1;

// Load History on Start
refreshSidebar();

// Handle Live Stream from Background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "LIVE_STREAM") {
    const { chatId, responseId, topic, aiModel, html, isStreaming } = request.data;
    topicTitle.textContent = topic;
    editor.innerHTML = html;
    
    // Save to DB
    saveLiveResponse(chatId, responseId, topic, aiModel, html);
  }
});

// Expose selection functions to global for onclick handlers in db.js
window.loadSingleResponseIntoEditor = (html, title) => {
  topicTitle.textContent = title;
  editor.innerHTML = html;
};

window.loadFullChat = async (chatId, title) => {
  topicTitle.textContent = title;
  const responses = await getChatResponses(chatId);
  const combinedHtml = responses.map((r, i) => `
    <div style="margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid #ccc;">
      <h3 style="margin-bottom: 10px;">Response #${i + 1}</h3>
      <div>${r.html}</div>
    </div>
  `).join('');
  editor.innerHTML = combinedHtml;
};

// UI Buttons - Zoom
document.getElementById('btn-zoom-in').onclick = () => {
  rootZoom += 0.1;
  editor.style.transform = `scale(${rootZoom})`;
};

document.getElementById('btn-zoom-out').onclick = () => {
  rootZoom = Math.max(0.5, rootZoom - 0.1);
  editor.style.transform = `scale(${rootZoom})`;
};

// UI Buttons - Theme Toggle
document.getElementById('btn-theme').onclick = () => {
  document.body.classList.toggle('light-mode');
  document.body.classList.toggle('dark-mode');
};

// Export - PDF (using DOC-style approach since html2pdf has issues in extensions)
document.getElementById('btn-export-pdf').onclick = () => {
  const content = editor.innerHTML;
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
        pre { background: #f5f5f5; padding: 10px; border-radius: 4px; overflow-x: auto; }
        code { background: #f0f0f0; padding: 2px 4px; border-radius: 3px; font-family: monospace; }
        pre code { background: transparent; padding: 0; }
        h1, h2, h3 { margin-top: 1em; margin-bottom: 0.5em; }
        p { margin-bottom: 0.8em; }
        table { border-collapse: collapse; width: 100%; margin: 1em 0; }
        th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
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
  </style>
  </head><body>`;
  const footer = "</body></html>";
  const sourceHTML = header + editor.innerHTML + footer;
  
  const source = 'data:application/vnd.ms-word;charset=utf-8,' + encodeURIComponent(sourceHTML);
  const fileDownload = document.createElement("a");
  document.body.appendChild(fileDownload);
  fileDownload.href = source;
  fileDownload.download = `${topicTitle.textContent}.doc`;
  fileDownload.click();
  document.body.removeChild(fileDownload);
};
