# Current23 international frontage: independent source-geometry diagnostic

This diagnostic reads the actual current `/models/current23/06/{light,detail}.glb`, including mesh transforms and Meshopt decoding. It does not read the legacy `/models/yichang-international-s01` assets and does not modify production code or source models.

Run: `node scripts/diagnose-current23-international-low-geometry.mjs`.

## Verified geometry

Both current LODs have a continuous Light stone paving upper boundary, over the inspected X interval `[32.9,36.8]`, at native **Z=27.500717184972686, Y=-0.09975645499281255**. The report retains clipped triangles and both endpoints. The source base reaches Y=-0.41962095281073913. The former underlay Y=-0.13 lies inside this vertical span, so simply approving the new SHA and retaining the old interior paving is unsafe.

The band Z=28..30.1 contains decorative course accents only, reaching Z≈29.419386 in light and ≈29.433757 in detail. The old external landing rectangle X=32.9..36.8, Z=30.1..31.5 has no low source triangles. The whole-model maxZ≈29.8 is **not** the solid floor edge at this corridor. Starting a connecting floor at 29.8 without filling the preceding gap would not establish continuity.

## Smallest credible repair candidate

1. Keep the source model, source transform and all original source paving/accents unchanged.
2. Treat existing solid paving as the interior floor; do not emit the old departure and underlay portions over it.
3. Start a new bounded short transition at the actual solid edge Z=27.500717184972686 / Y=-0.09975645499281255. A narrow X=32.9..33.9 candidate may descend to the retained -0.13 under-ring level; exact extent must pass source-triangle clearance tests.
4. Retain only independently cleared downstream underlay, outer landing and long road transition. Do not hide rings to force clearance.
5. Re-certify both current GLBs and their source bounds in a current-specific guarded branch. Preserve the old guarded branch for old assets rather than weakening identity checks.

## Required acceptance before activation

- Clip every emitted paving triangle against **both actual current assets**, not the historical asset path. Check signed vertical separation over the complete intersection polygon, not centers or AABBs only.
- Source contact allowed only along the exact certified boundary; prove both full-width endpoint coverage and shared-edge heights after actual Float32 renderer emission.
- Preserve positive clearance under every retained ring and verify no other source material is crossed.
- Exercise source-road / water / board / other building exclusions and full route floor coverage. Existing platform sections count only if actual source top triangles cover the complete walking footprint.
- Keep SHA/asset/bounds mismatch fail-closed and explicitly test it.
- Do not claim site survey, confirmed operating entry route, accessibility certification, or real-browser visual approval from these offline tests.

`low-geometry.json` records independently decoded current asset hashes, per-zone material bounds, and clipped samples. This diagnostic certifies only the stated source facts; it does not by itself certify a finished connector.
