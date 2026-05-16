// SOAP AI Assistant - Popup Script
// ================================================

document.addEventListener('DOMContentLoaded', async () => {
  const enabledToggle = document.getElementById('enabled-toggle');
  const statusText = document.getElementById('status-text');
  const addUrlBtn = document.getElementById('add-url-btn');
  const urlInputContainer = document.getElementById('url-input-container');
  const urlInput = document.getElementById('url-input');
  const saveUrlBtn = document.getElementById('save-url-btn');
  const cancelUrlBtn = document.getElementById('cancel-url-btn');
  const urlList = document.getElementById('url-list');

  let urlListData = [];

  // Load current settings
  const settings = await chrome.storage.sync.get(['enabled', 'urlList']);

  // Set initial toggle state
  const isEnabled = settings.enabled !== false;
  enabledToggle.checked = isEnabled;
  updateStatus(isEnabled);

  // Load URL list
  urlListData = (settings.urlList || []).map(item => ({
    ...item,
    enabled: item.enabled !== false // Default to true if not set
  }));
  renderUrlList();

  // Handle toggle changes
  enabledToggle.addEventListener('change', async () => {
    const enabled = enabledToggle.checked;

    // Update UI
    updateStatus(enabled);

    // Save to storage
    await chrome.storage.sync.set({ enabled: enabled });

    // Notify all valid tabs
    const tabs = await chrome.tabs.query({});

    for (const tab of tabs) {
      // Skip invalid URLs
      if (tab.url?.startsWith('chrome://') ||
          tab.url?.startsWith('chrome-extension://') ||
          tab.url?.startsWith('about:')) {
        continue;
      }

      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: 'toggleExtension',
          enabled: enabled
        });
      } catch (error) {
        // Ignore errors for tabs without content script
      }
    }
  });

  // Show URL input
  addUrlBtn.addEventListener('click', () => {
    urlInput.value = '';
    urlInputContainer.classList.add('active');
    urlInput.focus();
  });

  // Hide URL input
  cancelUrlBtn.addEventListener('click', () => {
    urlInputContainer.classList.remove('active');
    urlInput.value = '';
  });

  // Save URL
  saveUrlBtn.addEventListener('click', saveUrl);

  // Handle Enter key
  urlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      saveUrl();
    }
  });

  function saveUrl() {
    let url = urlInput.value.trim();

    if (!url) {
      alert('URL tidak boleh kosong');
      return;
    }

    // Add protocol if missing (but skip file:// URLs)
    if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('file://')) {
      url = 'https://' + url;
    }

    // Validate URL
    try {
      new URL(url);
    } catch (e) {
      alert('URL tidak valid');
      return;
    }

    // Check for duplicate
    const isDuplicate = urlListData.some(item => item.url === url);

    if (isDuplicate) {
      alert('URL sudah ada dalam daftar');
      return;
    }

    // Add new URL with enabled=true by default
    urlListData.push({ url, enabled: true, createdAt: Date.now() });

    saveUrlList();
    renderUrlList();
    urlInputContainer.classList.remove('active');
    urlInput.value = '';
  }

  function saveUrlList() {
    chrome.storage.sync.set({ urlList: urlListData });
    notifyTabsUrlListChanged();
  }

  function notifyTabsUrlListChanged() {
    // Get all tabs and send message
    chrome.tabs.query({}, (tabs) => {
      if (chrome.runtime.lastError) {
        console.error('Error querying tabs:', chrome.runtime.lastError);
        return;
      }

      tabs.forEach(tab => {
        // Skip special URLs
        if (tab.url?.startsWith('chrome://') ||
            tab.url?.startsWith('chrome-extension://') ||
            tab.url?.startsWith('about:')) {
          return;
        }

        // Send message to update URL list
        chrome.tabs.sendMessage(tab.id, {
          action: 'urlListChanged',
          urlList: urlListData
        }, (response) => {
          // Ignore errors for tabs without content script
          if (chrome.runtime.lastError) {
            // Tab doesn't have content script, ignore
          }
        });
      });
    });
  }

  function renderUrlList() {
    if (urlListData.length === 0) {
      urlList.innerHTML = '<div class="empty-state">Belum ada URL yang ditambahkan</div>';
      return;
    }

    urlList.innerHTML = urlListData.map((item, index) => `
      <div class="url-item ${item.enabled === false ? 'disabled' : ''}" data-index="${index}">
        <div class="url-item-left">
          <span class="url-text">${escapeHtml(item.url)}</span>
          <span class="url-status">${item.enabled === false ? 'Nonaktif' : 'Aktif'}</span>
        </div>
        <div class="url-actions">
          <label class="url-toggle">
            <input type="checkbox" class="url-toggle-input" data-index="${index}" ${item.enabled !== false ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
          <button class="delete-btn" data-index="${index}">Hapus</button>
        </div>
      </div>
    `).join('');

    // Add event listeners for toggles
    urlList.querySelectorAll('.url-toggle-input').forEach(input => {
      input.addEventListener('change', (e) => {
        const index = parseInt(e.target.dataset.index);
        toggleUrlEnabled(index);
      });
    });

    // Add event listeners for delete buttons
    urlList.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.target.dataset.index);
        deleteUrl(index);
      });
    });
  }

  function toggleUrlEnabled(index) {
    urlListData[index].enabled = urlListData[index].enabled === false ? true : false;
    saveUrlList();
    renderUrlList();
  }

  function deleteUrl(index) {
    if (confirm('Hapus URL ini dari daftar?')) {
      urlListData.splice(index, 1);
      saveUrlList();
      renderUrlList();
    }
  }

  function updateStatus(enabled) {
    if (enabled) {
      statusText.textContent = 'Ekstensi aktif';
      statusText.style.color = '#48bb78';
    } else {
      statusText.textContent = 'Ekstensi nonaktif';
      statusText.style.color = '#f56565';
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
});
