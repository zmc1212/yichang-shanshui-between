// Bounded, illustrative extensions of the existing street planner. Coordinates,
// source road widths, authored model transforms and retained model ground stay
// unchanged. These routes begin OUTSIDE the complete authored model bounds;
// followModelEntrance projects only the inspection subject's lateral position
// and does not certify a surveyed entrance or allow paving inside that model.
// Evidence and rejected candidates: docs/iterations/20261110-extra-street-frontages.json.
export const EXTRA_STREET_SITES = [
  {
    id: 'jinjiang-s03',
    roadName: '沿江大道',
    courtDepth: 4,
    halfRun: 44,
    followModelEntrance: true,
    treeSpan: 36,
    treeStep: 18,
    lampOffsets: [-27, 27],
    benchOffsets: [-8, 8],
  },
  {
    id: 'fujiang-s01',
    roadName: '沿江大道',
    // The curved model is oblique to the road. A 3–5 m outer band overlaps
    // the separate sidewalk at one end; the verified 2 m strip does
    // not. Keep this short of the mapped elevated section and side street.
    courtDepth: 2,
    halfRun: 48,
    followModelEntrance: true,
    treeSpan: 36,
    treeStep: 18,
    lampOffsets: [-30, 30],
    benchOffsets: [-8, 8],
  },
  {
    id: 'zhongnan-s09',
    roadName: '夷陵大道',
    courtDepth: 4,
    halfRun: 55,
    // This 44 m display segment stays within the continuous, same-side
    // frontage. Longer symmetric runs create islands beyond side streets.
    runBefore: 11,
    runAfter: 33,
    followModelEntrance: true,
    cornerLayout: true,
    treeSpan: 30,
    treeStep: 15,
    lampOffsets: [-7, 25],
    benchOffsets: [-8, 8],
  },
];
