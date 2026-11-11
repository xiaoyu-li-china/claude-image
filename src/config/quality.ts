/**
 * Quality configuration — the single source of truth lives in
 * src/config/quality-presets.json. Nothing else in the codebase hardcodes
 * preset ids, step counts or scale values:
 *   - the UI dropdown is populated from the same imported object;
 *   - render parameters (raymarch steps, resolution scale) come from the
 *     active preset via getQualityConfig();
 *   - docs/quality-presets.md is generated from it by
 *     scripts/gen-quality-doc.mjs.
 */
import raw from './quality-presets.json';

export interface QualityPreset {
  id: string;
  label: string;
  raymarchSteps: number;
  resolutionScale: number;
}

export interface QualityConstraints {
  raymarchSteps: {
    type: 'integer';
    min: number;
    description: string;
  };
  resolutionScale: {
    type: 'number';
    minExclusive: number;
    max: number;
    description: string;
  };
}

export interface QualityConfigFile {
  version: number;
  defaultPresetId: string;
  constraints: QualityConstraints;
  presets: QualityPreset[];
}

export class QualityConfigError extends Error {
  readonly violations: ReadonlyArray<string>;

  constructor(violations: ReadonlyArray<string>) {
    super(`非法画质配置：\n - ${violations.join('\n - ')}`);
    this.name = 'QualityConfigError';
    this.violations = violations;
  }
}

const config = raw as QualityConfigFile;

/** Structural + rule validation. Throws QualityConfigError with every issue found. */
export function validateQualityConfig(candidate: unknown): asserts candidate is QualityConfigFile {
  const violations: string[] = [];
  if (typeof candidate !== 'object' || candidate === null) {
    throw new QualityConfigError(['配置根节点必须是对象']);
  }
  const file = candidate as Record<string, unknown>;
  const presets = file.presets;

  if (!Array.isArray(presets) || presets.length === 0) {
    violations.push('presets 必须是非空数组');
  } else {
    const ids = new Set<string>();
    for (const [index, entry] of presets.entries()) {
      const where = `presets[${index}]`;
      if (typeof entry !== 'object' || entry === null) {
        violations.push(`${where} 必须是对象`);
        continue;
      }
      const preset = entry as Record<string, unknown>;
      if (typeof preset.id !== 'string' || preset.id.length === 0) {
        violations.push(`${where}.id 必须是非空字符串`);
      } else if (ids.has(preset.id)) {
        violations.push(`${where}.id "${preset.id}" 重复`);
      } else {
        ids.add(preset.id);
      }
      if (typeof preset.label !== 'string' || preset.label.length === 0) {
        violations.push(`${where}(${String(preset.id)}) 的 label 必须是非空字符串`);
      }
      // Step count: strictly a positive integer.
      const steps = preset.raymarchSteps;
      if (typeof steps !== 'number' || !Number.isInteger(steps) || steps <= 0) {
        violations.push(`${where}(${String(preset.id)}) 的 raymarchSteps 必须是正整数，实际值：${String(steps)}`);
      }
      // Resolution scale: finite number inside (0, 1].
      const scale = preset.resolutionScale;
      if (typeof scale !== 'number' || !Number.isFinite(scale) || !(scale > 0) || !(scale <= 1)) {
        violations.push(`${where}(${String(preset.id)}) 的 resolutionScale 必须属于 (0, 1]，实际值：${String(scale)}`);
      }
    }
  }

  if (typeof file.defaultPresetId !== 'string' || file.defaultPresetId.length === 0) {
    violations.push('defaultPresetId 必须是非空字符串');
  } else if (Array.isArray(presets) && !presets.some((p) => p && (p as QualityPreset).id === file.defaultPresetId)) {
    violations.push(`defaultPresetId "${file.defaultPresetId}" 不匹配任何已定义档位`);
  }

  if (violations.length > 0) {
    throw new QualityConfigError(violations);
  }
}

// Fail fast at module load if the checked-in config is corrupt.
validateQualityConfig(config);

export function getQualityConfigFile(): Readonly<QualityConfigFile> {
  return config;
}

export function listQualityPresets(): ReadonlyArray<Readonly<QualityPreset>> {
  return config.presets;
}

export function getDefaultPresetId(): string {
  return config.defaultPresetId;
}

export function getQualityPreset(presetId: string): Readonly<QualityPreset> {
  const preset = config.presets.find((candidate) => candidate.id === presetId);
  if (preset === undefined) {
    const known = config.presets.map((candidate) => candidate.id).join(', ');
    throw new QualityConfigError([`未知画质档位 "${presetId}"，可用档位：${known}`]);
  }
  return preset;
}

/**
 * Validate a candidate preset-shaped value at runtime (e.g. a mutated config
 * in tests) and return it only when legal; otherwise throw with a readable,
 * field-specific message.
 */
export function assertLegalPreset(candidate: unknown, context = 'preset'): asserts candidate is QualityPreset {
  const violations: string[] = [];
  if (typeof candidate !== 'object' || candidate === null) {
    throw new QualityConfigError([`${context} 必须是对象`]);
  }
  const preset = candidate as Record<string, unknown>;
  const steps = preset.raymarchSteps;
  if (typeof steps !== 'number' || !Number.isInteger(steps) || steps <= 0) {
    violations.push(`${context}.raymarchSteps 必须是正整数，实际值：${String(steps)}`);
  }
  const scale = preset.resolutionScale;
  if (typeof scale !== 'number' || !Number.isFinite(scale) || !(scale > 0) || !(scale <= 1)) {
    violations.push(`${context}.resolutionScale 必须属于 (0, 1]，实际值：${String(scale)}`);
  }
  if (violations.length > 0) {
    throw new QualityConfigError(violations);
  }
}
