# CONTRACT — read this before writing any module

A browser doodle, no build step at runtime, no dependencies. `shell.html` loads
`src/*.js` as **classic scripts** (so it works straight off `file://`), and
`build.mjs` inlines the same files into one self-contained `strain-worlds.html`.

## The pipeline

```
                       ┌── field (w*h geometry)  ──►  world (local rule)  ──►  view  ──► renderer
record (re,im,t)  ─────┤
                       └── record panels
```

**A field** is the record turned into a grid. **A world** is a local rule that
turns a field into something alive. **A view** is what the renderer draws.
Fields and worlds never touch the DOM.

## Hard rules for every module in `src/`

1. **DOM-free models.** Fields and worlds never access `document`, `window` or
   canvas. The renderer (`w-render.js`), machine (`w-shop.js`), room and stations
   (`w-room.js`, `w-stock.js`, `w-ink.js`) and app (`w-app.js`) own browser
   surfaces; shared decoding helpers may use `atob`.
2. **Dependency-free.** Use only globals from `core.js` (`PAL`, `INK`, `clamp`,
   `lerp`, `h2`, `mulberry32`, `mixHex`, `rr`, `decodeF64`, `newView`,
   `clearView`, `viewLive`, `defField`, `defWorld`) and JS built-ins. `PAL` is
   shared: a module may append its own entries, but the first 12 slots keep
   their meaning because every other world indexes them.
   **Palette entries are values the press owns.** Every colour must be
   `#rrggbb` — `mixHex` returns that — because at boot the renderer separates
   each entry into blue/pink/yellow ink coverage and rewrites `PAL[i]` to what
   those inks actually print (`snapPalette()`). Index into `PAL`; never cache
   the hex string you pushed, and never hand a colour in any other format: an
   unparseable entry separates to bare paper and the card prints blank.
   `tools/probe-press.mjs` asserts both.
3. **Deterministic.** Same seed + same field ⇒ same frames, forever. All
   randomness comes from a `mulberry32` handed in as `rng`. Never call
   `Math.random()`.
4. **No allocation in the hot path.** Allocate in `init`, then reuse. `step()`
   and `view()` must not build arrays or objects per cell.
5. **Node-testable.** Every module ships `tools/probe-<id>.mjs` that loads it
   with `node` and prints real numbers. `step()` must not need a DOM.

## Field contract (`w-field.js`)

```js
defField({
  id:'path', label:'THE RECORD ITSELF', blurb:'one line for the job ticket',
  build(rec, w, h, PAR) -> Field
});
```

`rec` = `{re:Float64Array, im:Float64Array, t:Float64Array, name, amp, ph, turns, amax}`
(`amp` = |h|, `ph` = unwrapped phase in radians, already computed by `prepRecord`).

```js
Field = {
  w, h, id, label, note,          // note: one sentence describing what the picture is
  amp : Float32Array(w*h),        // 0..1   the record's amplitude here
  ph  : Float32Array(w*h),        // radians, the record's own phase here
  freq: Float32Array(w*h),        // -1..1  instantaneous frequency here
  mask: Uint8Array(w*h),          // 1      the record actually visits this cell
  occ : Float32Array(w*h)         // 0..1   local density of the above
};
```

Additional builders are welcome if they make different data *look* different.
Required set: `path` (the record's own trajectory), `matrix` (self-similarity),
`spectro` (STFT), `hst` (time × instantaneous frequency × amplitude).
`w-field.js` also owns the pure parsers: `parseNumeric(text)`,
`prepRecord(obj)`, `makeNoise(seed)`, `fieldFromImage(rgba,w,h,W,H)`.

## World contract (`w-synch.js`, `w-grav.js`, `w-rd.js`, `w-life.js`)

```js
defWorld({
  id:'synch', label:'SYNCHRONY', blurb:'travelling lock fronts',
  params:[{key:'K', label:'coupling', min:0, max:8, step:0.1, def:2.4}],
  init(w,h,field,rng,PAR) -> S,   // S = your state, may hold a newView(w*h)
  step(S,field,PAR),              // advance exactly one generation
  stats(S) -> live,               // int: draw on the population plot
  view(S) -> V,                   // your reused view buffers
  HUD(S,field,PAR) -> string      // short status, no HTML
});
```

A param is a range unless it declares `options`, in which case it is a choice and
`def` must be one of the listed values:

```js
{key:'gapSpace', label:'gap sample space', def:'grid',
 options:[{value:'grid',label:'board samples'},{value:'raw',label:'original samples'}]}
```

The machine draws `options` parameters as detents and numeric parameters as
turnable wheels. The app supplies `def` for undefined values before building.
Modules must retain matching fallbacks because a headless probe can call a
builder directly without the app.

`PAR` is a live object: `{...your params..., speed, seed}`. Read it every step;
never cache it across steps. `w`,`h` are the grid size (`w*h` = cell count).

### Shaking (optional, but all four worlds ship it)

```js
shake(S, field, power) -> string      // power in 0..1
```

The audience-facing interaction for this piece is a shake: a pointer drag-shake on
desktop, `DeviceMotionEvent` on a phone. The app maps the gesture onto `power` and
calls every world's `shake`. You choose the physical content — synch kicks phases,
grav tilts the terrain, rd injects the second chemical, life perturbs the board.
The rules:

- The impulse enters through your own state variables. Never teleport a cell, never
  edit `field.mask`, never write the view by hand.
- Deterministic: `shake(S, field, power)` is a pure function of state, field and
  power, driven by the world's own seeded generator, so a recorded shake replays
  exactly. No `Math.random()`.
- Return ONE LINE of measured numbers for the HUD, describing what the kick did at the
  moment it landed — `"kick 0.4 -> r 0.81 to 0.22, locked 47% to 19%"` — not prose, not
  an adjective, and NOT a recovery time, which you cannot know when the call returns.
  Recovery is a future measurement: report it in your probe and in the HUD after
  stepping, not in the returned string.
- A shake is a perturbation, not a destruction: at `power = 1` the world must still
  recover. Report the recovery time for 0.2/0.5/1.0 at 52/76/120.

A world that omits `shake` still runs; the app just reports that it cannot be
shaken. But it is then the only world the audience cannot touch.

### What makes a *good* world here

The record must stay **in the dynamics**, not just in the initial condition.
A world where the data is discarded after generation 0 is the thing we are
replacing. State a measurement in your probe that shows the data still matters
(e.g. change one field, show the steady state changes).

## View contract (renderer side, already written)

`view(S)` returns a `newView(n)` you allocated in `init`. Per cell:

| array | meaning |
|---|---|
| `live` | 1 to draw a card |
| `col`  | index into `PAL` |
| `face` | 1 → the card has eyes (reserve for cells that earned it) |
| `flip` | 0..1 → card turns edge-on and vanishes (death / domain flip) |
| `lift` | vertical offset in **cells** (negative = up) |
| `spin` | -1..1 lean |
| `stack`| extra cards drawn under the top one (0 = single card, up to 8) |
| `spark`| 0..1 → starburst behind the card |

**`face` is a ranked subset, never a threshold.** Eyes are the scarcest thing on the
board, so a world earns them with a rule that cannot fill the screen: rank the eligible
cells (deepest lock, tallest pile, oldest spot — whatever your model calls a settled
core), break ties deterministically, and face only the top slice, capped at roughly a
quarter of the visible population. `w-synch.js` is the reference implementation — 20
consecutive generations above a lock threshold, then the deepest-locked 20% selected
through a fixed-size min-heap, measuring 0.1996/0.1998/0.1999 at 52/76/120. State the
criterion in the blurb as a rank and a cap so a reader cannot mistake it for
"everything above X gets eyes".

**When does the view get written?** Either place, your choice: `step()` may write
the view arrays directly, or `view()` may sync them from `S` on each call. The app
calls `view()` exactly once per painted frame and never caches the object, so both
work. The one rule is that `view(S)` must return the CURRENT state for the `S` it
is given — a world that syncs inside `view()` must not assume anyone will call it
between two steps.

**`spark` has three owners, so read this before touching it.** A world only ever
*raises* it: `V.spark[i] = 1` on the tick a birth happens there. A world must not
decay the array, and must not keep spark state in `S`; clearing the whole array
at the start of its own `step()` is allowed (a spark then lasts one generation).
The app decays the array by 0.78 once per generation, independently of paint.
The renderer draws starbursts only when cards are at least 7 device pixels,
and spends at most `R.sparkBudget` per frame. The anti-setoff spray valve owns
that budget; its initial value is 8.
Rarity is therefore enforced twice on purpose, and a spark that is never drawn is
not an error.

**`mask` is the record's geometry, and a world may couple through it.** A world
that wants its dynamics to live on the record's shape should treat `mask` as the
coupling graph: couple only to masked neighbours, normalise the pull by the
actual number of masked neighbours, and skip unmasked cells entirely (they are
never drawn, and they must not become a coherent background bath). `w-synch.js`
does exactly this.

Indices are `i = y*w + x` everywhere. The renderer draws nothing else.

## The record

`src/data-gsfc.js` holds the supplied `GSFC_QC6_strain_2_2.dat.txt` file as
base64 Float64 blocks: `const GSFC={name,n,t,re,im}` → `decodeF64()`.
Its 773 samples trace 11.0304 net turns. Attribution and physical units are
unverified; retain the filename without inventing an astronomical provenance.

### Record kinds

`prepRecord` accepts every kind below and produces the same shape, because the fields
and the worlds never learn where a record came from:

| kind | series | `amp` means |
|---|---|---|
| `numeric` | one column of numbers | normalised magnitude |
| `complex` | Re and Im columns (the GSFC record) | magnitude |
| `noise` | seeded white noise | magnitude |
| `image` | closed silhouette fitted to complex epicycles | distance from contour origin |
| `audio` | mono samples plus Hilbert quadrature | analytic-signal envelope |

Two requirements that follow from long records:

- **Images are contour records.** Trace once, cache the contour, and re-fit its
  Fourier coefficients when the harmonics wheel changes. Do not substitute a
  row-major or Hilbert luminance scan for the commission's outline.
- **Long records are reduced by averaging, not by picking.** A voice message is
  thousands of samples while `path` and `matrix` want one value per grid cell.
  `round(i*(n-1)/(M-1))` point-sampling is right for the 773-sample strain record and
  wrong for 24 kHz audio, where it aliases. Block-average when `n > 4*M` and print
  both the density and the picture for a long record so the difference is visible in
  the probe. The frequency fields keep using the record's own full-rate samples; an
  audio record also carries `sr` so those axes can mean Hz.

## Physical press contract

`w-shop.js` owns layout and hit testing together. Draw and pick from the same
geometry; crop housings if needed, never control labels or cam rims.
The shell contains a stage canvas and an offscreen native file input.
Pointer, wheel and native drop events enter through `SHOPVIEW`; machine
gestures request changes through `API`, never an independent UI state store.

`SHOP.state` progresses `makeready → proof → run → done`. A lever pull makes
a proof, approves it, or makes the next numbered edition sheet. Changing a
job's plate, law or source invalidates its proof but preserves delivered
edition sheets and the next edition number. A new commission clears the tray.

The three registration pins supply `R.slipScale` as a per-plate array; the
lens and the sheet use the same `measuredSlip()` equation. Ink keys must reach
`R.inkKey` before painting the sheet. `snapshotSheet()` is the shared crop
operation, called after drawing the sheet without the machine over it.

The app's interval advances simulation by elapsed wall time and animates
machine springs. The history ring advances only when simulation state changes.
Do not replace that clock with a display-dependent animation callback.

Screen-map caches retain only the current size and register offsets per
plate. Seed changes invalidate grain; key and coverage changes are read on
every overprint. Keep dot-boundary math in Float64. The exact uncached
equation in `tools/probe-overprint.mjs` guards against stale caches or changed
pixels, not merely visually similar output.

## Sonification contract (`w-sonify.js`)

```js
sonifyFrame(rec, index, mode, out) -> {level, pitch, pan, brightness, sourceHz, noteStep}
lifeFeedback(rec, S) -> wave | null             // complex presentation wave, or null
sonifyLifeFrame(rec, feedback, index, mode, out) -> the same control object
```

`sonifyFrame` is pure: no DOM, no audio nodes. `mode` is `'tone'` — continuous
pitch taken from the record's phase-rotation rate and folded into 110..800 Hz —
or `'music'`, where each quarter-turn of phase steps through `SONIFY_SCALE`, a C
pentatonic over two octaves. `level` follows the measured amplitude, `pan`
follows `Re(h)/|h|`, and the same amplitude is `brightness`, which opens the
filter. The app owns the AudioContext, the loudness value and the mute-on-pause
behaviour; the module only maps numbers.

`lifeFeedback` is the LIFE world's optional return path: live cells in each
column become a complex phasor (a cell's row sets its angle), neighbours are
averaged, and the result contributes 65% of a new wave whose remaining 35% is the
original record, scaled by the square root of live-cell density — an extinct
board gives a flat, silent wave. `sonifyLifeFrame` wraps `sonifyFrame` and bends
its pitch, level and pan from that wave. Neither writes to `rec`, the field or
`S`: the wave is presentation, and the source record still drives the automaton.
`tools/probe-sonify.mjs` tests the mapping and `tools/probe-life-feedback.mjs`
tests that cell positions change the wave without editing the data.

## Room and station contract (`w-room.js`, `w-stock.js`, `w-ink.js`)

`ROOMVIEW` owns the room scene, the station navigation and the station routing,
and simulates nothing. Modes are
`'room' | 'stock' | 'ink' | 'press' | 'scope'`. `enter(mode)` switches,
`navigation(g)` draws the shared paper tags (`← ROOM`, `SOURCE`, `INKS`, `PRESS`,
`LISTEN`, minus the current station) and records their hit regions, and `key(e)`
owns the shortcuts (`F` source, `I` inks, `P` press, `O` listen, `Escape` room,
`0` reset the view). `down/move/up/wheel` implement drag-to-wander and
wheel-to-zoom (0.65x..2.8x) and forward machine gestures to `SHOPVIEW` and job
changes to `API`; the room keeps no second copy of job state.

Each station paints itself and reports its own controls; a station is a real
function, never an alias of another screen. `STOCK_STATION.paint(ctx,W,H)` draws
the source choices, the stock preview and the harmonics dial, and
`INK_STATION.paint(ctx,W,H,sampleCanvas)` draws the three coverage dials, the
fixed overprint chart and the one live sample. The sample canvas is the press's
own overprint handed over by the app, not a copy of a sample. A source change or
a coverage change invalidates an approved proof; neither may erase a delivered
edition sheet or renumber the next edition.

The bench writes only through state the app already owns: `AUDIO.enabled`
(POWER), `AUDIO.mode` (PHASE, `'tone'` or `'music'`), `AUDIO.volume` (LOUDNESS),
`R.gain` (DISPLAY GAIN) and `APP.scopeOffset` (SWEEP OFFSET). Gain and offset are
read-only transforms of the samples: DISPLAY GAIN scales the drawn trace and
SWEEP OFFSET moves the scan line, and neither may mutate `rec`. The scope reads
`APP.rec`, `APP.scopeHist`, `APP.feedback` and `APP.wrldId`, and never steps a
world.

## Verification bar

Your probe must print numbers that would change if your rule were wrong —
not "it ran". Examples: Kuramoto → global order parameter rising with `K` and
falling to ~0 at `K=0`; gravity → pile heights and avalanche size distribution;
RD → spot count vs feed rate; fields → mask density per mode and a 48×24 ASCII
dump so the shapes can be compared as text.
