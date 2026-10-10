# Point Cloud Network

An animated proximity network of particles, packaged as a `<point-cloud-network>` web component. Particles can roam freely or be contained inside a shape (circle, ring, grid, wave, spiral, heart, or block text).

**Live demo:** https://foomoon.github.io/cloud-network-animator/ (press `h` to toggle the settings panel)

## Usage

```html
<script src="https://foomoon.github.io/cloud-network-animator/point-cloud-network.js"></script>

<point-cloud-network shape-mode="text" shape-text="AI" fg-color="#ff6600" style="height:400px"></point-cloud-network>
```

There's no build step and no dependencies. It works on a plain HTML page and inside React, Vue, Svelte and similar frameworks. The element is 360px tall by default; size it with CSS like any block element.

### Configuring

Every option can be set in three ways:

- **As an attribute,** in kebab-case: `point-count="150"`, `show-lines="false"`
- **As a JSON `config` attribute:** `config='{"shapeMode":"heart","speed":60}'`
- **From script:** `el.setConfig({speed: 130})` or `el.config = {...}`. Read the current settings with `el.getConfig()`.

Unknown keys are ignored, and numbers are clamped to the same ranges as the panel's sliders.

| Key | Default | Notes |
| --- | --- | --- |
| `pointCount` | 105 | 30–260 |
| `speed` | 90 | 5–220 |
| `nodeScale` | 1 | 0.4–3 |
| `nodeOpacity` | 0.8 | 0.1–1 |
| `connectionDistance` | 285 | 40–520 px |
| `nearAlpha` / `farAlpha` | 0.34 / 0.025 | Line opacity for close and far pairs |
| `lineWidth` | 0.85 | 0.2–3 |
| `showLines` | true | |
| `shapeMode` | `free` | `free` `circle` `ring` `grid` `wave` `spiral` `heart` `text` |
| `shapeText` | `TEXT` | Used by `text` mode, up to 24 characters |
| `shapeStrength` / `shapeDamping` | 4.5 / 0.93 | How hard outside particles are pulled into the shape |
| `shapeScale` | 0.96 | 0.25–1.35 |
| `drawBoundary` | false | Outline the shape |
| `clipBoundaryConnections` | true | Hide lines that cross outside the shape |
| `fgColor` / `bgColor` | `#30b178` / `#05090c` | |
| `showUI` | false | Settings panel (attribute: `controls`) |
| `showHud` | false | Point count readout (attribute: `hud`) |
| `maxFps` | 0 | Frame-rate cap, e.g. 30 for a quiet background; 0 = every display refresh. Motion speed is unaffected. |

### Methods and events

- `scatter()` / `regenerate()`: re-scatter the particles, or rebuild the shape
- `randomize()` / `reset()`
- `exportConfig()`: downloads the current settings as JSON
- A `configchange` event fires whenever the settings change, with the new config in `event.detail`.

The animation pauses while the element is offscreen or removed from the page.

## Macros

[`macros.js`](macros.js) is an optional add-on with small scripts ("macros") that animate a `<point-cloud-network>` using only its public `setConfig`/`getConfig`. Pick one from the **Macro** menu in the demo, or link straight to it with `?macro=<name>`, e.g. [`?macro=clock`](https://foomoon.github.io/cloud-network-animator/?macro=clock). Press `h` for a clean full-screen view.

```html
<script src="https://foomoon.github.io/cloud-network-animator/macros.js"></script>
<script>
  const clock = PointCloudMacros.clock(document.querySelector('point-cloud-network'), {hour12: false});
  // later: clock.stop();  // restores the settings the macro changed
</script>
```

| Name | What it does | Options (defaults) |
| --- | --- | --- |
| `clock` | Current time as `h:mm` | `hour12` (true) |
| `words` | Cycles through words | `words`, `intervalMs` (4000) |
| `countdown` | Counts down to a time, then shows `endText` | `to` (5 min from start), `endText` ("NOW") |
| `liveNumber` | Shows a fetched value, refreshed periodically | `source` (this repo's GitHub stars), `format`, `intervalMs` (60000) |
| `typewriter` | Reveals text one letter at a time | `text`, `charMs` (300), `holdMs` (2500), `loop` (true) |
| `shapeTour` | Cycles through shapes | `shapes`, `intervalMs` (6000) |
| `colorDrift` | Rotates the color around the hue wheel | `periodMs` (30000), `saturation`, `lightness` |
| `breathe` | Gently pulses node size and line opacity | `periodMs` (4000), `depth` (0.35) |
| `heartbeat` | Heart shape with a lub-dub pulse | `bpm` (66), `depth` (0.7) |
| `dayNight` | Colors and speed follow the time of day | `dayMs` (0 = real time; the demo uses 60000) |
| `explode` | Click the background or press Space to blast the points out; they reform | `outMs` (700), `boost` (2.4), `key` (" ") |
| `scroll` | Page scroll (or the mouse wheel when the page can't scroll) steps through shapes and grows the point count | `stages`, `minCount` (40), `maxCount` (220) |
| `audio` | Microphone level drives node size and line reach | `sensitivity` (1) |

The text macros and `shapeTour` drop the point count to the minimum and ramp it back up on every change. New points stream in from everywhere and spread evenly over the new shape. They accept `count` (200), `minCount` (30), `holdMs` (350) and `riseMs` (1200).
