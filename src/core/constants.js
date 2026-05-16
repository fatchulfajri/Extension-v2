// SOAP AI Assistant - Constants
// ================================================

export const STORAGE_KEYS = {
  ENABLED: 'enabled',
  N8N_URL: 'n8nUrl',
  URL_LIST: 'urlList'
};

export const MESSAGE_ACTIONS = {
  SEND_TO_N8N: 'sendToN8N',
  TOGGLE_EXTENSION: 'toggleExtension',
  UPDATE_N8N_URL: 'updateN8NUrl',
  REFRESH_CORRECTIONS: 'refreshCorrections',
  SAVE_SETTINGS: 'saveSettings',
  GET_SETTINGS: 'getSettings'
};

export const SOAP_CATEGORIES = ['S', 'O', 'A', 'P'];

export const DEBOUNCE_DELAY = 1500; // milliseconds

export const SEVERITY_LEVELS = {
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info'
};

export const SOAP_LABELS = {
  S: 'Subjective - Keluhan',
  O: 'Objective - Pemeriksaan',
  A: 'Assessment - Analisis',
  P: 'Plan - Rencana'
};
