// Each source root currently has a single shape: a local filesystem path.
// The wire form is intentionally `{ path: string }` (not bare strings) so
// M3's GitSource extension is additive — `{ git, ref? }` slots in next
// to `{ path }` once we build that.
export type SourceRootEntry = { path: string };

export type HexConfig = {
  sources: SourceRootEntry[];
};
