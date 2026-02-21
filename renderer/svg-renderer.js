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

  render(layouts, { selectedId = null, dropIdx = null, showLabels = true } = {}) {
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
    this._layerLabels.innerHTML = '';

    layouts.forEach(entry => {
      const { comp } = entry;
      seenIds.add(comp.id);
      comp._selected = comp.id === selectedId;

      let g = this._compEls.get(comp.id);
      if (!g) {
        g = comp.createSVG(entry, this._layerLabels);
        g.classList.toggle('labels-on', showLabels);
        g.addEventListener('click', e => {
          e.stopPropagation();
          this.onCompClick?.(comp.id);
        });
        this._layerComps.appendChild(g);
        this._compEls.set(comp.id, g);
      } else {
        g.classList.toggle('labels-on', showLabels);
        comp.updateSVG(g, entry, this._layerLabels);
      }
    });

    for (const [id, g] of this._compEls) {
      if (!seenIds.has(id)) { g.remove(); this._compEls.delete(id); }
    }
  }

  _renderNodes(layouts) {
    this._layerNodes.innerHTML = '';
    if (!layouts.length) return;
    const first = layouts[0], last = layouts[layouts.length - 1];
    this._layerNodes.appendChild(createNode(first.ix, first.iy, 'A', 'node-inlet'));
    this._layerNodes.appendChild(createNode(last.ox, last.oy, 'B', 'node-outlet'));
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
