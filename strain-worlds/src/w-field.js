/* Pure record -> geometry. Helpers stay private; only the four parsers escape. */
const {parseNumeric, prepRecord, makeNoise, fieldFromImage,
  waveContour, waveFit, waveFromImage, waveAudio, decimate, WAVE_N, WAVE_AUDIO} = (() => {
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
      const stated = obj.provenance;      /* a caller that described the file keeps its own wording */
      Object.assign(obj, decoded);
      if (stated) obj.provenance = stated;
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

  /* ══ file → wave ══════════════════════════════════════════════════════════
     The claim this variant commits to: a file is already a wave, and the
     picture and the signal are the same object.

     An IMAGE becomes a complex record whose own trajectory redraws it. The
     luminance is thresholded at the Otsu level, the dark side is traced into
     closed traversals (marching squares on the level set, one loop per
     boundary, holes included, sub-pixel crossings), the traversals are
     concatenated, resampled to uniform arc length, and the record is the sum
     of the P largest-magnitude DFT harmonics of that contour — the epicycles
     of the drawing, which is what a Fourier series of a curve has always been.

     AUDIO stays what it already was: x + i·H(x), the analytic signal.

     Both leave as {re, im, t} and nothing downstream is told which is which. */

  const WAVE_N = 1024;        /* contour samples the fitted record is emitted on  */
  const WAVE_SIDE = 640;      /* analysis frame for images with a longer side     */
  const WAVE_LOOPS = 6;       /* most traversals one record is allowed to hold    */

  /* Area-weighted box reduction onto a frame whose long side is at most
     maxSide. Luminance is composited on white, so alpha reads as paper. */
  function reduceFrame(rgba, w, h, maxSide) {
    const s = math.min(1, maxSide / math.max(w, h));
    const W = math.max(1, math.round(w * s)), H = math.max(1, math.round(h * s));
    const lum = new Float64Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const x0 = x * w / W, x1 = (x + 1) * w / W, y0 = y * h / H, y1 = (y + 1) * h / H;
      let sum = 0, area = 0;
      for (let sy = math.floor(y0); sy < math.ceil(y1); sy++) for (let sx = math.floor(x0); sx < math.ceil(x1); sx++) {
        const q = (math.min(x1, sx + 1) - math.max(x0, sx)) * (math.min(y1, sy + 1) - math.max(y0, sy));
        const px = bound(sx, 0, w - 1), py = bound(sy, 0, h - 1), i = (py * w + px) * 4, a = rgba[i + 3] / 255;
        sum += q * (a * (0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]) / 255 + 1 - a);
        area += q;
      }
      lum[y * W + x] = area ? sum / area : 1;
    }
    return {lum, w:W, h:H};
  }

  /* Otsu: the level whose two histogram classes are furthest apart in mean. */
  function levelOtsu(lum) {
    const BINS = 256, hist = new Float64Array(BINS);
    for (let i = 0; i < lum.length; i++) hist[bound(math.round(lum[i] * (BINS - 1)), 0, BINS - 1)]++;
    let moment = 0;
    for (let i = 0; i < BINS; i++) moment += i * hist[i];
    let below = 0, count = 0, best = -1, level = 0.5;
    for (let i = 0; i < BINS; i++) {
      count += hist[i];
      if (!count) continue;
      const rest = lum.length - count;
      if (!rest) break;
      below += i * hist[i];
      const delta = below / count - (moment - below) / rest;
      const between = count * rest * delta * delta;
      if (between > best) {best = between; level = (i + 0.5) / BINS;}
    }
    /* the figure is the minority region: an image that is mostly dark is read
       inside out, so the traced shape is the subject and not the frame */
    let dark = 0;
    for (let i = 0; i < lum.length; i++) if (lum[i] < level) dark++;
    return {level, invert:2 * dark > lum.length, dark};
  }

  /* Marching squares on a one-cell-padded level set. Every crossing edge is
     shared by exactly two cells, so half-edges pair up into closed loops with
     no bookkeeping beyond an edge → segment index. The pad is outside by
     construction, so a shape that runs off the frame still closes. */
  function marchingLoops(lum, w, h, level, invert, minArea, maxLoops) {
    const PW = w + 2, PH = h + 2, cells = PW * PH, sign = invert ? -1 : 1, lvl = sign * level;
    const f = new Float64Array(cells);
    f.fill(1);                                   /* the pad: outside either way */
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) f[(y + 1) * PW + x + 1] = sign * lum[y * w + x];
    const ex = new Float32Array(2 * cells), ey = new Float32Array(2 * cells), seen = new Uint8Array(2 * cells);
    const cross = (id, ax, ay, va, bx, by, vb) => {
      if (!seen[id]) {
        const s = (lvl - va) / (vb - va);
        ex[id] = ax + (bx - ax) * s; ey[id] = ay + (by - ay) * s; seen[id] = 1;
      }
    };
    let cap = 4096, count = 0, ea = new Int32Array(cap), eb = new Int32Array(cap);
    const push = (idA, idB) => {
      if (count === cap) {
        cap *= 2;
        const ga = new Int32Array(cap), gb = new Int32Array(cap);
        ga.set(ea); gb.set(eb); ea = ga; eb = gb;
      }
      ea[count] = idA; eb[count] = idB; count++;
    };
    const s0 = new Int32Array(2 * cells).fill(-1), s1 = new Int32Array(2 * cells).fill(-1);
    const link = (id, seg) => {if (s0[id] < 0) s0[id] = seg; else s1[id] = seg;};
    const seg = (a, b) => {push(a, b); link(a, count - 1); link(b, count - 1);};
    for (let j = 0; j + 1 < PH; j++) for (let i = 0; i + 1 < PW; i++) {
      const top = j * PW + i, left = (j + 1) * PW + i;
      const c0 = f[top], c1 = f[top + 1], c2 = f[left + 1], c3 = f[left];
      const e0 = top, e1 = cells + j * PW + i + 1, e2 = left, e3 = cells + j * PW + i;
      const m0 = c0 < lvl, m1 = c1 < lvl, m2 = c2 < lvl, m3 = c3 < lvl;
      const code = (m0 ? 1 : 0) | (m1 ? 2 : 0) | (m2 ? 4 : 0) | (m3 ? 8 : 0);
      if (!code || code === 15) continue;
      if (m0 !== m1) cross(e0, i, j, c0, i + 1, j, c1);
      if (m1 !== m2) cross(e1, i + 1, j, c1, i + 1, j + 1, c2);
      if (m2 !== m3) cross(e2, i, j + 1, c3, i + 1, j + 1, c2);
      if (m3 !== m0) cross(e3, i, j, c0, i, j + 1, c3);
      switch (code) {
        case 1: case 14: seg(e3, e0); break;
        case 2: case 13: seg(e0, e1); break;
        case 3: case 12: seg(e3, e1); break;
        case 4: case 11: seg(e1, e2); break;
        case 6: case 9: seg(e0, e2); break;
        case 7: case 8: seg(e2, e3); break;
        /* the two checkerboards need the bilinear centre to decide which way
           the saddle is resolved; ties fall to the centre-outside reading */
        case 5: case 10: {
          const centre = (c0 + c1 + c2 + c3) / 4 < lvl;
          const diagonal = (code === 5) === centre;
          if (diagonal) {seg(e0, e1); seg(e2, e3);}
          else {seg(e3, e0); seg(e1, e2);}
          break;
        }
      }
    }
    const used = new Uint8Array(count), loops = [];
    for (let start = 0; start < count; start++) {
      if (used[start]) continue;
      const px = [], py = [];
      let cur = start, entry = ea[start], guard = 0;
      while (cur >= 0 && !used[cur] && guard++ <= count) {
        used[cur] = 1;
        px.push(ex[entry] - 1);
        py.push(h - 1 - (ey[entry] - 1));
        /* a segment is entered through one end and left through the other */
        const exit = ea[cur] === entry ? eb[cur] : ea[cur];
        const next = s0[exit] === cur ? s1[exit] : s0[exit];
        entry = exit; cur = next;
      }
      const n = px.length;
      if (cur !== start || n < 4) continue;
      let perim = 0, area = 0;
      for (let i = 0; i < n; i++) {
        const k = (i + 1) % n;
        perim += math.hypot(px[k] - px[i], py[k] - py[i]);
        area += px[i] * py[k] - px[k] * py[i];
      }
      area = math.abs(area) / 2;
      if (area >= minArea && perim >= 8) loops.push({x:px, y:py, perim, area});
    }
    loops.sort((a, b) => (b.area - a.area) || (b.perim - a.perim) || (a.x.length - b.x.length));
    return loops.slice(0, maxLoops);
  }

  /* Uniform arc-length resampling of the concatenated traversals, then centred
     on the arc-length centroid, so the emitted record has no DC offset. */
  function resampleLoops(loops, N) {
    const keep = loops.slice(0, math.max(1, math.min(loops.length, math.floor(N / 3))));
    let total = 0, crossings = 0;
    for (const L of keep) {total += L.perim; crossings += L.x.length;}
    const x = new Float64Array(N), y = new Float64Array(N);
    let cursor = 0;
    for (let li = 0; li < keep.length; li++) {
      const L = keep[li], rest = keep.length - li - 1;
      let want = rest ? math.round(N * L.perim / total) : N - cursor;
      want = bound(want, 3, N - cursor - 3 * rest);
      const step = L.perim / want, n = L.x.length;
      let target = 0, walked = 0, out = 0;
      for (let i = 0; i < n && out < want; i++) {
        const j = (i + 1) % n, ax = L.x[i], ay = L.y[i], bx = L.x[j], by = L.y[j];
        const len = math.hypot(bx - ax, by - ay);
        while (out < want && target <= walked + len) {
          const s = len ? (target - walked) / len : 0;
          x[cursor + out] = ax + (bx - ax) * s;
          y[cursor + out] = ay + (by - ay) * s;
          out++; target += step;
        }
        walked += len;
      }
      while (out < want) {x[cursor + out] = x[cursor + out - 1]; y[cursor + out] = y[cursor + out - 1]; out++;}
      cursor += want;
    }
    let mx = 0, my = 0;
    for (let i = 0; i < cursor; i++) {mx += x[i]; my += y[i];}
    mx /= cursor; my /= cursor;
    for (let i = 0; i < cursor; i++) {x[i] -= mx; y[i] -= my;}
    return {x, y, crossings, loops:keep.length, ox:mx, oy:my};
  }

  /* Even-odd scanline fill of the reconstructed closed curve, compared with
     the thresholded frame it came from: how much of the picture the record's
     own trajectory still covers. The record is centred on its contour, so the
     frame offset is put back before the comparison. */
  function outlineIoU(rx, ry, ox, oy, lum, w, h, level, invert) {
    const n = rx.length, fill = new Uint8Array(w * h), xs = new Float64Array(n);
    let inter = 0, union = 0;
    for (let y = 0; y < h; y++) {
      let m = 0;
      for (let i = 0; i < n; i++) {
        const k = (i + 1) % n, ay = h - 1 - (ry[i] + oy), by = h - 1 - (ry[k] + oy);
        if ((ay <= y) === (by <= y)) continue;
        const ax = rx[i] + ox, bx = rx[k] + ox;
        xs[m++] = ax + (bx - ax) * (y - ay) / (by - ay);
      }
      const row = Array.prototype.slice.call(xs, 0, m).sort((a, b) => a - b);
      for (let s = 0; s + 1 < row.length; s += 2) {
        const from = math.max(0, math.ceil(row[s])), to = math.min(w - 1, math.floor(row[s + 1]));
        for (let x = from; x <= to; x++) fill[y * w + x] = 1;
      }
    }
    for (let i = 0; i < fill.length; i++) {
      const source = (lum[i] < level) !== invert ? 1 : 0;
      inter += source & fill[i];
      union += source | fill[i];
    }
    return union ? inter / union : 0;
  }

  /* The record is the sum of the P largest harmonics of the contour:
     h(t) = Σ A_k e^{i(ω_k t + φ_k)}, resampled from the DFT at the contour's
     own parameter values. DC is dropped — the contour is centred on it. */
  function dftFit(zr, zi, P) {
    const N = zr.length, sr = Float64Array.from(zr), si = Float64Array.from(zi);
    fft(sr, si);
    const mag = new Float64Array(N);
    for (let k = 1; k < N; k++) mag[k] = sr[k] * sr[k] + si[k] * si[k];
    const order = new Array(N - 1);
    for (let i = 0; i < N - 1; i++) order[i] = i + 1;
    order.sort((a, b) => (mag[b] - mag[a]) || (a - b));   /* magnitude, then bin */
    const take = bound(P, 1, N - 1), re = new Float64Array(N), im = new Float64Array(N), bins = new Int32Array(take);
    for (let i = 0; i < take; i++) {
      const k = order[i], omega = TAU * k / N, cw = math.cos(omega), sw = math.sin(omega);
      bins[i] = k;
      let cr = 1, ci = 0;
      for (let j = 0; j < N; j++) {
        re[j] += sr[k] * cr - si[k] * ci;
        im[j] += sr[k] * ci + si[k] * cr;
        const next = cr * cw - ci * sw; ci = cr * sw + ci * cw; cr = next;
      }
    }
    const scale = 1 / N;
    for (let j = 0; j < N; j++) {re[j] *= scale; im[j] *= scale;}
    let sum = 0, worst = 0;
    for (let j = 0; j < N; j++) {
      const d = (re[j] - zr[j]) * (re[j] - zr[j]) + (im[j] - zi[j]) * (im[j] - zi[j]);
      sum += d;
      worst = math.max(worst, d);
    }
    return {re, im, bins, take, rms:math.sqrt(sum / N), max:math.sqrt(worst), maxP:N - 1};
  }

  /* Stage one: pixels → one complex contour (the expensive half, cacheable). */
  function waveContour(obj) {
    if (!obj || !obj.rgba || !Number.isInteger(obj.width) || !Number.isInteger(obj.height) || obj.width < 1 || obj.height < 1 ||
        obj.rgba.length !== obj.width * obj.height * 4)
      throw new Error('An image wave needs rgba pixels that match their width and height.');
    const frame = reduceFrame(obj.rgba, obj.width, obj.height, WAVE_SIDE);
    const cut = levelOtsu(frame.lum);
    const found = marchingLoops(frame.lum, frame.w, frame.h, cut.level, cut.invert, 0.0004 * frame.w * frame.h, WAVE_LOOPS);
    if (!found.length) throw new Error('That image has no closed contour at the Otsu level ' + cut.level.toFixed(4) + '.');
    const c = resampleLoops(found, WAVE_N);
    return {x:c.x, y:c.y, n:WAVE_N, frame, level:cut.level, invert:cut.invert, ox:c.ox, oy:c.oy,
      loops:c.loops, crossings:c.crossings, area:found.reduce((s, L) => s + L.area, 0),
      name:obj.name || 'image', source:{w:obj.width, h:obj.height}};
  }

  /* Stage two: contour → the record, at harmonic count P. */
  function waveFit(contour, P) {
    const fit = dftFit(contour.x, contour.y, P);
    const iou = outlineIoU(fit.re, fit.im, contour.ox, contour.oy, contour.frame.lum, contour.frame.w, contour.frame.h, contour.level, contour.invert);
    const n = contour.n, t = new Float64Array(n);
    for (let i = 0; i < n; i++) t[i] = i / n;         /* one turn = one traversal */
    const f = contour.frame;
    return {
      kind:'complex', name:contour.name, re:fit.re, im:fit.im, t,
      timeUnit:'turns', frequencyUnit:'cycles/turn',
      wave:{kind:'image', file:contour.name, P:fit.take, maxP:fit.maxP, rms:fit.rms, max:fit.max,
        iou, points:n, loops:contour.loops, crossings:contour.crossings, level:contour.level,
        invert:contour.invert, frame:f.w + '×' + f.h, source:contour.source.w + '×' + contour.source.h},
      provenance:'IMAGE → WAVE. ' + contour.source.w + '×' + contour.source.h + ' in, analysed at ' + f.w + '×' + f.h +
        ', thresholded at the Otsu level ' + contour.level.toFixed(4) + ' on the ' + (contour.invert ? 'light' : 'dark') +
        ' side; ' + contour.loops + ' closed traversal' + (contour.loops === 1 ? '' : 's') + ' (' + contour.crossings +
        ' crossings) were concatenated and resampled to ' + n + ' uniform arc-length samples. The record is the sum of its ' +
        fit.take + ' largest-magnitude DFT harmonics of ' + fit.maxP + ' nonzero bins (DC dropped: the contour is centred on it), ' +
        'so re/im is the picture: RMS ' + fit.rms.toFixed(3) + ' px, max ' + fit.max.toFixed(3) +
        ' px, silhouette IoU ' + iou.toFixed(4) + '. Time is in traversals and frequency in cycles/turn.'
    };
  }

  function waveFromImage(obj, P) {return waveFit(waveContour(obj), P);}

  /* Box-average a long signal onto equal integer blocks — the reduction rule
     for long records — so a minute of 44.1 kHz audio becomes a record the
     panels and the fields can still afford. */
  function decimate(samples, want) {
    const n = samples.length;
    if (n <= want) return {samples:Float64Array.from(samples), factor:1};
    const factor = math.ceil(n / want), m = math.floor(n / factor), out = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      let sum = 0;
      for (let j = 0; j < factor; j++) sum += samples[i * factor + j];
      out[i] = sum / factor;
    }
    return {samples:out, factor};
  }

  /* Audio is the one file kind that was already a wave: the record is its
     analytic signal x + i·H(x) (the Hilbert transform by FFT — negative
     frequencies zeroed, positives doubled), which is prepRecord's own audio
     path. A long file is box-averaged onto WAVE_AUDIO samples first and keeps
     the reduced sample rate, so the sound's frequency axes still mean Hz. */
  const WAVE_AUDIO = 8192;

  function waveAudio(obj, want) {
    if (!obj || !obj.samples || !obj.samples.length) throw new Error('An audio wave needs decoded mono samples.');
    const cut = decimate(obj.samples, want || WAVE_AUDIO), rate = obj.sr / cut.factor;
    const note = obj.name || 'audio';
    return {
      kind:'audio', name:note, samples:cut.samples, sr:rate,
      wave:{kind:'audio', file:note, source:obj.samples.length, sr:obj.sr, points:cut.samples.length,
        factor:cut.factor, rate},
      provenance:'AUDIO → WAVE. ' + note + ' is ' + obj.samples.length + ' samples at ' + obj.sr +
        ' samples/s; box-averaged by ' + cut.factor + ' onto ' + cut.samples.length + ' samples at ' + rate.toFixed(2) +
        ' samples/s, and re/im is that signal\u2019s analytic signal x + i·H(x) — the Hilbert transform by FFT, negative ' +
        'frequencies zeroed and positives doubled — so the wave IS the sound. Amplitude is a centred 20 ms RMS loudness ' +
        'envelope; time is s and frequency is Hz.'
    };
  }

  defField({id:'path', label:'THE RECORD ITSELF', blurb:'The complex-plane trajectory, not a timeline.', build:path});
  defField({id:'matrix', label:'SELF-SIMILARITY', blurb:'Fixed-radius recurrence, closed rather than dilated.',
    params:[{key:'gapSpace', label:'gap sample space', def:'grid',
      options:[{value:'grid', label:'board samples'}, {value:'raw', label:'original samples'}]},
      {key:'k', label:'gap neighbour rank', min:1, max:16, step:1, def:4}], build:matrix});
  defField({id:'spectro', label:'SPECTROGRAM', blurb:'A signed, band-zoomed windowed frequency map.', build:spectro});
  defField({id:'hst', label:'HILBERT SPECTRUM', blurb:'The unwindowed frequency ridge, including reversals.', build:hst});
  return {parseNumeric, prepRecord, makeNoise, fieldFromImage,
    waveContour, waveFit, waveFromImage, waveAudio, decimate, WAVE_N, WAVE_AUDIO};   /* file → wave */
})();
