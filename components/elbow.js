'use strict';

import { ComponentBase, registerComponentType, DIR_VEC } from './base.js';
import { reynolds, hLoss_fitting, G } from '../core/hydraulics.js';
import { svgEl } from '../renderer/svg-utils.js';
import { drawSpec } from '../renderer/draw-spec.js';

const ARM = 27;

export class ElbowComponent extends ComponentBase {
  constructor(subtype = 'rd') {
    super('elbow', subtype);
    this.name   = 'Elbow';
    this.K      = 0.90;
    this._lenPx = ARM;
    const dirs  = { rd: ['right','down'], ru: ['right','up'],
                    ur: ['up','right'],   dr: ['down','right'] };
    [this.entryDir, this.exitDir] = dirs[subtype] ?? ['right', 'down'];
  }

  computeExit(ix, iy) {
    const eVec    = DIR_VEC[this.entryDir];
    const xVec    = DIR_VEC[this.exitDir];
    const cornerX = ix + eVec.dx * ARM;
    const cornerY = iy + eVec.dy * ARM;
    return { ox: cornerX + xVec.dx * ARM, oy: cornerY + xVec.dy * ARM,
             exitDir: this.exitDir, cornerX, cornerY };
  }

  // Elbow world koordinatlarla çalışır — shapeSpec layout'un tamamını alır
  shapeSpec(layout) {
    const { ix, iy, ox, oy, cornerX, cornerY } = layout;
    const cx = cornerX ?? (ix === ox ? ix : ox);
    const cy = cornerY ?? (iy === oy ? iy : oy);

    return {
      prims: [
        { tag: 'rect', cls: 'elbow-hit',
          x: Math.min(ix,ox)-4, y: Math.min(iy,oy)-4,
          width: Math.abs(ox-ix)+8||16, height: Math.abs(oy-iy)+8||16 },
        { tag: 'path', cls: 'elbow-path', d: `M ${ix} ${iy} Q ${cx} ${cy} ${ox} ${oy}` },
      ],
      labels: [
        { x: cx, y: cy - 10, anchor: 'middle', cls: 'lbl lbl-k', text: `K=${this.K}` },
      ],
    };
  }

  calcHydraulics(Q_m3s, fluid) {
    const D  = this.diameter_mm / 1000;
    const v  = Q_m3s / (Math.PI * D * D / 4);
    const nu = (fluid.mu_mPas / 1000) / fluid.rho;
    const Re = reynolds(v, D, nu);
    const hm    = hLoss_fitting(this.K, v);
    const dP_Pa = fluid.rho * G * hm;
    this.result = { v, Re,
      hf: { total: hm, fittings: hm, friction: 0, elevation: 0, transition: 0 },
      dP_Pa, dP_bar: dP_Pa / 1e5 };
    return this.result;
  }

  createSVG(layout, labelLayer) {
    const g = svgEl('g');
    g.dataset.compId = this.id;
    g.classList.add('component', 'elbow');
    drawSpec(g, labelLayer, this.shapeSpec(layout));
    return g;
  }

  updateSVG(g, layout, labelLayer) {
    super.updateSVG(g, layout);
    while (g.firstChild) g.removeChild(g.firstChild);
    drawSpec(g, labelLayer, this.shapeSpec(layout));
  }

  renderPropsHTML() {
    return `
      <div class="pr"><span class="pl">Turn</span>
        <span class="pv">${this.entryDir} → ${this.exitDir}</span></div>
      <div class="pr"><span class="pl">K value</span>
        <span class="pv">${this.K}</span></div>
      <div class="pr"><span class="pl">Diameter</span>
        <span class="pv">${this.diameter_mm} mm</span></div>`;
  }
}

['rd', 'ru', 'ur', 'dr'].forEach(s =>
  registerComponentType('elbow', s, () => new ElbowComponent(s))
);
