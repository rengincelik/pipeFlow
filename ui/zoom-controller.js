'use strict';

// ═══════════════════════════════════════════════════════════
// ZOOM CONTROLLER
// SVG viewBox üzerinde zoom + pan yönetimi.
//
// Strateji:
//   SVGRenderer._updateViewBox() her render'da "base viewBox"ı yazar.
//   ZoomController bunu okuyup üstüne zoom/pan offset uygular.
//   Zoom state: { scale, offsetX, offsetY } — base viewBox koordinatlarında.
//
// Kullanım:
//   const zoom = createZoomController(svgEl, flowCanvasEl);
//   zoom.attach();          // event listener'ları bağla
//   zoom.reset();           // zoomToFit sonrası state sıfırla
//   zoom.detach();          // gerekirse kaldır
// ═══════════════════════════════════════════════════════════

const ZOOM_MIN   = 0.2;
const ZOOM_MAX   = 8;
const ZOOM_STEP  = 0.12;   // wheel başına scale değişimi (oransal)

export function createZoomController(svgEl, flowCanvas) {
  // ─── State ───────────────────────────────────────────────
  let scale   = 1;
  let offsetX = 0;   // base viewBox koordinatında pan
  let offsetY = 0;
  let _baseVB = null; // SVGRenderer'ın yazdığı son base viewBox { x, y, w, h }

  // Space+drag pan için
  let _panning    = false;
  let _panStartX  = 0;
  let _panStartY  = 0;
  let _panVBStart = null;
  let _spaceDown  = false;

  // ─── Helpers ─────────────────────────────────────────────

  /** SVG elementinin güncel viewBox'ını parse eder. */
  function _readVB() {
    const vb = svgEl.getAttribute('viewBox');
    if (!vb) return null;
    const [x, y, w, h] = vb.split(' ').map(Number);
    return { x, y, w, h };
  }

  /**
   * Base viewBox'ı yakalar. Renderer render() sonrası bunu çağırmalı
   * VEYA controller kendisi okuyabilir — renderer'a dokunmak istemiyoruz,
   * bu yüzden her apply() öncesi lazy okuyoruz ama "base" sadece
   * scale===1 && offset===0 iken değişebilir.
   */
  function _captureBase() {
    // Base'i sadece zoom/pan yokken yakala
    // (renderer sıfır-offset durumda yazmış olur)
    _baseVB = _readVB();
  }

  /** Mevcut state'i SVG viewBox'a yazar + flow canvas'ı senkronize eder. */
  function _apply() {
    if (!_baseVB) return;
    const { x, y, w, h } = _baseVB;

    // Yeni boyutlar: scale büyüyünce viewBox küçülür (daha dar alan görünür → büyük görünüm)
    const nw = w / scale;
    const nh = h / scale;

    // Offset: base koordinatlarda — viewBox origin'ini kaydır
    const nx = x + offsetX;
    const ny = y + offsetY;

    svgEl.setAttribute('viewBox', `${nx} ${ny} ${nw} ${nh}`);

    // SVG fiziksel boyutunu (width/height) koru — sadece viewBox değişsin
    // Renderer width/height set eder; biz de aynısını tutuyoruz
    // (Renderer'ın yazdığı width/height'ı bozmayalım)

    _syncFlowCanvas();
  }

  /** flow-canvas boyutunu SVG bounding rect'e senkronize eder. */
  function _syncFlowCanvas() {
    if (!flowCanvas) return;
    const rect = svgEl.getBoundingClientRect();
    if (flowCanvas.width  !== rect.width)  flowCanvas.width  = rect.width;
    if (flowCanvas.height !== rect.height) flowCanvas.height = rect.height;
  }

  // ─── clientToSVG (zoom-aware) ─────────────────────────────
  // main.js'teki Interactions.clientToSVG() getScreenCTM().inverse() kullanıyor —
  // bu viewBox değişince otomatik doğru çalışır. Ek bir şey yapmaya gerek yok.

  // ─── Event Handlers ──────────────────────────────────────

  function _onWheel(e) {
    e.preventDefault();

    // _baseVB'yi güncelle: apply() çağrısından önce mevcut "sıfır" durumu kaydet
    // Her wheel olayında base'i yeniden okumak yanlış — base sadece renderer yazdığında değişmeli.
    // Bu yüzden _baseVB null ise ilk okumayı yap.
    if (!_baseVB) _captureBase();
    if (!_baseVB) return;

    // Fare imlecinin SVG koordinatını bul (zoom öncesi)
    const ptBefore = _clientToVBCoord(e.clientX, e.clientY);

    // Scale güncelle
    const delta  = e.deltaY < 0 ? (1 + ZOOM_STEP) : (1 / (1 + ZOOM_STEP));
    const newScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale * delta));
    if (newScale === scale) return;
    scale = newScale;

    // Zoom sonrası aynı SVG noktasının ekran pozisyonu değişti —
    // offset'i düzelterek imlecin altındaki nokta sabit kalsın.
    const ptAfter = _clientToVBCoordWithScale(e.clientX, e.clientY, scale);
    offsetX += ptBefore.x - ptAfter.x;
    offsetY += ptBefore.y - ptAfter.y;

    _apply();
    _updateZoomLabel();
  }

  /** client koordinatını mevcut viewBox koordinatına çevirir. */
  function _clientToVBCoord(cx, cy) {
    return _clientToVBCoordWithScale(cx, cy, scale);
  }

  function _clientToVBCoordWithScale(cx, cy, s) {
    const rect = svgEl.getBoundingClientRect();
    const { x, y, w, h } = _baseVB;
    const nw = w / s;
    const nh = h / s;
    const ratioX = (cx - rect.left) / rect.width;
    const ratioY = (cy - rect.top)  / rect.height;
    return {
      x: x + offsetX + ratioX * nw,
      y: y + offsetY + ratioY * nh,
    };
  }

  // ─── Pan (Space + drag veya Middle Mouse) ────────────────

  function _onKeyDown(e) {
    if (e.code === 'Space' && !e.target.matches('input, textarea, select')) {
      if (!_spaceDown) {
        _spaceDown = true;
        svgEl.style.cursor = 'grab';
        e.preventDefault();
      }
    }
  }

  function _onKeyUp(e) {
    if (e.code === 'Space') {
      _spaceDown = false;
      if (!_panning) svgEl.style.cursor = '';
    }
  }

  function _onMouseDown(e) {
    const isMiddle = e.button === 1;
    const isSpace  = _spaceDown && e.button === 0;
    if (!isMiddle && !isSpace) return;
    e.preventDefault();
    if (!_baseVB) _captureBase();
    _panning    = true;
    _panStartX  = e.clientX;
    _panStartY  = e.clientY;
    _panVBStart = { offsetX, offsetY };
    svgEl.style.cursor = 'grabbing';
    svgEl.setPointerCapture?.(e.pointerId);
  }

  function _onMouseMove(e) {
    if (!_panning || !_baseVB) return;
    const rect = svgEl.getBoundingClientRect();
    // client 1px = kaç VB unit?
    const scaleX = (_baseVB.w / scale) / rect.width;
    const scaleY = (_baseVB.h / scale) / rect.height;
    offsetX = _panVBStart.offsetX - (e.clientX - _panStartX) * scaleX;
    offsetY = _panVBStart.offsetY - (e.clientY - _panStartY) * scaleY;
    _apply();
  }

  function _onMouseUp(e) {
    if (!_panning) return;
    _panning = false;
    svgEl.style.cursor = _spaceDown ? 'grab' : '';
  }

  // ─── Zoom Label ──────────────────────────────────────────

  function _updateZoomLabel() {
    const label = document.getElementById('zoom-label');
    if (label) label.textContent = Math.round(scale * 100) + '%';
  }

  // ─── Public API ──────────────────────────────────────────

  /**
   * Renderer render() sonrası çağrılır — base viewBox'ı yakalar ve
   * mevcut zoom state'ini üstüne uygular.
   * main.js'te pipelineStore 'components:change' listener'ında çağrılacak.
   */
  function onRendererUpdate() {
    // Renderer az önce "fit" viewBox yazdı — bunu base olarak kaydet,
    // ama sadece zoom/pan sıfırsa (reset sonrası ilk render).
    if (scale === 1 && offsetX === 0 && offsetY === 0) {
      _captureBase();
      // offset yok, base viewBox zaten doğru — apply gerekmez
    } else {
      // Renderer base'i güncelledi (yeni component eklendi vs) — base'i güncelle
      // ama mevcut zoom/pan'ı koru. Base'i okuyup apply yapalım.
      _captureBase();
      _apply();
    }
  }

  /** Zoom ve pan'ı sıfırla — zoomToFit() sonrası çağrılır. */
  function reset() {
    scale   = 1;
    offsetX = 0;
    offsetY = 0;
    _baseVB = null;
    // Renderer'ın yazdığı viewBox zaten doğru — dokunma
    _updateZoomLabel();
  }

  function attach() {
    svgEl.addEventListener('wheel', _onWheel, { passive: false });
    svgEl.addEventListener('mousedown', _onMouseDown);
    svgEl.addEventListener('mousemove', _onMouseMove);
    svgEl.addEventListener('mouseup',   _onMouseUp);
    // pointer capture için pointermove/up da dinle (capture kaçmasın)
    document.addEventListener('mousemove', _onMouseMove);
    document.addEventListener('mouseup',   _onMouseUp);
    document.addEventListener('keydown',   _onKeyDown);
    document.addEventListener('keyup',     _onKeyUp);
  }

  function detach() {
    svgEl.removeEventListener('wheel', _onWheel);
    svgEl.removeEventListener('mousedown', _onMouseDown);
    svgEl.removeEventListener('mousemove', _onMouseMove);
    svgEl.removeEventListener('mouseup',   _onMouseUp);
    document.removeEventListener('mousemove', _onMouseMove);
    document.removeEventListener('mouseup',   _onMouseUp);
    document.removeEventListener('keydown',   _onKeyDown);
    document.removeEventListener('keyup',     _onKeyUp);
  }

  /** Mevcut zoom seviyesi (1 = %100) */
  function getScale() { return scale; }

  return { attach, detach, reset, onRendererUpdate, getScale };
}
