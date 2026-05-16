// SOAP AI Assistant - Background Service Worker
// ================================================

import { sendToN8N } from './n8n-handler.js';
import { MESSAGE_ACTIONS, STORAGE_KEYS } from './constants.js';

// ================================================
// INITIALIZATION
// ================================================

/**
 * Initialize default settings on startup
 */
function initializeSettings() {
  chrome.storage.sync.get([STORAGE_KEYS.ENABLED], (result) => {
    if (result.enabled === undefined) {
      chrome.storage.sync.set({ enabled: true });
      console.log('SOAP Assistant - Initialized with enabled=true');
    }
  });
}

initializeSettings();

// ================================================
// MESSAGE HANDLING
// ================================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case MESSAGE_ACTIONS.SEND_TO_N8N:
      handleSendToN8N(request)
        .then(response => sendResponse({ success: true, corrections: response }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // Keep message channel open for async response

    case MESSAGE_ACTIONS.SAVE_SETTINGS:
      handleSaveSettings(request)
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;

    case MESSAGE_ACTIONS.GET_SETTINGS:
      handleGetSettings()
        .then(settings => sendResponse(settings))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
  }
});

/**
 * Handle send to N8N request
 */
async function handleSendToN8N(request) {
  return await sendToN8N(request.url, request.data);
}

/**
 * Handle save settings request
 */
async function handleSaveSettings(request) {
  await chrome.storage.sync.set({
    n8nUrl: request.n8nUrl,
    enabled: request.enabled
  });
}

/**
 * Handle get settings request
 */
async function handleGetSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get([STORAGE_KEYS.N8N_URL, STORAGE_KEYS.ENABLED], (result) => {
      resolve({
        n8nUrl: result.n8nUrl || '',
        enabled: result.enabled !== false
      });
    });
  });
}

// ================================================
// EVENT LISTENERS
// ================================================

/**
 * Handle extension install/update
 */
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Set default settings
    chrome.storage.sync.set({
      enabled: true,
      n8nUrl: ''
    });

    // Open welcome popup
    chrome.tabs.create({
      url: chrome.runtime.getURL('src/popup/popup.html')
    });
  }
});

/**
 * Handle extension icon click
 */
chrome.action.onClicked.addListener((tab) => {
  chrome.action.openPopup();
});
