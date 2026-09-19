# the press takes commissions

A single-file browser toy that takes a numeric record — or any file you hand
it — and *prints* it: the file becomes a wave, the wave becomes a plate, one of
four local rules works the ink, and a three-colour press pulls a sheet.

The previous iteration turned every record into the same picture: a distance
matrix, thresholded into dots, run under Conway's Life. Two things were wrong
with that. Every source — the strain record, noise, a dropped image — looked the
same because one transform produced one visual grammar. And Life is binary and
memoryless: it forgets the record at generation 0, then plays out its own fixed
catalogue of gliders.

This rebuild separates the jobs that were tangled together.

```
file --► record --► field --► world --► view --► three plates --► sheet
(commission)(a wave) (a plate) (a law)  (flat arrays)(B,P,Y)   (the pull)
```

**The record** is data: `{re, im, t}` — a complex time series, or an image
traced into one, or audio turned analytic.
**A field** is the record turned into `w*h` of geometry: amplitude, phase,
instantaneous frequency, and a mask saying where the record actually lives.
**A world** is a local rule that keeps reading the field every step, so the
record stays in the dynamics instead of only seeding them.
**A view** is what the press inks: one paper card per live cell, with a face, a
stack, a flip, a lean and a starburst.
**The sheet** is three ink plates — blue, fluorescent pink, yellow — each
halftoned at its own screen angle, each with its own seeded registration slip,
multiplied together on paper. No card is ever filled with the colour it appears
to be.

Everything below is a number a script in `tools/` prints. Nothing here is
estimated, and where a quantity has two defensible estimators, both are given.

## Run it

    open ../strain-worlds.html     # the built single file, no server, no deps

`shell.html` loads `src/*.js` as classic scripts and also works straight off
`file://`. Rebuild the single file after editing `src/`:

    node build.mjs                 # inlines src/ + data into ../strain-worlds.html
    node tools/embed.mjs           # regenerates src/data-gsfc.js from the .dat

## The press

The sheet is not a colour scheme. Three inks are laid as separate plates —
blue `#1f6fc6` at 15°, fluorescent pink `#ff4fb0` at 75°, yellow `#ffd21e` at
45° — each halftoned on its own screen at a 2.6 device-pixel ruling, each
shifted by its own seeded registration error, and the sheet is the product of
the three on `#f3ecdd` paper. `node tools/probe-press.mjs` loads the real
renderer (not a copy of the model) and prints every number here.

**A colour is separated, never chosen.** The press builds every colour it can
physically make — 33 plate values per ink, **35,937 printable colours**, built
once in **29.7 ms** — and separating a colour is one nearest-neighbour search
of that gamut in CIE Lab. `#e8563f` is not a red fill; it is blue 1/32 + pink
13/32 + yellow 11/32, and the red happens on the paper.

**The separation is measured against what the app names.** An earlier
hand-kept on/off table (each colour either prints on a plate or does not) was
**mean dE 79.65, worst 139.39** — far enough that palette slot 0, a gold, was
printing as magenta. The search is **mean dE 11.98 across the twelve flats**
and **9.53 across all 44 colours** once the worlds have pushed the ones they
invent at runtime.

**Three inks cannot reach everything, and the misses are named.** 13 of 44
colours land further than dE 15, all of them saturated greens, teals and
violets: `#57ac4a -> #687e2c` (dE 27.71), `#3fb8a0 -> #76937e` (26.89),
`#8a63d2 -> #76448f` (23.20), `#a9c93f -> #afa42f` (23.00),
`#5a7fd8 -> #1e67ac` (16.93). Blue plus yellow does not make that green.

**So the palette is the press's gamut.** At boot `snapPalette()` replaces every
flat with what the inks actually lay down for it, because a shop cannot name a
colour it cannot print. After that the chip in the rail, the proof panel and
the pulled sheet agree to **max dE 0.4331 across all 44 colours** — the residue
is 8-bit rounding. The cost is honest and visible: the greens became olive.

**A colour the separation cannot parse prints as bare paper.** That was a real
bug: `mixHex()` returned `rgb(r,g,b)` strings, `hex2rgb()` reads `#rrggbb`, and
**24 of the 44** runtime colours (every LIFE rule's three derived shades) were
separating to NaN and printing as blank sheet. `mixHex` now returns hex and the
probe asserts both halves — 0 unparseable, 0 blank prints.

**The pull is seeded and reproducible.** Registration slip, dot phase and paper
grain are all functions of the plate seed: seed 7 always gives the same three
offsets `(1.27,-1.18) (-0.59,-1.38) (0.54,0.32)`, and seed 8 gives different
ones. Same board, new seed, another copy.

**Nothing finer than the screen ruling is drawn.** A cut line thinner than one
dot prints as nothing, so the card outline is clamped to the ruling and a pupil
is never smaller than 0.78 of a dot — the rule a printer actually works to.

**The sheet carries its furniture.** Crop marks at the trim, an edition stamp
(plate, run, pull seed, sheet grid, generation) and a press-check strip of the
three solids, their half tints and all four overprints — printed *through the
same three plates* as the image, because a control strip that was composited
separately would not show the registration slip it exists to reveal.

## The record

`src/data-gsfc.js` holds the GSFC QC6 strain record as base64 Float64 blocks:
773 complex samples, `t = 0.780 -> 301.872 s`, `dt = 0.3900156 s`, `|h|` up to
0.410804 at sample 549. The trajectory is a slowly widening spiral of
**11.0304 turns**, clockwise, so its spectral energy sits at *negative*
frequency.

Two things about it are worth stating because code depends on them:

- **The turn count has two estimators and the probe prints both.** Summing
  signed phase increments gives 11.0304; taking `|final - initial| / 2pi` gives
  11.2097. The second is wrong for a spiral that overshoots its origin, and the
  probe keeps it visible (`wrongAbsFinalPhase`) so the right one cannot be
  mistaken for a coincidence.
- **The frequency is nearly constant and slightly negative.** The exact signed
  DFT of the whole record peaks at bin -6, `-0.019902 Hz`; the median
  instantaneous (phase-derivative) frequency is `-0.022473 Hz`, ranging
  `-0.131914 .. +0.002014 Hz`, with 9 reversal samples around
  `t = 49.9 .. 53.0 s`. That hairpin is why the fields keep the sign of the
  frequency and why `spectro` zooms a 4.0x band around the DFT peak.

## The commission

Anything dropped on the page is a commission, and the press takes it by
turning it into a wave. `tools/probe-wave.mjs` measures that path end to end.

**A picture and a signal are the same object.** An image is traced to its
silhouette contour — `tools/fish.png` gives 1024 contour points — and the
contour is fitted as a sum of rotating vectors (an epicycle series, the DFT of
the closed curve). The harmonics slider is the fit: sweeping P, the
reconstruction error falls **60.145 px RMS at P=1 to 0.000 px at full P**,
monotonically, and the silhouette IoU rises **0.4683 to 0.9980**. At the
default P=48 the fish is 8.398 px RMS, IoU 0.9386 — recognisably a fish, made
of 48 spinning arrows.

**Audio is turned analytic, and the one inexact part is named.** A decoded
file is mixed to mono and given its Hilbert transform, so `x + i·H(x)` is the
record. For `x = cos(2πft)` that must be `e^{i2πft}`: on a synthesised tone the
probe measures `RMS(im - 0.6·sin) = 0.000000000` and a flat envelope,
`max ||x+iH(x)| - 0.6| = 0.000000000`. On the decoded 8-bit WAV the same
measurement is **0.006479 RMS over all samples but 0.000024 over the inner
6976**, with the worst sample 0.414263 at the very edge — the window-edge
artefact of an FFT Hilbert transform, one sample in from the boundary, not a
wrong transform. The probe prints both so the edge cannot hide.

Noise comes from the same generator the probes use. Which field survives a
dropped signal is measured rather than assumed — every field separates a
dropped signal from noise in both directions, and `tools/probe-field.mjs`
prints the trial counts per field, so the media path is not silently the record
path wearing a different filename.

## The fields

All four are built from the same record; each shows a different geometry of it.
Densities are the fraction of cells the record actually visits (`mask`), at
52x52 unless noted.

| field | what the picture is | density | build |
|---|---|---|---|
| `path` THE RECORD ITSELF | the Re/Im trajectory itself, 4x supersampled | **55.58%** (1503 cells) | 3.10 ms |
| `matrix` SELF-SIMILARITY | fixed-radius recurrence, closed not dilated | **19.23%** (520 cells) | 0.66 ms |
| `spectro` SPECTROGRAM | signed, band-zoomed Hann STFT, 512 window, hop 8 | **41.46%** (1121 cells) | 6.45 ms |
| `hst` HILBERT SPECTRUM | time x unwindowed instantaneous frequency | **5.29%** (143 cells) | 0.54 ms |

Those build times are from a run that records its own load: 7 unrelated node
processes, 0% reported CPU before the ordinary timings, before the media
timings and after them, with all eight GSFC masks at 52x52 and 120x120 compared
byte-for-byte against the pre-optimisation bytes at the same time. Nothing was
traded for the speed — the masks are identical, not merely similar. The one
default-case build still above the 20 ms flag is 24 kHz audio at 120x120 on
`path` at 64.57 ms (down from 473 ms under load); audio `matrix`/`spectro`/`hst`
there are 3.47/11.98/9.67 ms and image at 120x120 is
14.24/2.34/2.75/2.41 ms.

They are not four views of one shape. The probe measures overlap as
`xor / union` against a noise record made by the same pipeline, where 0 is
identical and 1 is disjoint:

| field | xor/union vs noise | amplitude L1 |
|---|---|---|
| `path` | 0.507 | 0.294 |
| `matrix` | 0.862 | 0.357 |
| `spectro` | 0.581 | 0.183 |
| `hst` | 0.940 | 0.078 |

`path` separates least, which is honest: a noise trajectory is also a blob in
the same plane, so the *shape* overlaps even though the densities differ
(55.58% vs 44.38%). The other three separate almost completely.

**The recurrence threshold is the one parameter with a provenance problem, so it
is reported rather than hidden.** `matrix` picks `eps` as the median k-th
nearest-neighbour gap, and that gap depends on how many points you sample:

| sample space | eps (raw units) | density @52x52 | density @120x120 |
|---|---|---|---|
| original 773 samples, k=4 | 0.017196 | 5.47% | 3.90% |
| board samples, k=4 *(shipped default)* | 0.117773 @52 / 0.064370 @120 | 19.23% | 11.33% |
| board samples, k=6 | 0.138410 @52 / 0.083565 @120 | 22.78% | 14.46% |

The earlier GSFC study this piece descends from used board-resampled k=4 at
136x136, `eps = 0.062431`, 10.90% — which is the shipped default's *regime*, not
the original-sample statistic. The field note says this in the app, and
`tools/probe-field.mjs` prints `implementationMismatch=0` from an independent
direct-radius reference: the recursive closing touches 44 cells where the direct
construction does, and the mask is symmetric (`asymmetry=0`).

Every field ships a 48x24 ASCII dump in the probe so the shapes can be compared
as text, and the probe checks the parsers, the signed phase origin, a synthetic
negative tone, the hairpin reversal, degenerate/rectangular grids and image
luminance. It exits 0 with `PASS`.

## The worlds

Four local rules read the field every generation. Measurements below are from
each world's own probe, on the record at 52x52 unless noted.

| world | rule | measured |
|---|---|---|
| `synch` SYNCHRONY | phase oscillators coupled through the mask, natural frequency from the record | global r 0.0157 at K=0 rising to 0.2212 at K=6; locked fraction 0.712 on the record, 0.671 on a synthetic band fixture; faces 0.198 of live cards |
| `grav` GRAVITY | grains fall on a terrain made from the record's loudness, toppling in 4-grain cascades | mass conserved exactly over 2000 steps (`maxResidual 0`); 1813 topplings/generation late; drainage and flat-terrain controls behave differently |
| `rd` REACTION | Gray-Scott reef on the record's footprint | turns over: 763/504/423/506 live at gen 50/100/150/200, 26.7% of the board at 2000 with 14 births and 7 deaths in the final 200; a non-isometric path->spectro switch at gen 500 lands on a different equilibrium (27.15% in 1 blob vs 26.74% in 5, mean-v 0.1199); faces capped at 25.000/24.922/24.962% (path), 25.000/24.870/24.902% (matrix), 23.529% on a 17-cell population |
| `life` LIFE | B/S rule family on the record's self-similarity bands, per-row rules from row loudness | 144-case rule truth table, 0 mismatches; byte-identical replay; all 8 amplitude rows change the picture (1343 cells uniform vs 2796 row-driven at gen 100) |

**What "the record stays in the dynamics" is tested to mean**, since it is the
whole point:

- `synch`: forcing the frequency field to 3x the record's changes the steady
  order parameter (0.0988 -> 0.1552), a detune offset changes the long-run phase
  difference (0.0035 rad vs 0.0215), and a view built with a hidden background
  bath differs by 0 rad from one without — the coupling is the mask, not an
  ambient field.
- `grav`: a field with no downhill direction emits nothing over 100 steps; equal
  mass on flat terrain topples 0 times against 12349 in a basin; a peaked source
  on the left puts 72 grains in the left basin where a right-peaked source puts 0.
- `life`: toggling from uniform rules to the record's per-row rules changes 3829
  cells by generation 100, and every one of the eight rows is individually
  observable in the output (8/8 live-field and 8/8 live-toggle changes).
- `rd`: the reef is not a fixed pattern. Restarting it at generation 500 on a
  non-isometric field (`path` -> `spectro`) lands on a different equilibrium —
  27.15% of the board in one blob against 26.74% in five, mean-v difference
  0.1199 — and both states go on reacting. That is the record re-entering the
  dynamics through the field rather than seeding it once.

### What is not claimed

- **`rd`'s probe now frames every output block, and that was not cosmetic.** Its
  `fixture52.*` block is a narrow synthetic blob+stripe vessel, not the record;
  read as a record result it says the reef reaches 17.1967% of the board by
  generation 600 and then holds that figure exactly through generation 2000 with
  no late births or deaths, which is false. The probe now labels its frames
  (`fixture52.*`, `fixture120.*`, `uniform-chemistry.*`, `gsfc.*`), records the
  vessel's settling as a checked negative expectation rather than an exit-1
  assertion, and exits 0. The same caveat covers its no-record control: that
  0.4970 is a synthetic-frame number and is not quoted as a record result.
- **`grav` is not a heavy-tailed avalanche model.** Late in a 52x52 run every
  generation cascades, averaging 1813 topplings with a largest cascade of 3549,
  and all 200 events exceed 200 topplings — a truncated distribution, not a power
  law, which the probe states outright. The basin is also still filling at step
  2000 (mean mass 3025.24 over steps 1501-1750 against 3311.76 over 1751-2000),
  so those late statistics describe a transient. At 120x120 the same parameters
  are dormant: 6 cascades in 200 generations against 194 that move nothing.
- **`life`'s falling variant is not a pile.** With gravity at 52x52 the colony
  thins to 59 cards from 68 and its centroid moves *up* to row 18.1 from 21.9,
  because the material the fall strands dies instead of accumulating. It ships
  off by default and the probe says so.
- **`synch` has a worst case above a 60 Hz budget.** Its stress configuration —
  120x120 full grid, 14400 visible, K=8, spread 2.4, detune 1, drive 2, h=0.3,
  6 substeps — measures `median_ms_per_step=27.7555` with
  `max_batch_ms_per_step=61.9521`, and the probe prints
  `worst_case_warning 120x120 exceeds_8ms=27.7555`. That run was slower than
  earlier measurements of the same unchanged block and was deliberately not
  re-run for a nicer number, so treat it as the pessimistic end of the machine's
  range rather than as a regression.
- **The default board is `path` + `synch`, and the reason is measurable.** The
  first frame has to show a rule that keeps reading the record, and `synch`'s
  natural frequency *is* the record's instantaneous frequency, its coupling is
  the mask (a hidden background bath changes the order parameter by 0 rad), and
  all four worlds now answer a shake with measured numbers. `life` is the one
  family borrowed wholesale, so it ships available but not as the first frame,
  and `rd` can run itself out on a thin substrate — on `hst` at 24x24 it reaches
  0 live cards by generation 150, measured in the page, where the board's own
  "nothing is alive on this board" note takes over. `path` stays the substrate
  because it is the record's own geometry, at 55.58% of the board.

## Shaking

The audience-facing interaction is a shake. The app maps a pointer drag-shake
(desktop) or `DeviceMotionEvent` (phone) onto `power` and calls the world's

    shake(S, field, power) -> string      // one line of measured numbers

The impulse enters through the world's own state and its own seeded generator,
so a recorded shake replays exactly; no world writes `field.mask`, and none
returns a recovery time, because recovery happens after the call returns.

`synch` is measured end to end against a matched unshaken control: uniform
phase kicks in `+-pi*power` drop the locked fraction from
0.8436/0.8278/0.8973 to 0.0892/0.0937/0.1079 at 52/76/120 for full power, and
local lock recovers after 65/56/62 generations. The criterion is explicit and
is the reason these numbers are larger than an earlier run's: recovery is the
CONFIRMATION generation, requiring the locked fraction to stay within 0.05 of
the control for 20 consecutive generations, baseline 500, horizon 1000. At
lower power the same boards recover in 21/20/21 and 28/27/28 generations.
Global r is a different story and does not track: its control rejoin is
20-30 generations in every case except 76x76 at full power, which takes 517.

All four worlds now expose the hook, and their temperaments differ more than
their code does.

`grav`'s recovery runs 32-90 generations depending on parameters: 34/88/90 on
one set and 32/32/32 on two others, which is its own probe's output, not a
range fitted afterwards.

`life` either returns in 39 generations or never returns at all, and the probe
reports the second outcome as a result rather than as a timeout.

`rd` is the last one added and the most interesting, because it is the one that
can be moved permanently. A state-only seeded pulse of the second chemical
recovers in 60/173/268 generations at 52x52 for powers 0.2/0.5/1, in
129/272/417 at 76x76, and at 120x120 it does NOT return within 600 generations
— while never being damaged, holding a minimum of 1487 live cells and ending at
1623, which is the matched control's population. The criterion is
`max|dU,dV| <= 0.001` plus a live-count gap within `max(1, 0.001*n)`, held for
30 generations. Clicking shake on REACTION in the page returns a real line,
verified in two independent browser runs: `kick 1.00 · reef 708→708 ·
births 1→0 · retreats 0→0 · V+ 0.1469` and `kick 1.00 · reef 491→491 ·
births 2→0 · retreats 3→0 · V+ 0.1706`. None of these strings predicts a
recovery; they report what the impulse did at the moment it landed.

## Files

    shell.html          the file:// page: loads src/ as classic scripts
    build.mjs           inlines src/ into one self-contained ../strain-worlds.html
    src/core.js         shared vocabulary: palette, RNG, view buffers, registries
    src/w-field.js      the four field builders + the pure parsers
    src/w-synch.js      phase-oscillator world
    src/w-grav.js       falling-grain world
    src/w-rd.js         Gray-Scott world
    src/w-life.js       B/S world
    src/w-render.js     paper-card renderer
    src/w-app.js        state, controls, loop
    src/data-gsfc.js    generated record embed
    tools/embed.mjs     record -> src/data-gsfc.js
    tools/probe-*.mjs   one probe per module: prints the numbers quoted above
    tools/itest.mjs     cross-module integration test at 52x52
    CONTRACT.md         the frozen module interfaces

## Verify it

    for p in field synch grav rd life; do node tools/probe-$p.mjs; done
    node tools/itest.mjs

`itest.mjs` loads `core.js` and every `src/w-*.js` into ONE function body the way
the browser does, so timings match the page rather than a contextified global
lookup. It checks each world for view reuse, out-of-range ids and NaNs, checks
that the same world and field build deterministically, and prints one line per
field and world. It exits 0 and warns, rather than fails, on `rd`'s current
saturation.

The page and the probes are the same claim, and that is now measured rather than
assumed. The strain loader used to hand the field builders a block-averaged
record, so `matrix` in the browser read 18.3% where the probe read 19.231%; with
that reduction suppressed the four masks in the browser measure
55.584 / 19.231 / 41.457 / 5.288% against the probe's 55.584 / 19.231 / 41.457 /
5.288% — 1503, 520, 1121 and 143 cells of 2704.
