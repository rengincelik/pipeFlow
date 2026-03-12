'use strict';

// S5: computeLayout buraya taşındı — pipeline-store.js svg-renderer.js'e bağımlı olmamalı
// Önceki konum: renderer/svg-renderer.js
// Bu dosyayı import edenler: state/pipeline-store.js, renderer/svg-renderer.js

const ORIGIN_X = 80;
const ORIGIN_Y = 200;

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
