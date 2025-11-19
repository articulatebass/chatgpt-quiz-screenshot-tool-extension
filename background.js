// background.js (service worker)

// Click the extension icon → start rectangle selection on the active tab
chrome.action.onClicked.addListener((tab) => {
  if (!tab || !tab.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "START_SELECTION" });
});

// Listen for messages from the content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CAPTURE_RECT") {
    const tab = sender.tab;
    if (!tab || typeof tab.windowId === "undefined" || typeof tab.id === "undefined") {
      console.warn("[RectShot] No valid tab in sender for CAPTURE_RECT");
      return;
    }

    // Capture the visible area of the current window as PNG
    chrome.tabs.captureVisibleTab(
      tab.windowId,
      { format: "png" },
      (dataUrl) => {
        if (chrome.runtime.lastError) {
          console.error("[RectShot] captureVisibleTab error:", chrome.runtime.lastError);
          chrome.tabs.sendMessage(tab.id, {
            type: "CAPTURE_ERROR",
            error: chrome.runtime.lastError.message || "Unknown capture error"
          });
          return;
        }

        if (!dataUrl) {
          console.error("[RectShot] captureVisibleTab returned empty dataUrl");
          chrome.tabs.sendMessage(tab.id, {
            type: "CAPTURE_ERROR",
            error: "Empty screenshot data"
          });
          return;
        }

        // Send screenshot + rect + DPR back to content script
        chrome.tabs.sendMessage(tab.id, {
          type: "CAPTURE_RESULT",
          dataUrl,
          rect: message.rect,
          dpr: message.dpr
        });
      }
    );

    // Keep message channel open for async response
    return true;
  }
});
