// SOAP AI Assistant - Content Script (Single File)
// ================================================

// ================================================
// CONSTANTS
// ================================================

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

// ================================================
// HARDCODED N8N WEBHOOK URL
// Ganti URL ini dengan URL webhook N8N yang sebenarnya
// ================================================

const DEFAULT_N8N_URL = 'https://n8n.zapp.covwatch.net/webhook/validate-form';

// ================================================
// STATE MANAGEMENT
// ================================================

const state = {
  isActive: true,
  sidebarOpen: false,
  formData: [], // Array of form data
  corrections: { S: [], O: [], A: [], P: [] },
  debounceTimer: null,
  n8nWebhookUrl: '',
  urlList: [], // List of allowed URLs
  isLoading: false, // Loading state untuk N8N request
  isFirstLoad: true, // Track first load untuk tampilan loading
  viewMode: 'result' // 'result' mode untuk menampilkan koreksi
};

async function initState() {
  const settings = await chrome.storage.sync.get(['enabled', 'urlList']);

  console.log('SOAP Assistant - Settings loaded:', settings);

  // Use hardcoded N8N URL
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
}

function clearDebounceTimer() {
  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = null;
  }
}

// ================================================
// UTILITY FUNCTIONS
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
// FORM DATA DETECTION
// ================================================

/**
 * Get label for an input element
 */
function getElementLabel(element) {
  // Cek label dengan for attribute
  if (element.id) {
    const label = document.querySelector(`label[for="${element.id}"]`);
    if (label) return label.textContent.trim();
  }

  // Cek label di parent
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

  // Cek placeholder sebagai fallback
  if (element.placeholder) {
    return element.placeholder;
  }

  return '';
}

/**
 * Get value from select element
 */
function getSelectValue(selectElement) {
  if (selectElement.type === 'select-multiple') {
    return Array.from(selectElement.selectedOptions).map(opt => opt.value).join(', ');
  }
  return selectElement.value;
}

/**
 * Check if current URL is in the allowed URL list
 * Returns true if list is empty (allow all) or if current URL matches
 */
function isCurrentUrlInList() {
  // If URL list is empty, don't allow any URLs
  if (!state.urlList || state.urlList.length === 0) {
    console.log('SOAP Assistant - URL list is empty');
    return false;
  }

  const currentUrl = window.location.href;
  console.log('SOAP Assistant - Current URL:', currentUrl);
  console.log('SOAP Assistant - URL List:', state.urlList);

  // Check if current URL matches any URL in the list AND is enabled
  const match = state.urlList.some(item => {
    // Skip if URL is disabled
    if (item.enabled === false) {
      console.log('SOAP Assistant - URL disabled:', item.url);
      return false;
    }

    const allowedUrl = item.url;

    // Try exact match first
    if (currentUrl === allowedUrl) {
      console.log('SOAP Assistant - URL exact match:', allowedUrl);
      return true;
    }

    // Try startsWith match (for subpages)
    if (currentUrl.startsWith(allowedUrl)) {
      console.log('SOAP Assistant - URL startsWith match:', allowedUrl);
      return true;
    }

    // For file:// URLs, also try decoding and comparing
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

/**
 * Check if page has any input fields (excluding search boxes)
 */
function hasInputFields() {
  const inputs = document.querySelectorAll('input:not([type="hidden"]), textarea, select');
  let hasForm = false;

  inputs.forEach((element) => {
    // Skip search inputs
    if (element.type === 'search') return;
    if (element.placeholder?.toLowerCase().includes('search')) return;
    if (element.name?.toLowerCase().includes('search')) return;
    if (element.id?.toLowerCase().includes('search')) return;
    if (element.getAttribute('role') === 'search') return;

    hasForm = true;
  });

  return hasForm;
}

/**
 * Collect all form data from the page
 */
function collectFormData() {
  const result = [];

  // Ambil semua input, textarea, dan select
  const inputs = document.querySelectorAll('input, textarea, select');

  inputs.forEach((element) => {
    // Skip elemen yang tidak memiliki name/id
    if (!element.name && !element.id) return;

    // Skip hidden inputs
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
        // Untuk textarea dan contenteditable
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

/**
 * Collect form data and update state
 */
function updateFormData() {
  state.formData = collectFormData();
  console.log('SOAP Assistant - Form data collected:', state.formData);
}

function handleFormInput() {
  // Debounce form data collection - kirim ke N8N setelah berhenti mengetik
  clearDebounceTimer();
  state.debounceTimer = setTimeout(() => {
    updateFormData();

    // Kirim otomatis ke N8N untuk analisis realtime
    if (state.formData.length > 0) {
      sendToN8N();
    }
  }, 2000); // Kirim setelah 2 detik berhenti mengetik
}

function setupFormMonitoring() {
  // Monitor semua input, textarea, select
  const inputs = document.querySelectorAll('input, textarea, select');

  inputs.forEach((element) => {
    // Skip hidden inputs
    if (element.type === 'hidden') return;

    // Remove existing listener
    element.removeEventListener('input', element._formHandler);
    element.removeEventListener('change', element._formHandler);

    // Add new listener
    element._formHandler = handleFormInput;
    element.addEventListener('input', element._formHandler);
    element.addEventListener('change', element._formHandler);
  });

  // Initial collection
  updateFormData();

  // Re-scan periodically for dynamic forms
  setTimeout(setupFormMonitoring, 2000);
}

function startSOAPMonitoring() {
  setupFormMonitoring();
  observeDOMChanges();
}

/**
 * Observe DOM changes untuk mendeteksi form yang muncul secara dinamis
 */
function observeDOMChanges() {
  // Cek form baru setiap beberapa detik
  const checkInterval = setInterval(() => {
    if (!state.isActive) {
      clearInterval(checkInterval);
      return;
    }

    const hasBtn = document.getElementById('soap-floating-btn');
    const shouldShow = isCurrentUrlInList() && hasInputFields();

    // Jika belum ada floating button dan seharusnya ada
    if (!hasBtn && shouldShow) {
      createFloatingButton();
      console.log('SOAP Assistant - Form detected, floating button created');
    }
    // Jika ada floating button tapi seharusnya tidak ada
    else if (hasBtn && !shouldShow) {
      const btn = document.getElementById('soap-floating-btn');
      btn.remove();
      console.log('SOAP Assistant - Conditions not met, floating button removed');
    }
  }, 3000); // Cek setiap 3 detik
}

// ================================================
// API CLIENT
// ================================================

async function sendToN8N() {
  if (!state.n8nWebhookUrl) {
    console.log('SOAP Assistant: N8N URL not configured');
    return;
  }

  try {
    // Set loading state
    state.isLoading = true;

    // Buka sidebar otomatis jika belum terbuka
    if (!state.sidebarOpen) {
      toggleSidebar();
    }

    // Render sidebar dengan loading state (hanya jika first load)
    renderSidebar();

    // Refresh form data before sending
    updateFormData();

    const response = await chrome.runtime.sendMessage({
      action: MESSAGE_ACTIONS.SEND_TO_N8N,
      data: state.formData,
      url: state.n8nWebhookUrl
    });

    // Reset loading state dan first load flag
    state.isLoading = false;
    state.isFirstLoad = false;

    if (response && response.corrections) {
      state.corrections = response.corrections;
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
// UI COMPONENTS
// ================================================

function createFloatingButton() {
  const existing = document.getElementById('soap-floating-btn');
  if (existing) existing.remove();

  if (!state.isActive) return;

  const button = document.createElement('div');
  button.id = 'soap-floating-btn';
  button.className = 'soap-floating-btn';
  button.innerHTML = `
    <div class="soap-btn-icon">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
      </svg>
      <span class="soap-btn-badge" id="soap-badge" style="display: none;">0</span>
    </div>
  `;

  button.addEventListener('click', toggleSidebar);
  document.body.appendChild(button);
}

function toggleSidebar() {
  state.sidebarOpen = !state.sidebarOpen;

  const sidebar = document.getElementById('soap-sidebar');
  const button = document.getElementById('soap-floating-btn');

  if (state.sidebarOpen) {
    // Reset first load flag saat sidebar dibuka
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

    // Pre-render empty sidebar untuk cold start
    sidebar.innerHTML = `
      <div class="soap-sidebar-header">
        <h3>SOAP Assistant</h3>
        <button class="soap-close-btn" id="soap-close-sidebar">&times;</button>
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

  // Tentukan konten berdasarkan state
  let contentHTML = '';
  if (state.formData.length === 0) {
    // Belum ada isian
    contentHTML = getNoDataHTML();
  } else if (state.isLoading && state.isFirstLoad) {
    // Sedang menganalisis - hanya tampilkan saat first load
    contentHTML = getLoadingHTML();
  } else if (totalCorrections > 0) {
    // Ada koreksi
    contentHTML = getCorrectionsHTML(categoriesWithCorrections);
  } else {
    // Tidak ada koreksi
    contentHTML = getEmptyStateHTML();
  }

  sidebar.innerHTML = `
    <div class="soap-sidebar-header">
      <h3>SOAP Assistant</h3>
      <button class="soap-close-btn" id="soap-close-sidebar">&times;</button>
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

/**
 * Get form data preview HTML
 */
function getSOAPPreviewHTML() {
  // Buat JSON yang rapi dari form data
  const formDataJSON = JSON.stringify(state.formData, null, 2);

  return `
    <div class="soap-preview-section">
      <div class="soap-preview-header">
        <h4>Data Form yang Terdeteksi</h4>
        <p class="soap-preview-subtitle">
          ${state.formData.length} field${state.formData.length !== 1 ? 's' : ''} ditemukan
          ${state.formData.length === 0 ? '(tidak ada data)' : ''}
        </p>
      </div>

      ${state.formData.length > 0 ? `
        <div class="soap-json-container">
          <pre class="soap-json-display">${highlightJSON(formDataJSON)}</pre>
        </div>
      ` : `
        <div class="soap-empty-state">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <p>Belum ada data form yang terdeteksi.</p>
          <p class="soap-preview-hint">Isi form pada halaman untuk mengambil data.</p>
        </div>
      `}
    </div>
  `;
}

/**
 * Highlight JSON dengan syntax coloring
 */
function highlightJSON(json) {
  return json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?)/g, '<span class="key">$1</span>')
    .replace(/:\s*("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*")/g, ': <span class="string">$1</span>')
    .replace(/:\s*(null)/g, ': <span class="null">$1</span>');
}

function getLoadingHTML() {
  return `
    <div class="soap-loading-state">
      <svg class="soap-spinner" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="32" style="animation: soap-spin 1.5s linear infinite;"/>
      </svg>
      <p>Sedang menganalisis dokumentasi SOAP...</p>
      <p class="soap-loading-hint">Mohon tunggu sebentar</p>
    </div>
    <style>
      @keyframes soap-spin {
        to { stroke-dashoffset: 0; }
      }
      .soap-loading-state {
        text-align: center;
        padding: 32px 16px;
        color: #718096;
      }
      .soap-loading-state p {
        margin-top: 16px;
        font-size: 13px;
        color: #4a5568;
      }
      .soap-loading-hint {
        font-size: 11px !important;
        color: #a0aec0 !important;
      }
    </style>
  `;
}

function getEmptyStateHTML() {
  return `
    <div class="soap-empty-state">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
      <p>Dokumentasi SOAP terlihat baik!</p>
      <p class="soap-preview-hint">Tidak ada koreksi yang diperlukan</p>
    </div>
  `;
}

function getNoDataHTML() {
  return `
    <div class="soap-empty-state">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
      </svg>
      <p>Belum ada isian</p>
      <p class="soap-preview-hint">Isi form SOAP untuk memulai analisis</p>
    </div>
  `;
}

function getCorrectionsHTML(categoriesWithCorrections) {
  return `
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

/**
 * Handle dismiss all corrections
 */
function handleDismissAll() {
  resetCorrections();
  updateBadge();
  renderSidebar();
}

// ================================================
// MESSAGE HANDLING
// ================================================

function handleMessage(request, sender, sendResponse) {
  console.log('SOAP Assistant - Message received:', request);

  switch (request.action) {
    case MESSAGE_ACTIONS.TOGGLE_EXTENSION:
      console.log('SOAP Assistant - Toggle extension to:', request.enabled);
      state.isActive = request.enabled;

      if (request.enabled) {
        // Hanya buat floating button jika: URL di list DAN ada form input
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

      // Re-evaluate floating button visibility
      const hasBtn = document.getElementById('soap-floating-btn');
      const shouldShow = state.isActive && isCurrentUrlInList() && hasInputFields();

      if (!hasBtn && shouldShow) {
        createFloatingButton();
        console.log('SOAP Assistant - URL list updated, floating button created');
      } else if (hasBtn && !shouldShow) {
        const btn = document.getElementById('soap-floating-btn');
        btn?.remove();
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

  // Pre-create sidebar elements (cold start optimization)
  createSidebar();

  // Hanya tampilkan floating button jika:
  // 1. Extension aktif
  // 2. URL saat ini ada di dalam URL list
  // 3. Halaman memiliki form input (bukan search)
  if (state.isActive && isCurrentUrlInList() && hasInputFields()) {
    createFloatingButton();
  }

  startSOAPMonitoring();

  console.log('SOAP Assistant - Initialized');
}

init();
