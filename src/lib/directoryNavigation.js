const searchableText = value => String(value || '').toLowerCase().replace(/\s+/g, '');

// Keep navigation, keyboard results and visible numbering in the same order as
// the grouped directory, including categories whose source rows are interleaved.
export function buildDirectoryResults(landmarks, { query = '', filter = 'all' } = {}) {
  const search = searchableText(query);
  const groupsByCategory = new Map();
  for (const landmark of landmarks) {
    if (filter !== 'all' && landmark.modelStatus !== filter) continue;
    const text = [landmark.name, landmark.category, landmark.subtitle, landmark.sourceName, ...(landmark.aliases || [])]
      .filter(Boolean).join(' ');
    if (!searchableText(text).includes(search)) continue;
    const category = landmark.category || '城市地标';
    if (!groupsByCategory.has(category)) groupsByCategory.set(category, []);
    groupsByCategory.get(category).push(landmark);
  }
  const groups = [...groupsByCategory].map(([category, items]) => ({ category, items }));
  return { groups, items: groups.flatMap(group => group.items) };
}

export function getDirectoryNavigation(items, selectedId) {
  const total = items.length;
  const index = items.findIndex(item => item.id === selectedId);
  const canStep = total > 1;
  return {
    index,
    position: index < 0 ? 0 : index + 1,
    total,
    outside: Boolean(selectedId) && index < 0,
    canStep,
    previousId: canStep ? items[index < 0 ? total - 1 : (index - 1 + total) % total].id : null,
    nextId: canStep ? items[index < 0 ? 0 : (index + 1) % total].id : null,
  };
}

export function moveDirectoryActiveId(items, activeId, direction) {
  if (!items.length) return null;
  const index = items.findIndex(item => item.id === activeId);
  const nextIndex = index < 0
    ? direction < 0 ? items.length - 1 : 0
    : (index + (direction < 0 ? -1 : 1) + items.length) % items.length;
  return items[nextIndex].id;
}

export function isComposingKeyEvent(event, compositionActive = false) {
  return Boolean(compositionActive || event?.isComposing || event?.nativeEvent?.isComposing
    || event?.keyCode === 229 || event?.nativeEvent?.keyCode === 229);
}
