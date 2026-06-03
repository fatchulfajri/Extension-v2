// SOAP AI Assistant - Content Script
// ================================================

// ================================================
// CONSTANTS
// ================================================

const DEFAULT_N8N_URL = 'https://n8n.zapp.covwatch.net/webhook/soap';
const DEFAULT_WRITING_URL = 'https://risetmerahputih.app.n8n.cloud/webhook-test/writing';

const MESSAGE_ACTIONS = {
  SEND_TO_N8N: 'sendToN8N',
  TOGGLE_EXTENSION: 'toggleExtension',
  REFRESH_CORRECTIONS: 'refreshCorrections'
};

const SEVERITY_LEVELS = {
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info'
};

const SOAP_LABELS = {
  S: 'Subjective - Keluhan',
  O: 'Objective - Pemeriksaan',
  A: 'Assessment - Analisis',
  P: 'Plan - Rencana'
};

const DEBOUNCE_DELAY = 2000;
const DOM_CHECK_INTERVAL = 3000;

// ================================================
// STATE
// ================================================

const state = {
  isActive: true,
  sidebarOpen: false,
  formData: [],
  corrections: { S: [], O: [], A: [], P: [] },
  writingRecommendations: [], // New state for writing improvements
  debounceTimer: null,
  n8nWebhookUrl: '',
  writingWebhookUrl: '', // Separate webhook for writing improvements
  urlList: [],
  isLoading: false,
  isLoadingWriting: false, // Loading state for writing improvements
  isFirstLoad: true,
  viewMode: 'result',
  activeTab: 'corrections', // New: 'corrections' or 'writing'
  apiStatus: null, // For storing status like 'no_knowledge', 'error'
  apiMessage: null, // For storing the message from API
  apiReason: null // For storing the reason from API (for error status)
};

// ================================================
// STATE FUNCTIONS
// ================================================

async function initState() {
  const settings = await chrome.storage.sync.get(['enabled', 'urlList']);

  console.log('SOAP Assistant - Settings loaded:', settings);

  state.n8nWebhookUrl = DEFAULT_N8N_URL;
  state.writingWebhookUrl = DEFAULT_WRITING_URL;
  state.urlList = settings.urlList || [];

  console.log('SOAP Assistant - N8N URL:', state.n8nWebhookUrl);
  console.log('SOAP Assistant - URL List:', state.urlList);

  if (settings.enabled === false) {
    state.isActive = false;
  } else {
    state.isActive = true;

    if (settings.enabled === undefined) {
      chrome.storage.sync.set({ enabled: true });
    }
  }

  console.log('SOAP Assistant - isActive:', state.isActive);

  return state;
}

function resetCorrections() {
  state.corrections = { S: [], O: [], A: [], P: [] };
  state.writingRecommendations = [];
  state.apiStatus = null;
  state.apiMessage = null;
  state.apiReason = null;
}

function clearDebounceTimer() {
  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = null;
  }
}

// ================================================
// HELPER FUNCTIONS
// ================================================

function hasCorrections() {
  return Object.values(state.corrections).some(items => items.length > 0);
}

function getTotalCorrections() {
  return Object.values(state.corrections).reduce((sum, items) => sum + items.length, 0);
}

function updateBadge() {
  const soapTotal = getTotalCorrections();
  const writingTotal = state.writingRecommendations.length;
  const total = soapTotal + writingTotal;
  const badge = document.getElementById('soap-badge');

  if (badge) {
    if (total > 0) {
      badge.textContent = total > 99 ? '99+' : total;
      badge.style.display = 'block';
    } else {
      badge.style.display = 'none';
    }
  }
}

function getCategoryLabel(category) {
  return SOAP_LABELS[category] || category;
}

function getSeverityIcon(severity) {
  const icons = {
    error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    warning: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };
  return icons[severity] || icons.info;
}

// ================================================
// FORM DETECTION
// ================================================

function getElementLabel(element) {
  if (element.id) {
    const label = document.querySelector(`label[for="${element.id}"]`);
    if (label) return label.textContent.trim();
  }

  let parent = element.parentElement;
  let depth = 0;
  while (parent && depth < 3) {
    const label = parent.querySelector('label');
    if (label && parent.contains(element)) {
      return label.textContent.trim();
    }
    parent = parent.parentElement;
    depth++;
  }

  if (element.placeholder) {
    return element.placeholder;
  }

  return '';
}

function getSelectValue(selectElement) {
  if (selectElement.type === 'select-multiple') {
    return Array.from(selectElement.selectedOptions).map(opt => opt.value).join(', ');
  }
  return selectElement.value;
}

function isCurrentUrlInList() {
  if (!state.urlList || state.urlList.length === 0) {
    console.log('SOAP Assistant - URL list is empty');
    return false;
  }

  const currentUrl = window.location.href;
  console.log('SOAP Assistant - Current URL:', currentUrl);
  console.log('SOAP Assistant - URL List:', state.urlList);

  const match = state.urlList.some(item => {
    if (item.enabled === false) {
      console.log('SOAP Assistant - URL disabled:', item.url);
      return false;
    }

    const allowedUrl = item.url;

    if (currentUrl === allowedUrl) {
      console.log('SOAP Assistant - URL exact match:', allowedUrl);
      return true;
    }

    if (currentUrl.startsWith(allowedUrl)) {
      console.log('SOAP Assistant - URL startsWith match:', allowedUrl);
      return true;
    }

    try {
      const decodedCurrent = decodeURIComponent(currentUrl);
      const decodedAllowed = decodeURIComponent(allowedUrl);
      if (decodedCurrent === decodedAllowed || decodedCurrent.startsWith(decodedAllowed)) {
        console.log('SOAP Assistant - URL decoded match:', allowedUrl);
        return true;
      }
    } catch (e) {
      // If decoding fails, skip this item
    }

    return false;
  });

  console.log('SOAP Assistant - URL match result:', match);
  return match;
}

function hasInputFields() {
  const inputs = document.querySelectorAll('input:not([type="hidden"]), textarea, select');
  let hasForm = false;

  inputs.forEach((element) => {
    if (element.type === 'search') return;
    if (element.placeholder?.toLowerCase().includes('search')) return;
    if (element.name?.toLowerCase().includes('search')) return;
    if (element.id?.toLowerCase().includes('search')) return;
    if (element.getAttribute('role') === 'search') return;

    hasForm = true;
  });

  return hasForm;
}

function collectFormData() {
  const result = [];
  const inputs = document.querySelectorAll('input, textarea, select');

  inputs.forEach((element) => {
    if (!element.name && !element.id) return;
    if (element.type === 'hidden') return;

    let value = '';
    let label = getElementLabel(element);

    switch (element.type) {
      case 'checkbox':
      case 'radio':
        value = element.checked ? 'Checked' : 'Unchecked';
        break;
      case 'select-one':
      case 'select-multiple':
        value = getSelectValue(element);
        break;
      case 'file':
        value = element.files.length > 0 ? element.files[0].name : '';
        break;
      default:
        value = element.value || '';
        if (element.tagName === 'TEXTAREA' || element.isContentEditable) {
          value = element.value || element.textContent || '';
        }
    }

    if (value && value.trim() !== '') {
      result.push({
        label: label,
        name: element.name || '',
        id: element.id || '',
        type: element.type || element.tagName.toLowerCase(),
        value: value.trim()
      });
    }
  });

  return result;
}

function handleFormInput() {
  clearDebounceTimer();
  state.debounceTimer = setTimeout(() => {
    const formData = collectFormData();
    state.formData = formData;
    console.log('SOAP Assistant - Form data collected:', formData);

    if (formData.length > 0) {
      sendToN8N();
    }
  }, DEBOUNCE_DELAY);
}

function setupFormMonitoring() {
  const inputs = document.querySelectorAll('input, textarea, select');

  inputs.forEach((element) => {
    if (element.type === 'hidden') return;

    element.removeEventListener('input', element._formHandler);
    element.removeEventListener('change', element._formHandler);

    element._formHandler = handleFormInput;
    element.addEventListener('input', element._formHandler);
    element.addEventListener('change', element._formHandler);
  });

  // Initial collection
  const initialData = collectFormData();
  state.formData = initialData;

  // Re-scan periodically for dynamic forms
  setTimeout(setupFormMonitoring, 2000);
}

function observeDOMChanges() {
  const checkInterval = setInterval(() => {
    if (!state.isActive) {
      clearInterval(checkInterval);
      return;
    }

    const hasBtn = document.getElementById('soap-floating-btn');
    const shouldShow = isCurrentUrlInList() && hasInputFields();

    if (!hasBtn && shouldShow) {
      createFloatingButton();
      console.log('SOAP Assistant - Form detected, floating button created');
    } else if (hasBtn && !shouldShow) {
      const btn = document.getElementById('soap-floating-btn');
      btn.remove();
      console.log('SOAP Assistant - Conditions not met, floating button removed');
    }
  }, DOM_CHECK_INTERVAL);
}

function startSOAPMonitoring() {
  setupFormMonitoring();
  observeDOMChanges();
}

// ================================================
// N8N API CLIENT
// ================================================

async function sendToN8N() {
  if (!state.n8nWebhookUrl) {
    console.log('SOAP Assistant: N8N URL not configured');
    return;
  }

  console.log('SOAP Assistant - sendToN8N called, URL:', state.n8nWebhookUrl);

  try {
    state.isLoading = true;
    console.log('SOAP Assistant - isLoading set to true');

    // Open sidebar if not already open
    if (!state.sidebarOpen) {
      toggleSidebar();
    }

    // Render sidebar with loading state
    renderSidebar();
    console.log('SOAP Assistant - Sidebar rendered with loading state');

    // Refresh form data before sending
    state.formData = collectFormData();

    console.log('SOAP Assistant - Sending message to service worker...');
    const response = await chrome.runtime.sendMessage({
      action: MESSAGE_ACTIONS.SEND_TO_N8N,
      data: state.formData,
      url: state.n8nWebhookUrl
    });

    console.log('SOAP Assistant - ✓ Response received from service worker!');
    console.log('SOAP Assistant - Response structure:', {
      hasSuccess: !!response?.success,
      hasStatus: !!response?.status,
      hasS: !!response?.S,
      hasO: !!response?.O,
      hasA: !!response?.A,
      hasP: !!response?.P,
      hasCorrectionsKey: !!response?.corrections,
      keys: response ? Object.keys(response) : 'null'
    });

    state.isLoading = false;
    state.isFirstLoad = false;

    console.log('SOAP Assistant - Response from service worker:', response);

    if (response && response.status) {
      // Handle special statuses like 'no_knowledge' or 'error'
      console.log('SOAP Assistant - Handling status response:', response.status);
      state.apiStatus = response.status;
      state.apiMessage = response.message || 'Terjadi kesalahan';
      state.apiReason = response.reason || '';
      state.corrections = response.corrections || { S: [], O: [], A: [], P: [] };
      console.log('SOAP Assistant - Status response, corrections:', state.corrections);
      updateBadge();
      renderSidebar();
      console.log('SOAP Assistant - ✓ Sidebar updated with status');
    } else if (response && (response.S || response.O || response.A || response.P || response.corrections)) {
      // Handle normal response - either direct corrections object or wrapped in 'corrections' key
      console.log('SOAP Assistant - Handling normal response with corrections');
      state.corrections = response.corrections || { S: response.S || [], O: response.O || [], A: response.A || [], P: response.P || [] };
      console.log('SOAP Assistant - Corrections response, corrections:', state.corrections);
      console.log('SOAP Assistant - Total corrections:', getTotalCorrections());
      state.apiStatus = null;
      state.apiMessage = null;
      state.apiReason = null;
      updateBadge();
      renderSidebar();
      console.log('SOAP Assistant - ✓ Sidebar updated with corrections');
    } else {
      console.warn('SOAP Assistant - Response received but no corrections found!');
      console.warn('SOAP Assistant - Response was:', response);
      // Show notification to user
      showNotification('Tidak ada koreksi ditemukan atau response kosong', 'warning');
      // Still update to show empty state
      state.apiStatus = null;
      state.apiMessage = null;
      state.apiReason = null;
      renderSidebar();
    }
  } catch (error) {
    console.error('SOAP Assistant Error:', error);
    state.isLoading = false;
    state.isFirstLoad = false;
    renderSidebar();
  }
}

async function sendToN8NWriting() {
  if (!state.writingWebhookUrl) {
    console.log('SOAP Assistant: Writing N8N URL not configured');
    return;
  }

  try {
    state.isLoadingWriting = true;

    // Refresh form data before sending
    state.formData = collectFormData();

    const response = await chrome.runtime.sendMessage({
      action: 'sendToN8NWriting',
      data: state.formData,
      url: state.writingWebhookUrl
    });

    state.isLoadingWriting = false;

    if (response && response.recommendations) {
      state.writingRecommendations = response.recommendations;
    } else {
      state.writingRecommendations = [];
    }

    renderSidebar();
  } catch (error) {
    console.error('SOAP Assistant Writing Error:', error);
    state.isLoadingWriting = false;
    renderSidebar();
  }
}

function acceptWritingRecommendation(recommendation) {
  // Find the form element and update its value
  const { fieldId, fieldName, correctedValue } = recommendation;

  let element = null;

  // Try to find element by ID first
  if (fieldId) {
    element = document.getElementById(fieldId);
  }

  // If not found, try to find by name
  if (!element && fieldName) {
    element = document.querySelector(`[name="${fieldName}"]`);
  }

  // If still not found, try to find by partial match in current formData
  if (!element) {
    const formData = collectFormData();
    const matchedField = formData.find(field => {
      return (field.id === fieldId || field.name === fieldName) &&
             field.value === recommendation.originalValue;
    });

    if (matchedField && matchedField.id) {
      element = document.getElementById(matchedField.id);
    } else if (matchedField && matchedField.name) {
      element = document.querySelector(`[name="${matchedField.name}"]`);
    }
  }

  if (element) {
    // Update the element value
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT') {
      element.value = correctedValue;

      // Trigger input and change events to ensure the page recognizes the change
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Remove this recommendation from the list
    state.writingRecommendations = state.writingRecommendations.filter(
      r => r !== recommendation
    );

    // Re-render sidebar
    renderSidebar();

    // Show success feedback
    showNotification('Perbaikan diterapkan!');
  } else {
    showNotification('Elemen tidak ditemukan', 'error');
  }
}

function showNotification(message, type = 'success') {
  const existing = document.getElementById('soap-notification');
  if (existing) existing.remove();

  const notification = document.createElement('div');
  notification.id = 'soap-notification';
  notification.className = `soap-notification soap-${type}`;
  notification.textContent = message;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.classList.add('show');
  }, 10);

  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
  }, 2000);
}

// ================================================
// FLOATING BUTTON
// ================================================

function createFloatingButton() {
  console.log('SOAP Assistant - createFloatingButton called, isActive:', state.isActive);

  const existing = document.getElementById('soap-floating-btn');
  if (existing) {
    console.log('SOAP Assistant - Removing existing floating button');
    existing.remove();
  }

  if (!state.isActive) {
    console.log('SOAP Assistant - Extension is not active, skipping button creation');
    return;
  }

  const button = document.createElement('div');
  button.id = 'soap-floating-btn';
  button.className = 'soap-floating-btn';
  button.innerHTML = `
    <div class="soap-btn-icon">
      <img src="${chrome.runtime.getURL('assets/cmt.png')}" alt="CMT" class="soap-toggle-logo">
      <span class="soap-btn-badge" id="soap-badge" style="display: none;">0</span>
    </div>
  `;

  setupDraggable(button);

  button.addEventListener('click', (e) => {
    if (!button.dataset.isDragging) {
      toggleSidebar();
    }
  });

  document.body.appendChild(button);
  console.log('SOAP Assistant - Floating button added to DOM');
}

function setupDraggable(element) {
  let isDragging = false;
  let startY = 0;
  let startTop = 0;
  let hasMoved = false;

  const onMouseDown = (e) => {
    isDragging = true;
    hasMoved = false;
    startY = e.clientY;
    startTop = parseInt(element.style.top) || 16;

    element.classList.add('dragging');
    e.preventDefault();
  };

  const onMouseMove = (e) => {
    if (!isDragging) return;

    const deltaY = e.clientY - startY;

    if (Math.abs(deltaY) > 5) {
      hasMoved = true;
    }

    let newTop = startTop + deltaY;

    const maxTop = window.innerHeight - 36 - 16;
    const minTop = 16;

    if (newTop < minTop) newTop = minTop;
    if (newTop > maxTop) newTop = maxTop;

    element.style.top = newTop + 'px';
  };

  const onMouseUp = () => {
    if (!isDragging) return;

    element.classList.remove('dragging');

    if (hasMoved) {
      element.dataset.isDragging = 'true';
      setTimeout(() => {
        delete element.dataset.isDragging;
      }, 100);
    }

    isDragging = false;
  };

  // Mouse events
  element.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  // Touch events
  element.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    onMouseDown({ clientY: touch.clientY, preventDefault: () => {} });
  });

  element.addEventListener('touchmove', (e) => {
    const touch = e.touches[0];
    onMouseMove({ clientY: touch.clientY });
  });

  element.addEventListener('touchend', onMouseUp);
}

// ================================================
// SIDEBAR
// ================================================

function toggleSidebar() {
  const isOpen = !state.sidebarOpen;
  state.sidebarOpen = isOpen;

  const sidebar = document.getElementById('soap-sidebar');
  const button = document.getElementById('soap-floating-btn');

  if (isOpen) {
    state.isFirstLoad = true;
    renderSidebar();
    sidebar?.classList.add('open');
    button?.classList.add('active');
  } else {
    sidebar?.classList.remove('open');
    button?.classList.remove('active');
  }
}

function createSidebar() {
  let sidebar = document.getElementById('soap-sidebar');
  if (!sidebar) {
    sidebar = document.createElement('div');
    sidebar.id = 'soap-sidebar';
    sidebar.className = 'soap-sidebar';
    document.body.appendChild(sidebar);

    sidebar.innerHTML = `
      <div class="soap-sidebar-header">
        <div class="soap-header-left">
          <img src="${chrome.runtime.getURL('assets/logo-white.png')}" alt="CASE" class="soap-logo">
        </div>
        <button class="soap-close-btn" id="soap-close-sidebar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
      </div>
      <div class="soap-sidebar-content"></div>
      <div class="soap-sidebar-footer"></div>
    `;
  }
  return sidebar;
}

function renderSidebar() {
  const sidebar = createSidebar();

  const totalCorrections = Object.values(state.corrections)
    .reduce((sum, items) => sum + items.length, 0);

  const categoriesWithCorrections = Object.entries(state.corrections)
    .filter(([_, items]) => items.length > 0);

  const totalWriting = state.writingRecommendations.length;

  let contentHTML = '';
  if (state.formData.length === 0) {
    contentHTML = getNoDataHTML();
  } else if (state.activeTab === 'writing') {
    if (state.isLoadingWriting) {
      contentHTML = getLoadingHTML('Sedang menganalisis penulisan...', 'Mohon tunggu sebentar');
    } else if (totalWriting > 0) {
      contentHTML = getWritingRecommendationsHTML();
    } else {
      contentHTML = getWritingEmptyHTML();
    }
  } else {
    if (state.isLoading) {
      contentHTML = getLoadingHTML();
    } else if (state.apiStatus === 'error') {
      contentHTML = getErrorHTML();
    } else if (state.apiStatus === 'no_knowledge') {
      contentHTML = getNoKnowledgeHTML();
    } else if (totalCorrections > 0) {
      contentHTML = getCorrectionsHTML(categoriesWithCorrections);
    } else {
      contentHTML = getEmptyStateHTML();
    }
  }

  sidebar.innerHTML = `
    <div class="soap-sidebar-header">
      <div class="soap-header-left">
        <img src="${chrome.runtime.getURL('assets/logo-white.png')}" alt="CASE" class="soap-logo">
      </div>
      <button class="soap-close-btn" id="soap-close-sidebar">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
    </div>

    ${state.formData.length > 0 ? `
      <div class="soap-tabs">
        <button class="soap-tab ${state.activeTab === 'corrections' ? 'active' : ''}" data-tab="corrections">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 11l3 3L22 4"/>
            <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
          </svg>
          Koreksi SOAP
          ${totalCorrections > 0 ? `<span class="soap-tab-badge">${totalCorrections}</span>` : ''}
        </button>
        <button class="soap-tab ${state.activeTab === 'writing' ? 'active' : ''}" data-tab="writing">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          Perbaikan Penulisan
          ${totalWriting > 0 ? `<span class="soap-tab-badge">${totalWriting}</span>` : ''}
        </button>
      </div>
    ` : ''}

    <div class="soap-sidebar-content">
      ${contentHTML}
    </div>

    <div class="soap-sidebar-footer">
      ${state.formData.length > 0 && state.activeTab === 'corrections' && totalCorrections > 0 ? `
        <button class="soap-dismiss-all-btn" id="soap-dismiss-all">
          Tutup Semua
        </button>
      ` : ''}
      ${state.formData.length > 0 && state.activeTab === 'writing' && totalWriting > 0 ? `
        <button class="soap-refresh-btn" id="soap-refresh-writing">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M23 4v6h-6M1 20v-6h6"/>
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
          </svg>
          Analisis Ulang
        </button>
      ` : ''}
    </div>
  `;

  attachSidebarListeners();
}

function getLoadingHTML(title = 'Sedang menganalisis SOAP...', hint = 'Mohon tunggu, proses mungkin memakan waktu 1-2 menit') {
  return `
    <div class="soap-loading-state">
      <svg class="soap-spinner" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#3F856F" stroke-width="2">
        <circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="32" style="animation: soap-spin 1.5s linear infinite;"/>
      </svg>
      <p class="soap-loading-title">${title}</p>
      <p class="soap-loading-hint">${hint}</p>
    </div>
    <style>
      @keyframes soap-spin {
        to { stroke-dashoffset: 0; }
      }
      .soap-loading-state {
        text-align: center;
        padding: 60px 24px;
        color: #718096;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 300px;
      }
      .soap-loading-state p {
        margin-top: 16px;
        font-size: 14px;
        color: #4a5568;
      }
      .soap-loading-title {
        font-size: 16px;
        font-weight: 500;
        color: #2d3748;
        margin: 16px 0 8px 0;
      }
      .soap-loading-hint {
        font-size: 13px !important;
        color: #718096 !important;
        margin: 0 !important;
      }
    </style>
  `;
}

function getEmptyStateHTML() {
  return `
    <div class="soap-empty-state">
      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#3F856F" stroke-width="2">
        <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
      <p class="soap-empty-title">Dokumen terlihat baik!</p>
      <p class="soap-preview-hint">Tidak ada koreksi yang diperlukan</p>
    </div>
  `;
}

function getNoKnowledgeHTML() {
  return `
    <div class="soap-empty-state">
      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#EAB308" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <p class="soap-empty-title">Informasi</p>
      <p class="soap-preview-hint">${state.apiMessage || 'Tidak ada informasi tersedia'}</p>
    </div>
  `;
}

function getErrorHTML() {
  const reason = state.apiReason || 'Terjadi kesalahan';
  const message = state.apiMessage || 'Silakan coba lagi atau periksa koneksi Anda.';

  return `
    <div class="soap-error-state">
      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#DC2626" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="15" y1="9" x2="9" y2="15"/>
        <line x1="9" y1="9" x2="15" y2="15"/>
      </svg>
      <p class="soap-error-title">Error</p>
      <p class="soap-error-reason">${reason}</p>
      <p class="soap-error-message">${message}</p>
    </div>
  `;
}

function getNoDataHTML() {
  return `
    <div class="soap-empty-state">
      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#3F856F" stroke-width="2">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
      </svg>
      <p class="soap-empty-title">Belum ada isian</p>
      <p class="soap-preview-hint">Isi form SOAP untuk memulai analisis</p>
    </div>
  `;
}

function getWritingRecommendationsHTML() {
  return `
    <div class="soap-info-banner soap-writing-banner">
      <div class="soap-info-banner-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
        Rekomendasi Perbaikan Penulisan
      </div>
      <div class="soap-info-banner-text">
        Berikut adalah saran perbaikan penulisan (singkatan, typo, dll).
      </div>
    </div>

    <div class="soap-writing-list">
      ${state.writingRecommendations.map((rec, index) => `
        <div class="soap-writing-item">
          <div class="soap-writing-header">
            <span class="soap-writing-field">${rec.fieldLabel || rec.fieldName || rec.fieldId || 'Field'}</span>
          </div>

          <div class="soap-writing-comparison">
            <div class="soap-writing-original">
              <span class="soap-writing-label">Asli:</span>
              <span class="soap-writing-value">${rec.originalValue}</span>
            </div>
            <svg class="soap-writing-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="5" y1="12" x2="19" y2="12"/>
              <polyline points="12 5 19 12 12 19"/>
            </svg>
            <div class="soap-writing-corrected">
              <span class="soap-writing-label">Perbaikan:</span>
              <span class="soap-writing-value soap-highlight">${rec.correctedValue}</span>
            </div>
          </div>

          ${rec.reason ? `
            <div class="soap-writing-reason">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="16" x2="12" y2="12"/>
                <line x1="12" y1="8" x2="12.01" y2="8"/>
              </svg>
              ${rec.reason}
            </div>
          ` : ''}

          <button class="soap-accept-btn" data-index="${index}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            Terapkan Perbaikan
          </button>
        </div>
      `).join('')}
    </div>
  `;
}

function getWritingEmptyHTML() {
  return `
    <div class="soap-empty-state">
      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#3F856F" stroke-width="2">
        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>
      <p class="soap-empty-title">Analisis Penulisan</p>
      <p class="soap-preview-hint">Klik tombol di bawah untuk menganalisis penulisan</p>
      <button class="soap-analyze-btn" id="soap-analyze-writing">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
        Analisis Penulisan
      </button>
    </div>
  `;
}

function getCorrectionsHTML(categoriesWithCorrections) {
  return `
    <div class="soap-info-banner">
      <div class="soap-info-banner-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="16" x2="12" y2="12"/>
          <line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>
        Rekomendasi AI
      </div>
      <div class="soap-info-banner-text">
        Berdasarkan PNPK dan Clinical Pathway, berikut adalah saran perbaikan untuk dokumentasi Anda.
      </div>
    </div>

    <div class="soap-summary">
      ${categoriesWithCorrections.map(([cat, items]) => `
        <span class="soap-category-badge soap-${cat.toLowerCase()}">${cat}: ${items.length}</span>
      `).join('')}
    </div>

    <div class="soap-corrections-list">
      ${categoriesWithCorrections.map(([category, items]) => `
        <div class="soap-correction-category">
          <h4 class="soap-category-title soap-${category.toLowerCase()}">
            ${getCategoryLabel(category)} (${items.length})
          </h4>
          <ul class="soap-correction-items">
            ${items.map(item => getCorrectionItemHTML(item)).join('')}
          </ul>
        </div>
      `).join('')}
    </div>
  `;
}

function getCorrectionItemHTML(item) {
  return `
    <li class="soap-correction-item ${item.severity || 'warning'}">
      <div class="soap-correction-header">
        <span class="soap-correction-icon">${getSeverityIcon(item.severity)}</span>
        <span class="soap-correction-title">${item.message}</span>
      </div>
      ${item.suggestion ? `
        <div class="soap-correction-suggestion">
          <strong>Saran:</strong> ${item.suggestion}
        </div>
      ` : ''}
      ${item.original ? `
        <div class="soap-correction-original">
          <em>"${item.original}"</em>
        </div>
      ` : ''}
    </li>
  `;
}

function attachSidebarListeners() {
  document.getElementById('soap-close-sidebar')?.addEventListener('click', toggleSidebar);
  document.getElementById('soap-dismiss-all')?.addEventListener('click', handleDismissAll);

  // Tab switching
  document.querySelectorAll('.soap-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      const tabName = e.currentTarget.dataset.tab;
      state.activeTab = tabName;

      // If switching to writing tab and no recommendations yet, fetch them
      if (tabName === 'writing' && state.writingRecommendations.length === 0 && !state.isLoadingWriting) {
        sendToN8NWriting();
      }

      renderSidebar();
    });
  });

  // Refresh writing button
  document.getElementById('soap-refresh-writing')?.addEventListener('click', () => {
    sendToN8NWriting();
  });

  // Analyze writing button
  document.getElementById('soap-analyze-writing')?.addEventListener('click', () => {
    sendToN8NWriting();
  });

  // Accept recommendation buttons
  document.querySelectorAll('.soap-accept-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const index = parseInt(e.currentTarget.dataset.index);
      const recommendation = state.writingRecommendations[index];
      if (recommendation) {
        acceptWritingRecommendation(recommendation);
      }
    });
  });
}

function handleDismissAll() {
  resetCorrections();
  updateBadge();
  renderSidebar();
}

// ================================================
// MESSAGE HANDLER
// ================================================

function handleMessage(request, sender, sendResponse) {
  console.log('SOAP Assistant - Message received:', request);

  switch (request.action) {
    case MESSAGE_ACTIONS.TOGGLE_EXTENSION:
      console.log('SOAP Assistant - Toggle extension to:', request.enabled);
      state.isActive = request.enabled;

      if (request.enabled) {
        if (isCurrentUrlInList() && hasInputFields()) {
          console.log('SOAP Assistant - Creating floating button');
          createFloatingButton();
        } else {
          console.log('SOAP Assistant - Extension enabled but conditions not met');
        }
      } else {
        console.log('SOAP Assistant - Removing floating button and sidebar');
        const btn = document.getElementById('soap-floating-btn');
        const sidebar = document.getElementById('soap-sidebar');
        btn?.remove();
        sidebar?.remove();
      }
      break;

    case MESSAGE_ACTIONS.REFRESH_CORRECTIONS:
      sendToN8N();
      break;

    case 'urlListChanged':
      console.log('SOAP Assistant - URL list changed:', request.urlList);
      state.urlList = request.urlList || [];

      const hasBtn = document.getElementById('soap-floating-btn');
      const shouldShow = state.isActive && isCurrentUrlInList() && hasInputFields();

      if (!hasBtn && shouldShow) {
        createFloatingButton();
        console.log('SOAP Assistant - URL list updated, floating button created');
      } else if (hasBtn && !shouldShow) {
        const btn = document.getElementById('soap-floating-btn');
        btn.remove();
        console.log('SOAP Assistant - URL list updated, floating button removed');
      }
      break;
  }

  return true;
}

chrome.runtime.onMessage.addListener(handleMessage);

// ================================================
// INITIALIZATION
// ================================================

async function init() {
  await initState();

  console.log('SOAP Assistant - Checking conditions:');
  console.log('  - isActive:', state.isActive);
  console.log('  - isCurrentUrlInList:', isCurrentUrlInList());
  console.log('  - hasInputFields:', hasInputFields());

  // Pre-create sidebar elements (cold start optimization)
  createSidebar();

  // Hanya tampilkan floating button jika:
  // 1. Extension aktif
  // 2. URL saat ini ada di dalam URL list
  // 3. Halaman memiliki form input (bukan search)
  if (state.isActive && isCurrentUrlInList() && hasInputFields()) {
    console.log('SOAP Assistant - All conditions met, creating floating button');
    createFloatingButton();
  } else {
    console.log('SOAP Assistant - Floating button NOT created. Check the conditions above.');
    console.log('SOAP Assistant - Please add this URL to the extension popup if not listed.');
  }

  // Start monitoring
  startSOAPMonitoring();

  console.log('SOAP Assistant - Initialized');
}

// Start the extension
init();
