/**
 * Foundation renderer.
 *
 * Deliberately minimal: a fullscreen triangle filled with a resolution-aware
 * gradient. It exists to exercise the GL tool layer (program / buffer / VAO,
 * resize, context-loss rebuild). No raymarching, noise textures or shadows
 * belong in this stage.
 */
import { GLBuffer, GLContext, GLProgram, GLVertexArray } from '../gl';
import type { QualityPreset } from '../config/quality';

const VERT = `#version 300 es
layout(location = 0) in vec2 aPosition;
out vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec2 uResolution;
uniform float uTime;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float pulse = 0.5 + 0.5 * sin(uTime);
  outColor = vec4(uv, 0.4 + 0.2 * pulse, 1.0);
}`;

export class Renderer {
  private readonly ctx: GLContext;
  private readonly program: GLProgram;
  private readonly vertexBuffer: GLBuffer;
  private readonly vao: GLVertexArray;
  // Render parameters arrive exclusively through the active quality preset.
  // Raymarching itself is out of scope for this stage; the plumbing here
  // makes the injected values observable and ready for later consumption.
  private activePreset: QualityPreset | null = null;

  constructor(ctx: GLContext) {
    this.ctx = ctx;
    this.program = new GLProgram(ctx, VERT, FRAG);

    // Fullscreen triangle in clip space (one oversized triangle).
    const vertices = new Float32Array([-1, -1, 3, -1, -1, 3]);
    this.vertexBuffer = new GLBuffer(ctx, vertices, {
      target: ctx.gl.ARRAY_BUFFER,
      usage: ctx.gl.STATIC_DRAW,
    });
    this.vao = new GLVertexArray(
      ctx,
      this.vertexBuffer,
      [{ location: 0, size: 2, type: ctx.gl.FLOAT, stride: 0, offset: 0 }],
    );
  }

  resize(width: number, height: number): void {
    this.ctx.gl.viewport(0, 0, width, height);
  }

  setPreset(preset: QualityPreset): void {
    this.activePreset = preset;
  }

  get renderParams(): { raymarchSteps: number; resolutionScale: number } | null {
    if (this.activePreset === null) {
      return null;
    }
    return {
      raymarchSteps: this.activePreset.raymarchSteps,
      resolutionScale: this.activePreset.resolutionScale,
    };
  }

  render(timeSeconds: number, preset?: QualityPreset): void {
    if (preset !== undefined) {
      this.setPreset(preset);
    }
    const gl = this.ctx.gl;
    this.program.use();
    gl.uniform2f(this.program.uniformLocation('uResolution'), gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform1f(this.program.uniformLocation('uTime'), timeSeconds);
    this.vao.bind();
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
