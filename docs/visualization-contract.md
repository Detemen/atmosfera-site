# Атмосфера — Advanced Visualization Contract

## Approval and evidence

- Approved direction: extruded geospatial globe, selected by the user on 2026-07-22.
- Desktop concept: `.superpowers/brainstorm/65864-1784737074/content/extruded-globe.png` in the original design workspace.
- Mobile contract: globe remains at least 62vh; controls and details become bottom sheets.
- Purpose: reveal current spatial air-quality estimates through progressive geographic depth.
- Audience: general public.
- Live data: Open-Meteo Air Quality API, CC BY 4.0 attribution; CAMS model data, approximately 11 km grid, current conditions requested on interaction.
- Geography: local Natural Earth-derived country boundaries with bundled attribution.
- Evidence status: AQI/pollutants are modeled estimates; country/region means are inferred from sampled points; plate elevation is interaction state; background texture is schematic.
- Free API boundary: no key for non-commercial use, 10,000 calls/day; coordinate requests are batched, debounced, and cached for ten minutes.
- Connectivity: last-known-good cache is shown with its timestamp; no cache falls back to deterministic demo data marked “Демо-дані”; manual retry is available after the next interaction.
- Truth invariants: never call a modeled point a station; never hide demo/cached state; always show numeric AQI, category text, time, and attribution.

## Renderer ownership

- One React Three Fiber canvas owns the globe. WebGL is justified because geographic hierarchy is encoded with real depth, camera distance controls progressive detail, and GPU picking drives selection.
- DOM owns all exact values, labels, legend, search, controls, and the accessible territory list.
- Fallback appears only after WebGL context failure or intentional low-capability disablement; it is a DOM/text territory list, not a duplicate globe.
- Render-ready means the canvas has mounted and reported its first frame.
- Canvas caps DPR at 1.5, resizes through R3F, listens for context loss, and disposes generated geometries/materials on unmount.
- One scene is visible. No additional WebGL contexts or decorative particle systems.
- Mobile quality removes shadows and most light columns before reducing geographic clarity.

## Coordinate frames

| Layer | Coordinate system | Transform owner | Alignment check |
| --- | --- | --- | --- |
| Country polygons | WGS84 lon/lat | `geography.ts` spherical transform | Ukraine, Japan, Australia, Alaska, antimeridian |
| Sample points | WGS84 lon/lat | `SpatialSampler` | inside selected polygon/bounds |
| Camera focus | WGS84 lon/lat → unit sphere | `AirQualityGlobe` | shortest-path rotation to Kyiv and Tokyo |
| Pointer hits | Three.js world coordinates | `CountryLayer` | hit plate id equals preview/selection id |
| DOM labels | selection state, not projected every frame | `AirPanel` | name matches selected geometry id |

- Convention: longitude 0° is Greenwich, positive east; longitude wraps to `[-180, 180)`.
- Latitude is clamped to `[-90, 90]`; plate elevation is radial and illustrative, not terrain.
- Selected and hovered elevation must never be interpreted as AQI magnitude.
- Runtime-decoded country polygons are registered by stable selection id in one geography repository. Country breadcrumbs always resolve through that repository, so returning from a city or region uses the same polygon and samples as direct country selection.
- Country sampling uses deterministic stratified candidates plus spherical farthest-point selection, capped at six. The world estimate uses six explicit points distributed across North America, South America, Africa, Europe, Asia, and Oceania.

## Visual encoding ledger

| Data or state | Visual channel | Scale/range | Must not imply |
| --- | --- | --- | --- |
| AQI category | emissive accent + text | green, yellow, orange, red, purple, maroon | precision beyond category thresholds |
| Hover | plate elevation 0.055 | interaction-only | higher pollution |
| Selected | plate elevation 0.075 + outline | interaction-only | higher pollution |
| Sampling location | restrained light column | point presence | physical monitoring station |
| Cached/demo | status badge + timestamp | categorical text | live data |

- Neutral context: charcoal ocean and stone land. Primary focal accent: AQI category. Selected state: pale outline. Loading: low-motion opacity pulse.
- No particles. Glow encodes AQI category or current focus only.
- Essential values visible without hover: world/selected AQI, category, live/cached/demo state, source time, legend.
- Color is always paired with text and number.
- Aggregates are keyed by `level:id`. A city, region, or coordinate estimate can accent only its matching detail object; it never recolors the parent country plate. Continent plates use only the matching continent aggregate while continent grouping is active.

## State and shell

- Shell: single visualization with compact left control rail, central globe viewport, right inspector, bottom legend.
- URL persistence is excluded from the first version; no local or remote saved views.
- Default focus: Europe/Africa with world summary.
- Empty-surface drag rotates; empty click clears preview but preserves pinned selection.
- Desktop: drag orbit, wheel/pinch zoom, click pin, Escape clear, reset and zoom buttons.
- Mobile portrait: first tap previews, second selects; pinch zoom; bottom sheets preserve the globe.
- Below 760 px, controls, details, and the AQI scale are collapsed overlay sheets. Their persistent summary keeps the active selection, provenance, pollutant, and model caveat visible; closing, applying, or choosing a search result restores focus to the relevant sheet trigger.
- Keyboard/text fallback: next/previous territory and activate controls operate on a visible territory list.
- Reduced motion: immediate camera focus, no elevation tween, static loading state.
- Idle render loop pauses when the page is hidden.

## Multiscale contract

- Camera distance determines: continent → country → region → city → coordinate.
- Country boundaries are global. Curated country profiles expose first-level regions and cities for Ukraine, Poland, Germany, France, India, Japan, Brazil, United States, Canada, and Australia.
- Other countries expose country and sampled-coordinate detail without pretending exhaustive administrative coverage.
- Screen-stable DOM labels and strokes retain legibility while map-space plates change with zoom.
- Missing live values remain visibly unavailable; geometry and navigation still work.
- All 177 bundled Natural Earth features have a maintained ISO/feature-key metadata join, a Ukrainian accessible name, and one of the seven selectable continent groups. Natural Earth-only Northern Cyprus, Somaliland, and Kosovo keep explicit non-ISO fallback keys rather than invented ISO claims.
- Geography asset failures are a visible error state with an explicit retry action.

## QA contract

- Commands: `npm test`, `npm run build`, `git diff --check`.
- Runtime checks: first nonblank frame, pointer preview/select agreement, wheel/pinch/button zoom, reset, keyboard territory selection, context-loss fallback.
- Coordinate checks: Kyiv, Tokyo, Sydney, Alaska, and the Pacific seam.
- Data checks: live, cached, demo, partial/missing pollutant, and timestamp states.
- Responsive checks: 1440×900 desktop, 768×1024 tablet, 390×844 phone.
- Accessibility checks: visible focus, text AQI category, numeric value, reduced motion, polite status announcement.
- Concept fidelity: globe owns the viewport, land reads as extruded plates, panels stay compact, and all decorative effects without a data/state mapping are removed.
