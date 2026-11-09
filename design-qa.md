# 宜昌 · 江山之间 — Design QA

## Landmark registration — 2026-11-09 (Asia/Shanghai)

**Passed and published to the same owner-private Site.** Latest functional revision: `d42428258a8ea64457748caa65108a09b6102bba` (V10). The preceding registration revision was `611f1726adac13323191bc1645546ccf81bb1356` (V9). Later screenshot/documentation commits do not change these application assets.

### User-reported defects and corrections

- 葛洲坝 previously used a regional POI, a default east–west axis and a fixed 17-unit length. Its model visibly crossed the mapped dam line. It now uses the west main-channel segment of retained crest road `way/1465238639`, from WGS84 `[111.266107,30.740883]` to `[111.272164,30.739043]`; the anchor is the segment midpoint, the length comes from those endpoints and local `+Z` faces downstream. Adjacent reservoir/river polygon edges corroborate the axis. The model represents this segment, not every structure in the multi-channel complex.
- 镇江阁 previously had no geographic heading. Its entrance remained world-south, and the enlarged footprint was shifted inland. Its local `+X` is now registered to the named building footprint at bearing 356.672°, putting the `+Z` front at 86.672°. The documented front/back relation of the current rebuilt pavilion is landward toward East Mountain, with the river behind it.
- 天然塔 now has a river-facing `+Z` entrance at the locally inferred 226.179° bearing. The internal octagon was rotated so the door, inscription and steps share a real flat face. This internal modelling adjustment does not add a second geographic yaw.
- Both historic buildings retain their original POI coordinates with zero display translation. Display scales are 0.51 and 0.19 respectively, allowing their complete rotated bounds to fit on source land. The former 1.55/2.5-unit inland shifts are superseded. Labels, selection rings, collision clearing and cameras follow the same anchor and transformed model bounds.
- 至喜's old near-bank water crossing length was wrongly treated as the whole 250:838:215 bridge, moving both towers into water. It is now the main span; the two side spans extend onto the banks. Source road points are normalized west-to-east before sampling, preventing point-order reversal from flipping the asymmetric structure. This remains an inferred placement; the west/east allocation of the unequal side-span values preserves the previous convention and is not asserted as a surveyed result.
- 夷陵's axis was checked against its named water-crossing road; the approximately 2.6 m maximum road-to-chord difference is inside the stylized deck width. The park/island models remain illustrative regional markers without invented surveyed entrance directions.

Pose inputs, source IDs and references are retained in `scripts/landmark-alignments.json`, applied by `scripts/landmark_alignment.py`, and included in `city.json` / `sources.txt`. Angle conventions and implementation notes are in the README. Primary direction references are the [Three Gorges Group magazine, 2022 no.10, printed page 111](https://www.ctgne.com/sxjt/fileDir/resource/cms/article/1278180/1418219/2023032716492726407.pdf) and [Yichang Civil Affairs' Tianran Pagoda entry](https://mzj.yichang.gov.cn/content-63849-997288-1.html). Bearings derived from retained map geometry are display registration, not field measurements.

### Focused verification

`node scripts/check-landmark-alignment.mjs` passed after both functional revisions. It exercises the actual placement resolver, model factory and waterfront planner without WebGL, checking:

- Actual dam/bridge model endpoints coincide with the resolved map endpoints; valid endpoints override conflicting heading and display scale.
- The two historic-building anchors have zero drift, and their transformed `+Z` fronts have the opposite documented land/river relationships.
- 5,799 samples over the complete rotated footprints, including 3 m extra clearance, remain outside mapped water.
- The two actual Zhixi tower centres coincide with `mainSpanEndpoints` and are on source land. Reversing source road point order preserves exactly the same endpoints.

Current Zhixi main-span tower points are `[-60.576279988,-35.247478189]` and `[-43.770481376,-34.571555901]`. The inferred main span is approximately 840.97 m and the whole deck approximately 1,307.62 m; these include the map/sampling and bank allowance and are not substituted for the published 838/1303 m dimensions. The script checks tower centres, not a surveyed foundation outline.

The roads, water, parks and building arrays were hash-compared before/after data registration and are unchanged. Applying the calibration manifest a second time leaves the landmark records unchanged. Python files compile, scene modules parse, production builds and `git diff --check` pass. The entire Shapely clipping pipeline was not rerun in this environment; only landmark configuration and metadata changed, through the same standard-library registration helper used by that pipeline.

### Actual browser inspection and final adjustment

The deployed Site was inspected in connected Chrome at its normal 1920 × 919 viewport. 葛洲坝 was examined from both the settled top and oblique views; its model and the mapped line now connect along a common axis. 镇江阁's landward steps, river-facing rear and complete base are visible. 至喜's towers stand at the two banks with its side spans following the mapped road.

The first new 天然塔 close view exposed a concrete scale regression: unchanged lamps, benches and railings looked oversized beside the correctly placed smaller tower. V10 scales local furniture around its existing anchors (0.51 at 镇江阁, 0.28 at 天然塔), reduces rail height/cross-section without moving shoreline endpoints, and updates night-light positions. The tower's close framing was tightened to approximately 5.17 world units of visible height on this desktop layout. The final screenshot shows the whole tower, entrance steps and proportionate surrounding furniture. An independent visual review confirmed the regression is resolved.

A 390 × 844 responsive check showed the whole tower and steps above the complete bottom detail sheet. DOM measurements reported document width 390, stage scrollTop 0, and stage scrollHeight = clientHeight = 784. The application error/warning log was empty. The temporary viewport was reset to 1920 pixels, and the final browser tab was left at the corrected 葛洲坝 close view. No device-performance or new export/download claim is made.

Current waterfront planning retains three decorative boats and two checked routes. Only three generic building footprints overlap the newly registered historic models, compared with eighteen in the previous enlarged/shifted display. Furnishings and boats remain illustrative assets.

### Evidence

- `docs/qa/alignment-dam-oblique.png` and `alignment-dam-top.png`: V9 actual rendered dam-axis continuity; the dam geometry and framing are unchanged in V10.
- `docs/qa/alignment-zhixi.png`: V9 corrected bridge main-span and bank tower placement; unchanged in V10.
- `docs/qa/alignment-pavilion.png`: final V10 landward entrance and fixed-anchor pavilion, with proportional furniture.
- `docs/qa/alignment-pagoda.png`: final V10 tower and river-facing entry.
- `docs/qa/alignment-mobile.png`: final V10 390 × 844 tower detail.
- `docs/qa/alignment-pagoda-initial.png`: retained V9 evidence of the furniture-scale issue, superseded by the final image.

---

## Detail iteration — 2026-11-09 (Asia/Shanghai)

This historical section records the preceding detail iteration. Its display-only inland offsets and enlarged waterfront props have been replaced by the registration work above.

**Published; inspected desktop and mobile visual states passed.** The new work retains the bright miniature style and updates the same owner-private Site. Latest functional source: `1ca21d6fef83f0a067609f616c7c7239cdc4e88c` (V7). Documentation-only follow-up commits do not change the build.

### Delivered

- Local paved courts and river walks, shoreline railings, four benches and five lamp posts around 镇江阁 and 天然塔. Three small decorative boats use two checked water routes. These props and routes are illustrative, not surveyed assets or live traffic.
- Visible night-time eave lights, warm windows and lanterns; small bridge rail lights. Tiny procedural plaque textures avoid external image dependencies.
- Separate default and close camera framing, with 1.4× close magnification and projected space reserved for the desktop card / mobile sheet. The two waterfront landmarks also offer a lower view from the river.
- Previous/next landmark buttons, a PNG export control, motion pause, selection clearing, and synchronized orbit state after manual camera interaction. Reduced-motion preferences set the initial motion state; an explicit checkbox choice can opt in.
- Resting full-city views remain static; boat animation is limited to selected waterfront views and approximately 30 updates per second. Hidden pages pause animation. No device-performance claim is made.

### Actual browser checks

The deployed Site rendered in connected Chrome at 1440 × 900 and the restored default desktop viewport (1920 × 919). The observed states included 镇江阁 default/close, day/night, the river-facing view, landmark navigation wrapping from 镇江阁 to 西坝岛 and back, and the correct 天然塔 detail content. The PNG button displayed the expected save status without an application exception.

A real focus-scroll defect was found during inspection: offscreen projected labels expanded the fixed stage's scrollable area, and clicking the near-view control moved the canvas and toolbar upward. `overflow: clip` on the stage and label layer fixed it. The repeated browser check reported stage `scrollTop = 0`, `scrollHeight = clientHeight = 830`, and a visible toolbar at y = 92.

The first night-light implementation was geometrically occluded by roofs/walls. Its visible placement was corrected and rechecked in actual rendering. The final 镇江阁 screenshots show thin warm eave lines and lit windows while retaining roof, railing and column detail. A separate visual review passed both screenshots with no visible overexposure or clipped UI.

The motion checkbox was switched off. Three water-region captures retained the same boat positions; residual channel differences were at most 6/255 and mean absolute differences about 0.00171/255. The checkbox was switched back on. This checks pause behavior, not a timing or frame-rate benchmark.

### Targeted geometry and build checks

- Production builds passed. Current assets: `index-vZUI6gNK.js` and `index-C6591R1O.css`; `git diff --check` passed.
- 50,699 paving samples and 5,202 model-footprint samples stayed on source land. 155,520 boat/wake vertex samples and 11,520 route-clearance samples stayed in water. Sampled route clearance from the nearest bridge road segment was at least 11.513 world units.
- Source POI coordinates are preserved. Display-only landward shifts are 1.55 units for 镇江阁 and 2.5 for 天然塔; 18 overlapping generic building footprints are omitted from rendering at these enlarged landmark sites.
- Four desktop/mobile container sizes and all seven landmark bounds were checked against the camera's available viewport. All 448 tested bounds/upper-margin points fit, with separate default and 1.4× close framing. The later 天然塔 direction-only adjustment retains this fitting calculation.

### Recovery and remaining limits

A near view of 天然塔 revealed foreground buildings blocking part of the tower. V7 changes only its default/detail direction to a higher view from the water, retaining the real neighboring building geometry. After the browser connection recovered, the final V7 screenshot showed the complete tower, steps, riverwalk and surrounding city without the previous foreground obstruction.

A 390 × 844 responsive state was inspected after recovery. The tower and the full bottom detail card are visible in the final image. A DOM layout check reported document `scrollWidth = clientWidth = 390` and stage `scrollTop = 0`. The mobile drawer was also observed opening. A separate final visual review passed both the 天然塔 desktop and mobile screenshots with no model/card occlusion or horizontal clipping. This is responsive browser verification, not a physical-phone performance benchmark.

The temporary viewport override was reset at handoff and the final browser application error/warning log was empty. The earlier screenshot/connection timeouts were recovered; they are not outstanding Site errors.

The download-event waiter timed out and reset the browser session. A subsequent direct click of the PNG button produced “正在保存这张宜昌风景”; completion in the browser's Downloads folder is not asserted.

### Evidence for this iteration

- `docs/qa/details-day.png` — actual 1440 × 900 镇江阁 close view, with riverwalk, facilities and boats.
- `docs/qa/details-night.png` — the same view with visible eave and window lighting.
- `docs/qa/details-pagoda.png` — V7 天然塔 from the water, after resolving foreground occlusion.
- `docs/qa/details-mobile.png` — V7 390 × 844 天然塔 close view and full mobile detail sheet.

The 镇江阁 images were captured from functional revision `fc7dc927b1b0943927be5bae461211da26c2e0c4`. V7 changes only 天然塔's camera direction, so that illustrated scene and interface are unchanged. The 天然塔 and mobile images were captured from final functional revision `1ca21d6fef83f0a067609f616c7c7239cdc4e88c`.

---

## V4 baseline result

**Passed.** No remaining P0, P1, or P2 visual or interaction blocker was observed in the checked states. Reviewed on 2026-11-08 against the user-selected Douyin city-sandbox reference. This is an adaptation to Yichang geography, not a pixel-identical copy of the Nanjing screen.

Live Site: https://yichang-miniature-city.gaoronghai.chatgpt.site

Last functional source revision checked: `c0e894aa2e867b3c845c74e882807865085c308f`. Subsequent documentation and screenshot commits do not alter the checked application assets.

## Reference and visual criteria

Reference: https://www.douyin.com/video/7704694490355608165 (闻远). Actual reference frames are stored in `docs/reference/01-reference-city-overview.png` and `02-reference-sandbox-base.png`. The comparison uses the webpage within the video, excluding the outer video title, browser chrome, and subtitles.

| Criterion | Observed result |
| --- | --- |
| Physical miniature | Finite square model, visibly thick layered earth section, soft contact shadow and slanted orthographic view. |
| Color | Cream interface; forest-green controls; grass-green ground; clear blue water; bright off-white buildings. The initially washed-out render was corrected. |
| City geometry | Real clipped river, road and building footprints give a recognizably river-centered Yichang layout. Styled landmarks are the visual accents. |
| Typography and hierarchy | Chinese serif titles, restrained sans-serif controls, clear directory groups and selected state. No missing Chinese glyphs observed. |
| Detail view | The selected landmark remains clear to the left of the story panel. Scene postcards are captured from the actual canvas and update with the day/night theme. |
| Labels | Desktop labels avoid overlaps. On a small screen, labels requiring more than one row of displacement are hidden; all seven landmarks remain in the directory. Selected visible landmarks retain priority. |
| Readability on scenery | Bottom captions and data credits have translucent paper-colored backing, including in close views over blue water. |
| Responsive layout | Desktop directory becomes a mobile drawer; details use a bottom sheet; icon-only mobile controls have accessible names. |

## Rendered checks

Actual WebGL rendering was inspected in the connected Chrome browser after private deployment, at the default desktop viewport (1920 × 920), 1440 × 900, and a temporary 390 × 844 viewport. Temporary viewport overrides were reset before handoff. Mobile-width checks are browser layout checks, not a physical-device performance benchmark.

The managed internal preview browser reported `GL_RENDERER = Disabled` and could not create a WebGL context. No application fallback or browser security change was introduced to compensate. The deployed Site rendered successfully in the connected browser, with an empty application error/warning log during final inspection.

### Interactions observed

- Initial data loading completes and reveals the rendered model.
- Directory selection smoothly focuses 镇江阁、天然塔、夷陵长江大桥 and 至喜长江大桥, and opens the matching description and real scene postcard.
- Search for 天然 narrows the directory to 天然塔; clearing restores all landmarks.
- Closing details and returning to the full scene work.
- Top view and miniature perspective switch correctly.
- Day/night switching changes the scene and interface; the open postcard updates to the new theme.
- Building visibility removes the building layer; the label toggle changes its container to opacity 0 and visibility hidden; restoring both works.
- Automatic orbit toggles to a pause state; manual canvas dragging changes the compass heading.
- Mobile navigation opens, selection closes the drawer, and the detail sheet remains usable.
- The closed mobile directory receives `aria-hidden`, and the mobile viewport has no horizontal document overflow.
- Guide modal opens with the stated controls and touch instructions.

### Build and geometry checks

Production builds passed after each functional revision. Final functional output is `index-ByphOWSb.js` and `index-CIwZ5mIP.css`. `git diff --check` passed. The scene module parses; landmark geometry, ground placement, endpoint length/orientation and theme updates were checked by the implementation agents. Rendering uses merged building/road meshes and instanced trees; no performance figure is asserted without a benchmark.

## Evidence

- `docs/qa/final-desktop.png`: final daytime overview.
- `docs/qa/final-detail.png`: 镇江阁 close view.
- `docs/qa/final-bridge.png`: suspension-bridge close view and readable bottom captions.
- `docs/qa/final-night.png`: nighttime landmark view (before the bottom-caption backing adjustment; 3D scene is unchanged).
- `docs/qa/final-mobile.png`: final 390 × 844 overview, short local labels and readable footer.

The first-render and pre-fix mobile images are retained with explicit initial/before names for review history. A separate read-only visual review also found no remaining P0/P1/P2 blocker in the final desktop, close-up and corrected mobile images.

## Scope and factual limits

The data covers approximately 12.44 × 12.25 km of central Yichang. It is not the entire municipal administrative area. Buildings are selected real footprints with mixed-source heights and 3.8× display exaggeration; landmark dimensions, trees and the small hill relief are stylized. No DEM or measured landmark survey is included. The presentation is suitable for a miniature city explorer, not survey or engineering use. Full data credits and provenance remain available from the Site.
