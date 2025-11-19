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
      enableSelectShortcut: false
    },
    (data) => {
      const showRectToggle = document.getElementById("showRectangleToggle");
      const selectShortcutToggle = document.getElementById("enableSelectShortcutToggle");

      if (showRectToggle) {
        showRectToggle.checked = !!data.showRectangle;
      }
      if (selectShortcutToggle) {
        selectShortcutToggle.checked = !!data.enableSelectShortcut;
      }
    }
  );
}

// ---- UI wiring ----

const showRectEl = document.getElementById("showRectangleToggle");
const selectShortcutEl = document.getElementById("enableSelectShortcutToggle");
const startBtn = document.getElementById("startBtn");
const initKeyBtn = document.getElementById("initKeyBtn");

loadSettings();

startBtn.addEventListener("click", () => {
  const showRectangle = showRectEl.checked;
  const enableSelectShortcut = selectShortcutEl.checked;

  chrome.storage.local.set({
    showRectangle,
    enableSelectShortcut
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
    "Choose a decryption password (you must remember this to use the key later):"
  );
  if (!passphrase) {
    statusEl.textContent = "Initialization cancelled (no password).";
    return;
  }

  try {
    const encrypted = await encryptApiKey(apiKey.trim(), passphrase);
    await new Promise((resolve) => {
      chrome.storage.local.set({ openaiKeyEnc: encrypted }, resolve);
    });
    statusEl.textContent = "API key saved (encrypted). Remember your password.";
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
