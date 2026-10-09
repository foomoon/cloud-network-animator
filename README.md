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

### Methods and events

- `scatter()` / `regenerate()`: re-scatter the particles, or rebuild the shape
- `randomize()` / `reset()`
- `exportConfig()`: downloads the current settings as JSON
- A `configchange` event fires whenever the settings change, with the new config in `event.detail`.

The animation pauses while the element is offscreen or removed from the page.
