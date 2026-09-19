/* Kuramoto dynamics on the record's induced four-neighbour graph, with wrap.
   omega = detune * (0.35*freq + spread_eff*(amp - mean masked amp)) radians
   per simulation-time unit. Coupling is the mean over PRESENT neighbours only.
   spread_eff = spread*(w*h/2704)^0.25. This is the smallest tested exponent
   (0,.15,.25,.35,.5) keeping GSFC path locking below 90% at 52, 76 and 120.
   Euler substeps preserve h and keep dt*(2*K + drive) <= 0.9; a second bound
   limits relative natural rotation so bond crossings cannot alias by a turn.
   Geometry and pin phases are immutable until init; freq, amp and PAR stay live. */
(() => {
  const PI = Math.PI, TAU = 2 * PI, OMEGA = 0.35;
  const {sin, cos, sqrt, floor, ceil, max, abs} = Math;

  // Exact coherence ordering; ties favour the lower cell index deterministically.
  function weaker(r, i, j) { return r[i] < r[j] || (r[i] === r[j] && i > j); }

  function present(S, field, advance) {
    const {active, degree, neighbours, cs, sn, localR, V, faceHeap} = S;
    let locked = 0, sumC = 0, sumS = 0, faces = 0;
    for (let a = 0; a < active.length; a++) {
      const i = active[a], count = degree[a], offset = a * 4;
      let c = 0, s = 0;
      for (let b = 0; b < count; b++) {
        const j = neighbours[offset + b];
        c += cs[j];
        s += sn[j];
      }
      if (count) { c /= count; s /= count; }
      const r = sqrt(c * c + s * s), was = localR[i], isLocked = r > 0.9;
      // Isolated cells have no local order, but still show their own rhythm.
      if (!count) { c = cs[i]; s = sn[i]; }
      // Exact 45-degree octants, spanning the complete circle, without atan2.
      V.col[i] = s >= 0
        ? (c >= 0 ? (s < c ? 4 : 5) : (s > -c ? 6 : 7))
        : (c < 0 ? (-s < -c ? 0 : 1) : (-s > c ? 2 : 3));
      if (advance) S.lockAge[a] = r > 0.99 ? Math.min(20, S.lockAge[a] + 1) : 0;
      V.face[i] = 0;
      V.lift[i] = -0.05 * field.amp[i];
      if (advance) {
        V.flip[i] = S.slipped[a] ? 1 : max(0, V.flip[i] - 0.12);
        V.spark[i] = isLocked && was <= 0.9 ? 1 : max(0, V.spark[i] - 0.12);
      }
      localR[i] = r;
      // Even r>.99 sustained for 20 generations covers 51–63% of GSFC cards.
      // Keep the strongest eligible fifth: eyes distinguish deep domain cores,
      // rather than decorating almost every oscillator. Storage is reused.
      if (S.lockAge[a] >= 20 && faceHeap.length) {
        if (faces < faceHeap.length) {
          let p = faces++;
          while (p) {
            const parent = (p - 1) >> 1;
            if (!weaker(localR, i, faceHeap[parent])) break;
            faceHeap[p] = faceHeap[parent];
            p = parent;
          }
          faceHeap[p] = i;
        } else if (weaker(localR, faceHeap[0], i)) {
          let p = 0;
          while (p * 2 + 1 < faces) {
            let child = p * 2 + 1;
            if (child + 1 < faces && weaker(localR, faceHeap[child + 1], faceHeap[child])) child++;
            if (!weaker(localR, faceHeap[child], i)) break;
            faceHeap[p] = faceHeap[child];
            p = child;
          }
          faceHeap[p] = i;
        }
      }
      if (isLocked) locked++;
      sumC += cs[i];
      sumS += sn[i];
    }
    for (let a = 0; a < faces; a++) V.face[faceHeap[a]] = 1;
    S.faces = faces;
    S.locked = locked;
    S.order = S.visible ? sqrt(sumC * sumC + sumS * sumS) / S.visible : 0;
  }

  defWorld({
    id: 'synch', label: 'SYNCHRONY',
    blurb: 'Global r measures whole-board phase agreement; locally locked counts neighbour order >0.9.',
    params: [
      {key: 'K', label: 'coupling', min: 0, max: 8, step: 0.1, def: 2.4},
      {key: 'detune', label: 'record detune', min: 0, max: 4, step: 0.05, def: 1},
      {key: 'spread', label: 'energy spread', min: 0, max: 3, step: 0.05, def: 2.4},
      {key: 'drive', label: 'record pull', min: 0, max: 2, step: 0.01, def: 0.5},
      {key: 'h', label: 'step', min: 0.02, max: 0.3, step: 0.01, def: 0.1}
    ],
    init(w, h, field, rng, PAR) {
      const n = w * h;
      let visible = 0;
      for (let i = 0; i < n; i++) if (field.mask[i]) visible++;
      const S = {
        w, h, n, visible, generation: 0, order: 0, locked: 0, substeps: 1,
        rng, shakePending: false, shakeSlipBonds: 0,
        meanAmp: 0, slipBonds: 0, bonds: 0,
        spreadScale: Math.pow(n / 2704, 0.25), lockAge: new Uint8Array(visible),
        faces: 0, faceHeap: new Int32Array(floor(visible * 0.2)),
        active: new Int32Array(visible), degree: new Uint8Array(visible),
        neighbours: new Int32Array(visible * 4), bondPhase: new Float32Array(visible * 4),
        slipped: new Uint8Array(visible), theta: new Float32Array(n), next: new Float32Array(n),
        cs: new Float32Array(n), sn: new Float32Array(n),
        pinCS: new Float32Array(n), pinSN: new Float32Array(n),
        delta: new Float32Array(n), localR: new Float32Array(n), V: newView(n)
      };
      let a = 0, amplitude = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!field.mask[i]) continue;
        S.active[a] = i;
        S.V.live[i] = 1;
        amplitude += field.amp[i];
        S.pinCS[i] = cos(field.ph[i]);
        S.pinSN[i] = sin(field.ph[i]);
        const angle = field.ph[i] + (rng() * 2 - 1) * 0.02;
        S.theta[i] = angle - floor(angle / TAU) * TAU;
        S.cs[i] = cos(S.theta[i]);
        S.sn[i] = sin(S.theta[i]);
        let count = 0;
        for (let b = 0; b < 4; b++) {
          const j = b === 0 ? y * w + (x ? x - 1 : w - 1)
            : b === 1 ? y * w + (x + 1 < w ? x + 1 : 0)
            : b === 2 ? (y ? y - 1 : h - 1) * w + x
            : (y + 1 < h ? y + 1 : 0) * w + x;
          if (field.mask[j] && j !== i) S.neighbours[a * 4 + count++] = j;
        }
        S.degree[a] = count;
        S.bonds += count;
        a++;
      }
      S.meanAmp = visible ? amplitude / visible : 0;
      for (a = 0; a < visible; a++) {
        const i = S.active[a];
        for (let b = 0; b < S.degree[a]; b++) {
          const offset = a * 4 + b, d = S.theta[S.neighbours[offset]] - S.theta[i];
          S.bondPhase[offset] = d - floor((d + PI) / TAU) * TAU;
        }
      }
      present(S, field, false);
      return S;
    },
    shake(S, field, power) {
      const kick = clamp(power, 0, 1), before = S.order, lockedBefore = S.locked;
      if (kick > 0) {
        const {active, theta, cs, sn, delta, neighbours, degree, bondPhase} = S;
        if (!S.shakePending) { S.slipped.fill(0); S.shakeSlipBonds = 0; }
        for (let a = 0; a < active.length; a++) {
          const i = active[a], d = (S.rng() * 2 - 1) * PI * kick;
          delta[i] = d;
          const angle = theta[i] + d;
          theta[i] = angle - floor(angle / TAU) * TAU;
          cs[i] = cos(theta[i]);
          sn[i] = sin(theta[i]);
        }
        let sumC = 0, sumS = 0, locked = 0;
        for (let a = 0; a < active.length; a++) {
          const i = active[a], count = degree[a];
          let c = 0, s = 0;
          for (let b = 0; b < count; b++) {
            const offset = a * 4 + b, j = neighbours[offset];
            c += cs[j]; s += sn[j];
            // Count crossings along the actual kick, including a relative jump
            // exceeding pi. Rebase the bond so the next step cannot double-count.
            const crossings = abs(floor((bondPhase[offset] + delta[j] - delta[i] + PI) / TAU));
            if (crossings) { S.slipped[a] = 1; S.shakeSlipBonds += crossings; }
            const relative = theta[j] - theta[i];
            bondPhase[offset] = relative - floor((relative + PI) / TAU) * TAU;
          }
          const r = count ? sqrt(c * c + s * s) / count : 0;
          S.localR[i] = r;
          if (r > 0.9) locked++;
          if (r <= 0.99) S.lockAge[a] = 0;
          sumC += cs[i]; sumS += sn[i];
        }
        S.order = S.visible ? sqrt(sumC * sumC + sumS * sumS) / S.visible : 0;
        S.locked = locked;
        S.shakePending = true;
      }
      // Recovery is a future observation, never a forecast in an impulse HUD.
      return 'kick ' + kick.toFixed(2) + ' · global r ' + before.toFixed(4) + '→' + S.order.toFixed(4) +
        ' · locally locked ' + lockedBefore + '→' + S.locked + '/' + S.visible;
    },
    step(S, field, PAR) {
      const K = PAR.K, detune = PAR.detune, drive = PAR.drive;
      const spread = PAR.spread * S.spreadScale;
      const rateBound = max(2 * K + drive, 2 * detune * (OMEGA + spread));
      const substeps = max(1, ceil(PAR.h * rateBound / 0.9)), dt = PAR.h / substeps;
      const {active, degree, neighbours, cs, sn, pinCS, pinSN, delta, bondPhase, slipped} = S;
      S.substeps = substeps;
      if (S.shakePending) {
        S.slipBonds = S.shakeSlipBonds;
        S.shakePending = false;
      } else {
        S.slipBonds = 0;
        slipped.fill(0);
      }
      for (let a = 0; a < active.length; a++) delta[active[a]] = 0;
      for (let k = 0; k < substeps; k++) {
        const theta = S.theta, next = S.next;
        for (let a = 0; a < active.length; a++) {
          const i = active[a], count = degree[a];
          let c = 0, s = 0;
          for (let b = 0; b < count; b++) {
            const j = neighbours[a * 4 + b];
            c += cs[j];
            s += sn[j];
          }
          const coupling = count ? (s * cs[i] - c * sn[i]) / count : 0;
          const pin = pinSN[i] * cs[i] - pinCS[i] * sn[i];
          const omega = detune * (OMEGA * field.freq[i] + spread * (field.amp[i] - S.meanAmp));
          const d = dt * (omega + K * coupling + drive * field.amp[i] * pin);
          delta[i] += d;
          const angle = theta[i] + d;
          next[i] = angle - floor(angle / TAU) * TAU;
        }
        S.theta = next;
        S.next = theta;
        for (let a = 0; a < active.length; a++) {
          const i = active[a];
          cs[i] = cos(next[i]);
          sn[i] = sin(next[i]);
          // Directed bonds count separately. A crossing and return within one
          // generation still flips the two endpoint cards, never other cells.
          for (let b = 0; b < degree[a]; b++) {
            const offset = a * 4 + b, d = next[neighbours[offset]] - next[i];
            const relative = d - floor((d + PI) / TAU) * TAU;
            if (abs(relative - bondPhase[offset]) > PI) {
              slipped[a] = 1;
              S.slipBonds++;
            }
            bondPhase[offset] = relative;
          }
        }
      }
      S.generation++;
      present(S, field, true);
    },
    stats(S) { return S.locked; },
    view(S) { return S.V; },
    HUD(S, field, PAR) {
      return 'global r ' + S.order.toFixed(2) + ' · locally locked ' + S.locked + '/' + S.visible +
        ' · K ' + PAR.K.toFixed(1);
    }
  });
})();
