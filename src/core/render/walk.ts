import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import ignore, { type Ignore } from 'ignore';

const HEX_DIR = '.hex';
const HEXIGNORE_FILE = '.hexignore';

export type WalkedFile = {
  /** Path relative to the template root, using POSIX separators (`/`). */
  relativePath: string;
  /** Absolute path on disk. */
  absolutePath: string;
};

async function loadHexignore(rootPath: string): Promise<Ignore> {
  const ig = ignore();
  try {
    const body = await readFile(join(rootPath, HEXIGNORE_FILE), 'utf8');
    ig.add(body);
  } catch {
    // missing .hexignore is fine
  }
  return ig;
}

function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/');
}

/**
 * Walk a template root, yielding every file that should be considered
 * for rendering. Skips:
 *
 *   - the `.hex/` directory at the artifact root (Hex metadata)
 *   - the `.hexignore` file itself
 *   - any path matched by `.hexignore`
 *
 * Symlinks are not followed.
 */
export async function* walkTemplate(rootPath: string): AsyncGenerator<WalkedFile> {
  const ig = await loadHexignore(rootPath);

  async function* walk(absDir: string): AsyncGenerator<WalkedFile> {
    const entries = await readdir(absDir, { withFileTypes: true });
    for (const entry of entries) {
      const absPath = join(absDir, entry.name);
      const rel = toPosix(relative(rootPath, absPath));

      if (rel === HEX_DIR || rel.startsWith(`${HEX_DIR}/`)) continue;
      if (rel === HEXIGNORE_FILE) continue;

      if (entry.isDirectory()) {
        // gitignore-style: a trailing-slash glob targets directories
        if (ig.ignores(`${rel}/`)) continue;
        yield* walk(absPath);
      } else if (entry.isFile()) {
        if (ig.ignores(rel)) continue;
        yield { relativePath: rel, absolutePath: absPath };
      }
      // symlinks, sockets, etc. are intentionally skipped
    }
  }

  yield* walk(rootPath);
}
