'use strict';

// ═══════════════════════════════════════════════════════════
// SVG UTILITIES — DOM tabanlı, string concat yok
// ═══════════════════════════════════════════════════════════

export const SVG_NS = 'http://www.w3.org/2000/svg';

/** SVG namespace'inde element yarat */
export function svgEl(tag) {
  return document.createElementNS(SVG_NS, tag);
}

/** Toplu attribute set */
export function setAttrs(el, attrs) {
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    el.setAttribute(k, v);
  }
}

/** `<g>` içindeki ilk `.lbl-vel` gibi class'ı bul, yoksa yarat */
export function getOrCreate(parent, tag, cls) {
  let el = parent.querySelector(`.${cls}`);
  if (!el) {
    el = svgEl(tag);
    el.classList.add(cls);
    parent.appendChild(el);
  }
  return el;
}

/** Düzlem kesitimleri için helper: iki sayı arasında lerp */
export function lerpN(a, b, t) { return a + (b - a) * t; }

/** Node (A/B nokta) elementi yarat */
export function createNode(x, y, label, cssClass) {
  const g = svgEl('g');
  g.classList.add('pipeline-node', cssClass);

  const circle = svgEl('circle');
  setAttrs(circle, { cx: x, cy: y, r: 6 });
  g.appendChild(circle);

  const text = svgEl('text');
  setAttrs(text, { x, y: y - 14, 'text-anchor': 'middle' });
  text.textContent = label;
  g.appendChild(text);

  return g;
}
