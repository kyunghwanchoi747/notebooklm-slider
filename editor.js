/**
 * NotebookLM Canvas Editor - Canva-style editor
 * Slide image as locked background + free editing layer
 */

// =============================================
// State
// =============================================
let canvas;
let currentTool = 'select';
let bgLocked = true;
let bgImage = null;

let isDrawing = false;
let drawStartX = 0;
let drawStartY = 0;
let activeShape = null;

// Undo/Redo history (JSON snapshots, non-background objects only)
const history = [];
let historyIndex = -1;
let pauseHistory = false;
const MAX_HISTORY = 50;

// =============================================
// Init
// =============================================
document.addEventListener('DOMContentLoaded', async () => {
  initCanvas();
  setupTools();
  setupProperties();
  setupTopBar();
  setupKeyboard();
  await loadPendingImage();
});

function initCanvas() {
  const area = document.querySelector('.canvas-area');
  const availW = Math.max(area.clientWidth - 64, 400);
  const availH = Math.max(area.clientHeight - 64, 300);

  canvas = new fabric.Canvas('canvas', {
    width: availW,
    height: availH,
    backgroundColor: '#ffffff',
    selection: true,
  });

  // History
  canvas.on('object:added', onCanvasChanged);
  canvas.on('object:modified', onCanvasChanged);
  canvas.on('object:removed', onCanvasChanged);

  // Selection -> update properties panel
  canvas.on('selection:created', (e) => updatePropsPanel(e.selected ? e.selected[0] : null));
  canvas.on('selection:updated', (e) => updatePropsPanel(e.selected ? e.selected[0] : null));
  canvas.on('selection:cleared', () => updatePropsPanel(null));

  // Drawing
  canvas.on('mouse:down', onMouseDown);
  canvas.on('mouse:move', onMouseMove);
  canvas.on('mouse:up', onMouseUp);
}

// =============================================
// Pending Image Loading
// =============================================
async function loadPendingImage() {
  showLoading(true);
  try {
    const data = await chrome.storage.local.get('pendingImage');
    if (data.pendingImage) {
      await loadSlideBackground(data.pendingImage.src);
      chrome.storage.local.remove('pendingImage');
    }
  } catch (err) {
    console.error('[Editor] Failed to load pending image:', err);
  } finally {
    showLoading(false);
    saveHistory();
  }
}

function loadSlideBackground(src) {
  return new Promise((resolve) => {
    const options = src.startsWith('data:') ? {} : { crossOrigin: 'anonymous' };
    fabric.Image.fromURL(src, (img) => {
      if (!img) { resolve(); return; }

      const area = document.querySelector('.canvas-area');
      const availW = Math.max(area.clientWidth - 64, 400);
      const availH = Math.max(area.clientHeight - 64, 300);
      const scale = Math.min(availW / img.width, availH / img.height, 1);
      const cW = Math.round(img.width * scale);
      const cH = Math.round(img.height * scale);

      canvas.setWidth(cW);
      canvas.setHeight(cH);

      img.set({
        left: 0,
        top: 0,
        scaleX: scale,
        scaleY: scale,
        selectable: false,
        evented: false,
        lockMovementX: true,
        lockMovementY: true,
        hasControls: false,
        hasBorders: false,
        name: '__background__',
      });

      bgImage = img;
      pauseHistory = true;
      canvas.add(img);
      canvas.sendToBack(img);
      canvas.renderAll();
      pauseHistory = false;
      resolve();
    }, options);
  });
}

// =============================================
// Tool Palette
// =============================================
function setupTools() {
  document.querySelectorAll('.tool-palette .tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => setTool(btn.dataset.tool));
  });

  document.getElementById('imageFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      fabric.Image.fromURL(ev.target.result, (img) => {
        if (!img) return;
        const maxW = canvas.width * 0.5;
        if (img.width > maxW) img.scaleToWidth(maxW);
        img.set({ left: 40, top: 40 });
        canvas.add(img);
        canvas.setActiveObject(img);
        canvas.renderAll();
      });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
    setTool('select');
  });
}

function setTool(tool) {
  currentTool = tool;

  document.querySelectorAll('.tool-palette .tool-btn').forEach(b => b.classList.remove('active'));
  const activeBtn = document.querySelector(`.tool-btn[data-tool="${tool}"]`);
  if (activeBtn) activeBtn.classList.add('active');

  if (tool === 'image') {
    document.getElementById('imageFileInput').click();
    return;
  }

  const area = document.querySelector('.canvas-area');
  area.className = 'canvas-area tool-' + tool;

  if (tool === 'select') {
    canvas.isDrawingMode = false;
    canvas.selection = true;
    canvas.forEachObject(obj => {
      if (obj.name !== '__background__') {
        obj.selectable = true;
        obj.evented = true;
      }
    });
  } else {
    canvas.isDrawingMode = false;
    canvas.selection = false;
    canvas.discardActiveObject();
    canvas.forEachObject(obj => {
      obj.selectable = false;
      obj.evented = false;
    });
    canvas.renderAll();
  }
}

// =============================================
// Mouse Events (Drawing + Text)
// =============================================
function onMouseDown(opt) {
  // Text tool: place IText on click
  if (currentTool === 'text') {
    const pointer = canvas.getPointer(opt.e);
    const text = new fabric.IText('텍스트를 입력하세요', {
      left: pointer.x,
      top: pointer.y,
      fontFamily: 'Arial',
      fontSize: 20,
      fill: '#222222',
      selectable: true,
      evented: true,
    });
    canvas.add(text);
    canvas.setActiveObject(text);
    text.enterEditing();
    text.selectAll();
    canvas.renderAll();
    setTool('select');
    return;
  }

  if (currentTool === 'select' || currentTool === 'image') return;

  const pointer = canvas.getPointer(opt.e);
  isDrawing = true;
  drawStartX = pointer.x;
  drawStartY = pointer.y;

  const shapeDefaults = {
    left: pointer.x,
    top: pointer.y,
    fill: 'rgba(79,142,247,0.2)',
    stroke: '#4f8ef7',
    strokeWidth: 2,
    selectable: false,
    evented: false,
    originX: 'left',
    originY: 'top',
  };

  if (currentTool === 'rect') {
    activeShape = new fabric.Rect({ ...shapeDefaults, width: 1, height: 1 });
  } else if (currentTool === 'circle') {
    activeShape = new fabric.Ellipse({ ...shapeDefaults, rx: 1, ry: 1 });
  } else if (currentTool === 'line' || currentTool === 'arrow') {
    activeShape = new fabric.Line(
      [pointer.x, pointer.y, pointer.x, pointer.y],
      { stroke: '#4f8ef7', strokeWidth: 2, selectable: false, evented: false }
    );
  }

  if (activeShape) {
    pauseHistory = true;
    canvas.add(activeShape);
  }
}

function onMouseMove(opt) {
  if (!isDrawing || !activeShape) return;
  const pointer = canvas.getPointer(opt.e);

  if (currentTool === 'rect') {
    activeShape.set({
      left: Math.min(pointer.x, drawStartX),
      top: Math.min(pointer.y, drawStartY),
      width: Math.abs(pointer.x - drawStartX),
      height: Math.abs(pointer.y - drawStartY),
    });
  } else if (currentTool === 'circle') {
    activeShape.set({
      left: Math.min(pointer.x, drawStartX),
      top: Math.min(pointer.y, drawStartY),
      rx: Math.abs(pointer.x - drawStartX) / 2,
      ry: Math.abs(pointer.y - drawStartY) / 2,
    });
  } else if (currentTool === 'line' || currentTool === 'arrow') {
    activeShape.set({ x2: pointer.x, y2: pointer.y });
  }

  canvas.renderAll();
}

function onMouseUp() {
  if (!isDrawing) return;
  isDrawing = false;
  pauseHistory = false;

  if (!activeShape) return;

  // Remove accidental tiny shapes
  const tooSmall = (() => {
    if (currentTool === 'rect') {
      return (activeShape.width || 0) < 4 || (activeShape.height || 0) < 4;
    }
    if (currentTool === 'circle') {
      return (activeShape.rx || 0) < 2 || (activeShape.ry || 0) < 2;
    }
    if (currentTool === 'line' || currentTool === 'arrow') {
      const dx = (activeShape.x2 || 0) - (activeShape.x1 || 0);
      const dy = (activeShape.y2 || 0) - (activeShape.y1 || 0);
      return Math.sqrt(dx * dx + dy * dy) < 4;
    }
    return false;
  })();

  if (tooSmall) {
    canvas.remove(activeShape);
    activeShape = null;
    return;
  }

  activeShape.set({ selectable: true, evented: true });

  if (currentTool === 'arrow') {
    addArrowhead(activeShape);
  }

  canvas.setActiveObject(activeShape);
  canvas.renderAll();
  activeShape = null;

  setTool('select');
}

function addArrowhead(line) {
  const angle = Math.atan2(
    (line.y2 || 0) - (line.y1 || 0),
    (line.x2 || 0) - (line.x1 || 0)
  ) * 180 / Math.PI;

  const head = new fabric.Triangle({
    left: line.x2 || 0,
    top: line.y2 || 0,
    angle: angle + 90,
    width: 12,
    height: 14,
    fill: line.stroke,
    originX: 'center',
    originY: 'center',
    selectable: true,
    evented: true,
  });
  canvas.add(head);
}

// =============================================
// Properties Panel
// =============================================
function setupProperties() {
  // Transform inputs
  ['propX', 'propY', 'propW', 'propH', 'propAngle'].forEach(id => {
    document.getElementById(id).addEventListener('change', applyTransform);
  });

  document.getElementById('propOpacity').addEventListener('input', (e) => {
    const obj = canvas.getActiveObject();
    if (!obj) return;
    obj.set('opacity', parseFloat(e.target.value) / 100);
    document.getElementById('propOpacityVal').textContent = e.target.value + '%';
    canvas.renderAll();
  });

  // Text properties
  document.getElementById('propFontFamily').addEventListener('change', (e) => {
    applyToActive('fontFamily', e.target.value);
  });
  document.getElementById('propFontSize').addEventListener('change', (e) => {
    applyToActive('fontSize', parseFloat(e.target.value) || 16);
  });
  document.getElementById('propTextColor').addEventListener('input', (e) => {
    applyToActive('fill', e.target.value);
  });
  document.getElementById('propBold').addEventListener('click', () => {
    const obj = canvas.getActiveObject();
    if (!obj) return;
    const bold = obj.fontWeight !== 'bold';
    obj.set('fontWeight', bold ? 'bold' : 'normal');
    document.getElementById('propBold').classList.toggle('active', bold);
    canvas.renderAll();
  });
  document.getElementById('propItalic').addEventListener('click', () => {
    const obj = canvas.getActiveObject();
    if (!obj) return;
    const italic = obj.fontStyle !== 'italic';
    obj.set('fontStyle', italic ? 'italic' : 'normal');
    document.getElementById('propItalic').classList.toggle('active', italic);
    canvas.renderAll();
  });
  document.getElementById('propUnderline').addEventListener('click', () => {
    const obj = canvas.getActiveObject();
    if (!obj) return;
    const val = !obj.underline;
    obj.set('underline', val);
    document.getElementById('propUnderline').classList.toggle('active', val);
    canvas.renderAll();
  });
  ['Left', 'Center', 'Right'].forEach(dir => {
    document.getElementById('propAlign' + dir).addEventListener('click', () => {
      applyToActive('textAlign', dir.toLowerCase());
      ['Left', 'Center', 'Right'].forEach(d => {
        document.getElementById('propAlign' + d).classList.toggle('active', d === dir);
      });
    });
  });

  // Shape properties
  document.getElementById('propFill').addEventListener('input', (e) => {
    const obj = canvas.getActiveObject();
    if (!obj) return;
    obj.set('fill', e.target.value);
    document.getElementById('propNoFill').checked = false;
    canvas.renderAll();
  });
  document.getElementById('propStroke').addEventListener('input', (e) => {
    applyToActive('stroke', e.target.value);
  });
  document.getElementById('propStrokeWidth').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    applyToActive('strokeWidth', val);
    document.getElementById('propStrokeWidthVal').textContent = val + 'px';
  });
  document.getElementById('propNoFill').addEventListener('change', (e) => {
    const obj = canvas.getActiveObject();
    if (!obj) return;
    obj.set('fill', e.target.checked ? 'transparent' : document.getElementById('propFill').value);
    canvas.renderAll();
  });

  // Z-order
  document.getElementById('orderFront').addEventListener('click', () => {
    const obj = canvas.getActiveObject();
    if (obj) { canvas.bringToFront(obj); canvas.renderAll(); }
  });
  document.getElementById('orderForward').addEventListener('click', () => {
    const obj = canvas.getActiveObject();
    if (obj) { canvas.bringForward(obj); canvas.renderAll(); }
  });
  document.getElementById('orderBackward').addEventListener('click', () => {
    const obj = canvas.getActiveObject();
    if (obj) { canvas.sendBackwards(obj); canvas.renderAll(); }
  });
  document.getElementById('orderBack').addEventListener('click', () => {
    const obj = canvas.getActiveObject();
    if (obj) {
      canvas.sendToBack(obj);
      if (bgImage) canvas.sendToBack(bgImage);
      canvas.renderAll();
    }
  });

  document.getElementById('deleteBtn').addEventListener('click', deleteSelected);
}

function applyToActive(prop, value) {
  const obj = canvas.getActiveObject();
  if (!obj) return;
  obj.set(prop, value);
  canvas.renderAll();
}

function applyTransform() {
  const obj = canvas.getActiveObject();
  if (!obj) return;

  const x = parseFloat(document.getElementById('propX').value);
  const y = parseFloat(document.getElementById('propY').value);
  const w = parseFloat(document.getElementById('propW').value);
  const h = parseFloat(document.getElementById('propH').value);
  const angle = parseFloat(document.getElementById('propAngle').value);

  if (!isNaN(x)) obj.set('left', x);
  if (!isNaN(y)) obj.set('top', y);
  if (!isNaN(angle)) obj.set('angle', angle);
  if (!isNaN(w) && w > 0 && obj.width) obj.set('scaleX', w / obj.width);
  if (!isNaN(h) && h > 0 && obj.height) obj.set('scaleY', h / obj.height);

  obj.setCoords();
  canvas.renderAll();
}

function updatePropsPanel(obj) {
  const panelEmpty  = document.getElementById('panelEmpty');
  const propTransform = document.getElementById('propTransform');
  const propText    = document.getElementById('propText');
  const propShape   = document.getElementById('propShape');
  const propOrder   = document.getElementById('propOrder');
  const propDelete  = document.getElementById('propDelete');

  if (!obj || obj.name === '__background__') {
    panelEmpty.style.display = '';
    [propTransform, propText, propShape, propOrder, propDelete].forEach(el => el.style.display = 'none');
    return;
  }

  panelEmpty.style.display = 'none';
  propTransform.style.display = '';
  propOrder.style.display = '';
  propDelete.style.display = '';

  const isText = ['i-text', 'text', 'textbox'].includes(obj.type);
  const isShape = !isText && obj.type !== 'image';

  propText.style.display = isText ? '' : 'none';
  propShape.style.display = isShape ? '' : 'none';

  // Transform fields
  document.getElementById('propX').value = Math.round(obj.left || 0);
  document.getElementById('propY').value = Math.round(obj.top || 0);
  document.getElementById('propW').value = Math.round((obj.width || 0) * (obj.scaleX || 1));
  document.getElementById('propH').value = Math.round((obj.height || 0) * (obj.scaleY || 1));
  document.getElementById('propAngle').value = Math.round(obj.angle || 0);
  const opacityPct = Math.round((obj.opacity !== undefined ? obj.opacity : 1) * 100);
  document.getElementById('propOpacity').value = opacityPct;
  document.getElementById('propOpacityVal').textContent = opacityPct + '%';

  if (isText) {
    document.getElementById('propFontFamily').value = obj.fontFamily || 'Arial';
    document.getElementById('propFontSize').value = obj.fontSize || 16;
    document.getElementById('propTextColor').value = colorToHex(obj.fill) || '#222222';
    document.getElementById('propBold').classList.toggle('active', obj.fontWeight === 'bold');
    document.getElementById('propItalic').classList.toggle('active', obj.fontStyle === 'italic');
    document.getElementById('propUnderline').classList.toggle('active', !!obj.underline);
    const align = obj.textAlign || 'left';
    ['Left', 'Center', 'Right'].forEach(d => {
      document.getElementById('propAlign' + d).classList.toggle('active', d.toLowerCase() === align);
    });
  }

  if (isShape) {
    const noFill = !obj.fill || obj.fill === 'transparent';
    document.getElementById('propNoFill').checked = noFill;
    document.getElementById('propFill').value = noFill ? '#4f8ef7' : (colorToHex(obj.fill) || '#4f8ef7');
    document.getElementById('propStroke').value = colorToHex(obj.stroke) || '#4f8ef7';
    const sw = obj.strokeWidth || 0;
    document.getElementById('propStrokeWidth').value = sw;
    document.getElementById('propStrokeWidthVal').textContent = sw + 'px';
  }
}

function colorToHex(color) {
  if (!color || color === 'transparent') return '#000000';
  if (typeof color === 'string' && color.startsWith('#')) return color;
  const m = typeof color === 'string' && color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) {
    return '#' + [m[1], m[2], m[3]]
      .map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
  }
  return color;
}

// =============================================
// Top Bar
// =============================================
function setupTopBar() {
  document.getElementById('backBtn').addEventListener('click', () => window.close());
  document.getElementById('undoBtn').addEventListener('click', undo);
  document.getElementById('redoBtn').addEventListener('click', redo);
  document.getElementById('downloadPng').addEventListener('click', downloadPng);
  document.getElementById('downloadSvg').addEventListener('click', downloadSvg);
  document.getElementById('lockBgBtn').addEventListener('click', toggleBgLock);
}

function toggleBgLock() {
  bgLocked = !bgLocked;
  document.getElementById('lockBgBtn').classList.toggle('active', bgLocked);
  if (bgImage) {
    bgImage.set({
      selectable: !bgLocked,
      evented: !bgLocked,
      hasControls: !bgLocked,
      hasBorders: !bgLocked,
    });
    canvas.renderAll();
  }
}

// =============================================
// Undo / Redo
// =============================================
function saveHistory() {
  if (pauseHistory) return;
  const editableObjs = canvas.getObjects().filter(o => o.name !== '__background__');
  const snapshot = JSON.stringify(editableObjs.map(o => o.toJSON(['name'])));

  if (historyIndex < history.length - 1) {
    history.splice(historyIndex + 1);
  }
  history.push(snapshot);
  if (history.length > MAX_HISTORY) history.shift();
  historyIndex = history.length - 1;
  updateHistoryButtons();
}

function onCanvasChanged(e) {
  if (e && e.target && e.target.name === '__background__') return;
  if (pauseHistory) return;
  saveHistory();
}

function undo() {
  if (historyIndex <= 0) return;
  historyIndex--;
  restoreSnapshot(history[historyIndex]);
}

function redo() {
  if (historyIndex >= history.length - 1) return;
  historyIndex++;
  restoreSnapshot(history[historyIndex]);
}

function restoreSnapshot(snapshot) {
  pauseHistory = true;
  canvas.getObjects().filter(o => o.name !== '__background__').forEach(o => canvas.remove(o));

  const objects = JSON.parse(snapshot);
  if (!objects.length) {
    canvas.renderAll();
    pauseHistory = false;
    updateHistoryButtons();
    return;
  }

  fabric.util.enlivenObjects(objects, (enlivened) => {
    enlivened.forEach(obj => canvas.add(obj));
    canvas.renderAll();
    pauseHistory = false;
    updateHistoryButtons();
  });
}

function updateHistoryButtons() {
  document.getElementById('undoBtn').disabled = historyIndex <= 0;
  document.getElementById('redoBtn').disabled = historyIndex >= history.length - 1;
}

// =============================================
// Keyboard Shortcuts
// =============================================
function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteSelected();
    } else if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
      else if (e.key === 'd') { e.preventDefault(); duplicateSelected(); }
      else if (e.key === 'a') { e.preventDefault(); selectAll(); }
    } else {
      if (e.key === 'Escape') { canvas.discardActiveObject(); canvas.renderAll(); setTool('select'); }
      else if (e.key === 'v') setTool('select');
      else if (e.key === 't') setTool('text');
      else if (e.key === 'r') setTool('rect');
      else if (e.key === 'o') setTool('circle');
      else if (e.key === 'l') setTool('line');
    }
  });
}

function deleteSelected() {
  const active = canvas.getActiveObjects();
  if (!active.length) return;
  canvas.discardActiveObject();
  active.filter(o => o.name !== '__background__').forEach(o => canvas.remove(o));
  canvas.requestRenderAll();
}

function duplicateSelected() {
  const obj = canvas.getActiveObject();
  if (!obj || obj.name === '__background__') return;
  obj.clone((cloned) => {
    cloned.set({ left: (obj.left || 0) + 20, top: (obj.top || 0) + 20 });
    canvas.add(cloned);
    canvas.setActiveObject(cloned);
    canvas.renderAll();
  });
}

function selectAll() {
  const objs = canvas.getObjects().filter(o => o.name !== '__background__');
  if (!objs.length) return;
  canvas.setActiveObject(new fabric.ActiveSelection(objs, { canvas }));
  canvas.renderAll();
}

// =============================================
// Export
// =============================================
function downloadPng() {
  const dataURL = canvas.toDataURL({ format: 'png', quality: 1 });
  const link = document.createElement('a');
  link.download = 'notebooklm-slide.png';
  link.href = dataURL;
  link.click();
}

function downloadSvg() {
  const svg = canvas.toSVG();
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = 'notebooklm-slide.svg';
  link.href = url;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// =============================================
// Loading
// =============================================
function showLoading(show, text) {
  const overlay = document.getElementById('loadingOverlay');
  overlay.classList.toggle('hidden', !show);
  if (text) document.getElementById('loadingText').textContent = text;
}
