import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { HexConfig } from '../config/types.js';
import { parseManifestFile } from '../manifest/parse.js';
import { findManifestFile } from '../sources/file-source.js';

export type TemplateEntry = {
  name: string;
  version: string;
  type: 'component' | 'recipe';
  kind?: string;
  rootPath: string;
  sourceRoot: string;
};

export type DiscoveryResult = {
  templates: TemplateEntry[];
  warnings: string[];
};

/**
 * Walk every configured source root one level deep, looking for child
 * directories that contain `.hex/manifest.{yaml,yml}`. Malformed manifests
 * skip to a `warnings` channel instead of aborting the walk — one bad
 * manifest in a shared root shouldn't take down `hex list`.
 *
 * Name clashes across roots: first-root-wins, with a warning. Predictable
 * without anticipating M9's qualified-name addressing.
 *
 * Discovery deliberately lives outside `sources/` because `idea.md`
 * Section 9 splits *fetch* (Source) from *discovery* (Catalogue). Even
 * though M2 ships no formal `Catalogue` interface, keeping the modules
 * separate now avoids fusing them when M9 lands.
 */
export async function discoverTemplates(config: HexConfig): Promise<DiscoveryResult> {
  const templates: TemplateEntry[] = [];
  const warnings: string[] = [];
  const seenNames = new Map<string, TemplateEntry>();

  for (const source of config.sources) {
    if (source.kind === 'git') {
      // M3.3 wires git resolution into discovery. Until then, list-time
      // discovery skips git entries with a warning so a config mixing
      // path + git roots still surfaces the local templates cleanly.
      warnings.push(
        `git source not yet supported in this build (skipped): ${source.url}${
          source.ref ? `@${source.ref}` : ''
        }`,
      );
      continue;
    }

    const sourceRoot = source.path;

    let rootStat: Awaited<ReturnType<typeof stat>>;
    try {
      rootStat = await stat(sourceRoot);
    } catch {
      warnings.push(`source root not found: ${sourceRoot}`);
      continue;
    }
    if (!rootStat.isDirectory()) {
      warnings.push(`source root is not a directory: ${sourceRoot}`);
      continue;
    }

    let entries: string[];
    try {
      entries = await readdir(sourceRoot);
    } catch (err) {
      warnings.push(
        `cannot read source root ${sourceRoot}: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    for (const entry of entries) {
      const childPath = join(sourceRoot, entry);
      let childStat: Awaited<ReturnType<typeof stat>>;
      try {
        childStat = await stat(childPath);
      } catch {
        continue;
      }
      if (!childStat.isDirectory()) continue;

      const manifestPath = await findManifestFile(childPath);
      if (!manifestPath) continue;

      try {
        const manifest = await parseManifestFile(manifestPath);
        const template: TemplateEntry = {
          name: manifest.name,
          version: manifest.version,
          type: manifest.type,
          kind: manifest.kind,
          rootPath: childPath,
          sourceRoot,
        };

        const previous = seenNames.get(manifest.name);
        if (previous) {
          warnings.push(
            `duplicate template "${manifest.name}" — keeping ${previous.rootPath}, ignoring ${childPath}`,
          );
          continue;
        }

        seenNames.set(manifest.name, template);
        templates.push(template);
      } catch (err) {
        warnings.push(
          `skipped ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  return { templates, warnings };
}
