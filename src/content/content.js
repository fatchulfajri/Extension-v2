// SOAP AI Assistant - Content Script
// ================================================

// ================================================
// CONSTANTS
// ================================================

const DEFAULT_N8N_URL = 'https://risetmerahputih.app.n8n.cloud/webhook-test/soap';

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
  debounceTimer: null,
  n8nWebhookUrl: '',
  urlList: [],
  isLoading: false,
  isFirstLoad: true,
  viewMode: 'result',
  apiStatus: null, // For storing status like 'no_knowledge'
  apiMessage: null // For storing the message from API
};

// ================================================
// STATE FUNCTIONS
// ================================================

async function initState() {
  const settings = await chrome.storage.sync.get(['enabled', 'urlList']);

  console.log('SOAP Assistant - Settings loaded:', settings);

  state.n8nWebhookUrl = DEFAULT_N8N_URL;
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
  state.apiStatus = null;
  state.apiMessage = null;
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
  const total = getTotalCorrections();
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

  try {
    state.isLoading = true;

    // Open sidebar if not already open
    if (!state.sidebarOpen) {
      toggleSidebar();
    }

    // Render sidebar with loading state
    renderSidebar();

    // Refresh form data before sending
    state.formData = collectFormData();

    const response = await chrome.runtime.sendMessage({
      action: MESSAGE_ACTIONS.SEND_TO_N8N,
      data: state.formData,
      url: state.n8nWebhookUrl
    });

    state.isLoading = false;
    state.isFirstLoad = false;

    if (response && response.status) {
      // Handle special statuses like 'no_knowledge' or 'error'
      state.apiStatus = response.status;
      state.apiMessage = response.message || 'Terjadi kesalahan';
      state.corrections = response.corrections || { S: [], O: [], A: [], P: [] };
      updateBadge();
      renderSidebar();
    } else if (response && response.corrections) {
      state.corrections = response.corrections;
      state.apiStatus = null;
      state.apiMessage = null;
      updateBadge();
      renderSidebar();
    }
  } catch (error) {
    console.error('SOAP Assistant Error:', error);
    state.isLoading = false;
    state.isFirstLoad = false;
    renderSidebar();
  }
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

  let contentHTML = '';
  if (state.formData.length === 0) {
    contentHTML = getNoDataHTML();
  } else if (state.isLoading && state.isFirstLoad) {
    contentHTML = getLoadingHTML();
  } else if (state.apiStatus === 'no_knowledge') {
    contentHTML = getNoKnowledgeHTML();
  } else if (totalCorrections > 0) {
    contentHTML = getCorrectionsHTML(categoriesWithCorrections);
  } else {
    contentHTML = getEmptyStateHTML();
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

    <div class="soap-sidebar-content">
      ${contentHTML}
    </div>

    <div class="soap-sidebar-footer">
      ${state.formData.length > 0 && totalCorrections > 0 ? `
        <button class="soap-dismiss-all-btn" id="soap-dismiss-all">
          Tutup Semua
        </button>
      ` : ''}
    </div>
  `;

  attachSidebarListeners();
}

function getLoadingHTML() {
  return `
    <div class="soap-loading-state">
      <svg class="soap-spinner" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#3F856F" stroke-width="2">
        <circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="32" style="animation: soap-spin 1.5s linear infinite;"/>
      </svg>
      <p class="soap-loading-title">Sedang menganalisis...</p>
      <p class="soap-loading-hint">Mohon tunggu sebentar</p>
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
