/**
 * Editor Logic - NotebookLM Canvas Editor
 * Uses VTracer WASM to vectorize images into individual selectable objects
 */

let canvas;

document.addEventListener('DOMContentLoaded', async () => {
  initCanvas();
  setupEventListeners();
  loadPendingImage();
});

function initCanvas() {
  const width = window.innerWidth - 300 - 80;
  const height = window.innerHeight - 80;

  canvas = new fabric.Canvas('canvas', {
    width: width,
    height: height,
    backgroundColor: '#ffffff'
  });
}

function setupEventListeners() {
  document.getElementById('deleteBtn').addEventListener('click', deleteSelected);
  document.getElementById('clearBtn').addEventListener('click', () => {
    if (confirm('모든 요소를 지우시겠습니까?')) {
      canvas.clear();
      canvas.backgroundColor = '#ffffff';
      canvas.renderAll();
    }
  });
  document.getElementById('downloadPng').addEventListener('click', downloadPng);
  document.getElementById('downloadSvg').addEventListener('click', downloadSvg);

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      deleteSelected();
    }
  });
}

async function loadPendingImage() {
  try {
    console.log('[Editor] Loading pending image from storage...');
    const data = await chrome.storage.local.get('pendingImage');
    if (data.pendingImage) {
      const imgData = data.pendingImage;
      console.log('[Editor] Found pending image, starting vectorization...');
      processImage(imgData.src);
      chrome.storage.local.remove('pendingImage');
    } else {
      console.warn('[Editor] No pending image found in storage.');
    }
  } catch (err) {
    console.error('[Editor] Failed to load pending image:', err);
  }
}

function deleteSelected() {
  const activeObjects = canvas.getActiveObjects();
  if (activeObjects.length) {
    canvas.discardActiveObject();
    activeObjects.forEach((obj) => {
      canvas.remove(obj);
    });
    canvas.requestRenderAll();
  }
}

function showLoading(show, text, progress) {
  const overlay = document.getElementById('loadingOverlay');
  const loadingText = document.getElementById('loadingText');
  const loadingProgress = document.getElementById('loadingProgress');
  
  if (show) {
    overlay.classList.remove('hidden');
    if (text) loadingText.textContent = text;
    if (progress !== undefined && loadingProgress) {
      loadingProgress.textContent = progress;
    }
  } else {
    overlay.classList.add('hidden');
  }
}

async function processImage(imageSrc) {
  showLoading(true, '이미지를 벡터화하는 중...', 'VTracer WASM 초기화 중...');
  const isDataURL = imageSrc.startsWith('data:');

  try {
    // 1. Try VTracer vectorization first
    console.log('[Editor] Attempting VTracer vectorization...');
    
    const svgString = await vtracer.imageToSvg(imageSrc, {
      color_precision: 6,
      filter_speckle: 4,
      corner_threshold: 60,
      length_threshold: 4.0,
      splice_threshold: 45,
      mode: 'spline'
    }, (progress) => {
      showLoading(true, '이미지를 벡터화하는 중...', `진행률: ${progress}%`);
    });

    if (svgString) {
      console.log('[Editor] VTracer returned SVG, loading as individual objects...');
      showLoading(true, '개별 객체를 캔버스에 배치하는 중...', '');
      loadSvgContent(svgString);
      return;
    }
    
    console.warn('[Editor] VTracer returned null, falling back to image load');
  } catch (err) {
    console.warn('[Editor] VTracer failed, falling back to image load:', err);
  }

  // 2. Fallback: load as a single image
  try {
    showLoading(true, '이미지를 로드하는 중...', '(벡터화 실패 - 이미지 모드)');
    
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('이미지를 불러올 수 없습니다'));
      if (!isDataURL) i.crossOrigin = 'Anonymous';
      i.src = imageSrc;
    });

    const maxWidth = window.innerWidth - 300 - 80;
    const maxHeight = window.innerHeight - 80;
    const ratio = Math.min(maxWidth / img.width, maxHeight / img.height);

    canvas.setDimensions({
      width: img.width * ratio,
      height: img.height * ratio
    });

    loadAsImage(imageSrc, ratio, isDataURL);
  } catch (err) {
    console.error('[Editor] Image loading also failed:', err);
    alert('이미지를 로드할 수 없습니다: ' + (err.message || '알 수 없는 오류'));
    showLoading(false);
  }
}

function loadAsImage(imageSrc, ratio, isDataURL) {
  const options = isDataURL ? {} : { crossOrigin: 'anonymous' };
  fabric.Image.fromURL(imageSrc, (fImg) => {
    if (!fImg) {
      alert('이미지를 캔버스에 불러올 수 없습니다.');
      showLoading(false);
      return;
    }
    fImg.scale(ratio);
    canvas.add(fImg);
    canvas.centerObject(fImg);
    canvas.renderAll();
    showLoading(false);
    console.log('[Editor] Image loaded as single object on canvas');
  }, options);
}

function loadSvgContent(svgString) {
  fabric.loadSVGFromString(svgString, (objects, options) => {
    if (!objects || objects.length === 0) {
      console.warn('[Editor] SVG contained no objects');
      showLoading(false);
      return;
    }

    // Calculate scaling to fit canvas
    const svgWidth = options.width || canvas.width;
    const svgHeight = options.height || canvas.height;
    
    const maxWidth = window.innerWidth - 300 - 80;
    const maxHeight = window.innerHeight - 80;
    const scale = Math.min(maxWidth / svgWidth, maxHeight / svgHeight);

    canvas.setDimensions({
      width: svgWidth * scale,
      height: svgHeight * scale
    });

    // Add each SVG path as an individual selectable object
    console.log(`[Editor] Loading ${objects.length} individual objects onto canvas...`);
    
    objects.forEach((obj, index) => {
      obj.set({
        left: (obj.left || 0) * scale,
        top: (obj.top || 0) * scale,
        scaleX: (obj.scaleX || 1) * scale,
        scaleY: (obj.scaleY || 1) * scale,
        selectable: true,
        hasControls: true,
        hasBorders: true
      });
      canvas.add(obj);
    });

    canvas.renderAll();
    showLoading(false);
    console.log(`[Editor] Successfully loaded ${objects.length} objects. Each can be selected, moved, and deleted independently.`);
  });
}

function downloadPng() {
  const dataURL = canvas.toDataURL({
    format: 'png',
    quality: 1
  });
  const link = document.createElement('a');
  link.download = 'notebooklm-canvas.png';
  link.href = dataURL;
  link.click();
}

function downloadSvg() {
  const svg = canvas.toSVG();
  const blob = new Blob([svg], {type: 'image/svg+xml'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = 'notebooklm-canvas.svg';
  link.href = url;
  link.click();
}
