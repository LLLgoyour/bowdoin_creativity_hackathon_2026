/* Conway's family on a record-shaped seed, with optional live row-loudness rules. */
(() => {
  const rules = [
    ['LIFE', '3', '23', '#57ac4a'],
    ['HIGHLIFE', '36', '23', '#4c93d8'],
    ['MAZE', '3', '12345', '#d4527e'],
    ['2×2', '36', '125', '#9c8b5a'],
    ['CORAL', '3', '45678', '#e8613c'],
    ['DIAMOEBA', '35678', '5678', '#2fb3a6'],
    ['DAY&NIGHT', '3678', '34678', '#8a63d2'],
    ['SEEDS', '2', '', '#f6c344']
  ];
  function mask(digits) {
    let bits = 0;
    for (let j = 0; j < digits.length; j++) bits |= 1 << Number(digits[j]);
    return bits;
  }
  for (let r = 0; r < rules.length; r++) {
    const a = rules[r], col = PAL.length;
    PAL.push(a[3], mixHex(a[3], INK, 0.10), mixHex(a[3], INK, 0.30),
      mixHex(a[3], '#fffdf4', 0.38));
    rules[r] = {name:a[0], B:mask(a[1]), S:mask(a[2]), text:'B' + a[1] + '/S' + a[2], col};
  }

  function pickRows(S, field, PAR) {
    const uniform = clamp(PAR.rule == null ? 0 : PAR.rule | 0, 0, 7);
    for (let y = 0; y < S.h; y++) {
      let r = uniform;
      if (PAR.ruleRows) {
        let sum = 0;
        for (let x = 0; x < S.w; x++) sum += field.amp[y * S.w + x];
        r = clamp(Math.floor(sum / S.w * 8 - 1e-9), 0, 7);
      }
      S.rowRule[y] = r;
    }
  }

  function older(ages, a, b) {
    return ages[a] > ages[b] || (ages[a] === ages[b] && a < b);
  }

  defWorld({
    id:'life', label:'LIFE',
    blurb:'Classic Life on the record’s footprint; optional falling is a variant, off by default.',
    note:'GSFC grid-k4, 52×52, generation 240: no fall has 68 live at centroid row 21.93; toroidal fall has 59 at row 18.07 (row 31.25 at generation 60). A separate, unshipped floor-only transport experiment piled at row 47.84 but collapsed to 19 live. Toroidal falling recirculates; it does not accumulate.',
    params:[
      {key:'rule', label:'rule', min:0, max:7, step:1, def:0,
        options:rules.map((rule, value) => ({value, label:rule.name}))},
      {key:'ruleRows', label:'rule per row from loudness', min:0, max:1, step:1, def:0},
      {key:'wrap', label:'wrap edges', min:0, max:1, step:1, def:1},
      {key:'gravity', label:'falling variant', min:0, max:1, step:1, def:0}
    ],
    init(w, h, field, rng, PAR) {
      const n = w * h;
      const S = {w, h, n, rng, gen:0, live:0, births:0, deaths:0,
        st:new Uint8Array(n), age:new Uint16Array(n), nb:new Uint8Array(n),
        falling:new Uint8Array(n), rowRule:new Uint8Array(h), faces:new Int32Array(n), V:newView(n)};
      for (let i = 0; i < n; i++) if (field.mask[i]) {
        S.st[i] = 1;
        S.age[i] = (rng() * 30) | 0;
        S.live++;
      }
      pickRows(S, field, PAR);
      return S;
    },
    step(S, field, PAR) {
      const w = S.w, h = S.h, st = S.st, nb = S.nb, age = S.age;
      const V = S.V, wrap = PAR.wrap == null || !!PAR.wrap;
      pickRows(S, field, PAR);
      nb.fill(0);
      for (let y = 0; y < h; y++) {
        const up = y ? y - 1 : wrap ? h - 1 : -1;
        const down = y + 1 < h ? y + 1 : wrap ? 0 : -1;
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (!st[i]) continue;
          const left = x ? x - 1 : wrap ? w - 1 : -1;
          const right = x + 1 < w ? x + 1 : wrap ? 0 : -1;
          if (up >= 0) {
            if (left >= 0) nb[up * w + left]++;
            nb[up * w + x]++;
            if (right >= 0) nb[up * w + right]++;
          }
          if (left >= 0) nb[y * w + left]++;
          if (right >= 0) nb[y * w + right]++;
          if (down >= 0) {
            if (left >= 0) nb[down * w + left]++;
            nb[down * w + x]++;
            if (right >= 0) nb[down * w + right]++;
          }
        }
      }
      let live = 0, births = 0, deaths = 0;
      for (let y = 0; y < h; y++) {
        const rule = rules[S.rowRule[y]];
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          V.flip[i] = Math.max(0, V.flip[i] - 0.09);
          const count = nb[i];
          if (st[i]) {
            if ((rule.S >>> count) & 1) {
              if (age[i] < 65000) age[i]++;
              live++;
            } else {
              st[i] = 0;
              age[i] = 0;
              V.flip[i] = 1;
              V.spark[i] = 0;
              deaths++;
            }
          } else if ((rule.B >>> count) & 1) {
            st[i] = 1;
            age[i] = 0;
            V.flip[i] = 0;
            V.spark[i] = S.rng() < 0.12 ? 1 : 0;
            births++;
            live++;
          }
        }
      }
      if (PAR.gravity) {
        // Decide from the post-rule board: a cell falls at most one row, even
        // across the torus seam. Its age and birth flash travel with the card.
        const falling = S.falling;
        falling.fill(0);
        for (let y = 0; y < h; y++) {
          const down = y + 1 < h ? y + 1 : wrap ? 0 : -1;
          if (down < 0) continue;
          for (let x = 0; x < w; x++) {
            const i = y * w + x, j = down * w + x;
            if (st[i] && !st[j]) falling[i] = 1;
          }
        }
        for (let y = 0; y < h; y++) {
          const down = y + 1 < h ? y + 1 : 0;
          for (let x = 0; x < w; x++) {
            const i = y * w + x;
            if (!falling[i]) continue;
            const j = down * w + x;
            st[j] = 1; st[i] = 0;
            age[j] = age[i]; age[i] = 0;
            V.spark[j] = V.spark[i]; V.spark[i] = 0;
            V.flip[j] = 0;
          }
        }
      }
      S.gen++;
      S.live = live;
      S.births = births;
      S.deaths = deaths;
    },
    shake(S, field, power) {
      const p = clamp(power, 0, 1), before = S.live, chance = p / 8;
      let births = 0, rejuvenated = 0;
      // Disturb only the record's footprint, without erasing the colony or
      // advancing time. The next ordinary B/S generation reorganises this seed.
      if (chance > 0) {
        for (let i = 0; i < S.n; i++) {
          if (!field.mask[i] || S.rng() >= chance) continue;
          if (!S.st[i]) { S.st[i] = 1; births++; }
          else if (S.age[i] > 0) rejuvenated++;
          S.age[i] = 0;
        }
        S.live += births;
        S.births = births;
        S.deaths = 0;
      }
      return 'power=' + p.toFixed(2) + ' births=' + births + ' deaths=0 pop=' +
        before + '->' + S.live + ' rejuvenated=' + rejuvenated;
    },
    stats(S) { return S.live; },
    view(S) {
      const V = S.V, candidates = S.faces, quota = S.live >> 2;
      let eligible = 0;
      for (let y = 0; y < S.h; y++) {
        const col = rules[S.rowRule[y]].col;
        for (let x = 0; x < S.w; x++) {
          const i = y * S.w + x, age = S.age[i];
          V.live[i] = S.st[i];
          // A shake can revive a fading cell without touching view buffers.
          if (S.st[i]) V.flip[i] = 0;
          V.col[i] = col + (S.st[i] ? age < 3 ? 3 : age < 26 ? 0 : 2 : 1);
          V.face[i] = 0;
          if (quota && S.st[i] && age >= 12) candidates[eligible++] = i;
        }
      }
      const count = Math.min(quota, eligible);
      if (count > 0) {
        // Partition the oldest quarter in place. Equal ages use grid index,
        // so a tiny colony cannot turn an age-percentile tie into all eyes.
        let left = 0, right = eligible - 1;
        const k = count - 1;
        while (left < right) {
          const pivot = candidates[(left + right) >> 1];
          let a = left, b = right;
          while (a <= b) {
            while (older(S.age, candidates[a], pivot)) a++;
            while (older(S.age, pivot, candidates[b])) b--;
            if (a <= b) {
              const t = candidates[a]; candidates[a] = candidates[b]; candidates[b] = t;
              a++; b--;
            }
          }
          if (k <= b) right = b;
          else if (k >= a) left = a;
          else break;
        }
        for (let i = 0; i < count; i++) V.face[candidates[i]] = 1;
      }
      return V;
    },
    HUD(S, field, PAR) {
      const rule = rules[clamp(PAR.rule == null ? 0 : PAR.rule | 0, 0, 7)];
      return (PAR.ruleRows ? 'rule per row · loudness' : rule.name + ' ' + rule.text) +
        ' · gen ' + S.gen + ' · ' + S.live + ' live · +' + S.births + '/−' + S.deaths +
        (PAR.gravity ? (PAR.wrap === 0 ? ' · floor fall variant' : ' · toroidal fall variant') : '');
    }
  });
})();
