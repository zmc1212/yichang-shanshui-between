# Yichang GIS base data

© OpenStreetMap contributors; © Overture Maps Foundation.
East Asian building footprints: Qian Shi et al., DOI:10.5281/zenodo.8174931 (CC BY 4.0).
Building height estimates: Yangzi Che et al., 3D-GloBFP v3 (2020), DOI:10.5281/zenodo.15459025 (CC BY 4.0).

The extracted and processed GIS databases are provided under ODbL-1.0:
https://opendatacommons.org/licenses/odbl/1-0/

Source attribution and source dates, processing changes, output checksums and geometry file indexes are in manifest.json, roads-water-source.json and buildings-source.json. Supplemental height provenance and the association policy are in [building-height-source.json](./building-height-source.json), with the per-building [association ledger](./building-height-associations.json.gz). Overture release date is not imagery capture date. The extraction is a public-data urban subset, not a complete survey of Yichang.

Road and water geometry comes from OpenStreetMap:
https://www.openstreetmap.org/copyright

Building data comes from Overture Maps:
https://docs.overturemaps.org/guides/buildings/
https://docs.overturemaps.org/attribution/

East Asian source:
https://zenodo.org/records/8174931
https://creativecommons.org/licenses/by/4.0/

Supplemental height source:

- Yangzi Che et al., **3D-GloBFP v3**, 2020 reference year: https://doi.org/10.5281/zenodo.15459025
- Source part: https://doi.org/10.6084/m9.figshare.28906499.v3
- Research paper: https://doi.org/10.5194/essd-16-5357-2024
- Source licence: **CC BY 4.0**, https://creativecommons.org/licenses/by/4.0/

The original footprint attribution and ODbL distribution terms remain. The height source's CC BY 4.0 attribution is retained separately; it does not replace the Overture or OpenStreetMap footprint attribution.

## Current building heights

The 49,378 retained footprints have these height categories:

| `heightSource` | Count | Meaning |
| --- | ---: | --- |
| `tag` | 346 | Source-provided height, not independently surveyed or verified |
| `levels` | 17 | Source floor count multiplied by an estimated 3 metres |
| `globfp2020` | 41,855 | 2020 machine-learning height prediction from 3D-GloBFP, assigned after strict footprint matching |
| `default` | 7,160 | Fixed 12 metre visualization height; not a measured or predicted height |
| `measured` | 0 | No independently measured heights have been introduced |

Before V56, 49,015 footprints used the fixed 12 metre default. The supplement changes only the two height fields of eligible default-height features; all retained IDs, footprint geometry and other properties remain unchanged, as do the existing `tag` and `levels` heights.

Matching requires intersection-over-union of at least 0.60 and at least 75% coverage of both the target and source footprints. Each target MultiPolygon part must meet 75% coverage. A second source covering 20% or more of the target rejects the association, and one source is assigned to at most one updated target. Non-finite or out-of-range source heights are rejected; accepted heights are rounded to 0.1 metre for display, not as an accuracy claim. Unmatched or ambiguous targets keep the original default.

Edits to the footprint snapshot remain region clipping, topology-preserving simplification, coordinate rounding and spatial partitioning. No random building footprints or random heights were generated. The current 138 building tiles total 17,272,449 bytes; individual-tile gzip estimates total 3,256,654 bytes; the largest tile is 292,649 bytes. Actual transfer size depends on hosting compression.

The 2020 predictions and the later footprint snapshot have different reference dates. Polygon overlap is an association check, not local height validation. These are flat-roof LoD1 display volumes, not current surveyed buildings, measured roof shapes or photogrammetry.
