'use strict';

// ═══════════════════════════════════════════════════════════
// SVG RENDERER
// ═══════════════════════════════════════════════════════════

import { svgEl, setAttrs, createNode } from './svg-utils.js';

const ORIGIN_X = 80;
const ORIGIN_Y = 200;
const PAD      = 80;

export function computeLayout(components) {
  if (!components.length) return [];
  const result  = [];
  let cx = ORIGIN_X, cy = ORIGIN_Y;
  let curDir = 'right';

  for (const comp of components) {
    if (comp.type !== 'elbow') {
      comp.entryDir = curDir;
      comp.exitDir  = curDir;
    }

    const ix   = cx, iy = cy;
    const exit = comp.computeExit(ix, iy);
    const { ox, oy, exitDir, ...extra } = exit;

    result.push({ comp, ix, iy, ox, oy, entryDir: comp.entryDir, exitDir, lenPx: comp._lenPx ?? 54, ...extra });

    cx     = ox;
    cy     = oy;
    curDir = exitDir;
  }
  return result;
}

export class SVGRenderer {
  constructor(svgRoot) {
    this.svg      = svgRoot;
    this._compEls = new Map();
    this._init();
  }

  _init() {
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


render(layouts, { selectedId = null, dropIdx = null, showLabels = true, warnings = [] } = {})  {

  
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
    layouts.forEach((l, i) => {
      let line = existing[i];
      if (!line) {
        line = svgEl('line');
        line.classList.add('spine-line');
        this._layerSpine.appendChild(line);
      }
      setAttrs(line, { x1: l.ix, y1: l.iy, x2: l.ox, y2: l.oy });
    });
    while (this._layerSpine.children.length > layouts.length) {
      this._layerSpine.removeChild(this._layerSpine.lastChild);
    }
  }

  _renderComponents(layouts, selectedId, showLabels) {
    const seenIds = new Set();
    // Önemli: Etiket katmanını her renderda temizliyoruz
    // çünkü etiketler dinamik (akış verisi değiştikçe güncellenmeli)
    this._layerLabels.innerHTML = '';

    layouts.forEach(entry => {
      const { comp } = entry;
      seenIds.add(comp.id);


      let g = this._compEls.get(comp.id);
      if (!g) {
        // 1. Yeni eleman oluşturma
        g = comp.createSVG(entry, this._layerLabels);
        g.addEventListener('click', e => {
          e.stopPropagation();
          this.onCompClick?.(comp.id);
        });
        this._layerComps.appendChild(g);
        this._compEls.set(comp.id, g);
      } else {
        // 2. Mevcut elemanı güncelleme (Yeni koordinatlar ve etiketler)
        // Artık updateSVG'yi Base sınıfta tanımlayacağız
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
    // A node — Hat başı (Giriş)
    const first = layouts[0];
    this._layerNodes.appendChild(createNode(first.ix, first.iy, 'A', 'node-inlet'));
    // B node — hat sonu
    const last = layouts[layouts.length - 1];
    this._layerNodes.appendChild(createNode(last.ox, last.oy, 'B', 'node-outlet'));

  }


  _renderWarnings(layouts, warnings) {
    // Önceki uyarı ikonlarını temizle
    this._layerOverlay.querySelectorAll('.warning-node').forEach(el => el.remove());

    warnings.forEach(w => {
      const layout = layouts[w.atIndex];
      if (!layout) return;

      // Bağlantı noktası — mevcut elemanın çıkışı
      const x = layout.ox;
      const y = layout.oy;

      const g = svgEl('g');
      g.classList.add('warning-node');
      g.style.cursor = 'pointer';

      // Arka plan dairesi
      const circle = svgEl('circle');
      setAttrs(circle, { cx: x, cy: y, r: 8, fill: '#ef4444', opacity: '0.9' });

      // Uyarı ikonu (!)
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

      // Hover tooltip
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

  _showWarningTooltip(x, y, message) {
    let tip = document.getElementById('warning-tooltip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'warning-tooltip';
      tip.style.cssText = `
        position: fixed;
        z-index: 9999;
        pointer-events: none;
        background: #1a1a2e;
        border: 1px solid #ef4444;
        border-radius: 5px;
        padding: 7px 11px;
        font-family: 'IBM Plex Mono', monospace;
        font-size: 11px;
        color: #fca5a5;
        max-width: 260px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.5);
        white-space: pre-wrap;
      `;
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


  _renderDropIndicator(layouts, dropIdx) {
    this._layerOverlay.innerHTML = '';
    if (dropIdx === null || !layouts.length) return;

    // dropIdx konumundaki veya son elemanın giriş noktasını referans al
    const ref = layouts[Math.min(dropIdx, layouts.length - 1)];
    const isV = ref.entryDir === 'down' || ref.entryDir === 'up';
    const line = svgEl('line');

    if (isV) {
      // Dikey eleman: yatay çizgi, giriş noktasının üstünde (down) veya altında (up)
      const ry = dropIdx < layouts.length ? ref.iy : ref.oy;
      setAttrs(line, { x1: ref.ix - 20, y1: ry - 4, x2: ref.ix + 20, y2: ry - 4, class: 'drop-indicator' });
    } else {
      // Yatay eleman: dikey çizgi, giriş noktasının solunda
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
