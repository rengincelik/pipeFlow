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
// Pan tetikleyicileri:
//   - Sol tık + sürükle   (threshold: PAN_THRESHOLD px — click korunur)
//   - Space + sol tık     (anında pan, threshold yok)
//   - Orta tuş sürükle    (anında pan, threshold yok)
//
// Click koruması:
//   didConsumeDrag() → true ise onCompClick'i yuttur.
//   Her mousedown'da otomatik sıfırlanır.
//
// Kullanım:
//   const zoom = createZoomController(svgEl, flowCanvasEl);
//   zoom.attach();
//   zoom.reset();           // zoomToFit sonrası state sıfırla
//   zoom.didConsumeDrag();  // onCompClick içinde kontrol et
//   zoom.detach();
// ═══════════════════════════════════════════════════════════

const ZOOM_MIN      = 0.2;
const ZOOM_MAX      = 8;
const ZOOM_STEP     = 0.12;  // wheel başına oransal değişim
const PAN_THRESHOLD = 5;     // px — sol tık drag'in pan sayılması için min mesafe

export function createZoomController(svgEl, flowCanvas) {

	// ─── Zoom state ──────────────────────────────────────────
	let scale   = 1;
	let offsetX = 0;
	let offsetY = 0;
	let _baseVB = null;

	// ─── Pan state ───────────────────────────────────────────
	let _panning    = false;  // gerçek pan aktif mi
	let _pendingPan = false;  // mousedown oldu, threshold bekliyor (sol tık)
	let _didDrag    = false;  // bu mousedown-mouseup döngüsünde drag oldu mu
	let _panStartX  = 0;
	let _panStartY  = 0;
	let _panVBStart = null;
	let _spaceDown  = false;

	// ─── Helpers ─────────────────────────────────────────────

	function _readVB() {
		const vb = svgEl.getAttribute('viewBox');
		if (!vb) return null;
		const [x, y, w, h] = vb.split(' ').map(Number);
		return { x, y, w, h };
	}

	function _captureBase() {
		_baseVB = _readVB();
	}

	function _apply() {
		if (!_baseVB) return;
		const { x, y, w, h } = _baseVB;
		svgEl.setAttribute('viewBox',
			`${x + offsetX} ${y + offsetY} ${w / scale} ${h / scale}`);
		_syncFlowCanvas();
	}

	function _syncFlowCanvas() {
		if (!flowCanvas) return;
		const rect = svgEl.getBoundingClientRect();
		if (flowCanvas.width  !== rect.width)  flowCanvas.width  = rect.width;
		if (flowCanvas.height !== rect.height) flowCanvas.height = rect.height;
	}

	function _clientToVBCoordWithScale(cx, cy, s) {
		const rect = svgEl.getBoundingClientRect();
		const { x, y, w, h } = _baseVB;
		return {
			x: x + offsetX + ((cx - rect.left) / rect.width)  * (w / s),
			y: y + offsetY + ((cy - rect.top)  / rect.height) * (h / s),
		};
	}

	function _clientToVBCoord(cx, cy) {
		return _clientToVBCoordWithScale(cx, cy, scale);
	}

	/** Pan hareketi hesapla ve uygula. */
	function _applyPanMove(clientX, clientY) {
		if (!_baseVB || !_panVBStart) return;
		const rect   = svgEl.getBoundingClientRect();
		const scaleX = (_baseVB.w / scale) / rect.width;
		const scaleY = (_baseVB.h / scale) / rect.height;
		offsetX = _panVBStart.offsetX - (clientX - _panStartX) * scaleX;
		offsetY = _panVBStart.offsetY - (clientY - _panStartY) * scaleY;
		_apply();
	}

	/** Pan'ı başlat — mevcut cursor pozisyonundan. */
	function _startPan(clientX, clientY) {
		_panning    = true;
		_didDrag    = true;
		_panStartX  = clientX;
		_panStartY  = clientY;
		_panVBStart = { offsetX, offsetY };
		svgEl.style.cursor = 'grabbing';
	}
	/** HTML5 drag başladığında pan'ı iptal et. */
	function cancelPan() {
		_pendingPan = false;
		_panning    = false;
		_didDrag    = false;
		svgEl.style.cursor = _spaceDown ? 'grab' : '';
	}
	function _updateZoomLabel() {
		const label = document.getElementById('zoom-label');
		if (label) label.textContent = Math.round(scale * 100) + '%';
	}

	// ─── Wheel ───────────────────────────────────────────────

	function _onWheel(e) {
		e.preventDefault();
		if (!_baseVB) _captureBase();
		if (!_baseVB) return;

		const ptBefore = _clientToVBCoord(e.clientX, e.clientY);
		const delta    = e.deltaY < 0 ? (1 + ZOOM_STEP) : (1 / (1 + ZOOM_STEP));
		const newScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale * delta));
		if (newScale === scale) return;
		scale = newScale;

		// İmleç altındaki nokta sabit kalsın
		const ptAfter = _clientToVBCoordWithScale(e.clientX, e.clientY, scale);
		offsetX += ptBefore.x - ptAfter.x;
		offsetY += ptBefore.y - ptAfter.y;

		_apply();
		_updateZoomLabel();
	}

	// ─── Keyboard (Space) ────────────────────────────────────

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

	// ─── Mouse ───────────────────────────────────────────────

	function _onMouseDown(e) {
		const isMiddle = e.button === 1;
		const isLeft   = e.button === 0;

		// Her yeni mousedown'da drag flag'i sıfırla
		_didDrag = false;

		if (isMiddle || (_spaceDown && isLeft)) {
			// Anında pan — threshold yok
			e.preventDefault();
			if (!_baseVB) _captureBase();
			_pendingPan = false;
			_startPan(e.clientX, e.clientY);
			return;
		}

		if (isLeft) {
			// Sol tık: threshold geçilene kadar bekle
			if (!_baseVB) _captureBase();
			_pendingPan = true;
			_panStartX  = e.clientX;
			_panStartY  = e.clientY;
		}
	}

	function _onMouseMove(e) {
		if (_panning) {
			_applyPanMove(e.clientX, e.clientY);
			return;
		}

		if (_pendingPan) {
			const dist = Math.hypot(e.clientX - _panStartX, e.clientY - _panStartY);
			if (dist >= PAN_THRESHOLD) {
				// Threshold geçildi — pan'a geç, mevcut pozisyondan başlat
				_pendingPan = false;
				_startPan(_panStartX, _panStartY); // orijinal mousedown noktasından — kayma olmaz
				_applyPanMove(e.clientX, e.clientY);
			}
		}
	}

	function _onMouseUp() {
		_pendingPan = false;
		if (!_panning) return;
		_panning = false;
		svgEl.style.cursor = _spaceDown ? 'grab' : '';
		// _didDrag true olarak kaldı — didConsumeDrag() okuyacak
	}

	// ─── Public API ──────────────────────────────────────────

	/**
	 * Bu mousedown-mouseup döngüsünde pan yapıldı mı?
	 * main.js'te onCompClick içinde kontrol et:
	 *
	 *   renderer.onCompClick = (id) => {
	 *     if (zoom.didConsumeDrag()) return;
	 *     pipelineStore.select(id);
	 *   };
	 */
	function didConsumeDrag() {
		return _didDrag;
	}

	/**
	 * Renderer render() sonrası çağrılır.
	 * Base viewBox'ı günceller, mevcut zoom/pan'ı korur.
	 */
	function onRendererUpdate() {
		if (scale === 1 && offsetX === 0 && offsetY === 0) {
			_captureBase();
		} else {
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
		_updateZoomLabel();
	}

	function attach() {
		svgEl.addEventListener('wheel',        _onWheel,     { passive: false });
		svgEl.addEventListener('mousedown',    _onMouseDown);
		document.addEventListener('mousemove', _onMouseMove);
		document.addEventListener('mouseup',   _onMouseUp);
		document.addEventListener('keydown',   _onKeyDown);
		document.addEventListener('keyup',     _onKeyUp);
	}

	function detach() {
		svgEl.removeEventListener('wheel',        _onWheel);
		svgEl.removeEventListener('mousedown',    _onMouseDown);
		document.removeEventListener('mousemove', _onMouseMove);
		document.removeEventListener('mouseup',   _onMouseUp);
		document.removeEventListener('keydown',   _onKeyDown);
		document.removeEventListener('keyup',     _onKeyUp);
	}

	function getScale() { return scale; }

	return { attach, detach, reset, onRendererUpdate, getScale, didConsumeDrag, cancelPan };
}