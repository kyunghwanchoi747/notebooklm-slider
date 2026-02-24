/**
 * Background Service Worker
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('NotebookLM Canvas Editor extension installed.');
});

// Relay messages if needed (e.g., from sandbox to other parts)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'OPEN_EDITOR') {
    // Store the image data temporarily to be picked up by the editor
    chrome.storage.local.set({ 'pendingImage': request.imageData }, () => {
      // Then open editor in a new tab
      chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') });
      sendResponse({ success: true });
    });
    return true;
  }
});
