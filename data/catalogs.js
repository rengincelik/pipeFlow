'use strict';

// ═══════════════════════════════════════════════════════════
// CATALOG DATA — DN listesi, malzeme tablosu, komponent tanımları
// ═══════════════════════════════════════════════════════════

export const DN_LIST = [
  { dn:'DN15',  d:15.8  }, { dn:'DN20',  d:21.3  }, { dn:'DN25',  d:26.9  },
  { dn:'DN32',  d:35.4  }, { dn:'DN40',  d:41.9  }, { dn:'DN50',  d:53.1  },
  { dn:'DN65',  d:68.9  }, { dn:'DN80',  d:82.5  }, { dn:'DN100', d:106.1 },
  { dn:'DN125', d:131.7 }, { dn:'DN150', d:159.3 }, { dn:'DN200', d:206.5 },
];

export const MATERIALS = [
  { id:'steel_new',  name:'Seamless Steel (new)', eps:0.046  },
  { id:'steel_old',  name:'Welded Steel (old)',   eps:0.26   },
  { id:'cast_iron',  name:'Cast Iron',            eps:0.26   },
  { id:'pvc_pe',     name:'PVC / PE',             eps:0.003  },
  { id:'copper',     name:'Copper / Brass',       eps:0.0015 },
];

/**
 * Katalog tanımları.
 * Her item: { group, type, subtype, name, icon?, desc?, defaultOverrides? }
 * defaultOverrides: makeComp sırasında uygulanacak override değerleri
 */
export const CATALOG_DEF = [
  {
    group: 'Elbows',
    items: [
      { type:'elbow', subtype:'rd', icon:'┐', desc:'Right → Down' },
      { type:'elbow', subtype:'ru', icon:'┘', desc:'Right → Up'   },
      { type:'elbow', subtype:'ur', icon:'┌', desc:'Up → Right'   },
      { type:'elbow', subtype:'dr', icon:'└', desc:'Down → Right' },
    ],
  },
  {
    group: 'Pipes',
    items: [
      { type:'pipe', subtype:'pipe', icon:'━', desc:'Straight pipe',
        defaultOverrides: { length_m: 5 } },

      { type:'pipe', subtype:'reducer', icon:'▶', desc:'Diameter reduction',
        defaultOverrides: { length_m: 9 } },

      { type:'pipe', subtype:'expander', icon:'◀', desc:'Diameter expansion',
        defaultOverrides: { length_m: 9 } },
    ],
  },
  {
    group: 'Valves',
    items: [
      { type:'valve', subtype:'gate', icon:'⦿', desc:'Gate / K=0.20' },
    ],
  },
  {
    group: 'Pump',
    items: [
      { type:'pump', subtype:'centrifugal', icon:'⦿', desc:'Gate / K=0.20' },
    ],
  },

];

/** type:subtype → catalog item için hızlı arama */
export const CATALOG_MAP = new Map(
  CATALOG_DEF.flatMap(g => g.items.map(item => [`${item.type}:${item.subtype}`, item]))
);
