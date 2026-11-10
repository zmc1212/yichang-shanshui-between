// Retain the pre-extension eight groups' exact regression budget. Geometry
// filtering alone would leave new global lamp/cell totals in old reports.
// The dedicated approach check validates the full integrated plan separately.
export function retainedStreetTestPlan(plan) {
  const groups = [...plan.sites, ...(plan.links || [])];
  const stats = Object.fromEntries(Object.entries(plan.stats).filter(([key]) => !/^street(Extension|Junction|View|Route)/.test(key)));
  for (const [key, property] of [['streetPavingCells', 'paving'], ['streetCurbSegments', 'curbs'], ['streetTrees', 'trees'], ['streetLamps', 'lamps'], ['streetBenches', 'benches']]) stats[key] = groups.reduce((sum, site) => sum + site[property].length, 0);
  return { ...plan, extensions: [], stats };
}
