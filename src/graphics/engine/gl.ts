/** Low-level WebGL1 helpers for the Apex engine. */

export function createGL(canvas: HTMLCanvasElement): WebGLRenderingContext | null {
  const attempts: WebGLContextAttributes[] = [
    {
      alpha: false,
      antialias: true,
      depth: true,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
    },
    {
      alpha: false,
      antialias: false,
      depth: true,
      premultipliedAlpha: false,
      powerPreference: 'default',
    },
  ];
  for (const attrs of attempts) {
    const gl =
      canvas.getContext('webgl', attrs) ??
      canvas.getContext('experimental-webgl', attrs);
    if (gl) {
      const ctx = gl as WebGLRenderingContext;
      // Large tracks may exceed 65k indices — enable when available.
      ctx.getExtension('OES_element_index_uint');
      return ctx;
    }
  }
  return null;
}

export function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error('createShader failed');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown';
    gl.deleteShader(shader);
    throw new Error(`Shader compile: ${log}`);
  }
  return shader;
}

export function linkProgram(
  gl: WebGLRenderingContext,
  vertSrc: string,
  fragSrc: string,
): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const prog = gl.createProgram();
  if (prog === null) throw new Error('createProgram failed');
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) ?? 'unknown';
    gl.deleteProgram(prog);
    throw new Error(`Program link: ${log}`);
  }
  return prog;
}

export interface GpuMesh {
  vbo: WebGLBuffer;
  ibo: WebGLBuffer;
  indexCount: number;
  stride: number;
}

/** Interleaved: pos3 + normal3 + color3 + mat1 = 10 floats. */
export const VERTEX_STRIDE = 10;
export const VERTEX_BYTES = VERTEX_STRIDE * 4;

export function createMesh(
  gl: WebGLRenderingContext,
  vertices: Float32Array,
  indices: Uint16Array | Uint32Array,
): GpuMesh {
  const vbo = gl.createBuffer();
  const ibo = gl.createBuffer();
  if (vbo === null || ibo === null) throw new Error('createBuffer failed');
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  return {
    vbo,
    ibo,
    indexCount: indices.length,
    stride: VERTEX_BYTES,
  };
}

export function destroyMesh(gl: WebGLRenderingContext, mesh: GpuMesh): void {
  gl.deleteBuffer(mesh.vbo);
  gl.deleteBuffer(mesh.ibo);
}

export function bindLitAttribs(
  gl: WebGLRenderingContext,
  prog: WebGLProgram,
  mesh: GpuMesh,
): void {
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ibo);
  const aPos = gl.getAttribLocation(prog, 'aPosition');
  const aNrm = gl.getAttribLocation(prog, 'aNormal');
  const aCol = gl.getAttribLocation(prog, 'aColor');
  const aMat = gl.getAttribLocation(prog, 'aMat');
  if (aPos >= 0) {
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, VERTEX_BYTES, 0);
  }
  if (aNrm >= 0) {
    gl.enableVertexAttribArray(aNrm);
    gl.vertexAttribPointer(aNrm, 3, gl.FLOAT, false, VERTEX_BYTES, 12);
  }
  if (aCol >= 0) {
    gl.enableVertexAttribArray(aCol);
    gl.vertexAttribPointer(aCol, 3, gl.FLOAT, false, VERTEX_BYTES, 24);
  }
  if (aMat >= 0) {
    gl.enableVertexAttribArray(aMat);
    gl.vertexAttribPointer(aMat, 1, gl.FLOAT, false, VERTEX_BYTES, 36);
  }
}
