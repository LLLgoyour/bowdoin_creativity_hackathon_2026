/* Pure record -> geometry. Helpers stay private; only the four parsers escape. */
const {parseNumeric, prepRecord, makeNoise, fieldFromImage} = (() => {
  const math = Math, bound = clamp, blend = lerp;
  const TAU = 2 * math.PI;

  function parseNumeric(text) {
    const rows = [];
    let columns = 0;
    for (const line of String(text).split(/\r?\n/)) {
      const s = line.trim();
      if (!s || s[0] === '#' || s[0] === ';' || s[0] === '%') continue;
      const parts = s.split('#', 1)[0].trim().split(/[\s,;]+/);
      const values = parts.map(Number);
      if (!values.length || !values.every(Number.isFinite)) continue;
      const width = math.min(3, values.length);
      if (!columns) columns = width;
      if (width !== columns) continue;
      rows.push(values);
    }
    if (!rows.length) throw new Error('No numeric rows found.');
    const re = new Float64Array(rows.length), im = new Float64Array(rows.length);
    const t = new Float64Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
      t[i] = columns === 3 ? rows[i][0] : i;
      re[i] = rows[i][columns === 3 ? 1 : 0];
      im[i] = columns === 3 ? rows[i][2] : columns === 2 ? rows[i][1] : 0;
    }
    return {re, im, t, kind:columns === 1 ? 'numeric' : 'complex'};
  }

  function quadrature(samples) {
    let size = 1;
    while (size < samples.length) size *= 2;
    const re = new Float64Array(size), im = new Float64Array(size);
    re.set(samples);
    fft(re, im);
    for (let i = 1; i < size / 2; i++) {re[i] *= 2; im[i] *= 2;}
    for (let i = (size >> 1) + 1; i < size; i++) {re[i] = 0; im[i] = 0;}
    for (let i = 0; i < size; i++) im[i] = -im[i];
    fft(re, im);
    const result = new Float64Array(samples.length);
    for (let i = 0; i < result.length; i++) result[i] = -im[i] / size;
    return result;
  }

  function imageSeries(obj) {
    const {rgba, width, height} = obj;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || !rgba || rgba.length !== width * height * 4)
      throw new Error('Image pixels do not match their source dimensions.');
    let side = 1;
    while (side < math.max(width, height)) side *= 2;
    const re = new Float64Array(side * side), t = new Float64Array(side * side);
    for (let d = 0; d < re.length; d++) {
      let x = 0, y = 0, index = d;
      for (let scale = 1; scale < side; scale *= 2) {
        const rx = (index >> 1) & 1, ry = (index ^ rx) & 1;
        if (!ry) {
          if (rx) {x = scale - 1 - x; y = scale - 1 - y;}
          const swap = x; x = y; y = swap;
        }
        x += scale * rx; y += scale * ry; index >>= 2;
      }
      const sx = math.floor(x * width / side), sy = math.floor(y * height / side), p = (sy * width + sx) * 4;
      re[d] = (0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2]) * rgba[p + 3] / 65025;
      t[d] = d;
    }
    return {re, im:quadrature(re), t, timeUnit:'Hilbert steps', frequencyUnit:'cycles/Hilbert-step', provenance:'Image luminance follows a ' + side + '×' + side +
      ' Hilbert-curve scan (neighbour-preserving nearest resampling from ' + width + '×' + height +
      '); phase is analytic quadrature and frequency is cycles per Hilbert step, not physical Hz.'};
  }

  function audioSeries(obj) {
    if (!Number.isFinite(obj.sr) || obj.sr <= 0 || !obj.samples || !obj.samples.length)
      throw new Error('Audio needs mono samples and a positive sample rate.');
    const re = Float64Array.from(obj.samples), t = new Float64Array(re.length), amp = new Float64Array(re.length);
    const radius = math.max(1, math.round(obj.sr * 0.01));
    let left = 0, right = 0, energy = 0;
    for (let i = 0; i < re.length; i++) {
      if (!Number.isFinite(re[i])) throw new Error('Audio samples must be finite.');
      const end = math.min(re.length, i + radius + 1), start = math.max(0, i - radius);
      while (right < end) {energy += re[right] * re[right]; right++;}
      while (left < start) {energy -= re[left] * re[left]; left++;}
      amp[i] = math.sqrt(math.max(0, energy / (right - left))); t[i] = i / obj.sr;
    }
    return {re, im:quadrature(re), t, amp, timeUnit:'s', frequencyUnit:'Hz', provenance:'Mono audio at ' + obj.sr +
      ' samples/s; analytic Hilbert quadrature supplies phase, amplitude is a centred 20 ms RMS loudness envelope, and frequency is Hz.'};
  }

  function prepRecord(obj) {
    const kind = obj.kind || (obj.samples ? 'audio' : obj.rgba ? 'image' : obj.im == null ? 'numeric' : 'complex');
    if (!['numeric', 'complex', 'noise', 'image', 'audio'].includes(kind)) throw new Error('Unknown record kind: ' + kind);
    let envelope = null;
    if (kind === 'image') Object.assign(obj, imageSeries(obj));
    else if (kind === 'audio') {
      const decoded = audioSeries(obj);
      envelope = decoded.amp;
      Object.assign(obj, decoded);
    }
    const re = typeof obj.re === 'string' ? decodeF64(obj.re) : obj.re instanceof Float64Array ? obj.re : Float64Array.from(obj.re);
    const n = re.length;
    if (!n) throw new Error('The record is empty.');
    const im = typeof obj.im === 'string' ? decodeF64(obj.im) : obj.im == null ? new Float64Array(n) : obj.im instanceof Float64Array ? obj.im : Float64Array.from(obj.im);
    const t = typeof obj.t === 'string' ? decodeF64(obj.t) : obj.t == null ? Float64Array.from({length:n}, (_, i) => i) : obj.t instanceof Float64Array ? obj.t : Float64Array.from(obj.t);
    if (im.length !== n || t.length !== n) throw new Error('Record columns have different lengths.');
    const amp = new Float64Array(n), ph = new Float64Array(n);
    let amax = 0, previous = 0, accumulated = 0, origin = 0;
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(re[i]) || !Number.isFinite(im[i]) || !Number.isFinite(t[i])) throw new Error('Record values must be finite.');
      if (i && t[i] <= t[i - 1]) throw new Error('Record times must increase.');
      amp[i] = kind === 'image' ? re[i] : envelope ? envelope[i] : math.hypot(re[i], im[i]);
      amax = math.max(amax, amp[i]);
      const angle = math.atan2(im[i], re[i]);
      if (!i) origin = accumulated = angle;
      else {
        let delta = angle - previous;
        while (delta > math.PI) delta -= TAU;
        while (delta < -math.PI) delta += TAU;
        accumulated += delta;
      }
      ph[i] = accumulated;
      previous = angle;
    }
    if (kind === 'numeric' && amax) {
      for (let i = 0; i < n; i++) amp[i] /= amax;
      amax = 1;
    }
    const provenance = obj.provenance || (kind === 'noise' ? 'Seeded smoothed complex noise.' :
      kind === 'numeric' ? 'Numeric samples; amplitude is normalised magnitude.' : 'Complex samples; amplitude is complex magnitude.');
    return Object.assign(obj, {kind, provenance, re, im, t, amp, ph, amax, turns:math.abs(accumulated - origin) / TAU});
  }

  function makeNoise(seed) {
    const n = 773, rng = mulberry32(seed >>> 0);
    const re = new Float64Array(n), im = new Float64Array(n), t = new Float64Array(n);
    let a = 0, b = 0, c = 0, d = 0;
    for (let i = 0; i < n; i++) {
      a = 0.985 * a + (rng() - 0.5) * 0.9;
      b = 0.94 * b + (rng() - 0.5) * 0.5;
      c = 0.985 * c + (rng() - 0.5) * 0.9;
      d = 0.94 * d + (rng() - 0.5) * 0.5;
      re[i] = a + b; im[i] = c + d; t[i] = 0.780 + i * 0.3900156;
    }
    return {re, im, t, kind:'noise', name:'smoothed noise'};
  }

  function blank(w, h, id, label, note) {
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) throw new Error('Grid dimensions must be positive integers.');
    const n = w * h;
    return {w, h, id, label, note, amp:new Float32Array(n), ph:new Float32Array(n),
      freq:new Float32Array(n), mask:new Uint8Array(n), occ:new Float32Array(n)};
  }

  function occupancy(F, rec) {
    const {w, h, mask, occ} = F;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
        sum += mask[((y + dy + h) % h) * w + (x + dx + w) % w];
      occ[y * w + x] = sum / 9;
    }
    if (rec && rec.provenance) F.note += ' ' + rec.provenance;
    return F;
  }

  function frequencies(rec) {
    const n = rec.re.length, raw = new Float64Array(n), norm = new Float64Array(n);
    let min = Infinity, max = -Infinity, scale = 0;
    for (let i = 0; i < n; i++) {
      const a = math.max(0, i - 1), b = math.min(n - 1, i + 1);
      const value = a === b ? 0 : (rec.ph[b] - rec.ph[a]) / (TAU * (rec.t[b] - rec.t[a]));
      raw[i] = value;
      min = math.min(min, value); max = math.max(max, value); scale = math.max(scale, math.abs(value));
    }
    for (let i = 0; i < n; i++) norm[i] = scale ? raw[i] / scale : 0;
    return {raw, norm, min, max};
  }

  function geometryRecord(rec, count) {
    const n = rec.re.length;
    if (rec.smooth || n <= 4 * count) return rec;
    const re = new Float64Array(count), im = new Float64Array(count), t = new Float64Array(count);
    const amp = new Float64Array(count), ph = new Float64Array(count);
    for (let block = 0; block < count; block++) {
      const start = math.floor(block * n / count), end = math.floor((block + 1) * n / count), scale = 1 / (end - start);
      let r = 0, z = 0, time = 0, a = 0, phase = 0;
      for (let i = start; i < end; i++) {r += rec.re[i]; z += rec.im[i]; time += rec.t[i]; a += rec.amp[i]; phase += rec.ph[i];}
      re[block] = r * scale; im[block] = z * scale; t[block] = time * scale;
      amp[block] = a * scale; ph[block] = phase * scale;
    }
    return {...rec, re, im, t, amp, ph, provenance:rec.provenance + ' Geometry block-averages all ' + n +
      ' samples into ' + count + ' contiguous blocks; the frequency fields retain full-rate samples.'};
  }

  function path(rec, w, h) {
    rec = geometryRecord(rec, w * h);
    const F = blank(w, h, 'path', 'THE RECORD ITSELF',
      'x and y are Re h and Im h; brightness is sample amplitude: the record’s own path, ' +
      rec.turns.toFixed(2) + ' net turns, with fixed 4× supersampling and a ' +
      math.max(1, 0.5 * w / 240).toFixed(1) + '-cell brush radius.');
    const n = rec.re.length, fr = frequencies(rec), divisor = rec.amax || 1;
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (let i = 0; i < n; i++) {
      xmin = math.min(xmin, rec.re[i]); xmax = math.max(xmax, rec.re[i]);
      ymin = math.min(ymin, rec.im[i]); ymax = math.max(ymax, rec.im[i]);
    }
    const scale = 0.92 * math.max(0, math.min(w - 1, h - 1)) / (math.max(xmax - xmin, ymax - ymin) || 1);
    const cx = (xmin + xmax) / 2, cy = (ymin + ymax) / 2, W = w * 4, H = h * 4;
    const count = new Uint32Array(W * H), amps = new Float64Array(W * H), freq = new Float64Array(W * H);
    const phase = new Float64Array(W * H), last = new Float64Array(W * H);
    const radius = 4 * math.max(1, 0.5 * w / 240), r2 = radius * radius;
    for (let j = 0; j < math.max(1, n - 1); j++) {
      const a = j, b = math.min(n - 1, j + 1);
      const ax = 4 * ((w - 1) / 2 + (rec.re[a] - cx) * scale) + 2;
      const ay = 4 * ((h - 1) / 2 - (rec.im[a] - cy) * scale) + 2;
      const bx = 4 * ((w - 1) / 2 + (rec.re[b] - cx) * scale) + 2;
      const by = 4 * ((h - 1) / 2 - (rec.im[b] - cy) * scale) + 2;
      const dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy;
      const x0 = math.max(0, math.floor(math.min(ax, bx) - radius)), x1 = math.min(W - 1, math.ceil(math.max(ax, bx) + radius));
      const y0 = math.max(0, math.floor(math.min(ay, by) - radius)), y1 = math.min(H - 1, math.ceil(math.max(ay, by) + radius));
      const aa = rec.amp[a], ab = rec.amp[b], fa = fr.norm[a], fb = fr.norm[b], pa = rec.ph[a], pb = rec.ph[b];
      for (let y = y0; y <= y1; y++) {
        // A capsule only touches the part of a row near the segment, not its entire bounding box.
        const ta = dy ? bound((y + 0.5 - radius - ay) / dy, 0, 1) : 0;
        const tb = dy ? bound((y + 0.5 + radius - ay) / dy, 0, 1) : 1;
        const left = math.max(x0, math.floor(math.min(ax + ta * dx, ax + tb * dx) - radius));
        const right = math.min(x1, math.ceil(math.max(ax + ta * dx, ax + tb * dx) + radius));
        for (let x = left; x <= right; x++) {
        const t = length2 ? bound(((x + 0.5 - ax) * dx + (y + 0.5 - ay) * dy) / length2, 0, 1) : 0;
        const ex = x + 0.5 - ax - t * dx, ey = y + 0.5 - ay - t * dy;
        if (ex * ex + ey * ey > r2) continue;
        const i = y * W + x;
        count[i]++;
        amps[i] += blend(aa, ab, t) / divisor;
        freq[i] += blend(fa, fb, t);
        phase[i] = blend(pa, pb, t); last[i] = j + t;
      }
      }
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let on = 0, amp = 0, f = 0, latest = -1;
      for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) {
        const k = (y * 4 + dy) * W + x * 4 + dx;
        if (!count[k]) continue;
        on++; amp += amps[k] / count[k]; f += freq[k] / count[k];
        if (last[k] > latest) {latest = last[k]; F.ph[i] = phase[k];}
      }
      if (on) {F.mask[i] = 1; F.amp[i] = amp / on; F.freq[i] = f / on;}
    }
    return occupancy(F, rec);
  }

  function gapMedian(rec, count, ordinal) {
    if (rec.re.length < 2 || count < 2) return 0;
    const n = rec.re.length, k = math.min(ordinal, count - 1);
    const indices = new Int32Array(count), gaps = new Float64Array(count), best = new Float64Array(k);
    for (let i = 0; i < count; i++) indices[i] = math.round(i * (n - 1) / (count - 1));
    for (let i = 0; i < count; i++) {
      best.fill(Infinity);
      const a = indices[i];
      for (let j = 0; j < count; j++) {
        if (i === j) continue;
        const b = indices[j], dr = rec.re[a] - rec.re[b], di = rec.im[a] - rec.im[b], d = dr * dr + di * di;
        if (d >= best[k - 1]) continue;
        let rank = k - 1;
        while (rank && best[rank - 1] > d) {best[rank] = best[rank - 1]; rank--;}
        best[rank] = d;
      }
      gaps[i] = math.sqrt(best[k - 1]);
    }
    gaps.sort();
    return (gaps[(count - 1) >> 1] + gaps[count >> 1]) / 2;
  }

  function matrix(rec, w, h, PAR) {
    const original = rec;
    rec = geometryRecord(rec, math.max(w, h));
    const k = math.max(1, Number.isFinite(PAR && PAR.k) ? math.round(PAR.k) : 4);
    const F = blank(w, h, 'matrix', 'SELF-SIMILARITY', '');
    const n = rec.re.length, fr = frequencies(rec), divisor = rec.amax || 1;
    const cols = new Int32Array(w), distances = new Float64Array(w * h);
    const rawSpace = PAR && PAR.gapSpace === 'raw', sampleCount = rawSpace ? original.re.length : w;
    const eps = gapMedian(rawSpace ? original : rec, sampleCount, k), eps2 = eps * eps;
    for (let x = 0; x < w; x++) cols[x] = math.round(x * (n - 1) / math.max(1, w - 1));
    for (let y = 0; y < h; y++) {
      const a = math.round(y * (n - 1) / math.max(1, h - 1));
      let best = Infinity, link = a;
      for (let x = 0; x < w; x++) {
        const b = cols[x], dr = rec.re[a] - rec.re[b], di = rec.im[a] - rec.im[b], distance = dr * dr + di * di;
        distances[y * w + x] = distance;
        if (a !== b) {
          if (distance < best) {best = distance; link = b;}
        }
      }
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        F.amp[i] = rec.amp[a] / divisor; F.ph[i] = rec.ph[a];
        F.freq[i] = (fr.norm[a] + fr.norm[link]) / 2;
      }
    }
    const raw = new Uint8Array(w * h), dilated = new Uint8Array(w * h);
    for (let i = 0; i < raw.length; i++) raw[i] = distances[i] <= eps2 ? 1 : 0;
    /* Closing is dilation followed by erosion, both with a 3×3 toroidal box.
       Do not union kNN polylines or retain the intermediate dilation. */
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let on = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
        on |= raw[((y + dy + h) % h) * w + (x + dx + w) % w];
      dilated[y * w + x] = on;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let on = 1;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
        on &= dilated[((y + dy + h) % h) * w + (x + dx + w) % w];
      F.mask[y * w + x] = on;
    }
    let population = 0;
    for (let i = 0; i < F.mask.length; i++) population += F.mask[i];
    F.note = (rawSpace ? 'Original-record' : 'Board-resampled') + ' sample space: median ' + k +
      'th-neighbour gap among ' + sampleCount + ' points, eps = ' + eps.toFixed(6) +
      ' in raw strain units; ' + (100 * population / (w * h)).toFixed(2) +
      '% of this board after toroidal closing r=1; both axes are sample time and brightness is row amplitude; ' +
      'the earlier GSFC 2000-generation study used board-resampled k=4 at 136×136, eps = 0.062431 (not the original-773 statistic).';
    return occupancy(F, rec);
  }

  /* Exact record-grid DFT, excluding DC. Signed bins preserve complex rotation. */
  function dominant(rec) {
    const n = rec.re.length, dt = n > 1 ? (rec.t[n - 1] - rec.t[0]) / (n - 1) : 1;
    if (n > 2048) {
      let size = 1;
      while (size < n) size *= 2;
      const re = new Float64Array(size), im = new Float64Array(size);
      re.set(rec.re); im.set(rec.im); fft(re, im);
      let peak = 0, selected = 0;
      for (let i = 1; i < size; i++) {
        const power = re[i] * re[i] + im[i] * im[i];
        if (power > peak) {peak = power; selected = i < size / 2 ? i : i - size;}
      }
      return {bin:selected, hz:selected / (size * dt), dt, estimator:'rectangular full-rate zero-padded ' + size + '-point signed FFT'};
    }
    let peak = -1, selected = 0;
    for (let k = -math.floor(n / 2); k <= math.floor((n - 1) / 2); k++) {
      if (!k) continue;
      const a = -TAU * k / n, wr = math.cos(a), wi = math.sin(a);
      let zr = 1, zi = 0, sr = 0, si = 0;
      for (let j = 0; j < n; j++) {
        sr += rec.re[j] * zr - rec.im[j] * zi; si += rec.re[j] * zi + rec.im[j] * zr;
        const next = zr * wr - zi * wi; zi = zr * wi + zi * wr; zr = next;
      }
      const power = sr * sr + si * si;
      if (power > peak) {peak = power; selected = k;}
    }
    if (rec.amax === 0) selected = 0;
    return {bin:selected, hz:selected / (n * dt), dt, estimator:'rectangular full-record signed DFT'};
  }

  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let v = re[i]; re[i] = re[j]; re[j] = v;
        v = im[i]; im[i] = im[j]; im[j] = v;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const a = -TAU / size, wr = math.cos(a), wi = math.sin(a), half = size >> 1;
      for (let start = 0; start < n; start += size) {
        let zr = 1, zi = 0;
        for (let j = 0; j < half; j++) {
          const a = start + j, b = a + half;
          const br = re[b] * zr - im[b] * zi, bi = re[b] * zi + im[b] * zr;
          re[b] = re[a] - br; im[b] = im[a] - bi; re[a] += br; im[a] += bi;
          const next = zr * wr - zi * wi; zi = zr * wi + zi * wr; zr = next;
        }
      }
    }
  }

  function spectro(rec, w, h) {
    const n = rec.re.length, dom = dominant(rec), dt = dom.dt;
    let size = 1;
    const limit = math.min(512, n >= 128 + 29 * 8 ? n - 29 * 8 : n);
    while (size * 2 <= limit) size *= 2;
    const hop = n > 2048 ? math.max(8, size >> 2) : 8;
    const frames = math.max(1, math.floor((n - size) / hop) + 1);
    const df = 1 / (size * dt), sign = dom.hz < 0 ? -1 : 1;
    const band = math.min(0.5 / dt, math.max(df, math.abs(dom.hz) * 4));
    const bins = math.min((size >> 1) + 1, math.ceil(band / df + 0.5));
    const F = blank(w, h, 'spectro', 'SPECTROGRAM',
      'x is window-centre time ' + (rec.t[0] + (size - 1) * dt / 2).toFixed(1) + ' to ' +
      (rec.t[0] + ((frames - 1) * hop + (size - 1) / 2) * dt).toFixed(1) +
      ' ' + (rec.timeUnit || 's') + '; y is signed frequency 0 to ' + (sign * band).toFixed(4) +
      ' ' + (rec.frequencyUnit || 'Hz') + ', a record-derived ' +
      (math.abs(dom.hz) ? (band / math.abs(dom.hz)).toFixed(1) : 'no') +
      '× band from the ' + dom.estimator + ' peak, bin ' + dom.bin + ' at ' +
      dom.hz.toFixed(4) + ' ' + (rec.frequencyUnit || 'Hz') + '; brightness is magnitude^0.35, Hann ' + size + ', hop ' + hop + ', ' +
      bins + ' bins × ' + frames + ' frames, area-mean resampled.');
    const mag = new Float64Array(frames * bins), phase = new Float64Array(frames * bins);
    const re = new Float64Array(size), im = new Float64Array(size), hann = new Float64Array(size);
    const uniformRe = new Float64Array(n), uniformIm = new Float64Array(n);
    /* A Fourier axis assumes uniform time. Interpolate genuinely irregular input. */
    for (let j = 0, source = 0; j < n; j++) {
      const time = rec.t[0] + j * dt;
      while (source + 1 < n - 1 && rec.t[source + 1] < time) source++;
      const next = math.min(n - 1, source + 1), span = rec.t[next] - rec.t[source];
      const t = span ? bound((time - rec.t[source]) / span, 0, 1) : 0;
      uniformRe[j] = blend(rec.re[source], rec.re[next], t); uniformIm[j] = blend(rec.im[source], rec.im[next], t);
    }
    for (let j = 0; j < size; j++) hann[j] = size === 1 ? 1 : 0.5 - 0.5 * math.cos(TAU * j / (size - 1));
    let max = 0;
    for (let x = 0; x < frames; x++) {
      for (let j = 0; j < size; j++) {re[j] = uniformRe[x * hop + j] * hann[j]; im[j] = uniformIm[x * hop + j] * hann[j];}
      fft(re, im);
      for (let b = 0; b < bins; b++) {
        const k = (sign * b + size) % size, i = x * bins + b;
        mag[i] = math.hypot(re[k], im[k]); phase[i] = math.atan2(im[k], re[k]);
        max = math.max(max, mag[i]);
      }
    }
    if (max) for (let i = 0; i < mag.length; i++) mag[i] = math.pow(mag[i] / max, 0.35);
    let fieldMax = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const x0 = x * frames / w, x1 = (x + 1) * frames / w;
      const f0 = (h - 1 - y) * band / h, f1 = (h - y) * band / h;
      const b0 = math.max(0, math.floor(f0 / df - 0.5)), b1 = math.min(bins - 1, math.ceil(f1 / df + 0.5));
      let sum = 0, weight = 0, pr = 0, pi = 0, frequency = 0;
      for (let frame = math.floor(x0); frame < math.ceil(x1); frame++) {
        const wx = math.min(x1, frame + 1) - math.max(x0, frame);
        for (let b = b0; b <= b1; b++) {
          const overlap = math.min(f1, (b + 0.5) * df) - math.max(f0, math.max(0, (b - 0.5) * df));
          if (overlap <= 0) continue;
          const q = wx * overlap, i = frame * bins + b, a = mag[i];
          sum += q * a; weight += q; frequency += q * math.min(band, b * df);
          pr += q * a * math.cos(phase[i]); pi += q * a * math.sin(phase[i]);
        }
      }
      const i = y * w + x;
      F.amp[i] = weight ? sum / weight : 0;
      F.ph[i] = pr || pi ? math.atan2(pi, pr) : 0;
      F.freq[i] = weight ? sign * (2 * frequency / (weight * band) - 1) : 0;
      fieldMax = math.max(fieldMax, F.amp[i]);
    }
    let population = 0;
    for (let i = 0; i < F.mask.length; i++) {
      F.mask[i] = fieldMax > 0 && F.amp[i] >= 0.65 * fieldMax ? 1 : 0;
      population += F.mask[i];
    }
    F.note += ' The mask selects cells at or above 65% of the map’s peak amplitude: ' +
      (100 * population / (w * h)).toFixed(2) + '% of this board.';
    return occupancy(F, rec);
  }

  function hst(rec, w, h) {
    const fr = frequencies(rec), span = fr.max - fr.min, n = rec.re.length, divisor = rec.amax || 1;
    const F = blank(w, h, 'hst', 'HILBERT SPECTRUM',
      'x is time in ' + (rec.timeUnit || 's') + '; y is unwindowed phase-derivative frequency, ' + fr.min.toFixed(4) +
      ' to ' + fr.max.toFixed(4) + ' ' + (rec.frequencyUnit || 'Hz') + '; a 1.5-cell Gaussian paints amplitude.');
    const sums = new Float64Array(w * h), weights = new Float64Array(w * h);
    const duration = rec.t[n - 1] - rec.t[0], radius = 1.5, sigma2 = 0.65 * 0.65;
    let max = 0;
    for (let j = 0; j < n; j++) {
      const px = duration ? (rec.t[j] - rec.t[0]) / duration * (w - 1) : (w - 1) / 2;
      const fn = span ? 2 * (fr.raw[j] - fr.min) / span - 1 : 0, py = (1 - fn) / 2 * (h - 1);
      const y0 = math.max(0, math.ceil(py - radius)), y1 = math.min(h - 1, math.floor(py + radius));
      const x0 = math.max(0, math.ceil(px - radius)), x1 = math.min(w - 1, math.floor(px + radius));
      const amplitude = rec.amp[j] / divisor, phase = rec.ph[j];
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const d2 = (x - px) * (x - px) + (y - py) * (y - py);
          if (d2 > radius * radius) continue;
          const weight = math.exp(-d2 / (2 * sigma2)), value = amplitude * weight, i = y * w + x;
          if (value > F.amp[i]) {F.amp[i] = value; F.ph[i] = phase; max = math.max(max, value);}
          weights[i] += weight; sums[i] += weight * fn;
        }
    }
    for (let i = 0; i < F.mask.length; i++) {
      F.freq[i] = weights[i] ? sums[i] / weights[i] : 0;
      F.mask[i] = F.amp[i] > 0.12 * max ? 1 : 0;
    }
    return occupancy(F, rec);
  }

  function fieldFromImage(rgba, w, h, W, H) {
    const F = blank(W, H, 'image', 'IMAGE FIELD',
      'Image luminance sets amplitude, hue sets phase, and spatial gradient direction replaces frequency: an image has no time axis.');
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || rgba.length !== w * h * 4) throw new Error('Image pixels do not match their source dimensions.');
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const x0 = x * w / W, x1 = (x + 1) * w / W, y0 = y * h / H, y1 = (y + 1) * h / H;
      let r = 0, g = 0, b = 0, area = 0;
      for (let sy = math.floor(y0); sy < math.ceil(y1); sy++) for (let sx = math.floor(x0); sx < math.ceil(x1); sx++) {
        const q = (math.min(x1, sx + 1) - math.max(x0, sx)) * (math.min(y1, sy + 1) - math.max(y0, sy));
        const i = (sy * w + sx) * 4, alpha = rgba[i + 3] / 255;
        r += q * rgba[i] * alpha; g += q * rgba[i + 1] * alpha; b += q * rgba[i + 2] * alpha; area += q;
      }
      r /= area; g /= area; b /= area;
      const max = math.max(r, g, b), min = math.min(r, g, b), delta = max - min, i = y * W + x;
      let hue = 0;
      if (delta) {
        if (max === r) hue = (g - b) / delta;
        else if (max === g) hue = 2 + (b - r) / delta;
        else hue = 4 + (r - g) / delta;
        if (hue < 0) hue += 6;
      }
      F.amp[i] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      F.ph[i] = hue * TAU / 6; F.mask[i] = 1; F.occ[i] = 1;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = F.amp[y * W + math.min(W - 1, x + 1)] - F.amp[y * W + math.max(0, x - 1)];
      const dy = F.amp[math.min(H - 1, y + 1) * W + x] - F.amp[math.max(0, y - 1) * W + x];
      F.freq[y * W + x] = dx || dy ? math.atan2(dy, dx) / math.PI : 0;
    }
    return F;
  }

  defField({id:'path', label:'THE RECORD ITSELF', blurb:'The complex-plane trajectory, not a timeline.', build:path});
  defField({id:'matrix', label:'SELF-SIMILARITY', blurb:'Fixed-radius recurrence, closed rather than dilated.',
    params:[{key:'gapSpace', label:'gap sample space', def:'grid',
      options:[{value:'grid', label:'board samples'}, {value:'raw', label:'original samples'}]},
      {key:'k', label:'gap neighbour rank', min:1, max:16, step:1, def:4}], build:matrix});
  defField({id:'spectro', label:'SPECTROGRAM', blurb:'A signed, band-zoomed windowed frequency map.', build:spectro});
  defField({id:'hst', label:'HILBERT SPECTRUM', blurb:'The unwindowed frequency ridge, including reversals.', build:hst});
  return {parseNumeric, prepRecord, makeNoise, fieldFromImage};
})();
