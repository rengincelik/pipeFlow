'use strict';

// ═══════════════════════════════════════════════════════════
// DRAW-SPEC — { prims, labels } → SVG DOM
// Component'ler ve renderer bu fonksiyonu import eder.
// ═══════════════════════════════════════════════════════════

import { svgEl, setAttrs } from './svg-utils.js';

/**
 * spec.prims  → g'ye ekle
 * spec.labels → labelLayer'a ekle (asla transform almaz)
 *
 * Prim format: { tag, cls, ...svgAttrs }
 * Label format: { x, y, anchor, cls, text }  — text null/'' ise atlanır
 */
export function drawSpec(g, labelLayer, spec) {
  for (const p of spec.prims ?? []) {
    const { tag, cls, ...attrs } = p;
    const el = svgEl(tag);
    if (cls) el.setAttribute('class', cls);
    setAttrs(el, attrs);
    g.appendChild(el);
  }

  for (const l of spec.labels ?? []) {
    if (!l.text) continue;
    const el = svgEl('text');
    el.setAttribute('class', l.cls ?? 'lbl');
    el.setAttribute('x',            l.x);
    el.setAttribute('y',            l.y);
    el.setAttribute('text-anchor',  l.anchor ?? 'middle');
    el.textContent = l.text;
    labelLayer.appendChild(el);
  }
}
