/**
 * VTracer WASM Wrapper
 * Converts raster images to SVG using the VTracer color image converter.
 * The SVG output contains individual path elements for each detected color region.
 */

const vtracer = {
  _initialized: false,
  _module: null,

  /**
   * Initialize the WASM module
   */
  async init() {
    if (this._initialized) return true;

    try {
      console.log('[VTracer] Initializing WASM module...');
      
      // Dynamically import the ES module
      const wasmModule = await import(chrome.runtime.getURL('lib/vtracer_webapp_entry.js'));
      this._module = wasmModule;
      this._initialized = true;
      
      console.log('[VTracer] WASM module initialized successfully');
      return true;
    } catch (err) {
      console.error('[VTracer] Failed to initialize WASM:', err);
      return false;
    }
  },

  /**
   * Convert an image (data URL or Image element) to SVG string
   * @param {string} imageSrc - Data URL or image source
   * @param {object} options - Conversion options
   * @param {function} onProgress - Progress callback (0-100)
   * @returns {string|null} SVG string or null on failure
   */
  async imageToSvg(imageSrc, options = {}, onProgress = null) {
    if (!this._initialized) {
      const ok = await this.init();
      if (!ok) return null;
    }

    try {
      // 1. Load the image
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('이미지를 불러올 수 없습니다'));
        if (!imageSrc.startsWith('data:')) {
          i.crossOrigin = 'Anonymous';
        }
        i.src = imageSrc;
      });

      // 2. Draw image onto a hidden canvas element that VTracer will read from
      let tempCanvas = document.getElementById('vtracer-source');
      if (!tempCanvas) {
        tempCanvas = document.createElement('canvas');
        tempCanvas.id = 'vtracer-source';
        tempCanvas.style.display = 'none';
        document.body.appendChild(tempCanvas);
      }
      tempCanvas.width = img.naturalWidth;
      tempCanvas.height = img.naturalHeight;
      const ctx = tempCanvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      // 3. Create an SVG output element
      let svgContainer = document.getElementById('vtracer-output');
      if (!svgContainer) {
        svgContainer = document.createElement('div');
        svgContainer.id = 'vtracer-output';
        svgContainer.style.display = 'none';
        document.body.appendChild(svgContainer);
      }
      svgContainer.innerHTML = '';

      // 4. Create and run the ColorImageConverter
      const params = JSON.stringify({
        input: 'vtracer-source',
        output: 'vtracer-output',
        color_precision: options.color_precision || 6,
        filter_speckle: options.filter_speckle || 4,
        corner_threshold: options.corner_threshold || 60,
        length_threshold: options.length_threshold || 4.0,
        splice_threshold: options.splice_threshold || 45,
        mode: options.mode || 'spline'
      });

      console.log('[VTracer] Starting color image conversion...');
      const converter = this._module.ColorImageConverter.new_with_string(params);
      converter.init();

      // Tick until complete
      let tickCount = 0;
      const maxTicks = 100000; // Safety limit
      while (converter.tick() && tickCount < maxTicks) {
        tickCount++;
        if (onProgress && tickCount % 100 === 0) {
          const progress = converter.progress();
          onProgress(Math.min(progress, 99));
        }
      }

      if (onProgress) onProgress(100);
      console.log('[VTracer] Conversion complete after', tickCount, 'ticks');

      // 5. Extract the SVG from the output container
      const svgElement = svgContainer.querySelector('svg');
      if (svgElement) {
        const svgString = new XMLSerializer().serializeToString(svgElement);
        converter.free();
        return svgString;
      } else {
        console.warn('[VTracer] No SVG element found in output');
        converter.free();
        return null;
      }

    } catch (err) {
      console.error('[VTracer] Conversion error:', err);
      return null;
    }
  }
};
