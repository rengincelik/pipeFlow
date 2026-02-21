'use strict';

import { ComponentBase, registerComponentType } from './base.js';
import { reynolds, hLoss_fitting, G } from '../core/hydraulics.js';
import { svgEl } from '../renderer/svg-utils.js';
import { drawSpec } from '../renderer/draw-spec.js';

const ARM = 10;  // stemden merkeze
const S   = 10;  // üçgen yatay
const T   = 8;   // üçgen dikey

// Kapalı X primitifleri — merkez cx,cy
function closedX(cx, cy) {
  return [
    { tag: 'line', cls: 'valve-closed-x', x1: cx-7, y1: cy-7, x2: cx+7, y2: cy+7 },
    { tag: 'line', cls: 'valve-closed-x', x1: cx+7, y1: cy-7, x2: cx-7, y2: cy+7 },
  ];
}

export class ValveComponent extends ComponentBase {
  constructor(subtype = 'gate') {
    super('valve', subtype);
    const defs = {
      gate:      { name: 'Gate Valve',  K: 0.20 },
      ball:      { name: 'Ball Valve',  K: 0.10 },
      butterfly: { name: 'Butterfly',   K: 0.80 },
      globe:     { name: 'Globe Valve', K: 6.00 },
      check:     { name: 'Check Valve', K: 2.50 },
    };
    const d    = defs[subtype] ?? defs.gate;
    this.name  = d.name;
    this.K     = d.K;
    this.open  = true;
    this._lenPx = 54;
  }

  shapeSpec(ix, iy) {
    const len     = this._lenPx;
    const mx      = ix + len / 2;
    const my      = iy;
    const nameTxt = this.open ? this.name : 'CLOSED';
    const nameCls = `lbl ${this.open ? 'lbl-name' : 'lbl-closed'}`;
    const kTxt    = this.open ? `K=${this.K}` : null;

    // Yatay stem prims (merkeze ARM px kala)
    const hStems = [
      { tag: 'line', cls: 'valve-stem', x1: ix,       y1: iy, x2: mx - ARM, y2: my },
      { tag: 'line', cls: 'valve-stem', x1: mx + ARM, y1: my, x2: ix + len, y2: iy },
    ];
    // Yatay üçgenler (bowtie)
    const hTris = [
      { tag: 'polygon', cls: 'valve-tri', points: `${mx-S},${my-T} ${mx+S},${my} ${mx-S},${my+T}` },
      { tag: 'polygon', cls: 'valve-tri', points: `${mx+S},${my-T} ${mx-S},${my} ${mx+S},${my+T}` },
    ];

    // Dikey down: giriş üstte (ix,iy), merkez (ix, iy+len/2)
    const dmy = iy + len / 2;
    const vdStems = [
      { tag: 'line', cls: 'valve-stem', x1: ix, y1: iy,       x2: ix, y2: dmy - ARM },
      { tag: 'line', cls: 'valve-stem', x1: ix, y1: dmy + ARM, x2: ix, y2: iy + len },
    ];
    const vdTris = [
      { tag: 'polygon', cls: 'valve-tri', points: `${ix-T},${dmy-S} ${ix},${dmy+S} ${ix+T},${dmy-S}` },
      { tag: 'polygon', cls: 'valve-tri', points: `${ix-T},${dmy+S} ${ix},${dmy-S} ${ix+T},${dmy+S}` },
    ];

    // Dikey up: giriş altta (ix,iy), merkez (ix, iy-len/2)
    const umy = iy - len / 2;
    const vuStems = [
      { tag: 'line', cls: 'valve-stem', x1: ix, y1: iy,       x2: ix, y2: umy + ARM },
      { tag: 'line', cls: 'valve-stem', x1: ix, y1: umy - ARM, x2: ix, y2: iy - len },
    ];
    const vuTris = [
      { tag: 'polygon', cls: 'valve-tri', points: `${ix-T},${umy-S} ${ix},${umy+S} ${ix+T},${umy-S}` },
      { tag: 'polygon', cls: 'valve-tri', points: `${ix-T},${umy+S} ${ix},${umy-S} ${ix+T},${umy+S}` },
    ];

    return {
      right: {
        prims: [...hStems, ...hTris, ...(this.open ? [] : closedX(mx, my))],
        labels: [
          { x: mx, y: my - 22, anchor: 'middle', cls: nameCls,        text: nameTxt },
          { x: mx, y: my + 26, anchor: 'middle', cls: 'lbl lbl-k',    text: kTxt    },
        ],
      },
      down: {
        prims: [...vdStems, ...vdTris, ...(this.open ? [] : closedX(ix, dmy))],
        labels: [
          { x: ix + 18, y: dmy - 6, anchor: 'start', cls: nameCls,     text: nameTxt },
          { x: ix + 18, y: dmy + 8, anchor: 'start', cls: 'lbl lbl-k', text: kTxt    },
        ],
      },
      up: {
        prims: [...vuStems, ...vuTris, ...(this.open ? [] : closedX(ix, umy))],
        labels: [
          { x: ix + 18, y: umy - 6, anchor: 'start', cls: nameCls,     text: nameTxt },
          { x: ix + 18, y: umy + 8, anchor: 'start', cls: 'lbl lbl-k', text: kTxt    },
        ],
      },
    };
  }

  calcHydraulics(Q_m3s, fluid) {
    const D  = this.diameter_mm / 1000;
    const v  = Q_m3s / (Math.PI * D * D / 4);
    const nu = (fluid.mu_mPas / 1000) / fluid.rho;
    const Re = reynolds(v, D, nu);
    if (!this.open) {
      this.result = { v: 0, Re, blocked: true, dP_Pa: Infinity, dP_bar: Infinity, hf: { total: Infinity } };
      return this.result;
    }
    const hm    = hLoss_fitting(this.K, v);
    const dP_Pa = fluid.rho * G * hm;
    this.result = { v, Re, blocked: false,
      hf: { total: hm, fittings: hm, friction: 0, elevation: 0, transition: 0 },
      dP_Pa, dP_bar: dP_Pa / 1e5 };
    return this.result;
  }

  createSVG(layout, labelLayer) {
    const g = svgEl('g');
    g.dataset.compId = this.id;
    g.classList.add('component', 'valve', `valve-${this.subtype}`);
    if (!this.open) g.classList.add('valve-closed');
    drawSpec(g, labelLayer, this.shapeSpec(layout.ix, layout.iy)[layout.entryDir]);
    return g;
  }

  updateSVG(g, layout, labelLayer) {
    super.updateSVG(g, layout);
    g.classList.toggle('valve-closed', !this.open);
    while (g.firstChild) g.removeChild(g.firstChild);
    drawSpec(g, labelLayer, this.shapeSpec(layout.ix, layout.iy)[layout.entryDir]);
  }

  renderPropsHTML() {
    const VALVE_TYPES = [
      { subtype: 'gate',      label: 'Gate Valve',  K: 0.20 },
      { subtype: 'ball',      label: 'Ball Valve',  K: 0.10 },
      { subtype: 'butterfly', label: 'Butterfly',   K: 0.80 },
      { subtype: 'globe',     label: 'Globe Valve', K: 6.00 },
      { subtype: 'check',     label: 'Check Valve', K: 2.50 },
      { subtype: 'prv',       label: 'PRV',         K: null  },
    ];
    const typeOpts = VALVE_TYPES.map(t =>
      `<option value="${t.subtype}" ${this.subtype === t.subtype ? 'selected' : ''}>${t.label}</option>`
    ).join('');
    const btn = `<button class="valve-toggle ${this.open ? 'open' : 'closed'}" data-action="toggle-valve">
      ${this.open ? '⬤ OPEN' : '◯ CLOSED'}</button>`;
    return `
      <div class="pr"><span class="pl">Type</span>
        <select class="p-select" data-action="change-valve-type">${typeOpts}</select></div>
      <div class="pr"><span class="pl">Diameter</span><span class="pv">${this.diameter_mm} mm</span></div>
      <div class="pr"><span class="pl">K value</span><span class="pv">${this.K}</span></div>
      <div class="pr"><span class="pl">State</span>${btn}</div>`;
  }

  serialize() { return { ...super.serialize(), open: this.open, K: this.K }; }

  applySerializedData(d) {
    super.applySerializedData(d);
    if (d.K    != null) this.K    = d.K;
    if (d.open != null) this.open = d.open;
    return this;
  }
}

['gate', 'ball', 'butterfly', 'globe', 'check'].forEach(s =>
  registerComponentType('valve', s, () => new ValveComponent(s))
);

// ── PRV ───────────────────────────────────────────────────
export class PRVComponent extends ComponentBase {
  constructor() {
    super('valve', 'prv');
    this.name      = 'PRV';
    this.P_set_bar = 1.0;
    this._lenPx    = 54;
  }

  shapeSpec(ix, iy) {
    const len  = this._lenPx;
    const mx   = ix + len / 2;
    const dmy  = iy + len / 2;
    const umy  = iy - len / 2;
    const pset = `P≤${this.P_set_bar}bar`;

    const hStems = [
      { tag: 'line', cls: 'valve-stem', x1: ix, y1: iy, x2: mx - ARM, y2: iy },
      { tag: 'line', cls: 'valve-stem', x1: mx + ARM, y1: iy, x2: ix + len, y2: iy },
    ];
    const hTris = [
      { tag: 'polygon', cls: 'valve-tri', points: `${mx-S},${iy-T} ${mx+S},${iy} ${mx-S},${iy+T}` },
      { tag: 'polygon', cls: 'valve-tri', points: `${mx+S},${iy-T} ${mx-S},${iy} ${mx+S},${iy+T}` },
    ];

    const vdStems = [
      { tag: 'line', cls: 'valve-stem', x1: ix, y1: iy,        x2: ix, y2: dmy - ARM },
      { tag: 'line', cls: 'valve-stem', x1: ix, y1: dmy + ARM, x2: ix, y2: iy + len  },
    ];
    const vdTris = [
      { tag: 'polygon', cls: 'valve-tri', points: `${ix-T},${dmy-S} ${ix},${dmy+S} ${ix+T},${dmy-S}` },
      { tag: 'polygon', cls: 'valve-tri', points: `${ix-T},${dmy+S} ${ix},${dmy-S} ${ix+T},${dmy+S}` },
    ];

    const vuStems = [
      { tag: 'line', cls: 'valve-stem', x1: ix, y1: iy,        x2: ix, y2: umy + ARM },
      { tag: 'line', cls: 'valve-stem', x1: ix, y1: umy - ARM, x2: ix, y2: iy - len  },
    ];
    const vuTris = [
      { tag: 'polygon', cls: 'valve-tri', points: `${ix-T},${umy-S} ${ix},${umy+S} ${ix+T},${umy-S}` },
      { tag: 'polygon', cls: 'valve-tri', points: `${ix-T},${umy+S} ${ix},${umy-S} ${ix+T},${umy+S}` },
    ];

    return {
      right: {
        prims: [
          ...hStems, ...hTris,
          { tag: 'path', cls: 'prv-spring', d: `M${mx-6},${iy-10} Q${mx},${iy-22} ${mx+6},${iy-10}` },
        ],
        labels: [
          { x: mx, y: iy - 26, anchor: 'middle', cls: 'lbl lbl-name', text: 'PRV'  },
          { x: mx, y: iy + 28, anchor: 'middle', cls: 'lbl lbl-pset', text: pset   },
        ],
      },
      down: {
        prims: [
          ...vdStems, ...vdTris,
          { tag: 'path', cls: 'prv-spring', d: `M${ix+10},${dmy-6} Q${ix+22},${dmy} ${ix+10},${dmy+6}` },
        ],
        labels: [
          { x: ix + 28, y: dmy - 8, anchor: 'start', cls: 'lbl lbl-name', text: 'PRV'  },
          { x: ix + 28, y: dmy + 6, anchor: 'start', cls: 'lbl lbl-pset', text: pset   },
        ],
      },
      up: {
        prims: [
          ...vuStems, ...vuTris,
          { tag: 'path', cls: 'prv-spring', d: `M${ix+10},${umy-6} Q${ix+22},${umy} ${ix+10},${umy+6}` },
        ],
        labels: [
          { x: ix + 28, y: umy - 8, anchor: 'start', cls: 'lbl lbl-name', text: 'PRV'  },
          { x: ix + 28, y: umy + 6, anchor: 'start', cls: 'lbl lbl-pset', text: pset   },
        ],
      },
    };
  }

  calcHydraulics(Q_m3s, fluid) {
    const D  = this.diameter_mm / 1000;
    const v  = Q_m3s / (Math.PI * D * D / 4);
    const nu = (fluid.mu_mPas / 1000) / fluid.rho;
    const Re = reynolds(v, D, nu);
    this.result = { v, Re, P_set_bar: this.P_set_bar, isPRV: true,
                    dP_Pa: 0, dP_bar: 0, hf: { total: 0 } };
    return this.result;
  }

  createSVG(layout, labelLayer) {
    const g = svgEl('g');
    g.dataset.compId = this.id;
    g.classList.add('component', 'valve', 'valve-prv');
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
      <div class="pr"><span class="pl">Diameter</span><span class="pv">${this.diameter_mm} mm</span></div>
      <div class="pr"><span class="pl">P set</span>
        <input class="p-input" type="number" value="${this.P_set_bar}" step="0.1" min="0" data-prop="P_set_bar">
        <span class="pu">bar</span></div>`;
  }

  serialize() { return { ...super.serialize(), P_set_bar: this.P_set_bar }; }
}

registerComponentType('valve', 'prv', () => new PRVComponent());
