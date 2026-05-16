// SOAP AI Assistant - Popup Script
// ================================================

document.addEventListener('DOMContentLoaded', async () => {
  const enabledToggle = document.getElementById('enabled-toggle');
  const statusText = document.getElementById('status-text');

  // Load current settings
  const settings = await chrome.storage.sync.get(['enabled']);

  // Set initial toggle state
  const isEnabled = settings.enabled !== false;
  enabledToggle.checked = isEnabled;
  updateStatus(isEnabled);

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

  function updateStatus(enabled) {
    if (enabled) {
      statusText.textContent = 'Ekstensi aktif';
      statusText.style.color = '#48bb78';
    } else {
      statusText.textContent = 'Ekstensi nonaktif';
      statusText.style.color = '#f56565';
    }
  }
});
