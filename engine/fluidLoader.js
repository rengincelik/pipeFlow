/**
 * fluidLoader.js
 * JSON metadata + CSV tablo yükler.
 * Dışarıya: loadFluid(jsonPath, csvPath) → FluidModel nesnesi
 *
 * FluidModel.getProps(T_C) → { rho, mu, nu, cp, k, Pr, warnings[] }
 */

import { cubicSplineInterp } from './interpolate.js';

// ── CSV PARSER ───────────────────────────────────────────
/**
 * Basit CSV parser.
 * # ile başlayan satırlar yorum sayılır.
 * İlk yorum-olmayan satır header'dır.
 * @returns {{ headers: string[], rows: object[] }}
 */
function parseCSV(text) {
  const lines = text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('#'));

  if (lines.length < 2) throw new Error('CSV: en az header + 1 satır veri gerekli');

  const headers = lines[0].split(',').map(h => h.trim());

  const rows = lines.slice(1).map((line, i) => {
    const parts = line.split(',');
    if (parts.length !== headers.length)
      throw new Error(`CSV satır ${i + 2}: ${parts.length} sütun beklenen ${headers.length}`);
    const row = {};
    headers.forEach((h, j) => { row[h] = parseFloat(parts[j]); });
    return row;
  });

  return { headers, rows };
}

// ── JSON VALIDATOR ────────────────────────────────────────
const REQUIRED_JSON_KEYS = ['id', 'name', 'valid_range', 'polynomial_fallback'];

function validateJSON(meta) {
  const missing = REQUIRED_JSON_KEYS.filter(k => !(k in meta));
  if (missing.length > 0)
    throw new Error(`Fluid JSON eksik alanlar: ${missing.join(', ')}`);

  const pb = meta.polynomial_fallback;
  if (!pb.density || !pb.dynamic_viscosity)
    throw new Error('polynomial_fallback içinde density ve dynamic_viscosity zorunlu');
}

// ── POLYNOMIAL EVALUATORS ─────────────────────────────────
function evalPolynomial(coeffs, T) {
  // ρ = a0 + a1*T + a2*T² + ...
  return coeffs.reduce((acc, a, i) => acc + a * Math.pow(T, i), 0);
}

function evalArrhenius(A, B, C, T_C) {
  // μ = A * 10^(B / (T + 273.15 - C))
  return A * Math.pow(10, B / (T_C + 273.15 - C));
}

// ── FLUID MODEL ───────────────────────────────────────────
class FluidModel {
  /**
   * @param {object} meta  - water.json içeriği
   * @param {object|null} tableData  - parseCSV çıktısı ya da null
   */
  constructor(meta, tableData) {
    this.meta = meta;
    this.table = null;      // interpolasyon için hazır yapı
    this.usingTable = false;

    if (tableData) {
      this._buildTable(tableData);
    }
  }

  _buildTable({ rows }) {
    // Her property için T dizisi + değer dizisi hazırla
    const cols = Object.keys(rows[0]).filter(k => k !== 'T_C');
    this.table = { T: rows.map(r => r.T_C) };
    cols.forEach(col => {
      this.table[col] = rows.map(r => r[col]);
    });
    this.usingTable = true;
  }

  /**
   * Verilen sıcaklık için sıvı özelliklerini döner.
   * Önce tablo, yoksa polinom.
   *
   * @param {number} T_C - Sıcaklık (°C)
   * @returns {{
   *   T: number,
   *   rho: number,    // kg/m³
   *   mu: number,     // mPa·s
   *   nu: number,     // mm²/s  (= μ/ρ * 1e3)
   *   cp: number|null,
   *   k: number|null,
   *   Pr: number|null,
   *   source: string,
   *   warnings: string[]
   * }}
   */
  getProps(T_C) {
    const warnings = [];
    const range = this.meta.valid_range;

    // Geçerlilik uyarısı (hesabı durdurmaz)
    if (T_C < range.T_min_C || T_C > range.T_max_C)
      warnings.push(`⚠ T=${T_C}°C geçerli aralık dışı [${range.T_min_C}–${range.T_max_C}°C]`);

    let rho, mu, nu, cp = null, k = null, Pr = null;
    let source;

    if (this.usingTable) {
      // Tablo interpolasyonu (cubic spline)
      const tbl = this.table;
      const opts = { extrapolate: false };

      rho = cubicSplineInterp(tbl.T, tbl.rho, T_C, opts);
      mu  = cubicSplineInterp(tbl.T, tbl.mu,  T_C, opts);

      if (rho.warning) warnings.push('ρ: ' + rho.warning);
      if (mu.warning)  warnings.push('μ: ' + mu.warning);

      rho = rho.value;
      mu  = mu.value;

      // Opsiyonel sütunlar
      if (tbl.cp)  cp  = cubicSplineInterp(tbl.T, tbl.cp,  T_C, opts).value;
      if (tbl.k)   k   = cubicSplineInterp(tbl.T, tbl.k,   T_C, opts).value;
      if (tbl.Pr)  Pr  = cubicSplineInterp(tbl.T, tbl.Pr,  T_C, opts).value;

      source = 'tablo (cubic spline)';
    } else {
      // Polinom / Arrhenius fallback
      warnings.push('ℹ CSV tablosu yüklenemedi, polinom fallback kullanılıyor');
      const fb = this.meta.polynomial_fallback;

      rho = evalPolynomial(fb.density.coefficients, T_C);
      const vm = fb.dynamic_viscosity;
      mu  = evalArrhenius(vm.A, vm.B, vm.C, T_C);

      source = 'polinom (fallback)';
    }

    nu = (mu / 1000) / rho * 1e6;   // mm²/s

    return { T: T_C, rho, mu, nu, cp, k, Pr, source, warnings };
  }

  /** Sıvı adı */
  get name() { return this.meta.name; }

  /** Geçerli T aralığı */
  get validRange() { return this.meta.valid_range; }
}

// ── PUBLIC LOADER ─────────────────────────────────────────
/**
 * JSON + CSV yükler, FluidModel döner.
 * Browser ortamında fetch kullanır.
 *
 * @param {string} jsonPath  - Örn: './data/water.json'
 * @param {string} csvPath   - Örn: './data/water_props.csv'
 * @returns {Promise<FluidModel>}
 */
async function loadFluid(jsonPath, csvPath) {
  // JSON yükle
  const jsonRes = await fetch(jsonPath);
  if (!jsonRes.ok) throw new Error(`Fluid JSON yüklenemedi: ${jsonPath} (${jsonRes.status})`);
  const meta = await jsonRes.json();
  validateJSON(meta);

  // CSV yükle (hata halinde polinom fallback)
  let tableData = null;
  try {
    const csvRes = await fetch(csvPath);
    if (!csvRes.ok) throw new Error(`HTTP ${csvRes.status}`);
    const csvText = await csvRes.text();
    tableData = parseCSV(csvText);
    console.info(`[FluidLoader] ${meta.name}: ${tableData.rows.length} satır CSV yüklendi`);
  } catch (e) {
    console.warn(`[FluidLoader] CSV yüklenemedi (${e.message}), polinom fallback aktif`);
  }

  return new FluidModel(meta, tableData);
}

export { loadFluid, FluidModel };
