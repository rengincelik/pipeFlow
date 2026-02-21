'use strict';

import { ComponentBase, registerComponentType } from './base.js';
import { calcSegment } from '../core/hydraulics.js';
import { svgEl } from '../renderer/svg-utils.js';
import { drawSpec } from '../renderer/draw-spec.js';
import { DN_LIST, MATERIALS } from '../data/catalogs.js';

const PX_PER_M = 18;
const MIN_PX   = 40;
const HALF     = 9;

export class PipeComponent extends ComponentBase {
  constructor() {
    super('pipe', 'pipe');
    this.name     = 'Pipe';
    this.entryDir = 'right';
    this.exitDir  = 'right';
  }

  get _lenPx() { return Math.max(MIN_PX, (this._overrides.length_m ?? 5) * PX_PER_M); }

  get dz_m() {
    const len = this._overrides.length_m ?? 5;
    if (this.entryDir === 'down') return  len;
    if (this.entryDir === 'up')   return -len;
    return 0;
  }

  // ── Şekil tanımları — world coord, yöne göre ─────────
  shapeSpec(ix, iy) {
    const len = this._lenPx;
    const mx  = ix + len / 2;
    const dim = `⌀${this.diameter_mm}mm`;
    const lbl = `${this._overrides.length_m ?? 5}m`;
    const vel = this.result?.v != null ? `v=${this.result.v.toFixed(2)}m/s` : null;

    return {
      right: {
        prims: [
          { tag: 'rect',    cls: 'pipe-body',      x: ix, y: iy - HALF, width: len, height: HALF * 2, rx: 1 },
          { tag: 'line',    cls: 'pipe-centerline', x1: ix + 4, y1: iy, x2: ix + len - 4, y2: iy },
          { tag: 'polygon', cls: 'pipe-arrow',      points: `${mx},${iy-3} ${mx+5},${iy} ${mx},${iy+3}` },
        ],
        labels: [
          { x: mx, y: iy - 22, anchor: 'middle', cls: 'lbl lbl-dim', text: dim },
          { x: mx, y: iy - 12, anchor: 'middle', cls: 'lbl lbl-len', text: lbl },
          { x: mx, y: iy -  2, anchor: 'middle', cls: 'lbl lbl-vel', text: vel },
        ],
      },

      down: {
        prims: [
          { tag: 'rect',    cls: 'pipe-body',      x: ix - HALF, y: iy, width: HALF * 2, height: len, rx: 1 },
          { tag: 'line',    cls: 'pipe-centerline', x1: ix, y1: iy + 4, x2: ix, y2: iy + len - 4 },
          { tag: 'polygon', cls: 'pipe-arrow',      points: `${ix-3},${iy+mx} ${ix},${iy+mx+5} ${ix+3},${iy+mx}` },
        ],
        labels: [
          { x: ix + 14, y: iy + len/2 - 8, anchor: 'start', cls: 'lbl lbl-dim', text: dim },
          { x: ix + 14, y: iy + len/2 + 2, anchor: 'start', cls: 'lbl lbl-len', text: lbl },
          { x: ix + 14, y: iy + len/2 +12, anchor: 'start', cls: 'lbl lbl-vel', text: vel },
        ],
      },

      up: {
        prims: [
          { tag: 'rect',    cls: 'pipe-body',      x: ix - HALF, y: iy - len, width: HALF * 2, height: len, rx: 1 },
          { tag: 'line',    cls: 'pipe-centerline', x1: ix, y1: iy - len + 4, x2: ix, y2: iy - 4 },
          { tag: 'polygon', cls: 'pipe-arrow',      points: `${ix-3},${iy-mx} ${ix},${iy-mx-5} ${ix+3},${iy-mx}` },
        ],
        labels: [
          { x: ix + 14, y: iy - len/2 - 8, anchor: 'start', cls: 'lbl lbl-dim', text: dim },
          { x: ix + 14, y: iy - len/2 + 2, anchor: 'start', cls: 'lbl lbl-len', text: lbl },
          { x: ix + 14, y: iy - len/2 +12, anchor: 'start', cls: 'lbl lbl-vel', text: vel },
        ],
      },
    };
  }

  calcHydraulics(Q_m3s, fluid, prev = null) {
    const length_m = this._overrides.length_m ?? 5;
    const prevSeg  = prev ? { diameter_mm: prev.outDiameter_mm } : null;
    this.result = calcSegment(
      { diameter_mm: this.diameter_mm, length_m, dz_m: this.dz_m, eps_mm: this.eps_mm, K_fittings: 0 },
      Q_m3s, fluid, prevSeg
    );
    this.result.P_out = null;
    return this.result;
  }

  createSVG(layout, labelLayer) {
    const g = svgEl('g');
    g.dataset.compId = this.id;
    g.classList.add('component', 'pipe');
    const spec = this.shapeSpec(layout.ix, layout.iy);
    drawSpec(g, labelLayer, spec[layout.entryDir]);
    return g;
  }

  updateSVG(g, layout, labelLayer) {
    super.updateSVG(g, layout);
    while (g.firstChild) g.removeChild(g.firstChild);
    const spec = this.shapeSpec(layout.ix, layout.iy);
    drawSpec(g, labelLayer, spec[layout.entryDir]);
  }

  renderPropsHTML() {
    const d       = this.diameter_mm;
    const l       = this._overrides.length_m ?? 5;
    const matId   = this._overrides.material_id ?? this.resolve('material_id');
    const dnOpts  = DN_LIST.map(x =>
      `<option value="${x.d}" ${Math.abs(x.d - d) < 1 ? 'selected' : ''}>${x.dn} (${x.d}mm)</option>`
    ).join('');
    const matOpts = MATERIALS.map(m =>
      `<option value="${m.id}" ${m.id === matId ? 'selected' : ''}>${m.name}</option>`
    ).join('');
    return `
      <div class="pr"><span class="pl">Diameter</span>
        <select class="p-select" data-prop="diameter_mm">${dnOpts}</select></div>
      <div class="pr"><span class="pl">Length</span>
        <input class="p-input" type="number" value="${l}" step="0.5" min="0.1" data-prop="length_m">
        <span class="pu">m</span></div>
      <div class="pr"><span class="pl">dz (auto)</span>
        <span class="pv dim">${this.dz_m.toFixed(2)}</span><span class="pu">m</span></div>
      <div class="pr"><span class="pl">Material</span>
        <select class="p-select" data-prop="material_id">${matOpts}</select></div>
      <div class="pr"><span class="pl">Roughness ε</span>
        <span class="pv dim">${this.eps_mm}</span><span class="pu">mm</span></div>`;
  }

  serialize() { return { ...super.serialize(), length_m: this._overrides.length_m ?? 5 }; }
}

registerComponentType('pipe', 'pipe', () => new PipeComponent());
