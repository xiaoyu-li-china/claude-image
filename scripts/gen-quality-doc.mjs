/**
 * Generate docs/quality-presets.md from the single source of truth.
 * Run via `npm run gen:quality-doc`; the README never lists preset numbers
 * by hand — it points at this generated file.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const configPath = join(root, 'src/config/quality-presets.json');
const outputPath = join(root, 'docs/quality-presets.md');

const config = JSON.parse(await readFile(configPath, 'utf8'));

const lines = [];
lines.push('# 画质档位参数（自动生成，请勿手改）');
lines.push('');
lines.push(`- 数据源：\`src/config/quality-presets.json\`（version ${config.version}）`);
lines.push('- 生成命令：`npm run gen:quality-doc`');
lines.push(`- 默认档位：\`${config.defaultPresetId}\``);
lines.push('');
lines.push('## 校验规则');
lines.push('');
lines.push(`- raymarchSteps：${config.constraints.raymarchSteps.description}（type=${config.constraints.raymarchSteps.type}, min=${config.constraints.raymarchSteps.min}）`);
lines.push(`- resolutionScale：${config.constraints.resolutionScale.description}（type=${config.constraints.resolutionScale.type}, 范围 (${config.constraints.resolutionScale.minExclusive}, ${config.constraints.resolutionScale.max}]）`);
lines.push('');
lines.push('## 档位');
lines.push('');
lines.push('| 档位 id | 显示名 | raymarchSteps（正整数） | resolutionScale（(0,1]） |');
lines.push('| --- | --- | --- | --- |');
for (const preset of config.presets) {
  lines.push(`| \`${preset.id}\` | ${preset.label} | ${preset.raymarchSteps} | ${preset.resolutionScale} |`);
}
lines.push('');
lines.push('UI 下拉框、渲染参数注入与本文件均从同一 JSON 导入，不存在第二处硬编码。');
lines.push('');

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, lines.join('\n'), 'utf8');
console.log(`[gen:quality-doc] wrote ${outputPath}`);
