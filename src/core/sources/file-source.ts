import { stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { parseManifestFile } from '../manifest/parse.js';
import type { Manifest } from '../manifest/types.js';

export type ComponentBundle = {
  manifest: Manifest;
  rootPath: string;
};

export class SourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceError';
  }
}

export const MANIFEST_CANDIDATES = ['manifest.yaml', 'manifest.yml'];

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * Locate `.hex/manifest.{yaml,yml}` under a candidate template root,
 * returning the first match. Exported so the discovery walker can reuse
 * the candidate-file logic.
 */
export async function findManifestFile(rootPath: string): Promise<string | null> {
  for (const name of MANIFEST_CANDIDATES) {
    const candidate = join(rootPath, '.hex', name);
    if (await isFile(candidate)) return candidate;
  }
  return null;
}

async function findManifest(rootPath: string): Promise<string> {
  const found = await findManifestFile(rootPath);
  if (found) return found;
  throw new SourceError(
    `no manifest found in ${rootPath}/.hex/ — expected one of: ${MANIFEST_CANDIDATES.join(', ')}`,
  );
}

/**
 * Load a component bundle from a local filesystem path.
 *
 * The path must be an existing directory containing `.hex/manifest.yaml`.
 */
export async function loadFromPath(path: string): Promise<ComponentBundle> {
  const rootPath = isAbsolute(path) ? path : resolve(process.cwd(), path);

  let s: Awaited<ReturnType<typeof stat>>;
  try {
    s = await stat(rootPath);
  } catch {
    throw new SourceError(`template path does not exist: ${rootPath}`);
  }
  if (!s.isDirectory()) {
    throw new SourceError(`template path is not a directory: ${rootPath}`);
  }

  const manifestPath = await findManifest(rootPath);
  const manifest = await parseManifestFile(manifestPath);
  return { manifest, rootPath };
}
