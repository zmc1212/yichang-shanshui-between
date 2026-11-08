# 宜昌 · 江山之间 — Design QA

## Result

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
