/* Two-species Gray–Scott chemistry in a record-shaped reaction vessel.
   A generation is two forward-Euler substeps, dt = 0.5, dx = 1.
   Du = 0.16; Dv = Du / dR. With dR >= 1, D*dt/dx² <= 0.08,
   below the 5-point diffusion CFL bound of 0.25. For u,v in [0,1],
   dt*(4*Du + v*v + F) <= 0.87 and dt*(4*Dv + F+k+loss) <= 0.45:
   neither species can acquire a negative Euler coefficient. Each substep
   clamps concentrations to [0,1]; clipped counts expose any lost stability.
   Edges are impermeable (missing neighbours are the cell itself).
   Cards are live at v > 0.18; four concentration bands are printed flats. */
(() => {
  const threshold = 0.18;
  // Weakest candidate first: higher V, then older age, then lower index wins.
  function weaker(S, a, b) {
    return S.v[a] < S.v[b] || (S.v[a] === S.v[b] &&
      (S.age[a] < S.age[b] || (S.age[a] === S.age[b] && a > b)));
  }
  function rankFaces(S) {
    const cap = S.live >> 2, heap = S.faceHeap, face = S.V.face;
    let count = 0;
    for (let i = 0; i < S.n; i++) {
      if (!face[i]) continue;
      face[i] = 0;
      if (!cap) continue;
      if (count < cap) {
        let at = count++;
        while (at) {
          const parent = (at - 1) >> 1;
          if (!weaker(S, i, heap[parent])) break;
          heap[at] = heap[parent];
          at = parent;
        }
        heap[at] = i;
      } else if (weaker(S, heap[0], i)) {
        let at = 0;
        while (2 * at + 1 < count) {
          let child = 2 * at + 1;
          if (child + 1 < count && weaker(S, heap[child + 1], heap[child])) child++;
          if (!weaker(S, heap[child], i)) break;
          heap[at] = heap[child];
          at = child;
        }
        heap[at] = i;
      }
    }
    for (let i = 0; i < count; i++) face[heap[i]] = 1;
  }
  function paint(S, advance = true) {
    const V = S.V;
    let live = 0, births = 0, deaths = 0;
    for (let i = 0; i < S.n; i++) {
      const v = S.v[i], delta = v - S.before[i];
      const on = v > threshold, was = V.live[i];
      V.live[i] = on ? 1 : 0;
      if (on) {
        live++;
        S.age[i] = was ? (advance && S.age[i] < 65535 ? S.age[i] + 1 : S.age[i]) : 1;
        V.col[i] = v < 0.24 ? 6 : v < 0.31 ? 2 : v < 0.39 ? 4 : 7;
        // Eyes belong to mature, concentrated cores, not every old front.
        V.face[i] = S.age[i] >= 60 && v >= 0.30 &&
          2 * v >= S.v[S.left[i]] + S.v[S.right[i]] &&
          2 * v >= S.v[S.up[i]] + S.v[S.down[i]] ? 1 : 0;
        // A falling concentration at a thin neck or front signals fission/retreat.
        // Detect onset, not every frame: the card gets a full turn then unfolds.
        if (advance) {
          const retreat = delta < -0.001 && v < 0.3;
          V.flip[i] = retreat && !S.retreat[i] ? 1 : (V.flip[i] > 0.09 ? V.flip[i] - 0.09 : 0);
          S.retreat[i] = retreat ? 1 : 0;
        }
        // The app fades sparks once per rendered frame; worlds only raise them.
        if (!was) V.spark[i] = 1;
      } else {
        S.age[i] = 0;
        S.retreat[i] = 0;
        V.face[i] = 0;
        V.flip[i] = 0;
        V.lift[i] = 0;
        V.spin[i] = 0;
      }
      if (on && !was) births++;
      if (!on && was) deaths++;
    }
    S.live = live;
    if (advance) { S.births = births; S.deaths = deaths; }
    rankFaces(S);
  }
  defWorld({
    id: 'rd', label: 'REACTION',
    blurb: 'A mask-confined two-chemical reef; the eyes are old, concentrated, concave cells.',
    params: [
      { key: 'F', label: 'feed F', min: 0.01, max: 0.09, step: 0.001, def: 0.037 },
      { key: 'k', label: 'kill k', min: 0.04, max: 0.07, step: 0.001, def: 0.06 },
      { key: 'dR', label: 'diffusion U / V', min: 1, max: 4, step: 0.05, def: 2 },
      { key: 'drive', label: 'record modulation', min: 0, max: 1, step: 0.05, def: 0.6 }
    ],
    init(w, h, field, rng, PAR) {
      const n = w * h;
      const S = {
        w, h, n, gen: 0, live: 0, births: 0, deaths: 0, clipped: 0,
        rng, shakePending: false,
        u: new Float32Array(n), v: new Float32Array(n),
        un: new Float32Array(n), vn: new Float32Array(n),
        before: new Float32Array(n), age: new Uint16Array(n),
        retreat: new Uint8Array(n),
        faceHeap: new Int32Array(n),
        left: new Int32Array(n), right: new Int32Array(n),
        up: new Int32Array(n), down: new Int32Array(n), V: newView(n)
      };
      const modulation = clamp(PAR.drive ?? 0.6, 0, 1);
      S.u.fill(1);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        S.left[i] = x ? i - 1 : i;
        S.right[i] = x < w - 1 ? i + 1 : i;
        S.up[i] = y ? i - w : i;
        S.down[i] = y < h - 1 ? i + w : i;
      }
      // Independent nuclei make modulation=0 a genuine record-free control.
      // Draw the same random numbers regardless of the field or modulation.
      for (let y = 2; y < h - 2; y += 7) for (let x = 2; x < w - 2; x += 7) {
        const chance = rng(), jitter = rng();
        const cx = clamp(x + (jitter * 3 | 0) - 1, 1, w - 2);
        const cy = clamp(y + (rng() * 3 | 0) - 1, 1, h - 2);
        const i = cy * w + cx;
        const record = modulation * field.mask[i];
        if (chance > 0.14 + 0.64 * record) continue;
        for (let yy = cy - 1; yy <= cy + 1; yy++) for (let xx = cx - 1; xx <= cx + 1; xx++) {
          const j = yy * w + xx;
          S.v[j] = 0.27 + 0.04 * jitter;
          S.u[j] = 1 - S.v[j];
        }
      }
      // Weak background substrate plus discrete nuclei avoids exciting a dense
      // mask all at once into a uniform slab (and its synchronized collapse).
      for (let i = 0; i < n; i++) if (modulation > 0 && field.mask[i]) {
        S.v[i] = Math.max(S.v[i], modulation * (0.025 + 0.025 * field.amp[i]));
        S.u[i] = 1 - S.v[i];
      }
      S.before.set(S.v);
      paint(S);
      S.births = 0;
      return S;
    },
    shake(S, field, power) {
      const kick = clamp(power, 0, 1);
      const beforeLive = S.live, beforeBirths = S.births, beforeDeaths = S.deaths;
      let injected = 0;
      if (kick > 0) {
        // Select a seeded frontier without allocating an eligible-cell list.
        let eligible = 0;
        for (let i = 0; i < S.n; i++) if (field.mask[i] && S.v[i] >= 0.14 && S.v[i] < 0.30) eligible++;
        const frontier = eligible > 0;
        if (!frontier) for (let i = 0; i < S.n; i++) if (field.mask[i]) eligible++;
        if (eligible) {
          let pick = S.rng() * eligible | 0, centre = 0;
          for (let i = 0; i < S.n; i++) {
            if (!field.mask[i] || (frontier && (S.v[i] < 0.14 || S.v[i] >= 0.30))) continue;
            if (pick-- === 0) { centre = i; break; }
          }
          const cx = centre % S.w, cy = centre / S.w | 0;
          const radius = Math.max(2, 0.045 * Math.min(S.w, S.h)) * (0.5 + 0.5 * kick);
          const radius2 = radius * radius, pulse = 0.025 * kick;
          const x0 = Math.max(0, Math.floor(cx - radius)), x1 = Math.min(S.w - 1, Math.ceil(cx + radius));
          const y0 = Math.max(0, Math.floor(cy - radius)), y1 = Math.min(S.h - 1, Math.ceil(cy + radius));
          S.before.set(S.v);
          S.births = 0; S.deaths = 0;
          for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
            const i = y * S.w + x, distance2 = (x - cx) ** 2 + (y - cy) ** 2;
            if (!field.mask[i] || distance2 >= radius2) continue;
            const old = S.v[i];
            // A bounded chemical injection, not a cell-state or view override.
            S.v[i] = old + pulse * (1 - distance2 / radius2) * (1 - old);
            injected += S.v[i] - old;
            if (old <= threshold && S.v[i] > threshold) { S.live++; S.births++; }
          }
          S.shakePending = true;
        }
      }
      return 'kick ' + kick.toFixed(2) + ' · reef ' + beforeLive + '→' + S.live +
        ' · births ' + beforeBirths + '→' + S.births + ' · retreats ' + beforeDeaths + '→' + S.deaths +
        ' · V+ ' + injected.toFixed(4);
    },
    step(S, field, PAR) {
      if (S.shakePending) { paint(S, false); S.shakePending = false; }
      const feed = clamp(PAR.F ?? 0.037, 0.01, 0.09);
      const kill = clamp(PAR.k ?? 0.06, 0.04, 0.07);
      const dv = 0.16 / clamp(PAR.dR ?? 2, 1, 4);
      const mod = clamp(PAR.drive ?? 0.6, 0, 1);
      S.before.set(S.v);
      for (let sub = 0; sub < 2; sub++) {
        const U = S.u, V = S.v, un = S.un, vn = S.vn;
        for (let i = 0; i < S.n; i++) {
          const left = S.left[i], right = S.right[i], up = S.up[i], down = S.down[i];
          const u = U[i], v = V[i];
          // These coefficients are read from the live record every generation.
          // Amplitude increases both supply and turnover. Off-mask substrate
          // loses V, so diffusion can spill across an edge but cannot colonize it.
          const signal = field.mask[i] ? 0.25 + 0.75 * field.amp[i] : 0;
          const localFeed = feed + mod * 0.016 * (signal - 0.4);
          const localKill = kill + mod * 0.002 * (signal - 0.3);
          const loss = mod * 0.08 * (1 - field.mask[i]);
          const F = localFeed < 0.005 ? 0.005 : localFeed > 0.1 ? 0.1 : localFeed;
          const k = localKill < 0.04 ? 0.04 : localKill > 0.075 ? 0.075 : localKill;
          const reaction = u * v * v;
          const nextU = u + 0.5 * (0.16 * (U[left] + U[right] + U[up] + U[down] - 4 * u) - reaction + F * (1 - u));
          const nextV = v + 0.5 * (dv * (V[left] + V[right] + V[up] + V[down] - 4 * v) + reaction - (F + k + loss) * v);
          if (nextU < 0 || nextU > 1 || nextV < 0 || nextV > 1) S.clipped++;
          un[i] = nextU < 0 ? 0 : nextU > 1 ? 1 : nextU;
          vn[i] = nextV < 0 ? 0 : nextV > 1 ? 1 : nextV;
        }
        S.u = un; S.un = U;
        S.v = vn; S.vn = V;
      }
      S.gen++;
      paint(S);
    },
    stats(S) { return S.live; },
    view(S) {
      if (S.shakePending) { paint(S, false); S.shakePending = false; }
      return S.V;
    },
    HUD(S) { return 'reef ' + S.live + ' · births ' + S.births + ' · retreats ' + S.deaths + ' · step ' + S.gen; }
  });
})();
