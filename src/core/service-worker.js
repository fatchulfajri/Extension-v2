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
        .then(response => sendResponse({ success: true, ...response }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // Keep message channel open for async response

    case 'sendToN8NWriting':
      handleSendToN8NWriting(request)
        .then(response => sendResponse({ success: true, ...response }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;

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
 * Handle send to N8N writing analysis request
 */
async function handleSendToN8NWriting(request) {
  try {
    const response = await fetch(request.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        formData: request.data,
        timestamp: new Date().toISOString(),
        source: 'chrome-extension',
        type: 'writing_analysis'
      })
    });

    if (!response.ok) {
      throw new Error(`N8N responded with status: ${response.status}`);
    }

    const text = await response.text();
    if (!text || text.trim() === '') {
      return { recommendations: [] };
    }

    const result = JSON.parse(text);

    // Handle different response formats from n8n
    if (result.recommendations && Array.isArray(result.recommendations)) {
      return { recommendations: result.recommendations };
    }

    // Alternative format: array of recommendations directly
    if (Array.isArray(result)) {
      return { recommendations: result };
    }

    // Format with hasil_analisis array
    if (result.hasil_analisis && Array.isArray(result.hasil_analisis)) {
      const recommendations = result.hasil_analisis.map(item => ({
        fieldId: item.field_id || item.fieldId || '',
        fieldName: item.field_name || item.fieldName || '',
        fieldLabel: item.field_label || item.fieldLabel || '',
        originalValue: item.original_value || item.originalValue || '',
        correctedValue: item.corrected_value || item.correctedValue || '',
        reason: item.reason || item.alasan || ''
      }));
      return { recommendations };
    }

    return { recommendations: [] };
  } catch (error) {
    console.error('SOAP Assistant - Writing N8N Error:', error);
    return { recommendations: [] };
  }
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
