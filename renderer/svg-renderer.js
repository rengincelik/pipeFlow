'use strict';

// ═══════════════════════════════════════════════════════════
// SVG RENDERER
// ═══════════════════════════════════════════════════════════

import { svgEl, setAttrs, createNode } from './svg-utils.js';

// R5: Layout sabitleri — burada belgelenmiş, değiştirilmek istenirse tek nokta.
// ORIGIN_X/Y: İlk elemanın (pompa) SVG içindeki başlangıç koordinatı.
// PAD: viewBox hesabında eleman koordinatlarının dışına eklenen kenar boşluğu.
// Bu değerler svg-renderer içinde tutulur; ileride SystemConfig'e taşınabilir.
const ORIGIN_X = 80;   // px — ilk elemanın X başlangıcı
const ORIGIN_Y = 200;  // px — ilk elemanın Y başlangıcı
const PAD      = 80;   // px — viewBox kenar boşluğu

export class SVGRenderer {
	constructor(svgRoot) {
		this.svg      = svgRoot;
		this._compEls = new Map();
		this._init();
	}

	_init() {
		// R4: Layer isimleri — CLAUDE.md'den farklı, bu liste doğru:
		// layer-spine   → boru gövde çizgileri
		// layer-comps   → eleman SVG'leri (pump, valve vb.)
		// layer-labels  → isim etiketleri
		// layer-nodes   → A/B inlet-outlet node'ları
		// layer-overlay → seçim highlight, warning ikonları, drop indicator
		this._layerSpine   = svgEl('g'); this._layerSpine.id   = 'layer-spine';
		this._layerComps   = svgEl('g'); this._layerComps.id   = 'layer-comps';
		this._layerLabels  = svgEl('g'); this._layerLabels.id  = 'layer-labels';
		this._layerNodes   = svgEl('g'); this._layerNodes.id   = 'layer-nodes';
		this._layerOverlay = svgEl('g'); this._layerOverlay.id = 'layer-overlay';
		this.svg.appendChild(this._layerSpine);
		this.svg.appendChild(this._layerComps);
		this.svg.appendChild(this._layerLabels);
		this.svg.appendChild(this._layerNodes);
		this.svg.appendChild(this._layerOverlay);
	}

	render(layouts, { selectedId = null, dropIdx = null, showLabels = true, warnings = [] } = {}) {
		if (!layouts.length) {
			this._clearAll();
			this._updateViewBox([], []);
			return;
		}
		this._updateViewBox(
			layouts.flatMap(l => [l.ix, l.ox]),
			layouts.flatMap(l => [l.iy, l.oy])
		);
		this._renderSpine(layouts);
		this._renderComponents(layouts, selectedId, showLabels);
		this._renderNodes(layouts);
		this._renderDropIndicator(layouts, dropIdx);
		this._renderWarnings(layouts, warnings);
	}

	_updateViewBox(xs, ys) {
		const allX = [ORIGIN_X, ...xs];
		const allY = [ORIGIN_Y, ...ys];
		const vx = Math.min(...allX) - PAD;
		const vy = Math.min(...allY) - PAD;
		const vw = Math.max(600, Math.max(...allX) - Math.min(...allX) + PAD * 2);
		const vh = Math.max(320, Math.max(...allY) - Math.min(...allY) + PAD * 2);
		setAttrs(this.svg, { width: vw, height: vh, viewBox: `${vx} ${vy} ${vw} ${vh}` });
	}

	_renderSpine(layouts) {
		const existing = [...this._layerSpine.querySelectorAll('line')];
		let lineIdx = 0;

		layouts.forEach((l) => {
			// R7: Elbow kendi path'ini çiziyor — spine çizgisi çizme
			if (l.comp.type === 'elbow') return;

			let line = existing[lineIdx];
			if (!line) {
				line = svgEl('line');
				line.classList.add('spine-line');
				this._layerSpine.appendChild(line);
			}
			setAttrs(line, { x1: l.ix, y1: l.iy, x2: l.ox, y2: l.oy });
			lineIdx++;
		});

		// Fazla çizgileri kaldır
		while (this._layerSpine.children.length > lineIdx) {
			this._layerSpine.removeChild(this._layerSpine.lastChild);
		}
	}

	_renderComponents(layouts, selectedId, showLabels) {
		const seenIds = new Set();
		this._layerLabels.innerHTML = '';

		layouts.forEach(entry => {
			const { comp } = entry;
			seenIds.add(comp.id);

			let g = this._compEls.get(comp.id);
			if (!g) {
				g = comp.createSVG(entry, this._layerLabels);
				g.addEventListener('click', e => {
					e.stopPropagation();
					this.onCompClick?.(comp.id);
				});
				this._layerComps.appendChild(g);
				this._compEls.set(comp.id, g);
			} else {
				comp.updateSVG(g, entry, this._layerLabels);
			}
			g.classList.toggle('selected', comp.id === selectedId);
		});

		// Silinen elemanları temizle
		for (const [id, g] of this._compEls) {
			if (!seenIds.has(id)) {
				g.remove();
				this._compEls.delete(id);
			}
		}
	}

	_renderNodes(layouts) {
		this._layerNodes.innerHTML = '';
		const first = layouts[0];
		this._layerNodes.appendChild(createNode(first.ix, first.iy, 'A', 'node-inlet'));
		const last = layouts[layouts.length - 1];
		this._layerNodes.appendChild(createNode(last.ox, last.oy, 'B', 'node-outlet'));
	}

	_renderWarnings(layouts, warnings) {
		// Önceki uyarı ikonlarını temizle — sadece .warning-node class'lıları
		this._layerOverlay.querySelectorAll('.warning-node').forEach(el => el.remove());

		warnings.forEach(w => {
			const layout = layouts[w.atIndex];
			if (!layout) return;

			const x = layout.ox;
			const y = layout.oy;

			const g = svgEl('g');
			g.classList.add('warning-node');
			g.style.cursor = 'pointer';

			const circle = svgEl('circle');
			setAttrs(circle, { cx: x, cy: y, r: 8, fill: '#ef4444', opacity: '0.9' });

			const text = svgEl('text');
			setAttrs(text, {
				x, y: y + 4,
				'text-anchor': 'middle',
				fill: 'white',
				'font-size': '10',
				'font-weight': 'bold',
				'pointer-events': 'none',
			});
			text.textContent = '!';

			g.appendChild(circle);
			g.appendChild(text);

			g.addEventListener('mouseenter', (e) => {
				this._showWarningTooltip(e.clientX, e.clientY, w.message);
			});
			g.addEventListener('mousemove', (e) => {
				this._moveWarningTooltip(e.clientX, e.clientY);
			});
			g.addEventListener('mouseleave', () => {
				this._hideWarningTooltip();
			});

			this._layerOverlay.appendChild(g);
		});
	}

	// R2/TT1: Tooltip inline style → CSS class (warning-tooltip sınıfı)
	// style.css'te .warning-tooltip tanımı olmalı
	_showWarningTooltip(x, y, message) {
		let tip = document.getElementById('warning-tooltip');
		if (!tip) {
			tip = document.createElement('div');
			tip.id = 'warning-tooltip';
			tip.className = 'warning-tooltip';
			document.body.appendChild(tip);
		}
		tip.textContent = message;
		tip.style.opacity = '1';
		this._moveWarningTooltip(x, y);
	}

	_moveWarningTooltip(x, y) {
		const tip = document.getElementById('warning-tooltip');
		if (!tip) return;
		const tw = tip.offsetWidth  || 200;
		const th = tip.offsetHeight || 40;
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		let left = x + 12;
		let top  = y + 12;
		if (left + tw > vw - 8) left = x - tw - 12;
		if (top  + th > vh - 8) top  = y - th - 12;
		tip.style.left = left + 'px';
		tip.style.top  = top  + 'px';
	}

	_hideWarningTooltip() {
		const tip = document.getElementById('warning-tooltip');
		if (tip) tip.style.opacity = '0';
	}

	// R6: destroy() — tooltip DOM'dan kaldır
	destroy() {
		const tip = document.getElementById('warning-tooltip');
		if (tip) tip.remove();
	}

	_renderDropIndicator(layouts, dropIdx) {
		// R1: innerHTML = '' yerine sadece .drop-indicator'ları sil
		this._layerOverlay.querySelectorAll('.drop-indicator').forEach(el => el.remove());

		if (dropIdx === null || !layouts.length) return;

		const ref = layouts[Math.min(dropIdx, layouts.length - 1)];
		const isV = ref.entryDir === 'down' || ref.entryDir === 'up';
		const line = svgEl('line');

		if (isV) {
			const ry = dropIdx < layouts.length ? ref.iy : ref.oy;
			setAttrs(line, { x1: ref.ix - 20, y1: ry - 4, x2: ref.ix + 20, y2: ry - 4, class: 'drop-indicator' });
		} else {
			const rx = dropIdx < layouts.length ? ref.ix : ref.ox;
			setAttrs(line, { x1: rx - 4, y1: ref.iy - 20, x2: rx - 4, y2: ref.iy + 20, class: 'drop-indicator' });
		}

		this._layerOverlay.appendChild(line);
	}

	_clearAll() {
		this._layerSpine.innerHTML   = '';
		this._layerComps.innerHTML   = '';
		this._layerLabels.innerHTML  = '';
		this._layerNodes.innerHTML   = '';
		this._layerOverlay.innerHTML = '';
		this._compEls.clear();
	}

	onCompClick = null;
}