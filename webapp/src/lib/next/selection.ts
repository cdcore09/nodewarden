// Fork-local (NodeWarden Next): pure selection-model helpers for bulk
// operations in VaultNextPage. Kept DOM-free so node:test covers the
// range/toggle semantics directly.

export function toggleSelection(selection: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selection);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function rangeSelect(
  selection: ReadonlySet<string>,
  visibleIds: readonly string[],
  anchorId: string | null,
  targetId: string,
): Set<string> {
  const anchorIndex = anchorId === null ? -1 : visibleIds.indexOf(anchorId);
  const targetIndex = visibleIds.indexOf(targetId);
  if (anchorIndex === -1 || targetIndex === -1) {
    const next = new Set(selection);
    next.add(targetId);
    return next;
  }
  const [from, to] = anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
  const next = new Set(selection);
  for (let i = from; i <= to; i++) next.add(visibleIds[i]);
  return next;
}

export function selectAll(visibleIds: readonly string[]): Set<string> {
  return new Set(visibleIds);
}

export function pruneSelection(selection: ReadonlySet<string>, visibleIds: readonly string[]): Set<string> {
  const visible = new Set(visibleIds);
  const next = new Set<string>();
  for (const id of selection) if (visible.has(id)) next.add(id);
  return next;
}
