/**
 * Content script to extract images from NotebookLM
 */

// Convert an image URL to a base64 data URL
function imageToDataURL(imgSrc) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const dataURL = canvas.toDataURL('image/png');
        resolve(dataURL);
      } catch (e) {
        // If canvas is tainted, fall back to original URL
        console.warn('Could not convert to dataURL:', e);
        resolve(imgSrc);
      }
    };
    img.onerror = () => {
      // Fall back to original URL on error
      resolve(imgSrc);
    };
    img.src = imgSrc;
  });
}

// Function to find all potential images on the page
async function extractImages() {
  const images = [];

  // 1. Standalone <img> tags
  const imgElements = document.querySelectorAll("img");
  for (let index = 0; index < imgElements.length; index++) {
    const img = imgElements[index];
    if (img.src && img.src.startsWith("http") && img.naturalWidth > 50 && img.naturalHeight > 50) {
      const dataURL = await imageToDataURL(img.src);
      images.push({
        id: `img_${index}`,
        src: dataURL,
        type: "img",
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
      });
    }
  }

  // 2. Canvas elements
  document.querySelectorAll("canvas").forEach((canvas, index) => {
    try {
      if (canvas.width > 50 && canvas.height > 50) {
        images.push({
          id: `canvas_${index}`,
          src: canvas.toDataURL(),
          type: "canvas",
          width: canvas.width,
          height: canvas.height,
        });
      }
    } catch (e) {
      console.warn("Could not extract canvas data:", e);
    }
  });

  return images;
}

// Global listener for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "GET_IMAGES") {
    // extractImages is now async, so we use .then()
    extractImages().then(images => {
      sendResponse({ images: images });
    }).catch(err => {
      console.error("Image extraction failed:", err);
      sendResponse({ images: [] });
    });
    return true; // Keep message channel open for async response
  }
});
