'use strict';

// ── SABİTLER ──────────────────────────────────────────────
const G = 9.80665;       // Yerçekimi ivmesi [m/s²]
const P_ATM = 101325;    // Atmosfer basıncı [Pa]

// ── REYNOLDS SAYISI ───────────────────────────────────────
/**
 * @param {number} v    - Hız [m/s]
 * @param {number} D    - Çap [m]
 * @param {number} nu   - Kinematik viskozite [m²/s]
 * @returns {number}    - Reynolds sayısı [-]
 */
function Reynolds(v, D, nu) {
  if (nu <= 0 || D <= 0) return Infinity;
  return (v * D) / nu;
}

// ── AKIŞ REJİMİ ───────────────────────────────────────────
/**
 * @param {number} Re
 * @returns {{ regime: string, code: 'L'|'Tr'|'T', color: string }}
 */
function flowRegime(Re) {
  if (Re < 2300)      return { regime: 'Laminer',       code: 'L',  color: '#00e5ff' };
  if (Re < 4000)      return { regime: 'Geçiş',         code: 'Tr', color: '#ffdd57' };
  return               { regime: 'Türbülanslı',         code: 'T',  color: '#ff6b35' };
}

// ── DARCY SÜRTÜNME FAKTÖRÜ ────────────────────────────────
/**
 * Akış rejimine göre otomatik seçim:
 *   Laminer  : f = 64 / Re
 *   Geçiş    : Laminer ve türbülanslı arası lineer interpolasyon
 *   Türb.    : Colebrook-White iteratif çözümü
 *              (Swamee-Jain ile başlat, 50 iterasyon)
 *
 * @param {number} Re       - Reynolds sayısı
 * @param {number} D        - İç çap [m]
 * @param {number} eps_mm   - Yüzey pürüzlülüğü [mm]
 * @returns {number}        - Darcy-Weisbach sürtünme faktörü f [-]
 */
function frictionFactor(Re, D, eps_mm) {
  if (Re < 1e-9) return 64;

  const eps = (eps_mm / 1000) / D;  // Bağıl pürüzlülük [-]

  // Laminer
  if (Re <= 2300) return 64 / Re;

  // Türbülanslı (Colebrook-White)
  const f_turb = _colebrook(Re, eps);

  // Geçiş: ağırlıklı interpolasyon
  if (Re < 4000) {
    const f_lam = 64 / 2300;
    const t = (Re - 2300) / (4000 - 2300);
    return f_lam * (1 - t) + f_turb * t;
  }

  return f_turb;
}

/** Colebrook-White iteratif çözüm */
function _colebrook(Re, eps) {
  // Swamee-Jain başlangıç tahmini
  let f = 0.25 / Math.pow(Math.log10(eps / 3.7 + 5.74 / Math.pow(Re, 0.9)), 2);
  // Newton-Raphson iterasyon
  for (let i = 0; i < 50; i++) {
    const sqf = Math.sqrt(f);
    const rhs = -2.0 * Math.log10(eps / 3.7 + 2.51 / (Re * sqf));
    const fNew = 1.0 / (rhs * rhs);
    if (Math.abs(fNew - f) < 1e-12) break;
    f = fNew;
  }
  return f;
}

// ── YÜK KAYBI BİLEŞENLERİ ────────────────────────────────

/**
 * Darcy-Weisbach sürtünme yük kaybı [m]
 * hf = f * (L/D) * v²/(2g)
 */
function headLoss_friction(f, L, D, v) {
  return f * (L / D) * (v * v) / (2 * G);
}

/**
 * Bağlantı elemanı yük kaybı [m]
 * hm = K * v²/(2g)
 */
function headLoss_fitting(K_total, v) {
  return K_total * (v * v) / (2 * G);
}

/**
 * Ani genişleme yük kaybı — Borda-Carnot [m]
 * hexp = (v1 - v2)² / (2g)
 */
function headLoss_expansion(v1, v2) {
  const dv = v1 - v2;
  return (dv * dv) / (2 * G);
}

/**
 * Ani daralma yük kaybı — Borda-Carnot yaklaşımı [m]
 * Kc = 0.5 * (1 - A2/A1)
 * hcon = Kc * v2²/(2g)
 */
function headLoss_contraction(D1_m, D2_m, v2) {
  const A1 = Math.PI * D1_m * D1_m / 4;
  const A2 = Math.PI * D2_m * D2_m / 4;
  const aRatio = Math.min(A2 / A1, 1);
  const Kc = 0.5 * (1 - aRatio);
  return Kc * (v2 * v2) / (2 * G);
}

// ── TEK SEGMENT HESABI ────────────────────────────────────
/**
 * Bir boru segmentinin tam hidrolik analizini yapar.
 *
 * @param {object} seg - Segment tanımı:
 *   {
 *     length:   number,   // [m]
 *     diameter: number,   // [mm]
 *     dz:       number,   // Yükseklik farkı [m] (+: yokuş, -: iniş)
 *     fittings: { [key]: count },  // Bağlantı elemanı adetleri
 *   }
 * @param {number} Q_m3s    - Hacimsel debi [m³/s]
 * @param {object} fluid    - { rho [kg/m³], mu [mPa·s] }
 * @param {number} eps_mm   - Yüzey pürüzlülüğü [mm]
 * @param {object} fittingLib - K kütüphanesi { key: K_value }
 * @param {object|null} prevSeg - Önceki segment (çap geçişi için)
 *
 * @returns {object} - Tam segment analiz sonucu
 */
function calcSegment(seg, Q_m3s, fluid, eps_mm, fittingLib, prevSeg = null) {
  const D = seg.diameter / 1000;           // mm → m
  const A = Math.PI * D * D / 4;           // m²
  const v = Q_m3s / A;                     // m/s
  const nu_m2s = (fluid.mu / 1000) / fluid.rho;  // mPa·s → m²/s

  const Re = Reynolds(v, D, nu_m2s);
  const regime = flowRegime(Re);
  const f = frictionFactor(Re, D, eps_mm);

  // Sürtünme kaybı
  const hf_friction = headLoss_friction(f, seg.length, D, v);

  // Bağlantı elemanı kaybı
  let K_total = 0;
  const fittingDetail = {};
  if (seg.fittings && fittingLib) {
    for (const [key, count] of Object.entries(seg.fittings)) {
      if (!count || count <= 0) continue;
      const K = fittingLib[key]?.K ?? 0;
      K_total += K * count;
      fittingDetail[key] = { count, K, loss_m: headLoss_fitting(K * count, v) };
    }
  }
  const hf_fittings = headLoss_fitting(K_total, v);

  // Yükseklik farkı
  const hf_elevation = seg.dz;  // + = kayıp, - = kazanım

  // Çap geçiş kaybı
  let hf_transition = 0;
  let transitionType = null;
  if (prevSeg) {
    const D_prev = prevSeg.diameter / 1000;
    if (Math.abs(D - D_prev) > 0.0001) {
      if (D < D_prev) {
        // Daralma
        hf_transition = headLoss_contraction(D_prev, D, v);
        transitionType = 'contraction';
      } else {
        // Genişleme
        const A_prev = Math.PI * D_prev * D_prev / 4;
        const v_prev = Q_m3s / A_prev;
        hf_transition = headLoss_expansion(v_prev, v);
        transitionType = 'expansion';
      }
    }
  }

  const hf_total = hf_friction + hf_fittings + hf_elevation + hf_transition;
  const deltaP_Pa = fluid.rho * G * hf_total;

  return {
    // Girişler
    diameter_mm: seg.diameter,
    length_m:    seg.length,
    dz_m:        seg.dz,

    // Akış
    velocity_ms:   v,
    Re:            Re,
    regime:        regime,
    frictionFactor: f,

    // Yük kayıpları [m]
    hf: {
      friction:   hf_friction,
      fittings:   hf_fittings,
      elevation:  hf_elevation,
      transition: hf_transition,
      total:      hf_total,
    },
    transitionType,
    fittingDetail,
    K_total,

    // Basınç kaybı
    deltaP_Pa:   deltaP_Pa,
    deltaP_bar:  deltaP_Pa / 1e5,
  };
}

// ── SİSTEM HESABI (tüm segmentler) ───────────────────────
/**
 * Seri bağlı tüm segmentleri hesaplar.
 *
 * @param {Array}  segments   - Segment tanımları dizisi
 * @param {number} Q_lpm      - Giriş debisi [L/min]
 * @param {number} P_in_bar   - Giriş basıncı [bar]
 * @param {object} fluidData  - water.js formatında sıvı verisi
 * @param {number} T_C        - Sıcaklık [°C]
 * @param {number} eps_mm     - Pürüzlülük [mm]
 * @param {object} fittingLib - K kütüphanesi
 * @param {string} interpMethod - 'linear' | 'spline'
 *
 * @returns {object} - Sistem analiz sonucu
 */
function calcSystem(segments, Q_lpm, P_in_bar, fluidData, T_C, eps_mm, fittingLib, interpMethod = 'linear') {

  // Sıvı özelliklerini T'den interpolasyon ile al
  const fluidProps = getAllProps(fluidData, T_C, interpMethod);
  const fluid = {
    rho: fluidProps.rho,       // kg/m³
    mu:  fluidProps.mu,        // mPa·s
    nu:  fluidProps.nu,        // mm²/s (bilgi amaçlı)
    T_C,
  };

  const Q_m3s = Q_lpm / 60000;  // L/min → m³/s

  // Segment hesapları
  const segResults = segments.map((seg, i) =>
    calcSegment(seg, Q_m3s, fluid, eps_mm, fittingLib, i > 0 ? segments[i - 1] : null)
  );

  // Toplam kayıplar
  const totals = segResults.reduce((acc, s) => {
    acc.hf_friction   += s.hf.friction;
    acc.hf_fittings   += s.hf.fittings;
    acc.hf_elevation  += s.hf.elevation;
    acc.hf_transition += s.hf.transition;
    acc.hf_total      += s.hf.total;
    acc.deltaP_Pa     += s.deltaP_Pa;
    return acc;
  }, { hf_friction: 0, hf_fittings: 0, hf_elevation: 0, hf_transition: 0, hf_total: 0, deltaP_Pa: 0 });

  const P_out_Pa  = P_in_bar * 1e5 - totals.deltaP_Pa;
  const P_out_bar = P_out_Pa / 1e5;

  // Sistem durumu
  const status = _systemStatus(P_out_bar, segResults);

  // Sıkıştırılamaz → Q_b = Q_a
  return {
    // Giriş koşulları
    input: {
      Q_lpm, P_in_bar, T_C, eps_mm,
    },
    // Sıvı özellikleri (T'de hesaplanmış)
    fluid: {
      ...fluid,
      ...fluidProps,
      name: fluidData.meta.name,
    },
    // Debi (korunan)
    Q_a_lpm: Q_lpm,
    Q_b_lpm: Q_lpm,   // sıkıştırılamaz akış
    Q_m3s,

    // Basınç
    P_in_bar,
    P_out_bar,
    P_out_Pa,

    // Yük kayıpları [m]
    totals,

    // Segment detayları
    segments: segResults,

    // Durum
    status,
  };
}

// ── DURUM DEĞERLENDİRMESİ ────────────────────────────────
function _systemStatus(P_out_bar, segResults) {
  const reValues = segResults.map(s => s.Re);
  const Re_max   = Math.max(...reValues);
  const Re_min   = Math.min(...reValues);

  let overallRegime;
  if (Re_max < 2300)      overallRegime = { regime: 'Laminer',     code: 'L'  };
  else if (Re_min < 4000) overallRegime = { regime: 'Geçiş/Karma', code: 'Tr' };
  else                    overallRegime = { regime: 'Türbülanslı', code: 'T'  };

  let code, label, message;
  if (P_out_bar < 0) {
    code = 'error';
    label = 'BASINÇ YETERSİZ';
    message = 'Çıkış basıncı negatif — sistem bu debide çalışamaz. Giriş basıncını artırın veya debyi azaltın.';
  } else if (P_out_bar < 0.3) {
    code = 'warn';
    label = 'DÜŞÜK BASINÇ';
    message = 'Çıkış basıncı 0.3 bar\'ın altında. Kavitasyon riski olabilir.';
  } else {
    code = 'ok';
    label = 'NORMAL';
    message = 'Sistem normal koşullarda çalışıyor.';
  }

  return { code, label, message, overallRegime };
}

// ── DEVRE ANALİZİ ─────────────────────────────────────────
/**
 * Belirli bir P_out hedefi için gereken minimum Q'yu ikili arama ile bulur.
 * (İleride paralel hat desteği için placeholder)
 */
function findMinFlow(segments, P_in_bar, P_out_target_bar, fluidData, T_C, eps_mm, fittingLib) {
  let lo = 0.01, hi = 10000;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const res = calcSystem(segments, mid, P_in_bar, fluidData, T_C, eps_mm, fittingLib);
    if (res.P_out_bar > P_out_target_bar) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ── İNTERPOLASYON ────────────────────────────────────────

/**
 * Linear interpolasyon (iki nokta arası).
 */
function linearInterp(x, x0, x1, y0, y1) {
  if (x1 === x0) return y0;
  return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
}

/**
 * Sıralanmış tablo üzerinde linear interpolasyon.
 * Tablo dışı → clamp + uyarı.
 *
 * @param {number[]} xs    - X ekseni (artan sıralı)
 * @param {number[]} ys    - Y değerleri
 * @param {number}   x     - Sorgu noktası
 * @param {object}   opts  - { extrapolate: bool }
 * @returns {{ value: number, clamped: boolean, warning: string|null }}
 */
function tableInterp(xs, ys, x, opts = {}) {
  const n = xs.length;
  if (n === 0) throw new Error('interpolate: boş tablo');
  if (n !== ys.length) throw new Error('interpolate: xs ve ys uzunluk uyumsuz');

  if (x <= xs[0]) {
    if (!opts.extrapolate)
      return { value: ys[0], clamped: true, warning: `${x} < min (${xs[0]}), clamp uygulandı` };
    return { value: linearInterp(x, xs[0], xs[1], ys[0], ys[1]), clamped: false,
             warning: `Ekstrapolasyon: ${x} < ${xs[0]}` };
  }
  if (x >= xs[n - 1]) {
    if (!opts.extrapolate)
      return { value: ys[n-1], clamped: true, warning: `${x} > max (${xs[n-1]}), clamp uygulandı` };
    return { value: linearInterp(x, xs[n-2], xs[n-1], ys[n-2], ys[n-1]), clamped: false,
             warning: `Ekstrapolasyon: ${x} > ${xs[n-1]}` };
  }

  // Binary search
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid; else hi = mid;
  }

  return { value: linearInterp(x, xs[lo], xs[hi], ys[lo], ys[hi]), clamped: false, warning: null };
}

/**
 * Monotone cubic spline (Fritsch-Carlson).
 * Aşım yok, pürüzsüz. Tercihen bu kullanılır.
 */
function cubicSplineInterp(xs, ys, x, opts = {}) {
  const n = xs.length;
  if (n < 3) return tableInterp(xs, ys, x, opts);

  if (x <= xs[0]) {
    if (!opts.extrapolate) return { value: ys[0], clamped: true, warning: `Clamp: ${x} < ${xs[0]}` };
  }
  if (x >= xs[n - 1]) {
    if (!opts.extrapolate) return { value: ys[n-1], clamped: true, warning: `Clamp: ${x} > ${xs[n-1]}` };
  }

  const h = [], delta = [];
  for (let i = 0; i < n - 1; i++) {
    h[i]     = xs[i+1] - xs[i];
    delta[i] = (ys[i+1] - ys[i]) / h[i];
  }

  // Fritsch-Carlson türevleri
  const m = new Array(n);
  m[0]     = delta[0];
  m[n - 1] = delta[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (delta[i-1] * delta[i] <= 0) { m[i] = 0; continue; }
    const w1 = 2*h[i] + h[i-1];
    const w2 = h[i] + 2*h[i-1];
    m[i] = (w1 + w2) / (w1/delta[i-1] + w2/delta[i]);
  }

  // Monotonluk güvencesi
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(delta[i]) < 1e-10) { m[i] = m[i+1] = 0; continue; }
    const alpha = m[i]   / delta[i];
    const beta  = m[i+1] / delta[i];
    const tau   = alpha*alpha + beta*beta;
    if (tau > 9) {
      const s = 3 * delta[i] / Math.sqrt(tau);
      m[i]   = s * alpha;
      m[i+1] = s * beta;
    }
  }

  // Bracket
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid; else hi = mid;
  }

  const t  = (x - xs[lo]) / h[lo];
  const t2 = t*t, t3 = t2*t;

  return {
    value:   (2*t3 - 3*t2 + 1) * ys[lo]
           + (t3 - 2*t2 + t)   * h[lo] * m[lo]
           + (-2*t3 + 3*t2)    * ys[hi]
           + (t3 - t2)         * h[lo] * m[hi],
    clamped: false,
    warning: null,
  };
}

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


// ═══════════════════════════════════
// CATALOG DATA
// ═══════════════════════════════════
const DN_LIST = [
  {dn:'DN15',d:15.8},{dn:'DN20',d:21.3},{dn:'DN25',d:26.9},{dn:'DN32',d:35.4},
  {dn:'DN40',d:41.9},{dn:'DN50',d:53.1},{dn:'DN65',d:68.9},{dn:'DN80',d:82.5},
  {dn:'DN100',d:106.1},{dn:'DN125',d:131.7},{dn:'DN150',d:159.3},{dn:'DN200',d:206.5},
];
const MATERIALS = [
  {id:'steel_new',  name:'Seamless Steel (new)', eps:0.046},
  {id:'steel_old',  name:'Welded Steel (old)',   eps:0.26},
  {id:'cast_iron',  name:'Cast Iron',            eps:0.26},
  {id:'pvc_pe',     name:'PVC / PE',             eps:0.003},
  {id:'copper',     name:'Copper / Brass',       eps:0.0015},
];

/*
 * entryDir / exitDir: 'right' | 'left' | 'down' | 'up'
 * Layout engine bu bilgiyle bir sonraki elemanın başlangıç
 * noktasını ve yönünü belirler.
 */
const CATALOG_DEF = [
  {
    group: 'Pipes', items: [
      { type:'pipe', subtype:'h',  name:'Pipe H',   icon:'→', desc:'Horizontal',
        entryDir:'right', exitDir:'right',
        diameter_mm:50, length_m:5, material:'steel_new', eps:0.046 },
      { type:'pipe', subtype:'vd', name:'Pipe V↓',  icon:'↓', desc:'Vertical down',
        entryDir:'down', exitDir:'down',
        diameter_mm:50, length_m:3, material:'steel_new', eps:0.046 },
      { type:'pipe', subtype:'vu', name:'Pipe V↑',  icon:'↑', desc:'Vertical up',
        entryDir:'up', exitDir:'up',
        diameter_mm:50, length_m:3, material:'steel_new', eps:0.046 },
    ]
  },
  {
    group: 'Reducers', items: [
      { type:'pipe', subtype:'rh',  name:'Reducer H',  icon:'→', desc:'Horizontal taper',
        entryDir:'right', exitDir:'right',
        d_in_mm:50, d_out_mm:25, length_m:0.3, material:'steel_new', eps:0.046 },
      { type:'pipe', subtype:'rvd', name:'Reducer V↓', icon:'↓', desc:'Vertical down taper',
        entryDir:'down', exitDir:'down',
        d_in_mm:50, d_out_mm:25, length_m:0.3, material:'steel_new', eps:0.046 },
      { type:'pipe', subtype:'rvu', name:'Reducer V↑', icon:'↑', desc:'Vertical up taper',
        entryDir:'up', exitDir:'up',
        d_in_mm:50, d_out_mm:25, length_m:0.3, material:'steel_new', eps:0.046 },
    ]
  },
  {
    group: 'Elbows', items: [
      { type:'elbow', subtype:'rd', name:'Elbow →↓', icon:'↵', desc:'Right → Down', K:0.90,
        entryDir:'right', exitDir:'down' },
      { type:'elbow', subtype:'ru', name:'Elbow →↑', icon:'↱', desc:'Right → Up',   K:0.90,
        entryDir:'right', exitDir:'up' },
      { type:'elbow', subtype:'ur', name:'Elbow ↑→', icon:'↳', desc:'Up → Right',   K:0.90,
        entryDir:'up',   exitDir:'right' },
      { type:'elbow', subtype:'dr', name:'Elbow ↓→', icon:'↰', desc:'Down → Right', K:0.90,
        entryDir:'down', exitDir:'right' },
    ]
  },
  {
    group: 'Valves', expandable: true,
    items: [
      { type:'valve', subtype:'gate',      name:'Gate Valve',  desc:'K=0.20', K:0.20, entryDir:'right', exitDir:'right' },
      { type:'valve', subtype:'ball',      name:'Ball Valve',  desc:'K=0.10', K:0.10, entryDir:'right', exitDir:'right' },
      { type:'valve', subtype:'butterfly', name:'Butterfly',   desc:'K=0.80', K:0.80, entryDir:'right', exitDir:'right' },
      { type:'valve', subtype:'globe',     name:'Globe Valve', desc:'K=6.00', K:6.00, entryDir:'right', exitDir:'right' },
      { type:'valve', subtype:'check',     name:'Check Valve', desc:'K=2.50', K:2.50, entryDir:'right', exitDir:'right' },
      { type:'valve', subtype:'prv',       name:'PRV',         desc:'P_set',  K:null, special:'prv', P_set_bar:1.0, entryDir:'right', exitDir:'right' },
    ]
  },
  {
    group: 'Pumps', expandable: true,
    items: [
      { type:'pump', subtype:'centrifugal', name:'Centrifugal', desc:'Add head',
        head_m:20, efficiency:0.75, entryDir:'right', exitDir:'right' },
    ]
  },
];

// ═══════════════════════════════════
// INLINE FLUID DATA (water)
// ═══════════════════════════════════

// CSV tablosu inline — fetch gerekmez
const WATER_CSV_ROWS = [
  {T_C:0,   rho:999.8, mu:1.7921, nu:1.7924, cp:4217, k:0.5610, Pr:13.44},
  {T_C:5,   rho:999.9, mu:1.5188, nu:1.5189, cp:4202, k:0.5710, Pr:11.16},
  {T_C:10,  rho:999.7, mu:1.3077, nu:1.3081, cp:4192, k:0.5800, Pr:9.45},
  {T_C:15,  rho:999.1, mu:1.1382, nu:1.1392, cp:4186, k:0.5890, Pr:8.09},
  {T_C:20,  rho:998.2, mu:1.0020, nu:1.0038, cp:4182, k:0.5980, Pr:7.01},
  {T_C:25,  rho:997.0, mu:0.8910, nu:0.8937, cp:4180, k:0.6070, Pr:6.14},
  {T_C:30,  rho:995.7, mu:0.7975, nu:0.8009, cp:4178, k:0.6150, Pr:5.42},
  {T_C:35,  rho:994.0, mu:0.7194, nu:0.7237, cp:4178, k:0.6230, Pr:4.83},
  {T_C:40,  rho:992.2, mu:0.6533, nu:0.6585, cp:4179, k:0.6310, Pr:4.32},
  {T_C:45,  rho:990.2, mu:0.5963, nu:0.6022, cp:4180, k:0.6370, Pr:3.91},
  {T_C:50,  rho:988.1, mu:0.5471, nu:0.5537, cp:4181, k:0.6440, Pr:3.55},
  {T_C:55,  rho:985.7, mu:0.5040, nu:0.5113, cp:4183, k:0.6490, Pr:3.25},
  {T_C:60,  rho:983.2, mu:0.4665, nu:0.4745, cp:4185, k:0.6540, Pr:2.99},
  {T_C:65,  rho:980.4, mu:0.4335, nu:0.4422, cp:4187, k:0.6590, Pr:2.75},
  {T_C:70,  rho:977.5, mu:0.4042, nu:0.4135, cp:4190, k:0.6630, Pr:2.55},
  {T_C:75,  rho:974.8, mu:0.3781, nu:0.3879, cp:4193, k:0.6670, Pr:2.38},
  {T_C:80,  rho:971.8, mu:0.3550, nu:0.3653, cp:4197, k:0.6700, Pr:2.22},
  {T_C:85,  rho:968.6, mu:0.3342, nu:0.3451, cp:4201, k:0.6730, Pr:2.09},
  {T_C:90,  rho:965.3, mu:0.3150, nu:0.3263, cp:4205, k:0.6750, Pr:1.96},
  {T_C:95,  rho:961.9, mu:0.2974, nu:0.3092, cp:4209, k:0.6780, Pr:1.84},
  {T_C:100, rho:958.4, mu:0.2818, nu:0.2940, cp:4216, k:0.6800, Pr:1.75},
  {T_C:105, rho:954.7, mu:0.2670, nu:0.2797, cp:4224, k:0.6820, Pr:1.65},
  {T_C:110, rho:950.9, mu:0.2535, nu:0.2666, cp:4232, k:0.6840, Pr:1.57},
  {T_C:115, rho:946.9, mu:0.2410, nu:0.2545, cp:4240, k:0.6850, Pr:1.49},
  {T_C:120, rho:942.8, mu:0.2294, nu:0.2433, cp:4250, k:0.6870, Pr:1.42},
  {T_C:125, rho:938.5, mu:0.2187, nu:0.2330, cp:4260, k:0.6880, Pr:1.35},
  {T_C:130, rho:934.1, mu:0.2085, nu:0.2232, cp:4270, k:0.6890, Pr:1.29},
  {T_C:135, rho:929.5, mu:0.1991, nu:0.2142, cp:4281, k:0.6900, Pr:1.23},
  {T_C:140, rho:924.9, mu:0.1905, nu:0.2060, cp:4293, k:0.6900, Pr:1.18},
  {T_C:145, rho:920.0, mu:0.1824, nu:0.1983, cp:4305, k:0.6900, Pr:1.14},
  {T_C:150, rho:915.1, mu:0.1748, nu:0.1910, cp:4319, k:0.6900, Pr:1.09},
];

const WATER_JSON_META = {
  id: 'water', name: 'Su (H₂O)',
  valid_range: { T_min_C: 0, T_max_C: 150, P_min_bar: 0.5, P_max_bar: 10 },
  polynomial_fallback: {
    density: { coefficients: [998.21, -0.2411, -0.003472, 0.0000113] },
    dynamic_viscosity: { A: 2.414e-2, B: 247.8, C: 140 },
  }
};

// FluidModel instance'ını inline veriyle oluştur
const waterFluidModel = new FluidModel(WATER_JSON_META, { rows: WATER_CSV_ROWS });

/**
 * calcSystem'in beklediği getAllProps wrapper.
 * fluidData parametresi burada FluidModel instance'ıdır.
 */
function getAllProps(fluidData, T_C /*, interpMethod — spline zaten FluidModel içinde */) {
  return fluidData.getProps(T_C);
}

// Fitting K kütüphanesi (CATALOG_DEF ile eşleşiyor)
const FITTING_LIB = {
  elbow_90s: { K: 0.90 },
  elbow_90l: { K: 0.60 },
  elbow_45:  { K: 0.40 },
  elbow_180: { K: 1.50 },
  gate:      { K: 0.20 },
  ball:      { K: 0.10 },
  butterfly: { K: 0.80 },
  globe:     { K: 6.00 },
  check:     { K: 2.50 },
  flowmeter: { K: 1.50 },
};

// ═══════════════════════════════════
// STATE
// ═══════════════════════════════════
let line       = [];
let calcRes    = [];
let selected   = null;
let showPG     = false;
let showLabels = true;
let idCtr      = 0;
let dragItem   = null;
let dropIdx    = null;

// Sistem parametreleri (UI'dan güncellenebilir)
const sysConfig = {
  Q_lpm:    30,    // Debi [L/min]
  P_in_bar:  2.0,  // Giriş basıncı [bar]
  T_in_C:   20,    // Giriş sıcaklığı [°C]
  T_out_C:  20,    // Çıkış sıcaklığı [°C] — lineer interpolasyon için
};

// Layout constants
const ORIGIN_X = 80, ORIGIN_Y = 200;   // Hat başlangıç noktası
const PX_PER_M = 18;                    // 1 metre = 18 piksel
const FIT_W    = 54;                    // Fitting lokal genişliği (ana eksen)
const PUMP_W   = 64;

// Yön vektörleri (SVG koordinatı: y aşağı pozitif)
const DIR_VEC = {
  right: { dx:  1, dy:  0 },
  left:  { dx: -1, dy:  0 },
  down:  { dx:  0, dy:  1 },
  up:    { dx:  0, dy: -1 },
};

// ─── WORLD LAYOUT (entryDir/exitDir bazlı) ───────────────
/**
 * Her komp için döner:
 *   ix, iy   — entry point (world)
 *   ox, oy   — exit  point (world)
 *   entryDir, exitDir
 *   pw, ph   — pixel width/height (bounding box)
 */
function layout() {
  if (!line.length) return [];
  const result = [];
  let cx = ORIGIN_X, cy = ORIGIN_Y;
  let curDir = 'right';   // hat başlangıç yönü

  for (let i = 0; i < line.length; i++) {
    const comp = line[i];
    const eDir = comp.entryDir || curDir;
    const xDir = comp.exitDir  || eDir;
    const vec  = DIR_VEC[eDir];

    // Uzunluk piksel cinsinden
    let lenPx;
    if (comp.type === 'pipe') {
      lenPx = Math.max(40, (comp.length_m || 5) * PX_PER_M);
    } else if (comp.type === 'pump') {
      lenPx = PUMP_W;
    } else {
      lenPx = FIT_W;
    }

    const ix = cx, iy = cy;
    let ox, oy;

    if (comp.type === 'elbow') {
      // Dirsek: entry yönünde yarım FIT_W, sonra exit yönünde yarım FIT_W
      const half = lenPx / 2;
      const eVec = DIR_VEC[eDir];
      const xVec = DIR_VEC[xDir];
      const cornerX = cx + eVec.dx * half;
      const cornerY = cy + eVec.dy * half;
      ox = cornerX + xVec.dx * half;
      oy = cornerY + xVec.dy * half;
    } else {
      // Boru / valf / pompa: entryDir yönünde düz ilerle
      ox = cx + vec.dx * lenPx;
      oy = cy + vec.dy * lenPx;
    }

    result.push({ ix, iy, ox, oy, entryDir: eDir, exitDir: xDir, lenPx });

    cx = ox; cy = oy;
    curDir = xDir;
  }
  return result;
}

/**
 * dz [m] — yönden otomatik.
 * 'down' → pozitif dz (alçalıyor, basınç kaybı artar)
 * 'up'   → negatif dz (yükseliyor, basınç kazanımı)
 */
function calcDz(comp) {
  if (comp.type !== 'pipe') return 0;
  const dir = comp.entryDir || 'right';
  const len = comp.length_m || 0;
  if (dir === 'down') return  len;
  if (dir === 'up')   return -len;
  return 0;
}


// ═══════════════════════════════════
function renderCatalog() {
  let html = '';
  CATALOG_DEF.forEach((grp, gi) => {
    html += `<div class="cat-group">`;
    if (grp.expandable) {
      html += `<div class="cat-expand-row" onclick="toggleGroup(${gi})">
        <div class="cat-icon">${getThumb(grp.items[0].type, grp.items[0].subtype)}</div>
        <div style="flex:1"><div class="cat-name">${grp.group}</div>
        <div class="cat-desc">${grp.items.length} subtypes</div></div>
        <span class="expand-icon" id="ei_${gi}">▶</span>
      </div>
      <div class="subtypes-wrap" id="sw_${gi}">`;
      grp.items.forEach((item, ii) => {
        html += `<div class="cat-subitem" draggable="true" data-gi="${gi}" data-ii="${ii}" ondragstart="onCatDrag(event,this)">
          <span class="cat-subitem-name">${item.name}</span>
          <span class="cat-subitem-k">${item.K != null ? 'K='+item.K : item.special || item.desc || ''}</span>
        </div>`;
      });
      html += `</div>`;
    } else {
      html += `<div class="cat-group-title">${grp.group}</div>`;
      grp.items.forEach((item, ii) => {
        html += `<div class="cat-item" draggable="true" data-gi="${gi}" data-ii="${ii}" ondragstart="onCatDrag(event,this)">
          <div class="cat-icon">${getThumb(item.type, item.subtype)}</div>
          <div><div class="cat-name">${item.name}</div>
          <div class="cat-desc">${item.desc}</div></div>
        </div>`;
      });
    }
    html += `</div>`;
  });
  document.getElementById('cat-body').innerHTML = html;
}

function toggleGroup(gi) {
  const sw = document.getElementById('sw_'+gi);
  const ei = document.getElementById('ei_'+gi);
  sw.classList.toggle('open');
  ei.classList.toggle('open');
}

function getThumb(type, subtype) {
  if (type === 'pipe') {
    const isV = subtype === 'vd' || subtype === 'rvd';
    const isU = subtype === 'vu' || subtype === 'rvu';
    const isR = subtype === 'rh' || subtype === 'rvd' || subtype === 'rvu';
    const c   = isR ? '#9b59b6' : '#3d9ef5';
    if (isV || isU) {
      return `<svg width="22" height="34">
        <line x1="11" y1="0" x2="11" y2="34" stroke="${c}" stroke-width="2.5"/>
        <line x1="6" y1="0" x2="16" y2="0" stroke="${c}" stroke-width="1.5"/>
        <line x1="6" y1="34" x2="16" y2="34" stroke="${c}" stroke-width="1.5"/>
        ${isR ? `<line x1="6" y1="4" x2="16" y2="30" stroke="${c}" stroke-width="1" opacity="0.5"/>` : ''}
      </svg>`;
    }
    return `<svg width="34" height="22">
      <line x1="0" y1="8" x2="34" y2="8" stroke="${c}" stroke-width="1.5"/>
      <line x1="0" y1="14" x2="34" y2="14" stroke="${c}" stroke-width="1.5"/>
      <line x1="0" y1="8" x2="0" y2="14" stroke="${c}" stroke-width="1.5"/>
      <line x1="34" y1="8" x2="34" y2="14" stroke="${c}" stroke-width="1.5"/>
      ${isR ? `<line x1="4" y1="9" x2="30" y2="13" stroke="${c}" stroke-width="1" opacity="0.5"/>` : ''}
    </svg>`;
  }
  if (type === 'elbow') {
    const icons = {
      rd: `<svg width="34" height="34"><path d="M0,11 L16,11 Q23,11 23,18 L23,34" fill="none" stroke="#f0a500" stroke-width="2"/></svg>`,
      ru: `<svg width="34" height="34"><path d="M0,23 L16,23 Q23,23 23,16 L23,0"  fill="none" stroke="#f0a500" stroke-width="2"/></svg>`,
      ur: `<svg width="34" height="34"><path d="M11,34 L11,18 Q11,11 18,11 L34,11" fill="none" stroke="#f0a500" stroke-width="2"/></svg>`,
      dr: `<svg width="34" height="34"><path d="M11,0  L11,16 Q11,23 18,23 L34,23" fill="none" stroke="#f0a500" stroke-width="2"/></svg>`,
    };
    return icons[subtype] || icons.rd;
  }
  if (type === 'valve') {
    return `<svg width="34" height="22"><line x1="0" y1="11" x2="9" y2="11" stroke="#e05c00" stroke-width="1.5"/>
      <polygon points="9,5 23,11 9,17" fill="none" stroke="#e05c00" stroke-width="1.2"/>
      <polygon points="23,5 9,11 23,17" fill="none" stroke="#e05c00" stroke-width="1.2"/>
      <line x1="23" y1="11" x2="34" y2="11" stroke="#e05c00" stroke-width="1.5"/></svg>`;
  }
  if (type === 'pump') {
    return `<svg width="34" height="22"><circle cx="17" cy="11" r="8" fill="none" stroke="#2ecc71" stroke-width="1.5"/>
      <line x1="0" y1="11" x2="9" y2="11" stroke="#2ecc71" stroke-width="1.5"/>
      <line x1="25" y1="11" x2="34" y2="11" stroke="#2ecc71" stroke-width="1.5"/>
      <path d="M17,11 L14,7 L21,9" fill="#2ecc71" opacity="0.7"/></svg>`;
  }
  return '<svg width="34" height="22"></svg>';
}

// ═══════════════════════════════════
// DRAG & DROP
// ═══════════════════════════════════
function onCatDrag(evt, el) {
  const gi = parseInt(el.dataset.gi);
  const ii = parseInt(el.dataset.ii);
  dragItem = JSON.parse(JSON.stringify(CATALOG_DEF[gi].items[ii]));
  evt.dataTransfer.effectAllowed = 'copy';
  evt.dataTransfer.setData('text/plain', JSON.stringify(dragItem));
}

function onDragOver(evt) {
  evt.preventDefault();
  evt.dataTransfer.dropEffect = 'copy';
  document.getElementById('canvas-scroll').classList.add('drag-over');
  if (dragItem) {
    const rect = document.getElementById('canvas-scroll').getBoundingClientRect();
    dropIdx = calcDropIdx(evt.clientX - rect.left + document.getElementById('canvas-scroll').scrollLeft);
    renderSVG();
  }
}

function onDragLeave() {
  document.getElementById('canvas-scroll').classList.remove('drag-over');
  dropIdx = null;
  renderSVG();
}

function onDrop(evt) {
  evt.preventDefault();
  document.getElementById('canvas-scroll').classList.remove('drag-over');
  const raw = evt.dataTransfer.getData('text/plain');
  if (!raw) return;
  const template = JSON.parse(raw);
  const comp = makeComp(template);
  const idx  = dropIdx !== null ? dropIdx : line.length;
  line.splice(idx, 0, comp);
  dropIdx = null; dragItem = null;
  runCalc();
  renderSVG();
  renderChart();
  selectComp(idx);
  updateStatus();
}

function calcDropIdx(mouseX) {
  if (!line.length) return 0;
  const lyt = layout();
  for (let i = 0; i < lyt.length; i++) {
    const mx = (lyt[i].ix + lyt[i].ox) / 2;
    if (mouseX < mx) return i;
  }
  return line.length;
}

function makeComp(tpl) {
  const c = { ...tpl, _id: ++idCtr };
  const prev   = line.length > 0 ? line[line.length - 1] : null;
  const prevD  = prev ? (prev.d_out_mm || prev.diameter_mm || 50) : 50;
  const curDir = prev ? (prev.exitDir || 'right') : 'right';

  // entryDir: katalogdan geliyorsa koru, yoksa önceki çıkış yönü
  if (!c.entryDir) c.entryDir = curDir;
  if (!c.exitDir)  c.exitDir  = c.entryDir;

  // Çap mirası
  if (c.type !== 'pipe') c.diameter_mm = prevD;
  if (c.type === 'pipe' && (c.subtype === 'rh' || c.subtype === 'rvd' || c.subtype === 'rvu')) {
    c.d_in_mm  = prevD;
    c.d_out_mm = Math.max(15, Math.floor(prevD / 2));
  } else if (c.type === 'pipe' && !c.d_in_mm) {
    c.diameter_mm = c.diameter_mm || prevD;
  }
  return c;
}

// ═══════════════════════════════════
// SVG RENDER
// ═══════════════════════════════════
function renderSVG() {
  const svgEl = document.getElementById('svg-canvas');
  const hint  = document.getElementById('empty-hint');

  if (!line.length && !dragItem) {
    svgEl.innerHTML = '';
    svgEl.setAttribute('width', '100%');
    svgEl.setAttribute('height', '100%');
    hint.classList.remove('hidden');
    document.getElementById('cv-info').textContent = 'Drag components from catalog to start';
    return;
  }
  hint.classList.add('hidden');

  const lyt = layout();

  // ViewBox — tüm koordinatları kapsayacak şekilde
  const allX = [ORIGIN_X, ...lyt.flatMap(l => [l.ix, l.ox])];
  const allY = [ORIGIN_Y, ...lyt.flatMap(l => [l.iy, l.oy])];
  const pad  = 80;
  const vx   = Math.min(...allX) - pad;
  const vy   = Math.min(...allY) - pad;
  const vw   = Math.max(600, Math.max(...allX) - Math.min(...allX) + pad * 2);
  const vh   = Math.max(320, Math.max(...allY) - Math.min(...allY) + pad * 2);

  svgEl.setAttribute('width',   vw);
  svgEl.setAttribute('height',  vh);
  svgEl.setAttribute('viewBox', `${vx} ${vy} ${vw} ${vh}`);

  let out = '';

  // Spine (bağlantı hattı)
  out += buildSpine(lyt);

  // Drop indicator
  if (dropIdx !== null && lyt.length) {
    const ref = lyt[Math.min(dropIdx, lyt.length - 1)];
    out += `<line x1="${ref.ix - 6}" y1="${ref.iy - 30}" x2="${ref.ix - 6}" y2="${ref.iy + 30}"
      stroke="#f0a500" stroke-width="2" stroke-dasharray="4,3" opacity="0.8"/>`;
  }

  // Inlet node A
  const a = lyt.length ? lyt[0] : { ix: ORIGIN_X, iy: ORIGIN_Y };
  out += node(a.ix, a.iy, 'A', '#2ecc71');

  // Components
  lyt.forEach((l, i) => {
    out += compSVG(line[i], l, selected === i, calcRes[i] || null);
  });

  // Outlet node B
  if (lyt.length) {
    const z = lyt[lyt.length - 1];
    out += node(z.ox, z.oy, 'B', '#e74c3c');
  }

  // Pressure gradient
  if (showPG && calcRes.length) out += pressureGradient(lyt);

  svgEl.innerHTML = out;

  // Click handlers
  lyt.forEach((_, i) => {
    const g = svgEl.querySelector(`#c${line[i]._id}`);
    if (g) g.addEventListener('click', e => { e.stopPropagation(); selectComp(i); });
  });
  svgEl.addEventListener('click', e => { if (e.target === svgEl) deselect(); });

  if (line.length) {
    const lastRes = calcRes[calcRes.length - 1];
    document.getElementById('cv-info').textContent =
      lastRes ? `${line.length} components  ·  P_out = ${lastRes.P_out} bar` : `${line.length} components`;
  }
}

function buildSpine(lyt) {
  if (!lyt.length) return '';
  let out = '';
  lyt.forEach(l => {
    out += `<line x1="${l.ix}" y1="${l.iy}" x2="${l.ox}" y2="${l.oy}"
      stroke="#1c2030" stroke-width="3"/>`;
  });
  return out;
}

function node(x, y, label, color) {
  return `<circle cx="${x}" cy="${y}" r="6" fill="${color}" opacity="0.9"/>
    <text x="${x}" y="${y - 14}" text-anchor="middle"
      font-family="IBM Plex Mono" font-size="11" font-weight="700" fill="${color}">${label}</text>`;
}

function pressureGradient(lyt) {
  if (!calcRes.length) return '';
  const maxP = calcRes[0].P_in || 2;
  const scale = 36 / maxP;
  let d = '';
  lyt.forEach((l, i) => {
    const res = calcRes[i]; if (!res) return;
    const mx = (l.ix + l.ox) / 2;
    const my = (l.iy + l.oy) / 2 - res.P_in * scale - 20;
    d += `${i === 0 ? 'M' : 'L'} ${mx} ${my} `;
  });
  return `<path d="${d}" fill="none" stroke="rgba(61,158,245,0.5)"
    stroke-width="1.5" stroke-dasharray="5,3"/>`;
}

// ─── COMPONENT SVG ───────────────────────────────────────
function compSVG(comp, l, isSel, res) {
  const stroke = isSel
    ? `stroke="#f0a500" stroke-width="2"`
    : `stroke="#252830" stroke-width="1"`;

  let body = '';
  if (comp.type === 'pipe')  body = pipeSVG_2d(comp, l, stroke, res);
  if (comp.type === 'elbow') body = elbowSVG_2d(comp, l, stroke);
  if (comp.type === 'valve') body = valveSVG_2d(comp, l, stroke);
  if (comp.type === 'pump')  body = pumpSVG_2d(comp, l, stroke, res);

  // Warning dot — entry noktasının yanında
  const warns = getWarns(comp, res);
  let warnDot = '';
  if (warns.length) {
    const wc = warns.some(w => w.lvl === 'err') ? '#e74c3c' : '#f1c40f';
    const wx = (l.ix + l.ox) / 2;
    const wy = Math.min(l.iy, l.oy) - 14;
    warnDot = `<circle cx="${wx}" cy="${wy}" r="5" fill="${wc}" opacity="0.9"/>
      <text x="${wx}" y="${wy + 3}" text-anchor="middle"
        font-family="IBM Plex Mono" font-size="7" fill="#000" font-weight="700">!</text>`;
  }

  return `<g id="c${comp._id}" class="c-group ${isSel ? 'sel' : ''}">
    ${body}${warnDot}
  </g>`;
}

// ─── BORU SVG (2D world koordinat) ─────────────────────
function pipeSVG_2d(comp, l, stroke, res) {
  const { ix, iy, ox, oy, entryDir, lenPx } = l;
  const isRed = comp.subtype === 'rh' || comp.subtype === 'rvd' || comp.subtype === 'rvu';
  const color = isRed ? '#9b59b6' : '#3d9ef5';
  const isV   = entryDir === 'down' || entryDir === 'up';
  const half  = 9;   // boru yarı-genişliği

  let body = '';
  if (!isV) {
    // Yatay boru
    const y1 = iy - half, y2 = iy + half;
    const x1 = Math.min(ix, ox), x2 = Math.max(ix, ox);
    body = `<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${half * 2}"
      fill="#0e0f12" ${stroke} class="c-bg c-outline" rx="1"/>`;
    if (isRed) {
      // Reducer trapez
      const dy = 4;
      body = `<polygon points="${x1},${y1} ${x2},${y1+dy} ${x2},${y2-dy} ${x1},${y2}"
        fill="rgba(155,89,182,0.12)" stroke="${color}" stroke-width="1" class="c-bg c-outline"/>`;
    } else {
      body += `<line x1="${x1+4}" y1="${iy}" x2="${x2-4}" y2="${iy}"
        stroke="${color}" stroke-width="1" opacity="0.4"/>`;
    }
  } else {
    // Dikey boru
    const x1 = ix - half, x2 = ix + half;
    const yTop = Math.min(iy, oy), yBot = Math.max(iy, oy);
    body = `<rect x="${x1}" y="${yTop}" width="${half * 2}" height="${yBot - yTop}"
      fill="#0e0f12" ${stroke} class="c-bg c-outline" rx="1"/>`;
    if (isRed) {
      const dx = 4;
      const topW = half, botW = half - dx;
      const pts = entryDir === 'down'
        ? `${ix-topW},${yTop} ${ix+topW},${yTop} ${ix+botW},${yBot} ${ix-botW},${yBot}`
        : `${ix-botW},${yTop} ${ix+botW},${yTop} ${ix+topW},${yBot} ${ix-topW},${yBot}`;
      body = `<polygon points="${pts}"
        fill="rgba(155,89,182,0.12)" stroke="${color}" stroke-width="1" class="c-bg c-outline"/>`;
    } else {
      body += `<line x1="${ix}" y1="${yTop+4}" x2="${ix}" y2="${yBot-4}"
        stroke="${color}" stroke-width="1" opacity="0.4"/>`;
    }
  }

  // Akış yön oku
  const mx = (ix + ox) / 2, my = (iy + oy) / 2;
  const arrowSize = 5;
  let arrow = '';
  if (entryDir === 'right') arrow = `<polygon points="${mx},${my-3} ${mx+arrowSize},${my} ${mx},${my+3}" fill="${color}" opacity="0.6"/>`;
  if (entryDir === 'left')  arrow = `<polygon points="${mx},${my-3} ${mx-arrowSize},${my} ${mx},${my+3}" fill="${color}" opacity="0.6"/>`;
  if (entryDir === 'down')  arrow = `<polygon points="${mx-3},${my} ${mx},${my+arrowSize} ${mx+3},${my}" fill="${color}" opacity="0.6"/>`;
  if (entryDir === 'up')    arrow = `<polygon points="${mx-3},${my} ${mx},${my-arrowSize} ${mx+3},${my}" fill="${color}" opacity="0.6"/>`;

  // Etiketler
  let labels = '';
  if (showLabels) {
    const lblX = isV ? ix + 14 : mx;
    const lblY = isV ? my      : iy - 14;
    const dia  = isRed ? `${comp.d_in_mm||50}→${comp.d_out_mm||25}mm` : `⌀${comp.diameter_mm||50}mm`;
    const len  = `${comp.length_m||5}m`;
    labels = `
      <text x="${lblX}" y="${lblY}" text-anchor="${isV?'start':'middle'}"
        font-family="IBM Plex Mono" font-size="8" fill="#5a6070">${dia}</text>
      <text x="${lblX}" y="${lblY + (isV ? 10 : 10)}" text-anchor="${isV?'start':'middle'}"
        font-family="IBM Plex Mono" font-size="8" fill="#5a6070">${len}</text>
      ${res ? `<text x="${lblX}" y="${lblY + (isV ? 20 : 20)}" text-anchor="${isV?'start':'middle'}"
        font-family="IBM Plex Mono" font-size="8" fill="#3d9ef5">v=${res.v}m/s</text>` : ''}`;
  }

  return body + arrow + labels;
}

// ─── DİRSEK SVG (2D world koordinat) ───────────────────
function elbowSVG_2d(comp, l, stroke) {
  const { ix, iy, ox, oy, entryDir, exitDir } = l;
  const color = '#f0a500';
  const r = FIT_W * 0.55;   // köşe yarıçapı

  // Her 4 varyant için köşe Q bezier path
  // Boru hattının ortasından geçen merkez çizgi
  let path = '';
  // Kontrol noktası = köşe
  const kx = ix + (exitDir === 'right' || exitDir === 'left' ? (ox - ix) : 0);
  const ky = iy + (exitDir === 'down'  || exitDir === 'up'   ? (oy - iy) : 0);

  // Alternatif: entry→corner→exit quadratic bezier
  // Corner: entry yönünde FIT_W ilerle, sonra exit yönüne dön
  let cornerX, cornerY;
  if (entryDir === 'right') { cornerX = ox; cornerY = iy; }
  if (entryDir === 'left')  { cornerX = ox; cornerY = iy; }
  if (entryDir === 'down')  { cornerX = ix; cornerY = oy; }
  if (entryDir === 'up')    { cornerX = ix; cornerY = oy; }

  path = `M ${ix} ${iy} Q ${cornerX} ${cornerY} ${ox} ${oy}`;

  // Hit alanı
  const bx = Math.min(ix, ox, cornerX) - 5;
  const by = Math.min(iy, oy, cornerY) - 5;
  const bw = Math.abs(ox - ix) + Math.abs(oy - iy) + 10;
  const bh = bw;

  const label = comp.name || '90°';

  return `
    <rect x="${bx}" y="${by}" width="${Math.max(bw,20)}" height="${Math.max(bh,20)}"
      fill="rgba(240,165,0,0.04)" ${stroke} class="c-bg c-outline" rx="2"/>
    <path d="${path}" fill="none" stroke="${color}" stroke-width="2.5"
      stroke-linecap="round"/>
    ${showLabels ? `<text x="${cornerX}" y="${cornerY - 8}" text-anchor="middle"
      font-family="IBM Plex Mono" font-size="7" fill="#6a5a30">${label}</text>
      <text x="${cornerX}" y="${cornerY + 16}" text-anchor="middle"
      font-family="IBM Plex Mono" font-size="7" fill="#6a5a30">K=${comp.K}</text>` : ''}
  `;
}

// ─── VALF SVG (2D world koordinat) ─────────────────────
function valveSVG_2d(comp, l, stroke) {
  const { ix, iy, ox, oy } = l;
  const mx = (ix + ox) / 2, my = (iy + oy) / 2;
  const isPRV    = comp.special === 'prv';
  const isClosed = comp.open === false;
  const color    = isClosed ? '#e74c3c' : isPRV ? '#e74c3c' : '#e05c00';
  const half = 22;

  return `
    <rect x="${Math.min(ix,ox)-2}" y="${my - half}" width="${Math.abs(ox-ix)+4}" height="${half*2}"
      fill="${isClosed?'rgba(231,76,60,0.08)':'rgba(224,92,0,0.04)'}"
      ${stroke} class="c-bg c-outline" rx="1"/>
    <line x1="${ix}" y1="${iy}" x2="${mx-11}" y2="${my}" stroke="${color}" stroke-width="1.5"/>
    <polygon points="${mx-11},${my-9} ${mx+11},${my} ${mx-11},${my+9}"
      fill="${isClosed?'rgba(231,76,60,0.25)':'none'}" stroke="${color}" stroke-width="1.2"/>
    <polygon points="${mx+11},${my-9} ${mx-11},${my} ${mx+11},${my+9}"
      fill="${isClosed?'rgba(231,76,60,0.25)':'none'}" stroke="${color}" stroke-width="1.2"/>
    <line x1="${mx+11}" y1="${my}" x2="${ox}" y2="${oy}" stroke="${color}" stroke-width="1.5"/>
    ${isClosed ? `
      <line x1="${mx-7}" y1="${my-7}" x2="${mx+7}" y2="${my+7}" stroke="#e74c3c" stroke-width="2"/>
      <line x1="${mx+7}" y1="${my-7}" x2="${mx-7}" y2="${my+7}" stroke="#e74c3c" stroke-width="2"/>` : ''}
    ${isPRV ? `
      <line x1="${mx}" y1="${my-11}" x2="${mx}" y2="${my-20}" stroke="${color}" stroke-width="1"/>
      <path d="M${mx-5},${my-20} Q${mx},${my-27} ${mx+5},${my-20}" fill="none" stroke="${color}" stroke-width="1"/>` : ''}
    ${showLabels ? `<text x="${mx}" y="${my-26}" text-anchor="middle"
      font-family="IBM Plex Mono" font-size="7"
      fill="${isClosed?'#e74c3c':'#5a6070'}">${isClosed?'CLOSED':comp.name}</text>
      ${comp.K != null && !isClosed ? `<text x="${mx}" y="${my+34}" text-anchor="middle"
        font-family="IBM Plex Mono" font-size="8" fill="#6a7480">K=${comp.K}</text>` : ''}` : ''}
  `;
}

// ─── POMPA SVG (2D world koordinat) ────────────────────
function pumpSVG_2d(comp, l, stroke, res) {
  const { ix, iy, ox, oy } = l;
  const mx = (ix + ox) / 2, my = (iy + oy) / 2;
  const r = 18;

  return `
    <rect x="${Math.min(ix,ox)-2}" y="${my - 28}" width="${Math.abs(ox-ix)+4}" height="56"
      fill="rgba(46,204,113,0.04)" ${stroke} class="c-bg c-outline" rx="1"/>
    <circle cx="${mx}" cy="${my}" r="${r}"
      fill="rgba(46,204,113,0.07)" stroke="#2ecc71" stroke-width="1.5"/>
    <line x1="${ix}" y1="${iy}" x2="${mx-r}" y2="${my}" stroke="#2ecc71" stroke-width="1.5"/>
    <line x1="${mx+r}" y1="${my}" x2="${ox}" y2="${oy}" stroke="#2ecc71" stroke-width="1.5"/>
    <path d="M${mx},${my} L${mx-5},${my-7} L${mx+7},${my-3} Z" fill="#2ecc71" opacity="0.7"/>
    ${showLabels ? `
      <text x="${mx}" y="${my-32}" text-anchor="middle"
        font-family="IBM Plex Mono" font-size="8" fill="#2ecc71">PUMP</text>
      <text x="${mx}" y="${my+32}" text-anchor="middle"
        font-family="IBM Plex Mono" font-size="9" fill="#2ecc71">+${comp.head_m||20}m</text>` : ''}
  `;
}



// ═══════════════════════════════════
// SELECT / PROPS
// ═══════════════════════════════════
function selectComp(idx) {
  selected = idx;
  renderSVG();
  renderProps();
  renderChart();
  const delBtn = document.getElementById('btn-del-side');
  if (delBtn) delBtn.style.display = 'block';
}

function deselect() {
  selected = null;
  renderSVG();
  renderChart();
  document.getElementById('prop-body').innerHTML = '<div id="prop-empty"><div style="font-size:24px;opacity:0.2">◈</div><div>SELECT A COMPONENT</div></div>';
  const delBtn = document.getElementById('btn-del-side');
  if (delBtn) delBtn.style.display = 'none';
}

function renderProps() {
  if (selected === null) return;
  const comp = line[selected];
  const res  = calcRes[selected] || null;
  let h = '';

  h += `<div class="ps"><div class="ps-title">Component</div>
    <div class="pr"><span class="pl">Type</span><span class="pv">${comp.name||comp.type}</span></div>
    ${comp.subtype ? `<div class="pr"><span class="pl">Subtype</span><span class="pv">${comp.subtype.replace(/_/g,' ')}</span></div>` : ''}
  </div>`;

  const warns = getWarns(comp, res);
  h += `<div class="ps">`;
  if (!warns.length) h += `<div class="badge ok">✓ No issues</div>`;
  warns.forEach(w => h += `<div class="badge ${w.lvl}">⚠ ${w.msg}</div>`);
  h += `</div>`;

  h += `<div class="ps"><div class="ps-title">Parameters</div>`;

  if (comp.type==='pipe') {
    if (comp.subtype !== 'reducing') {
      h += `<div class="pr"><span class="pl">Diameter</span>
        <select class="p-select" onchange="upd(${selected},'diameter_mm',parseFloat(this.value))">
          ${DN_LIST.map(d=>`<option value="${d.d}" ${Math.abs(d.d-(comp.diameter_mm||50))<1?'selected':''}>${d.dn} (${d.d}mm)</option>`).join('')}
        </select></div>`;
      h += `<div class="pr"><span class="pl">Length</span>
        <input class="p-input" type="number" value="${comp.length_m||5}" step="0.5" min="0.1" onchange="upd(${selected},'length_m',+this.value)">
        <span class="pu">m</span></div>`;
      h += `<div class="pr"><span class="pl">Direction</span>
        <span class="pv" style="letter-spacing:0.1em">${comp.entryDir||'→'} → ${comp.exitDir||'→'}</span></div>`;
      h += `<div class="pr"><span class="pl">dz (auto)</span>
        <span class="pv" style="color:var(--text-dim)">${calcDz(comp).toFixed(2)}</span>
        <span class="pu">m</span></div>`;
    } else {
      h += `<div class="pr"><span class="pl">D in</span><input class="p-input" type="number" value="${comp.d_in_mm||50}" onchange="upd(${selected},'d_in_mm',+this.value)"><span class="pu">mm</span></div>`;
      h += `<div class="pr"><span class="pl">D out</span><input class="p-input" type="number" value="${comp.d_out_mm||25}" onchange="upd(${selected},'d_out_mm',+this.value)"><span class="pu">mm</span></div>`;
      h += `<div class="pr"><span class="pl">Length</span><input class="p-input" type="number" value="${comp.length_m||0.3}" step="0.05" onchange="upd(${selected},'length_m',+this.value)"><span class="pu">m</span></div>`;
    }
    h += `<div class="pr"><span class="pl">Material</span>
      <select class="p-select" onchange="updMat(${selected},this.value)">
        ${MATERIALS.map(m=>`<option value="${m.id}" ${comp.material===m.id?'selected':''}>${m.name}</option>`).join('')}
      </select></div>`;
    h += `<div class="pr"><span class="pl">Roughness</span><span class="pv" id="eps-display">${comp.eps||0.046}</span><span class="pu">mm</span></div>`;
  }

  if (comp.type==='elbow') {
    h += `<div class="pr"><span class="pl">K value</span><span class="pv">${comp.K}</span></div>`;
    h += `<div class="pr"><span class="pl">Diameter</span><span class="pv">${comp.diameter_mm||'—'} mm</span></div>`;
    h += `<div class="pr"><span class="pl">Turn</span>
      <span class="pv" style="letter-spacing:0.1em">${comp.entryDir||'right'} → ${comp.exitDir||'down'}</span></div>`;
  }

  if (comp.type==='valve') {
    h += `<div class="pr"><span class="pl">Diameter</span><span class="pv">${comp.diameter_mm||'—'} mm</span></div>`;
    if (comp.special==='prv') {
      h += `<div class="pr"><span class="pl">P set</span>
        <input class="p-input" type="number" value="${comp.P_set_bar||1.0}" step="0.1" min="0" onchange="upd(${selected},'P_set_bar',+this.value)">
        <span class="pu">bar</span></div>`;
    } else {
      h += `<div class="pr"><span class="pl">K value</span><span class="pv">${comp.K}</span></div>`;
    }
  }

  if (comp.type==='pump') {
    h += `<div class="pr"><span class="pl">Head</span>
      <input class="p-input" type="number" value="${comp.head_m||20}" step="1" onchange="upd(${selected},'head_m',+this.value)">
      <span class="pu">m</span></div>`;
    h += `<div class="pr"><span class="pl">Efficiency</span>
      <input class="p-input" type="number" value="${comp.efficiency||0.75}" step="0.01" min="0.1" max="1" onchange="upd(${selected},'efficiency',+this.value)"></div>`;
  }

  if (comp.type==='valve' && comp.special !== 'prv') {
    const isOpen = comp.open !== false;
    h += `<div class="pr"><span class="pl">State</span>
      <button class="valve-toggle ${isOpen?'open':'closed'}" onclick="toggleValve(${selected})">
        ${isOpen ? '⬤ OPEN' : '◯ CLOSED'}
      </button></div>`;
  }

  h += `</div>`;

  if (res) {
    const blocked = res.blocked ? `<div class="badge err">⛔ Flow blocked</div>` : '';
    h += `<div class="ps"><div class="ps-title">Live Readings</div>
      ${blocked}
      <div class="reading-card">
        <div class="r-row"><span class="r-lbl">P inlet</span><span><span class="r-val">${res.P_in}</span> <span class="r-unit">bar</span></span></div>
        <div class="r-row"><span class="r-lbl">P outlet</span><span><span class="r-val" style="${res.P_out<0.3?'color:var(--red)':''}">${res.P_out}</span> <span class="r-unit">bar</span></span></div>
        <div class="r-row"><span class="r-lbl">ΔP</span><span><span class="r-val" style="color:var(--accent)">${res.dP}</span> <span class="r-unit">bar</span></span></div>
        <div class="r-row"><span class="r-lbl">Velocity</span><span><span class="r-val" style="color:var(--blue)">${res.v}</span> <span class="r-unit">m/s</span></span></div>
        <div class="r-row"><span class="r-lbl">Reynolds</span><span><span class="r-val" style="color:var(--text-mid);font-size:13px">${res.Re.toLocaleString()}</span></span></div>
        <div class="r-row"><span class="r-lbl">Fluid T</span><span><span class="r-val" style="color:#f0a500">${res.T_C}</span> <span class="r-unit">°C</span></span></div>
      </div>
    </div>`;
  }

  h += `<button class="del-btn" onclick="deleteSelected()">✕ Remove Component</button>`;
  document.getElementById('prop-body').innerHTML = h;
}

function upd(idx, key, val) {
  if (!line[idx]) return;
  line[idx][key] = val;
  runCalc(); renderSVG(); renderProps(); renderChart();
}
function updMat(idx, matId) {
  const m = MATERIALS.find(x=>x.id===matId);
  if (m && line[idx]) { line[idx].material=matId; line[idx].eps=m.eps; }
  const el = document.getElementById('eps-display');
  if (el) el.textContent = m?.eps || '';
  runCalc(); renderSVG(); renderChart();
}

// ═══════════════════════════════════
// REAL CALC (hydraulics engine)
// ═══════════════════════════════════
function runCalc() {
  if (!line.length) { calcRes = []; return; }

  const { Q_lpm, P_in_bar, T_in_C, T_out_C } = sysConfig;
  const Q_m3s = Q_lpm / 60000;
  const N = line.length;

  let P = P_in_bar;
  let blocked = false;   // kapalı valf sonrası akış durur
  calcRes = [];

  for (let i = 0; i < N; i++) {
    const comp = line[i];
    const prev = i > 0 ? line[i - 1] : null;

    // Segment ortalama sıcaklığı — lineer interpolasyon
    const T_seg = T_in_C + (T_out_C - T_in_C) * ((i + 0.5) / N);
    const fp    = waterFluidModel.getProps(T_seg);
    const fluid = { rho: fp.rho, mu: fp.mu };

    let P_in_comp = P;
    let P_out_comp, v, Re, dP;

    // Kapalı valf sonrası tüm komponentler 0 basınç
    if (blocked) {
      const D_mm = comp.d_out_mm || comp.diameter_mm || 50;
      const D    = D_mm / 1000;
      v  = 0;
      Re = 0;
      dP = P_in_comp;
      P_out_comp = 0;
      calcRes.push({ P_in: +P_in_comp.toFixed(4), P_out: 0, dP: +P_in_comp.toFixed(5), v: 0, Re: 0, T_C: +T_seg.toFixed(1), blocked: true });
      P = 0;
      continue;
    }

    // ── Kapalı valf kontrolü ───────────────────────────
    if (comp.type === 'valve' && comp.open === false) {
      const D_mm = comp.diameter_mm || 50;
      const D    = D_mm / 1000;
      v  = 0;
      Re = 0;
      dP = P_in_comp;
      P_out_comp = 0;
      blocked = true;
      calcRes.push({ P_in: +P_in_comp.toFixed(4), P_out: 0, dP: +P_in_comp.toFixed(5), v: 0, Re: 0, T_C: +T_seg.toFixed(1), blocked: true, valveClosed: true });
      P = 0;
      continue;
    }

    // ── Boru (straight veya reducing) ──────────────────
    if (comp.type === 'pipe') {
      const D_mm    = comp.subtype === 'reducing' ? comp.d_out_mm  : comp.diameter_mm;
      const D_in_mm = comp.subtype === 'reducing' ? comp.d_in_mm   : D_mm;
      const eps     = comp.eps ?? 0.046;
      const seg     = {
        diameter: D_mm || 50,
        length:   comp.length_m || 5,
        dz:       calcDz(comp),
        fittings: {},
      };
      const prevSeg = comp.subtype === 'reducing'
        ? { diameter: D_in_mm || 50 }
        : (prev ? _prevSegDiameter(prev) : null);

      const r = calcSegment(seg, Q_m3s, fluid, eps, FITTING_LIB, prevSeg);
      v          = r.velocity_ms;
      Re         = r.Re;
      dP         = r.deltaP_bar;
      P_out_comp = +(P_in_comp - dP).toFixed(5);

    // ── Dirsek / Valf (K katsayılı) ────────────────────
    } else if (comp.type === 'elbow' || (comp.type === 'valve' && comp.special !== 'prv')) {
      const D_mm = comp.diameter_mm || 50;
      const D    = D_mm / 1000;
      const A    = Math.PI * D * D / 4;
      v  = Q_m3s / A;
      const nu = (fluid.mu / 1000) / fluid.rho;
      Re = Reynolds(v, D, nu);
      const K  = comp.K ?? 0;
      const hm = headLoss_fitting(K, v);
      dP = fluid.rho * G * hm / 1e5;
      P_out_comp = +(P_in_comp - dP).toFixed(5);

    // ── PRV ────────────────────────────────────────────
    } else if (comp.type === 'valve' && comp.special === 'prv') {
      const D_mm = comp.diameter_mm || 50;
      const D    = D_mm / 1000;
      v  = Q_m3s / (Math.PI * D * D / 4);
      const nu = (fluid.mu / 1000) / fluid.rho;
      Re = Reynolds(v, D, nu);
      const P_set = comp.P_set_bar ?? 1.0;
      P_out_comp  = Math.min(P_in_comp, P_set);
      dP = +(P_in_comp - P_out_comp).toFixed(5);

    // ── Pompa ──────────────────────────────────────────
    } else if (comp.type === 'pump') {
      const D_mm = comp.diameter_mm || 50;
      const D    = D_mm / 1000;
      v  = Q_m3s / (Math.PI * D * D / 4);
      const nu = (fluid.mu / 1000) / fluid.rho;
      Re = Reynolds(v, D, nu);
      const head = comp.head_m ?? 20;
      const addP = fluid.rho * G * head / 1e5;
      dP = -addP;
      P_out_comp = +(P_in_comp + addP).toFixed(5);

    // ── Fallback ───────────────────────────────────────
    } else {
      const D_mm = comp.diameter_mm || 50;
      const D    = D_mm / 1000;
      v  = Q_m3s / (Math.PI * D * D / 4);
      const nu = (fluid.mu / 1000) / fluid.rho;
      Re = Reynolds(v, D, nu);
      dP = 0;
      P_out_comp = P_in_comp;
    }

    calcRes.push({
      P_in:  +P_in_comp.toFixed(4),
      P_out: +P_out_comp.toFixed(4),
      dP:    +dP.toFixed(5),
      v:     +v.toFixed(3),
      Re:    Math.round(Re),
      T_C:   +T_seg.toFixed(1),
    });

    P = P_out_comp;
  }
}

/** Önceki komponentin çıkış çapını segment formatında döner */
function _prevSegDiameter(comp) {
  const d = comp.d_out_mm || comp.diameter_mm || 50;
  return { diameter: d };
}

// ─── WARNINGS ───────────────────────────────────────────
function getWarns(comp, res) {
  const w = [];
  if (!res) return w;
  if (res.P_out < 0)   w.push({lvl:'err', msg:'Negative pressure'});
  if (res.P_out < 0.3 && res.P_out >= 0) w.push({lvl:'wrn', msg:'Low outlet pressure'});
  const idx = line.indexOf(comp);
  if (idx > 0) {
    const prev  = line[idx-1];
    const prevD = prev.d_out_mm || prev.diameter_mm;
    const thisD = comp.d_in_mm  || comp.diameter_mm;
    if (prevD && thisD && Math.abs(prevD-thisD) > 2)
      w.push({lvl:'wrn', msg:`Diameter mismatch ${prevD}→${thisD}mm`});
  }
  return w;
}

// ═══════════════════════════════════
// ACTIONS
// ═══════════════════════════════════
function toggleValve(idx) {
  if (!line[idx] || line[idx].type !== 'valve') return;
  line[idx].open = line[idx].open === false ? true : false;
  runCalc(); renderSVG(); renderProps();
  updateStatus();
}

function setSysConfig(key, val) {
  sysConfig[key] = val;
  runCalc(); renderSVG(); updateStatus();
  // Grafik varsa güncelle
  if (typeof renderChart === 'function') renderChart();
}

function deleteSelected() {
  if (selected===null) return;
  line.splice(selected,1);
  selected=null; runCalc(); renderSVG(); renderChart();
  document.getElementById('prop-body').innerHTML = '<div id="prop-empty"><div style="font-size:24px;opacity:0.2">◈</div><div>SELECT A COMPONENT</div></div>';
  const delBtn = document.getElementById('btn-del-side');
  if (delBtn) delBtn.style.display='none';
  updateStatus();
}
function clearLine() {
  line=[]; calcRes=[]; selected=null;
  renderSVG(); renderChart();
  document.getElementById('prop-body').innerHTML='<div id="prop-empty"><div style="font-size:24px;opacity:0.2">◈</div><div>SELECT A COMPONENT</div></div>';
  const delBtn = document.getElementById('btn-del-side');
  if (delBtn) delBtn.style.display='none';
  updateStatus();
}
function togglePG() {
  showPG=!showPG;
  document.getElementById('btn-pg').classList.toggle('active',showPG);
  renderSVG();
}
function toggleLabels() {
  showLabels=!showLabels;
  document.getElementById('btn-lbl').classList.toggle('active',showLabels);
  renderSVG();
}
function toggleAnalyze() {
  document.getElementById('btn-analyze').classList.toggle('active');
}
function zoomFit() {
  const s=document.getElementById('canvas-scroll');
  s.scrollLeft=0; s.scrollTop=0;
}
function exportJSON() {
  const blob=new Blob([JSON.stringify({line,calcRes},null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='pipeline.json'; a.click();
}
function updateStatus() {
  const dot=document.getElementById('sdot');
  const txt=document.getElementById('stext');
  if (!line.length) { dot.className='status-dot ok'; txt.textContent='READY'; return; }
  const hasErr = calcRes.some(r=>r.P_out<0);
  const hasWrn = calcRes.some(r=>r.P_out<0.3&&r.P_out>=0);
  if (hasErr)      { dot.className='status-dot err'; txt.textContent='PRESSURE FAULT'; }
  else if (hasWrn) { dot.className='status-dot warn'; txt.textContent='WARNING'; }
  else             { dot.className='status-dot ok';   txt.textContent=`${line.length} COMP`; }
}

// ═══════════════════════════════════
// RESIZE HANDLES (3 adet)
// ═══════════════════════════════════

(function() {
  let active = null;
  let startX, startY, startW, startH;

  // 1) Sol kolon catalog/props dikey ayırıcı
  const leftResize   = document.getElementById('left-resize');
  const panelCatalog = document.getElementById('panel-catalog');
  const panelProps   = document.getElementById('panel-props');

  // 2) Sol/sağ kolon yatay ayırıcı
  const colResize = document.getElementById('col-resize');
  const colLeft   = document.getElementById('col-left');

  // 3) Sağ kolon canvas/chart dikey ayırıcı
  const rightResize  = document.getElementById('right-resize');
  const panelChart   = document.getElementById('panel-chart');

  function onDown(e, type) {
    active = type;
    startX = e.clientX;
    startY = e.clientY;
    if (type === 'left-v') {
      startH = panelCatalog.offsetHeight;
    } else if (type === 'col-h') {
      startW = colLeft.offsetWidth;
    } else if (type === 'right-v') {
      startH = panelChart.offsetHeight;
    }
    document.body.style.userSelect = 'none';
    e.preventDefault();
  }

  leftResize.addEventListener('mousedown',  e => { leftResize.classList.add('active');  onDown(e, 'left-v'); document.body.style.cursor = 'ns-resize'; });
  colResize.addEventListener('mousedown',   e => { colResize.classList.add('active');   onDown(e, 'col-h');  document.body.style.cursor = 'ew-resize'; });
  rightResize.addEventListener('mousedown', e => { rightResize.classList.add('active'); onDown(e, 'right-v'); document.body.style.cursor = 'ns-resize'; });

  document.addEventListener('mousemove', e => {
    if (!active) return;
    if (active === 'left-v') {
      const delta = e.clientY - startY;
      const newH  = Math.min(700, Math.max(60, startH + delta));
      panelCatalog.style.flexBasis = newH + 'px';
      panelCatalog.style.flexGrow  = '0';
      panelCatalog.style.flexShrink = '0';
    } else if (active === 'col-h') {
      const delta = e.clientX - startX;
      const newW  = Math.min(420, Math.max(160, startW + delta));
      colLeft.style.width = newW + 'px';
    } else if (active === 'right-v') {
      const delta = startY - e.clientY;
      const newH  = Math.min(500, Math.max(80, startH + delta));
      panelChart.style.height = newH + 'px';
    }
  });

  document.addEventListener('mouseup', () => {
    if (!active) return;
    leftResize.classList.remove('active');
    colResize.classList.remove('active');
    rightResize.classList.remove('active');
    active = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
})();

// ═══════════════════════════════════
// CHART (Canvas 2D)
// ═══════════════════════════════════
function renderChart() {
  const canvas = document.getElementById('chart-canvas');
  const empty  = document.getElementById('chart-empty');
  if (!canvas) return;

  if (!calcRes.length) {
    empty && empty.classList.remove('hidden');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  empty && empty.classList.add('hidden');

  // Boyut ayarla
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width  = rect.width  * devicePixelRatio;
  canvas.height = rect.height * devicePixelRatio;
  canvas.style.width  = rect.width  + 'px';
  canvas.style.height = rect.height + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(devicePixelRatio, devicePixelRatio);
  const W = rect.width, H = rect.height;

  const PAD_L = 48, PAD_R = 48, PAD_T = 16, PAD_B = 28;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  ctx.clearRect(0, 0, W, H);

  // Veri noktaları: her segment için P_in, son segment P_out da eklenir
  const pVals = calcRes.map(r => r.P_in).concat([calcRes[calcRes.length-1].P_out]);
  const vVals = calcRes.map(r => r.v).concat([calcRes[calcRes.length-1].v]);
  const n     = pVals.length;

  const pMin = 0, pMax = Math.max(...pVals) * 1.15 || 3;
  const vMin = 0, vMax = Math.max(...vVals) * 1.15 || 3;

  const xOf = i => PAD_L + (i / (n - 1)) * chartW;
  const yOfP = v => PAD_T + chartH - ((v - pMin) / (pMax - pMin)) * chartH;
  const yOfV = v => PAD_T + chartH - ((v - vMin) / (vMax - vMin)) * chartH;

  // ── Komponent arka plan bantları ──
  const compColors = {
    pipe:  'rgba(61,158,245,0.04)',
    elbow: 'rgba(240,165,0,0.05)',
    valve: 'rgba(224,92,0,0.06)',
    pump:  'rgba(46,204,113,0.06)',
  };
  calcRes.forEach((r, i) => {
    const comp = line[i];
    const x1 = xOf(i), x2 = xOf(i+1);
    const col = compColors[comp?.type] || 'transparent';
    ctx.fillStyle = selected === i
      ? 'rgba(240,165,0,0.10)'
      : col;
    ctx.fillRect(x1, PAD_T, x2 - x1, chartH);

    // Seçili ise üst çizgi
    if (selected === i) {
      ctx.strokeStyle = 'rgba(240,165,0,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x1, PAD_T);
      ctx.lineTo(x1, PAD_T + chartH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x2, PAD_T);
      ctx.lineTo(x2, PAD_T + chartH);
      ctx.stroke();
    }
  });

  // ── Grid ──
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = PAD_T + (chartH / 4) * i;
    ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(PAD_L + chartW, y); ctx.stroke();
  }

  // ── P eğrisi (mavi) ──
  ctx.strokeStyle = '#3d9ef5';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  pVals.forEach((p, i) => {
    i === 0 ? ctx.moveTo(xOf(i), yOfP(p)) : ctx.lineTo(xOf(i), yOfP(p));
  });
  ctx.stroke();

  // Alan dolgusu
  ctx.fillStyle = 'rgba(61,158,245,0.07)';
  ctx.beginPath();
  pVals.forEach((p, i) => {
    i === 0 ? ctx.moveTo(xOf(i), yOfP(p)) : ctx.lineTo(xOf(i), yOfP(p));
  });
  ctx.lineTo(xOf(n-1), PAD_T + chartH);
  ctx.lineTo(xOf(0),   PAD_T + chartH);
  ctx.closePath();
  ctx.fill();

  // ── v eğrisi (yeşil) ──
  ctx.strokeStyle = '#2ecc71';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  vVals.forEach((v, i) => {
    i === 0 ? ctx.moveTo(xOf(i), yOfV(v)) : ctx.lineTo(xOf(i), yOfV(v));
  });
  ctx.stroke();
  ctx.setLineDash([]);

  // ── Nokta işaretçiler (P) ──
  pVals.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(xOf(i), yOfP(p), 3, 0, Math.PI * 2);
    ctx.fillStyle = selected === i || selected === i-1 ? '#f0a500' : '#3d9ef5';
    ctx.fill();
  });

  // ── Y ekseni sol (P) ──
  ctx.fillStyle = 'rgba(61,158,245,0.7)';
  ctx.font = '9px IBM Plex Mono';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const v = pMin + (pMax - pMin) * (1 - i/4);
    ctx.fillText(v.toFixed(1), PAD_L - 5, PAD_T + (chartH/4)*i + 3);
  }
  ctx.fillStyle = 'rgba(61,158,245,0.5)';
  ctx.font = '8px IBM Plex Mono';
  ctx.textAlign = 'left';
  ctx.fillText('bar', 2, PAD_T + 8);

  // ── Y ekseni sağ (v) ──
  ctx.fillStyle = 'rgba(46,204,113,0.7)';
  ctx.font = '9px IBM Plex Mono';
  ctx.textAlign = 'left';
  for (let i = 0; i <= 4; i++) {
    const v = vMin + (vMax - vMin) * (1 - i/4);
    ctx.fillText(v.toFixed(2), PAD_L + chartW + 5, PAD_T + (chartH/4)*i + 3);
  }
  ctx.fillStyle = 'rgba(46,204,113,0.5)';
  ctx.font = '8px IBM Plex Mono';
  ctx.textAlign = 'left';
  ctx.fillText('m/s', PAD_L + chartW + 5, PAD_T + chartH + 18);

  // ── X ekseni — komponent isimleri ──
  ctx.fillStyle = 'rgba(74,80,96,0.9)';
  ctx.font = '7px IBM Plex Mono';
  ctx.textAlign = 'center';
  calcRes.forEach((r, i) => {
    const comp = line[i];
    const label = comp ? (comp.name || comp.type).slice(0,6) : '';
    const cx = (xOf(i) + xOf(i+1)) / 2;
    ctx.fillText(label, cx, PAD_T + chartH + 16);
  });

  // ── Chart tıklama — komponent seçimi ──
  canvas._chartClickHandler && canvas.removeEventListener('click', canvas._chartClickHandler);
  canvas._chartClickHandler = function(e) {
    const bnd = canvas.getBoundingClientRect();
    const mx  = e.clientX - bnd.left;
    for (let i = 0; i < calcRes.length; i++) {
      if (mx >= xOf(i) && mx < xOf(i+1)) {
        selectComp(i);
        break;
      }
    }
  };
  canvas.addEventListener('click', canvas._chartClickHandler);
}

// ═══════════════════════════════════
// INIT
// ═══════════════════════════════════
renderCatalog();
renderSVG();
renderChart();
