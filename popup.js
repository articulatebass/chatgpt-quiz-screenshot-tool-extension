// popup.js

// ---- helpers ----

function withActiveTab(fn) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0] || !tabs[0].id) return;
    fn(tabs[0].id);
  });
}

function loadSettings() {
  chrome.storage.local.get(
    {
      showRectangle: true,
      enableSelectShortcut: false,
      selectedModel: "o1"
    },
    (data) => {
      const showRectToggle = document.getElementById("showRectangleToggle");
      const selectShortcutToggle = document.getElementById("enableSelectShortcutToggle");
      const modelSelect = document.getElementById("modelSelect");

      if (showRectToggle) {
        showRectToggle.checked = !!data.showRectangle;
      }
      if (selectShortcutToggle) {
        selectShortcutToggle.checked = !!data.enableSelectShortcut;
      }
      if (modelSelect) {
        modelSelect.value = data.selectedModel || "o1";
      }
    }
  );
}

// ---- UI wiring ----

const showRectEl = document.getElementById("showRectangleToggle");
const selectShortcutEl = document.getElementById("enableSelectShortcutToggle");
const modelSelectEl = document.getElementById("modelSelect");
const startBtn = document.getElementById("startBtn");
const initKeyBtn = document.getElementById("initKeyBtn");

loadSettings();

startBtn.addEventListener("click", () => {
  const showRectangle = showRectEl.checked;
  const enableSelectShortcut = selectShortcutEl.checked;
  const selectedModel = (modelSelectEl && modelSelectEl.value) || "o1";

  chrome.storage.local.set({
    showRectangle,
    enableSelectShortcut,
    selectedModel
  });

  withActiveTab((tabId) => {
    chrome.tabs.sendMessage(tabId, {
      type: "START_SELECTION",
      showRectangle
    });
  });

  // Close the popup so the overlay can receive input
  window.close();
});

showRectEl.addEventListener("change", () => {
  const showRectangle = showRectEl.checked;

  chrome.storage.local.set({ showRectangle });

  withActiveTab((tabId) => {
    chrome.tabs.sendMessage(tabId, {
      type: "UPDATE_SHOW_RECTANGLE",
      showRectangle
    });
  });
});

selectShortcutEl.addEventListener("change", () => {
  const enabled = selectShortcutEl.checked;

  chrome.storage.local.set({ enableSelectShortcut: enabled });

  withActiveTab((tabId) => {
    chrome.tabs.sendMessage(tabId, {
      type: "UPDATE_SELECT_SHORTCUT",
      enabled
    });
  });
});

if (modelSelectEl) {
  modelSelectEl.addEventListener("change", () => {
    const model = modelSelectEl.value || "o1";

    chrome.storage.local.set({ selectedModel: model });

    withActiveTab((tabId) => {
      chrome.tabs.sendMessage(tabId, {
        type: "UPDATE_MODEL_SELECTION",
        model
      });
    });
  });
}

initKeyBtn.addEventListener("click", () => {
  initOpenAIKey();
});

// ---- Encryption helpers (Web Crypto, AES-GCM) ----

async function initOpenAIKey() {
  const statusEl = document.getElementById("status");

  const apiKey = window.prompt("Enter your OpenAI API key:");
  if (!apiKey) {
    statusEl.textContent = "Initialization cancelled.";
    return;
  }

  const passphrase = window.prompt(
    "Choose a decryption password (optional).\n" +
      "Leave blank to store the key without an extra password.\n" +
      "Click Cancel to abort."
  );

  // User hit Cancel on the passphrase prompt => do nothing
  if (passphrase === null) {
    statusEl.textContent = "Initialization cancelled.";
    return;
  }

  try {
    if (passphrase === "") {
      // No decrypt password: store key in plain form in local storage
      await new Promise((resolve) => {
        chrome.storage.local.set(
          {
            openaiApiKeyPlain: apiKey.trim(),
            openaiKeyEnc: null // clear any previous encrypted key
          },
          resolve
        );
      });
      statusEl.textContent =
        "API key saved without extra password (stored only in this browser).";
    } else {
      // With decrypt password: store encrypted key as before
      const encrypted = await encryptApiKey(apiKey.trim(), passphrase);
      await new Promise((resolve) => {
        chrome.storage.local.set(
          {
            openaiKeyEnc: encrypted,
            openaiApiKeyPlain: null // clear any previous plain key
          },
          resolve
        );
      });
      statusEl.textContent =
        "API key saved (encrypted). Remember your password.";
    }
  } catch (err) {
    console.error("Error encrypting/saving key:", err);
    statusEl.textContent = "Error saving key: " + err.message;
  }
}

function strToUint8(str) {
  return new TextEncoder().encode(str);
}

function uint8ToBase64(bytes) {
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
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

async function encryptApiKey(apiKey, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKeyFromPassphrase(passphrase, salt);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    strToUint8(apiKey)
  );

  return {
    ciphertext: uint8ToBase64(new Uint8Array(ciphertext)),
    iv: uint8ToBase64(iv),
    salt: uint8ToBase64(salt)
  };
}

// (Decryption happens in content.js, which has matching helpers)
