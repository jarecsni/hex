import type { Command } from 'commander';
import { brand } from '../brand/colors.js';
import { getDefaultConfigPath, loadConfig } from '../core/config/load.js';
import { type TemplateEntry, discoverTemplates } from '../core/discovery/index.js';

export function registerList(program: Command): void {
  program
    .command('list')
    .description('list templates available across configured source roots')
    .option('--json', 'emit machine-readable JSON', false)
    .action(async (opts: { json: boolean }) => {
      const config = await loadConfig();
      const { templates, warnings } = await discoverTemplates(config);

      if (opts.json) {
        process.stdout.write(`${JSON.stringify({ templates, warnings }, null, 2)}\n`);
        return;
      }

      if (config.sources.length === 0) {
        const configPath = getDefaultConfigPath();
        const example =
          '  sources:\n    - path: ~/dev/hex-templates\n    - path: /opt/hex/templates\n';
        process.stdout.write(
          `${brand.dim('No source roots configured.')}\n\nAdd a config file at ${brand.bold(configPath)}:\n\n${example}`,
        );
        return;
      }

      if (templates.length === 0) {
        process.stdout.write(`${brand.dim('No templates found.')}\n`);
      } else {
        process.stdout.write(formatTable(templates));
      }

      if (warnings.length > 0) {
        process.stdout.write('\n');
        for (const w of warnings) {
          process.stdout.write(`${brand.warn(`! ${w}`)}\n`);
        }
      }
    });
}

function formatTable(templates: TemplateEntry[]): string {
  const rows = templates.map((t) => ({
    name: t.name,
    version: `@${t.version}`,
    type: t.type,
    kind: t.kind ?? '',
    path: t.rootPath,
  }));

  const widths = {
    name: Math.max(4, ...rows.map((r) => r.name.length)),
    version: Math.max(7, ...rows.map((r) => r.version.length)),
    type: Math.max(4, ...rows.map((r) => r.type.length)),
    kind: Math.max(4, ...rows.map((r) => r.kind.length)),
  };

  const lines = rows.map((r) => {
    const name = brand.bold(r.name.padEnd(widths.name));
    const version = brand.dim(r.version.padEnd(widths.version));
    const type = r.type.padEnd(widths.type);
    const kind = r.kind.padEnd(widths.kind);
    const path = brand.dim(r.path);
    return `${name}  ${version}  ${type}  ${kind}  ${path}\n`;
  });

  return lines.join('');
}
