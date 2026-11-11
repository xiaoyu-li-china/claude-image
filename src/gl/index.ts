export { GLContext, type ContextState, type ContextStateListener, type ContextOptions } from './context';
export {
  GLProgram,
  type AttributeSpec,
} from './shader';
export {
  GLBuffer,
  GLTexture2D,
  GLVertexArray,
  ResourceRegistry,
  type BufferOptions,
  type ManagedResource,
  type Texture2DOptions,
  type VertexAttrib,
} from './resources';
export {
  ContextUnavailableError,
  ProgramLinkError,
  ResourceDisposedError,
  ShaderCompileError,
  annotateSource,
  type ShaderStage,
} from './errors';
