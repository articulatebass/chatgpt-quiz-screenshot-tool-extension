// content.js

let selectionActive = false;
let overlay = null;
let boxRect = null;   // rectangle outline
let pointDot = null;  // first-click dot
let startX = 0;
let startY = 0;

// Config from popup: whether rectangle is normally shown
let configShowRectangle = true;
// Remember user's rectangle preference for shortcuts
let lastShowRectangleSetting = true;
// Temporary inversion while "m" is pressed
let invertRectKeyActive = false;

// Needed so we can remove it
function handleContextMenu(e) {
  e.preventDefault();
}

// ===== ChatGPT-related globals =====
let lastCroppedImageDataUrl = null;
let chatButtonsContainer = null;
let chatButton = null;
let cancelButton = null;
let loadingBar = null;
let resultPanel = null;
let openAIApiKey = null; // decrypted key kept only in memory for this page

// ===== Shortcut-related globals =====
let enableSelectShortcut = false;
let globalKeyListenerAttached = false;

// Attach a single global key listener for shortcuts
function ensureGlobalKeyListener() {
  if (globalKeyListenerAttached) return;
  window.addEventListener("keydown", onGlobalKeyDown, true);
  globalKeyListenerAttached = true;
}

// Global keyboard shortcuts:
// s -> start selection (if enabled in popup)
// p -> proceed
// c -> cancel
// x -> close result panel
function onGlobalKeyDown(e) {
  const tag = e.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable) {
    return;
  }

  if ((e.key === "s" || e.key === "S") && enableSelectShortcut && !selectionActive) {
    e.preventDefault();
    configShowRectangle = lastShowRectangleSetting;
    invertRectKeyActive = false;
    startSelection();
    return;
  }

  if ((e.key === "p" || e.key === "P") && chatButton && chatButtonsContainer) {
    e.preventDefault();
    onChatButtonClick();
    return;
  }

  if ((e.key === "c" || e.key === "C") && cancelButton && chatButtonsContainer) {
    e.preventDefault();
    onCancelButtonClick();
    return;
  }

  if ((e.key === "x" || e.key === "X") && resultPanel) {
    e.preventDefault();
    closeResultPanel();
    return;
  }
}

// enable key listener immediately
ensureGlobalKeyListener();

// Load initial settings from storage
chrome.storage.local.get(["showRectangle", "enableSelectShortcut"], (data) => {
  if (typeof data.showRectangle === "boolean") {
    configShowRectangle = data.showRectangle;
    lastShowRectangleSetting = data.showRectangle;
  }
  if (typeof data.enableSelectShortcut === "boolean") {
    enableSelectShortcut = data.enableSelectShortcut;
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "START_SELECTION") {
    configShowRectangle =
      message.showRectangle !== undefined ? message.showRectangle : true;
    lastShowRectangleSetting = configShowRectangle;
    invertRectKeyActive = false;
    startSelection();
  } else if (message.type === "CAPTURE_RESULT") {
    handleCaptureResult(message);
  } else if (message.type === "CAPTURE_ERROR") {
    console.error("[RectShot] Capture error:", message.error);
    alert("Failed to capture screenshot: " + message.error);
  } else if (message.type === "UPDATE_SELECT_SHORTCUT") {
    enableSelectShortcut = !!message.enabled;
  } else if (message.type === "UPDATE_SHOW_RECTANGLE") {
    if (typeof message.showRectangle === "boolean") {
      configShowRectangle = message.showRectangle;
      lastShowRectangleSetting = message.showRectangle;
    }
  }
});

function isRectVisible() {
  return configShowRectangle ^ invertRectKeyActive;
}

function startSelection() {
  if (selectionActive) {
    cleanupSelection();
    return;
  }

  selectionActive = true;

  overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    cursor: "default",
    background: "transparent"
  });

  overlay.tabIndex = -1;

  overlay.addEventListener("click", onOverlayClick, true);
  overlay.addEventListener("mousemove", onOverlayMouseMove, true);
  overlay.addEventListener("contextmenu", handleContextMenu, true);
  overlay.addEventListener("keydown", onOverlayKeyDown, true);
  overlay.addEventListener("keyup", onOverlayKeyUp, true);

  document.body.appendChild(overlay);
  overlay.focus();
}

function onOverlayKeyDown(e) {
  if (e.key === "Escape") {
    cleanupSelection();
    return;
  }
  if (e.key === "m" || e.key === "M") {
    if (!invertRectKeyActive) {
      invertRectKeyActive = true;
      updateVisualMode();
    }
  }
}

function onOverlayKeyUp(e) {
  if (e.key === "m" || e.key === "M") {
    invertRectKeyActive = false;
    updateVisualMode();
  }
}

function onOverlayClick(e) {
  e.preventDefault();
  e.stopPropagation();

  if (e.button !== 0) return; // only left click

  if (!boxRect && !pointDot) {
    startX = e.clientX;
    startY = e.clientY;

    boxRect = document.createElement("div");
    Object.assign(boxRect.style, {
      position: "fixed",
      border: "1px solid rgba(0,0,0,0.05)",
      background: "transparent",
      pointerEvents: "none"
    });

    pointDot = document.createElement("div");
    Object.assign(pointDot.style, {
      position: "fixed",
      width: "2px",
      height: "2px",
      background: "black",
      pointerEvents: "none"
    });

    overlay.appendChild(boxRect);
    overlay.appendChild(pointDot);

    updateBoxRect(startX, startY);
    updatePointDot();
    updateVisualMode();
  } else {
    const endX = e.clientX;
    const endY = e.clientY;

    const rect = normalizeRect(startX, startY, endX, endY);

    cleanupSelection();

    if (rect.width < 5 || rect.height < 5) return;

    chrome.runtime.sendMessage({
      type: "CAPTURE_RECT",
      rect,
      dpr: window.devicePixelRatio || 1
    });
  }
}

function onOverlayMouseMove(e) {
  if (!boxRect) return;
  updateBoxRect(e.clientX, e.clientY);
}

function updateBoxRect(currentX, currentY) {
  const rect = normalizeRect(startX, startY, currentX, currentY);
  boxRect.style.left = rect.x + "px";
  boxRect.style.top = rect.y + "px";
  boxRect.style.width = rect.width + "px";
  boxRect.style.height = rect.height + "px";
}

function updatePointDot() {
  pointDot.style.left = startX - 1 + "px";
  pointDot.style.top = startY - 1 + "px";
}

function updateVisualMode() {
  if (!boxRect || !pointDot) return;
  const showRect = isRectVisible();
  boxRect.style.display = showRect ? "block" : "none";
  pointDot.style.display = showRect ? "none" : "block";
}

function normalizeRect(x1, y1, x2, y2) {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1)
  };
}

function cleanupSelection() {
  selectionActive = false;

  if (overlay) {
    overlay.removeEventListener("click", onOverlayClick, true);
    overlay.removeEventListener("mousemove", onOverlayMouseMove, true);
    overlay.removeEventListener("contextmenu", handleContextMenu, true);
    overlay.removeEventListener("keydown", onOverlayKeyDown, true);
    overlay.removeEventListener("keyup", onOverlayKeyUp, true);
    overlay.remove();
  }

  overlay = null;
  boxRect = null;
  pointDot = null;
  invertRectKeyActive = false;
}

// ===== Capture result =====

function handleCaptureResult(message) {
  const { dataUrl, rect, dpr } = message;
  const img = new Image();

  img.onload = () => {
    const scale = dpr || 1;
    const canvas = document.createElement("canvas");
    canvas.width = rect.width * scale;
    canvas.height = rect.height * scale;
    const ctx = canvas.getContext("2d");

    ctx.drawImage(
      img,
      rect.x * scale,
      rect.y * scale,
      rect.width * scale,
      rect.height * scale,
      0,
      0,
      canvas.width,
      canvas.height
    );

    const cropped = canvas.toDataURL("image/png");
    lastCroppedImageDataUrl = cropped;

    showChatButtons();
  };

  img.src = dataUrl;
}

// ===== Buttons =====

function showChatButtons() {
  removeChatButtons();

  chatButtonsContainer = document.createElement("div");
  Object.assign(chatButtonsContainer.style, {
    position: "fixed",
    top: "10px",
    right: "10px",
    zIndex: "2147483647",
    display: "flex",
    gap: "8px"
  });

  chatButton = document.createElement("button");
  chatButton.textContent = "proceed";
  Object.assign(chatButton.style, {
    padding: "8px 12px",
    fontSize: "13px",
    fontFamily: "system-ui, sans-serif",
    borderRadius: "4px",
    border: "1px solid rgba(0,0,0,0.05)",
    background: "transparent",
    color: "rgba(0,0,0,0.05)",
    cursor: "pointer",
    whiteSpace: "nowrap",
    opacity: "1",
    backdropFilter: "blur(2px)"
  });
  chatButton.addEventListener("click", onChatButtonClick);

  cancelButton = document.createElement("button");
  cancelButton.textContent = "Cancel";
  Object.assign(cancelButton.style, {
    padding: "8px 10px",
    fontSize: "13px",
    fontFamily: "system-ui, sans-serif",
    borderRadius: "4px",
    border: "1px solid rgba(0,0,0,0.05)",
    background: "transparent",
    color: "rgba(0,0,0,0.05)",
    cursor: "pointer",
    whiteSpace: "nowrap",
    opacity: "1",
    backdropFilter: "blur(2px)"
  });
  cancelButton.addEventListener("click", onCancelButtonClick);

  chatButtonsContainer.appendChild(chatButton);
  chatButtonsContainer.appendChild(cancelButton);
  document.body.appendChild(chatButtonsContainer);
}

function removeChatButtons() {
  if (chatButton) {
    chatButton.removeEventListener("click", onChatButtonClick);
    chatButton = null;
  }
  if (cancelButton) {
    cancelButton.removeEventListener("click", onCancelButtonClick);
    cancelButton = null;
  }
  if (chatButtonsContainer) {
    chatButtonsContainer.remove();
    chatButtonsContainer = null;
  }
}

function onCancelButtonClick() {
  lastCroppedImageDataUrl = null;
  removeChatButtons();
}

// ===== Crypto =====

function strToUint8(str) {
  return new TextEncoder().encode(str);
}

function base64ToUint8(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveKeyFromPassphrase(passphrase, saltBytes) {
  const passphraseBytes = strToUint8(passphrase);
  const baseKey = await crypto.subtle.importKey(
    "raw",
    passphraseBytes,
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: 100000,
      hash: "SHA-256"
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function decryptApiKey(encObj, passphrase) {
  const salt = base64ToUint8(encObj.salt);
  const iv = base64ToUint8(encObj.iv);
  const ciphertext = base64ToUint8(encObj.ciphertext);

  const key = await deriveKeyFromPassphrase(passphrase, salt);
  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );

  const dec = new TextDecoder();
  return dec.decode(plaintextBuffer);
}

async function getApiKeyForSession() {
  if (openAIApiKey) {
    return openAIApiKey;
  }

  const storageData = await new Promise((resolve) => {
    chrome.storage.local.get(["openaiKeyEnc"], resolve);
  });

  const encObj = storageData.openaiKeyEnc;
  if (!encObj) {
    alert(
      "No OpenAI API key is initialized.\n\nOpen the extension popup and click 'Initialize OpenAI API key' first."
    );
    return null;
  }

  const passphrase = window.prompt(
    "Enter your decryption password for the OpenAI API key:"
  );
  if (!passphrase) {
    return null;
  }

  try {
    const apiKey = await decryptApiKey(encObj, passphrase);
    openAIApiKey = apiKey;
    return apiKey;
  } catch (err) {
    console.error("Failed to decrypt API key:", err);
    alert("Failed to decrypt API key. Check your password and try again.");
    return null;
  }
}

// ===== ChatGPT request =====

async function onChatButtonClick() {
  if (!lastCroppedImageDataUrl) {
    alert("No screenshot data available.");
    return;
  }

  const apiKey = await getApiKeyForSession();
  if (!apiKey) {
    return;
  }

  removeChatButtons();
  showLoadingBar("Loading...");

  try {
    const body = {
      model: "gpt-5.1",
      reasoning: { effort: "low" },
      text: { verbosity: "low" },
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "You are helping me understand this screenshot.\n" +
                "1) Briefly explain what is shown.\n" +
                "2) If there is a question or problem, answer or solve it clearly.\n"
            },
            {
              type: "input_image",
              image_url: lastCroppedImageDataUrl,
              detail: "high"
            }
          ]
        }
      ]
    };

    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey
      },
      body: JSON.stringify(body)
    });

    const json = await resp.json();
    hideLoadingBar();

    if (!resp.ok) {
      const msg = (json && json.error && json.error.message) || JSON.stringify(json);
      showResultPanel("Error from OpenAI: " + msg);
      return;
    }

    let answer = "";
    if (json.output_text) {
      answer = json.output_text;
    } else if (Array.isArray(json.output)) {
      const pieces = [];
      for (const item of json.output) {
        if (Array.isArray(item.content)) {
          for (const c of item.content) {
            if (c.type === "output_text" && typeof c.text === "string") {
              pieces.push(c.text);
            }
          }
        }
      }
      answer = pieces.join("\n");
    } else {
      answer = JSON.stringify(json);
    }

    showResultPanel(answer || "(No answer text found)");
  } catch (err) {
    hideLoadingBar();
    showResultPanel("Network or parsing error: " + err.message);
  }
}

function showLoadingBar(message) {
  if (loadingBar) {
    loadingBar.textContent = message;
    return;
  }

  loadingBar = document.createElement("div");
  loadingBar.textContent = message || "Loading...";

  Object.assign(loadingBar.style, {
    position: "fixed",
    top: "10px",
    left: "50%",
    transform: "translateX(-50%)",
    padding: "4px 8px",
    background: "transparent",
    color: "rgba(0,0,0,0.25)",
    fontSize: "14px",
    fontFamily: "system-ui, sans-serif",
    zIndex: "2147483647",
    textShadow: "0 0 4px rgba(255,255,255,0.6)"
  });

  document.body.appendChild(loadingBar);
}

function hideLoadingBar() {
  if (loadingBar) {
    loadingBar.remove();
    loadingBar = null;
  }
}

// ===== ChatGPT output panel =====

function closeResultPanel() {
  if (resultPanel) {
    resultPanel.remove();
    resultPanel = null;
  }
}

function showResultPanel(text) {
  if (resultPanel) {
    resultPanel.remove();
  }

  resultPanel = document.createElement("div");
  resultPanel.id = "__resultPanel";

  Object.assign(resultPanel.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    maxWidth: "400px",
    maxHeight: "10vh",
    overflowY: "auto",
    padding: "12px",

    background: "rgba(255,255,255,0.05)",
    color: "rgba(0,0,0,0.32)",

    fontSize: "13px",
    fontFamily: "system-ui, sans-serif",

    borderRadius: "6px",
    border: "1px solid rgba(0,0,0,0.05)",
    boxShadow: "none",
    backdropFilter: "blur(3px)",

    zIndex: "2147483647",
    whiteSpace: "pre-wrap"
  });

  const scrollbarStyle = document.createElement("style");
  scrollbarStyle.textContent = `
    #__resultPanel::-webkit-scrollbar {
      width: 3px;
    }
    #__resultPanel::-webkit-scrollbar-track {
      background: rgba(0,0,0,0.02);
    }
    #__resultPanel::-webkit-scrollbar-thumb {
      background: rgba(0,0,0,0.02);
      border-radius: 4px;
    }
    #__resultPanel::-webkit-scrollbar-thumb:hover {
      background: rgba(0,0,0,0.02);
    }
  `;
  document.head.appendChild(scrollbarStyle);

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "×";
  Object.assign(closeBtn.style, {
    position: "absolute",
    top: "4px",
    right: "6px",
    border: "none",
    background: "transparent",
    color: "#666",
    cursor: "pointer",
    fontSize: "16px",
    lineHeight: "16px"
  });
  closeBtn.addEventListener("click", () => {
    closeResultPanel();
  });

  const textNode = document.createElement("div");
  textNode.textContent = text;

  resultPanel.appendChild(closeBtn);
  resultPanel.appendChild(textNode);
  document.body.appendChild(resultPanel);
}
