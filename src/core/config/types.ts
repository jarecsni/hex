// Source roots can point at a local filesystem path or a git remote.
// The wire form (in `~/.hex/config.yaml`) is `{ path: ... }` or
// `{ git: ..., ref?: ... }` — see `schema.ts`. Internally we tag each
// entry with a `kind` discriminator so consumers (discovery, the future
// resolver) can switch on it without re-sniffing field presence.
export type FileSourceRoot = { kind: 'path'; path: string };
export type GitSourceRoot = { kind: 'git'; url: string; ref?: string };
export type SourceRootEntry = FileSourceRoot | GitSourceRoot;

export type HexConfig = {
  sources: SourceRootEntry[];
};
