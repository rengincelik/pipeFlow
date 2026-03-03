'use strict';

import { ComponentBase, registerComponentType } from './base.js';
import { svgEl, drawSpec } from '../renderer/svg-utils.js';
import { Units } from '../data/unit-system.js';
import { validateParams } from '../components/validation.js';

const ARM = 10;
const S   = 10;
const T   = 8;

function closedX(cx, cy) {
  return [
	{ tag: 'line', cls: 'valve-closed-x', x1: cx - 7, y1: cy - 7, x2: cx + 7, y2: cy + 7 },
	{ tag: 'line', cls: 'valve-closed-x', x1: cx + 7, y1: cy - 7, x2: cx - 7, y2: cy + 7 },
  ];
}

// Vana tipi başına sabit K değerleri
const VALVE_DEFS = {
  gate:      { name: 'Gate Valve',  K: 0.20 },
  ball:      { name: 'Ball Valve',  K: 0.10 },
  butterfly: { name: 'Butterfly',   K: 0.80 },
  globe:     { name: 'Globe Valve', K: 6.00 },
  check:     { name: 'Check Valve', K: 2.50 },
};


['gate', 'ball', 'butterfly', 'globe', 'check'].forEach(s =>
  registerComponentType('valve', s, () => new ValveComponent(s))
);

// ── PRV ───────────────────────────────────────────────────
export class PRVComponent extends ComponentBase {

  static get CONSTRAINTS() {
	return {
	  P_set_bar: { min: 0.1, max: 100, step: 0.1, unit: 'bar' },
	};
  }

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
	  { tag: 'line', cls: 'valve-stem', x1: ix,       y1: iy,        x2: mx - ARM, y2: iy        },
	  { tag: 'line', cls: 'valve-stem', x1: mx + ARM, y1: iy,        x2: ix + len, y2: iy        },
	];
	const hTris = [
	  { tag: 'polygon', cls: 'valve-tri', points: `${mx - S},${iy - T} ${mx + S},${iy} ${mx - S},${iy + T}` },
	  { tag: 'polygon', cls: 'valve-tri', points: `${mx + S},${iy - T} ${mx - S},${iy} ${mx + S},${iy + T}` },
	];

	const vdStems = [
	  { tag: 'line', cls: 'valve-stem', x1: ix, y1: iy,        x2: ix, y2: dmy - ARM },
	  { tag: 'line', cls: 'valve-stem', x1: ix, y1: dmy + ARM, x2: ix, y2: iy + len  },
	];
	const vdTris = [
	  { tag: 'polygon', cls: 'valve-tri', points: `${ix - T},${dmy - S} ${ix},${dmy + S} ${ix + T},${dmy - S}` },
	  { tag: 'polygon', cls: 'valve-tri', points: `${ix - T},${dmy + S} ${ix},${dmy - S} ${ix + T},${dmy + S}` },
	];

	const vuStems = [
	  { tag: 'line', cls: 'valve-stem', x1: ix, y1: iy,        x2: ix, y2: umy + ARM },
	  { tag: 'line', cls: 'valve-stem', x1: ix, y1: umy - ARM, x2: ix, y2: iy - len  },
	];
	const vuTris = [
	  { tag: 'polygon', cls: 'valve-tri', points: `${ix - T},${umy - S} ${ix},${umy + S} ${ix + T},${umy - S}` },
	  { tag: 'polygon', cls: 'valve-tri', points: `${ix - T},${umy + S} ${ix},${umy - S} ${ix + T},${umy + S}` },
	];

	return {
	  right: {
		prims: [
		  ...hStems, ...hTris,
		  { tag: 'path', cls: 'prv-spring', d: `M${mx - 6},${iy - 10} Q${mx},${iy - 22} ${mx + 6},${iy - 10}` },
		],
		labels: [
		  { x: mx, y: iy - 26, anchor: 'middle', cls: 'lbl lbl-name', text: 'PRV'  },
		  { x: mx, y: iy + 28, anchor: 'middle', cls: 'lbl lbl-pset', text: pset   },
		],
	  },
	  down: {
		prims: [
		  ...vdStems, ...vdTris,
		  { tag: 'path', cls: 'prv-spring', d: `M${ix + 10},${dmy - 6} Q${ix + 22},${dmy} ${ix + 10},${dmy + 6}` },
		],
		labels: [
		  { x: ix + 28, y: dmy - 8, anchor: 'start', cls: 'lbl lbl-name', text: 'PRV'  },
		  { x: ix + 28, y: dmy + 6, anchor: 'start', cls: 'lbl lbl-pset', text: pset   },
		],
	  },
	  up: {
		prims: [
		  ...vuStems, ...vuTris,
		  { tag: 'path', cls: 'prv-spring', d: `M${ix + 10},${umy - 6} Q${ix + 22},${umy} ${ix + 10},${umy + 6}` },
		],
		labels: [
		  { x: ix + 28, y: umy - 8, anchor: 'start', cls: 'lbl lbl-name', text: 'PRV'  },
		  { x: ix + 28, y: umy + 6, anchor: 'start', cls: 'lbl lbl-pset', text: pset   },
		],
	  },
	};
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
	return [
	  this.row('Diameter',
		this.value(`${this.diameter_mm} mm`)),

	  // input — min/max/step CONSTRAINTS'ten otomatik gelir
	  this.row('P set',
		this.input('P_set_bar', this.P_set_bar), 'bar'),
	].join('');
  }

  serialize() {
	return { ...super.serialize(), P_set_bar: this.P_set_bar };
  }
}

registerComponentType('valve', 'prv', () => new PRVComponent());
