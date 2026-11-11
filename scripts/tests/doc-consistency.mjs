/**
 * Node-side guard (no browser): the generated docs must match the JSON
 * source of truth, and application sources must not hardcode preset ids or
 * values outside the config module itself.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = process.cwd();

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}

export async function runDocConsistencyCheck() {
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });

  const config = JSON.parse(await readFile(join(ROOT, 'src/config/quality-presets.json'), 'utf8'));
  const doc = await readFile(join(ROOT, 'docs/quality-presets.md'), 'utf8');

  for (const preset of config.presets) {
    const row = `| \`${preset.id}\` | ${preset.label} | ${preset.raymarchSteps} | ${preset.resolutionScale} |`;
    check(`文档包含 ${preset.id} 且参数与 JSON 一致`, doc.includes(row), row);
  }
  check('文档记录默认档位', doc.includes(`默认档位：\`${config.defaultPresetId}\``), config.defaultPresetId);

  // Hardcoding guard: preset ids may appear only in the config layer.
  const srcFiles = (await walk(join(ROOT, 'src'))).filter(
    (f) => !f.endsWith('quality-presets.json') && !f.endsWith('config/quality.ts'),
  );
  const forbidden = ['"smooth"', '"balanced"', '"ultra"', "'smooth'", "'balanced'", "'ultra'"];
  const offenders = [];
  for (const file of srcFiles) {
    const text = await readFile(file, 'utf8');
    for (const token of forbidden) {
      if (text.includes(token)) {
        offenders.push(`${file.replace(ROOT, '')} contains ${token}`);
      }
    }
  }
  check('应用源码中不存在档位 id 硬编码（仅配置层可出现）', offenders.length === 0, offenders);

  return results;
}
