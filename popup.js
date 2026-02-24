/**
 * Popup Logic
 */

document.addEventListener('DOMContentLoaded', () => {
  const scanBtn = document.getElementById('scanBtn');
  const statusEl = document.getElementById('status');
  const imageListContainer = document.getElementById('imageListContainer');
  const imageListEl = document.getElementById('imageList');
  const placeholderEl = document.getElementById('placeholder');
  const countEl = document.getElementById('count');

  scanBtn.addEventListener('click', async () => {
    statusEl.textContent = '이미지를 찾는 중...';
    scanBtn.disabled = true;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab.url.includes('notebooklm.google.com')) {
        statusEl.textContent = '노트북LM 페이지에서 실행해주세요.';
        scanBtn.disabled = false;
        return;
      }

      chrome.tabs.sendMessage(tab.id, { action: 'GET_IMAGES' }, (response) => {
        if (chrome.runtime.lastError) {
          statusEl.textContent = '페이지와 통신할 수 없습니다. 새로고침 후 시도해주세요.';
          console.error(chrome.runtime.lastError);
          scanBtn.disabled = false;
          return;
        }

        if (response && response.images && response.images.length > 0) {
          renderImages(response.images);
          statusEl.textContent = `${response.images.length}개의 이미지를 찾았습니다.`;
        } else {
          statusEl.textContent = '추출 가능한 이미지가 없습니다.';
        }
        scanBtn.disabled = false;
      });
    } catch (err) {
      statusEl.textContent = '오류가 발생했습니다.';
      console.error(err);
      scanBtn.disabled = false;
    }
  });

  function renderImages(images) {
    imageListEl.innerHTML = '';
    placeholderEl.classList.add('hidden');
    imageListContainer.classList.remove('hidden');
    countEl.textContent = images.length;

    images.forEach(img => {
      const item = document.createElement('div');
      item.className = 'image-item';
      item.innerHTML = `
        <img src="${img.src}" alt="Extracted Image">
        <div class="overlay">
          <div class="edit-icon">✏️</div>
        </div>
      `;

      item.addEventListener('click', () => {
        openEditor(img);
      });

      imageListEl.appendChild(item);
    });
  }

  function openEditor(imgData) {
    statusEl.textContent = '에디터를 여는 중...';
    chrome.runtime.sendMessage({
      action: 'OPEN_EDITOR',
      imageData: imgData
    }, (response) => {
      if (chrome.runtime.lastError) {
        statusEl.textContent = '에디터를 열 수 없습니다: ' + chrome.runtime.lastError.message;
        console.error(chrome.runtime.lastError);
      } else if (response && response.success) {
        window.close(); // Close popup
      }
    });
  }
});
