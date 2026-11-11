/**
 * GL error types — every failure carries the raw driver log plus enough
 * structural detail (shader stage, source with line numbers) to debug
 * without reproducing the problem. No bare `new Error('shader failed')`.
 */

export type ShaderStage = 'vertex' | 'fragment';

/** Annotate GLSL source with 1-based line numbers for error reports. */
export function annotateSource(source: string): string {
  const lines = source.split('\n');
  const gutterWidth = String(lines.length).length;
  return lines
    .map((line, index) => `${String(index + 1).padStart(gutterWidth, ' ')} | ${line}`)
    .join('\n');
}

export class ShaderCompileError extends Error {
  readonly stage: ShaderStage;
  readonly infoLog: string;
  readonly source: string;

  constructor(stage: ShaderStage, infoLog: string, source: string) {
    super(
      `WebGL2 ${stage} shader compilation failed.\n` +
        `--- getShaderInfoLog ---\n${infoLog}\n` +
        `--- ${stage} shader source ---\n${annotateSource(source)}`,
    );
    this.name = 'ShaderCompileError';
    this.stage = stage;
    this.infoLog = infoLog;
    this.source = source;
  }
}

export class ProgramLinkError extends Error {
  readonly infoLog: string;
  readonly vertexSource: string;
  readonly fragmentSource: string;

  constructor(infoLog: string, vertexSource: string, fragmentSource: string) {
    super(
      `WebGL2 program link failed.\n` +
        `--- getProgramInfoLog ---\n${infoLog}\n` +
        `--- vertex shader source ---\n${annotateSource(vertexSource)}\n` +
        `--- fragment shader source ---\n${annotateSource(fragmentSource)}`,
    );
    this.name = 'ProgramLinkError';
    this.infoLog = infoLog;
    this.vertexSource = vertexSource;
    this.fragmentSource = fragmentSource;
  }
}

export class ContextUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContextUnavailableError';
  }
}

/** Thrown when a resource is used after its GL context was lost / it was disposed. */
export class ResourceDisposedError extends Error {
  constructor(kind: string) {
    super(`GL resource (${kind}) has been disposed or its context was lost`);
    this.name = 'ResourceDisposedError';
  }
}
