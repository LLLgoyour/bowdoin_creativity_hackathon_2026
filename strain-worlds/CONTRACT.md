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

1. **DOM-free.** No `document`, `window`, `canvas`, `performance`, `atob` guards
   excepted. Only the renderer (`w-render.js`) and the app (`w-app.js`) see the DOM.
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
6. **Own your file.** Never edit another module. If you need something from one,
   ask through `hub` (ids below) or state the assumption in your probe output.

## Field contract (`w-field.js`)

```js
defField({
  id:'path', label:'THE RECORD ITSELF', blurb:'one line for the rail',
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

The app renders `options` params as a select and the rest as a slider, and it applies
`def` to any param left undefined before the first build — including in `boot()`, so a
module's own fallback for a missing param must agree with its declared `def`. Do not
rely on the app to set it: a probe that builds a field directly never goes through
`drawParams()`.

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
The app decays the array by 0.78 once per generation, so a spark is visible for
about five generations at any frame rate. The renderer decides whether a
starburst is actually drawn: cards must be at least 9 px, and at most
`R.sparkBudget` (the rail's starbursts slider, default 8) are spent per frame.
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

`src/data-gsfc.js` holds the GSFC QC6 strain record (773 complex samples,
11.2 turns of a slowly widening spiral in the Re/Im plane) as base64 Float64
blocks: `const GSFC={name,n,t,re,im}` → `CORE.decodeF64()`.

### Record kinds

`prepRecord` accepts every kind below and produces the same shape, because the fields
and the worlds never learn where a record came from:

| kind | series | `amp` means |
|---|---|---|
| `numeric` | one column of numbers | normalised magnitude |
| `complex` | Re and Im columns (the GSFC record) | magnitude |
| `noise` | seeded white noise | magnitude |
| `image` | a Hilbert-curve scan of the luminance | luminance |
| `audio` | decoded mono samples | loudness envelope |

Two requirements that follow from long records:

- **Images keep their locality.** A row-major scan makes the recurrence view
  meaningless, so scan along a Hilbert curve: neighbours in the series are then
  neighbours in the picture and `matrix` shows the picture's own texture. Say the
  mapping in the field note.
- **Long records are reduced by averaging, not by picking.** A voice message is
  thousands of samples while `path` and `matrix` want one value per grid cell.
  `round(i*(n-1)/(M-1))` point-sampling is right for the 773-sample strain record and
  wrong for 24 kHz audio, where it aliases. Block-average when `n > 4*M` and print
  both the density and the picture for a long record so the difference is visible in
  the probe. The frequency fields keep using the record's own full-rate samples; an
  audio record also carries `sr` so those axes can mean Hz.

## Verification bar

Your probe must print numbers that would change if your rule were wrong —
not "it ran". Examples: Kuramoto → global order parameter rising with `K` and
falling to ~0 at `K=0`; gravity → pile heights and avalanche size distribution;
RD → spot count vs feed rate; fields → mask density per mode and a 48×24 ASCII
dump so the shapes can be compared as text.
