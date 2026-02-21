'use strict';

import { ComponentBase, registerComponentType } from './base.js';
import { reynolds, G } from '../core/hydraulics.js';
import { svgEl } from '../renderer/svg-utils.js';
import { drawSpec } from '../renderer/draw-spec.js';

const R = 18;  // daire yarıçapı

export class PumpComponent extends ComponentBase {
  constructor() {
    super('pump', 'centrifugal');
    this.name       = 'Centrifugal';
    this.head_m     = 20;
    this.efficiency = 0.75;
    this._lenPx     = 64;
  }

  shapeSpec(ix, iy) {
    const len  = this._lenPx;
    const head = `+${this.head_m}m`;

    // Yatay: merkez (ix+len/2, iy)
    const mx = ix + len / 2;
    // Dikey down: merkez (ix, iy+len/2)
    const dmy = iy + len / 2;
    // Dikey up: merkez (ix, iy-len/2)
    const umy = iy - len / 2;

    return {
      right: {
        prims: [
          { tag: 'line',   cls: 'pump-stem',   x1: ix,      y1: iy, x2: mx - R, y2: iy },
          { tag: 'line',   cls: 'pump-stem',   x1: mx + R,  y1: iy, x2: ix+len, y2: iy },
          { tag: 'circle', cls: 'pump-circle', cx: mx, cy: iy, r: R },
          { tag: 'path',   cls: 'pump-blade',  d: `M${mx},${iy} L${mx-5},${iy-7} L${mx+7},${iy-3} Z` },
        ],
        labels: [
          { x: mx, y: iy - R - 10, anchor: 'middle', cls: 'lbl lbl-pump', text: 'PUMP' },
          { x: mx, y: iy + R + 14, anchor: 'middle', cls: 'lbl lbl-head', text: head   },
        ],
      },

      down: {
        prims: [
          { tag: 'line',   cls: 'pump-stem',   x1: ix, y1: iy,        x2: ix, y2: dmy - R },
          { tag: 'line',   cls: 'pump-stem',   x1: ix, y1: dmy + R,   x2: ix, y2: iy+len  },
          { tag: 'circle', cls: 'pump-circle', cx: ix, cy: dmy, r: R },
          { tag: 'path',   cls: 'pump-blade',  d: `M${ix},${dmy} L${ix-7},${dmy-5} L${ix+3},${dmy+7} Z` },
        ],
        labels: [
          { x: ix + R + 8, y: dmy - 6, anchor: 'start', cls: 'lbl lbl-pump', text: 'PUMP' },
          { x: ix + R + 8, y: dmy + 8, anchor: 'start', cls: 'lbl lbl-head', text: head   },
        ],
      },

      up: {
        prims: [
          { tag: 'line',   cls: 'pump-stem',   x1: ix, y1: iy,        x2: ix, y2: umy + R },
          { tag: 'line',   cls: 'pump-stem',   x1: ix, y1: umy - R,   x2: ix, y2: iy-len  },
          { tag: 'circle', cls: 'pump-circle', cx: ix, cy: umy, r: R },
          { tag: 'path',   cls: 'pump-blade',  d: `M${ix},${umy} L${ix-7},${umy+5} L${ix+3},${umy-7} Z` },
        ],
        labels: [
          { x: ix + R + 8, y: umy - 6, anchor: 'start', cls: 'lbl lbl-pump', text: 'PUMP' },
          { x: ix + R + 8, y: umy + 8, anchor: 'start', cls: 'lbl lbl-head', text: head   },
        ],
      },
    };
  }

  calcHydraulics(Q_m3s, fluid) {
    const D    = this.diameter_mm / 1000;
    const v    = Q_m3s / (Math.PI * D * D / 4);
    const nu   = (fluid.mu_mPas / 1000) / fluid.rho;
    const Re   = reynolds(v, D, nu);
    const addP = fluid.rho * G * this.head_m / 1e5;
    this.result = { v, Re, dP_bar: -addP, dP_Pa: -addP * 1e5,
                    head_m: this.head_m, isPump: true, hf: { total: -this.head_m } };
    return this.result;
  }

  createSVG(layout, labelLayer) {
    const g = svgEl('g');
    g.dataset.compId = this.id;
    g.classList.add('component', 'pump');
    drawSpec(g, labelLayer, this.shapeSpec(layout.ix, layout.iy)[layout.entryDir]);
    return g;
  }

  updateSVG(g, layout, labelLayer) {
    super.updateSVG(g, layout);
    while (g.firstChild) g.removeChild(g.firstChild);
    drawSpec(g, labelLayer, this.shapeSpec(layout.ix, layout.iy)[layout.entryDir]);
  }

  renderPropsHTML() {
    return `
      <div class="pr"><span class="pl">Head</span>
        <input class="p-input" type="number" value="${this.head_m}" step="1" data-prop="head_m">
        <span class="pu">m</span></div>
      <div class="pr"><span class="pl">Efficiency</span>
        <input class="p-input" type="number" value="${this.efficiency}" step="0.01" min="0.1" max="1" data-prop="efficiency">
      </div>`;
  }

  serialize() { return { ...super.serialize(), head_m: this.head_m, efficiency: this.efficiency }; }
}

registerComponentType('pump', 'centrifugal', () => new PumpComponent());
