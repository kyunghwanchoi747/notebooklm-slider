/**
 * Content script to extract slide images from NotebookLM
 */

// Convert an image URL to a base64 data URL
function imageToDataURL(imgSrc) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch (e) {
        resolve(imgSrc);
      }
    };
    img.onerror = () => resolve(imgSrc);
    img.src = imgSrc;
  });
}

// Check if an image looks like a slide (large, roughly 16:9 or 4:3 aspect ratio)
function isSlideCandidate(width, height) {
  if (width < 400 || height < 200) return false;
  const ratio = width / height;
  // 16:9 = 1.78, 4:3 = 1.33, allow ±25% tolerance
  return (ratio >= 1.0 && ratio <= 2.5);
}

// Get a label from nearby text content
function getNearbyLabel(element) {
  // Check parent, sibling, or ancestor for a heading/title
  const parent = element.closest('[class*="slide"], [class*="card"], [class*="frame"], section, article, li');
  if (parent) {
    const heading = parent.querySelector('h1, h2, h3, h4, [class*="title"]');
    if (heading && heading.textContent.trim()) {
      return heading.textContent.trim().slice(0, 50);
    }
  }
  return null;
}

async function extractImages() {
  const images = [];
  const seen = new Set();

  // 1. Standalone <img> tags - prioritize slide-like images
  const imgElements = Array.from(document.querySelectorAll('img'));

  // Sort by area descending (largest images first = most likely slides)
  imgElements.sort((a, b) => {
    const aArea = (a.naturalWidth || a.width) * (a.naturalHeight || a.height);
    const bArea = (b.naturalWidth || b.width) * (b.naturalHeight || b.height);
    return bArea - aArea;
  });

  for (let index = 0; index < imgElements.length; index++) {
    const img = imgElements[index];
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;

    if (!img.src || !img.src.startsWith('http')) continue;
    if (seen.has(img.src)) continue;
    if (!isSlideCandidate(w, h)) continue;

    seen.add(img.src);
    const dataURL = await imageToDataURL(img.src);
    const label = getNearbyLabel(img);

    images.push({
      id: `img_${index}`,
      src: dataURL,
      type: 'img',
      width: w,
      height: h,
      label: label || `슬라이드 ${images.length + 1}`,
      isSlide: true,
    });
  }

  // 2. Canvas elements (rendered slides)
  document.querySelectorAll('canvas').forEach((canvas, index) => {
    try {
      if (canvas.width < 400 || canvas.height < 200) return;
      if (!isSlideCandidate(canvas.width, canvas.height)) return;

      const dataURL = canvas.toDataURL('image/png');
      if (seen.has(dataURL)) return;
      seen.add(dataURL);

      images.push({
        id: `canvas_${index}`,
        src: dataURL,
        type: 'canvas',
        width: canvas.width,
        height: canvas.height,
        label: `캔버스 슬라이드 ${images.length + 1}`,
        isSlide: true,
      });
    } catch (e) {
      console.warn('Could not extract canvas:', e);
    }
  });

  // 3. Fallback: if no slide candidates found, include all medium+ images
  if (images.length === 0) {
    for (let index = 0; index < imgElements.length; index++) {
      const img = imgElements[index];
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (!img.src || !img.src.startsWith('http')) continue;
      if (w < 100 || h < 100) continue;
      if (seen.has(img.src)) continue;
      seen.add(img.src);

      const dataURL = await imageToDataURL(img.src);
      images.push({
        id: `fallback_${index}`,
        src: dataURL,
        type: 'img',
        width: w,
        height: h,
        label: `이미지 ${images.length + 1}`,
        isSlide: false,
      });
    }
  }

  return images;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'GET_IMAGES') {
    extractImages()
      .then(images => sendResponse({ images }))
      .catch(err => {
        console.error('Image extraction failed:', err);
        sendResponse({ images: [] });
      });
    return true;
  }
});
