/** GLSL ES 1.0 sources for the Apex lit world pass. */

export const LIT_VERT = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec3 aColor;

uniform mat4 uMVP;
uniform mat4 uModel;
uniform mat3 uNormalMat;

varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vColor;

void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(uNormalMat * aNormal);
  vColor = aColor;
  gl_Position = uMVP * vec4(aPosition, 1.0);
}
`;

export const LIT_FRAG = `
precision mediump float;

varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vColor;

uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uAmbient;
uniform vec3 uTint;
uniform float uAlpha;
uniform float uNight;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec3 uCameraPos;

void main() {
  vec3 n = normalize(vNormal);
  float ndl = max(dot(n, normalize(uLightDir)), 0.0);
  float hemi = 0.5 + 0.5 * n.y;
  vec3 base = vColor * uTint;
  vec3 lit = base * (uAmbient + uLightColor * ndl + vec3(0.04, 0.05, 0.06) * hemi);

  // Soft rim toward camera for chassis readability
  vec3 viewDir = normalize(uCameraPos - vWorld);
  float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 2.5);
  lit += vec3(0.18, 0.16, 0.1) * rim * (uNight > 0.5 ? 0.55 : 0.35);

  float dist = length(uCameraPos - vWorld);
  float fog = 1.0 - exp(-uFogDensity * dist * dist * 0.00035);
  vec3 col = mix(lit, uFogColor, clamp(fog, 0.0, 0.72));

  // Night cools the plate slightly
  if (uNight > 0.5) {
    col *= vec3(0.78, 0.82, 0.95);
  }

  gl_FragColor = vec4(col, uAlpha);
}
`;

export const FX_VERT = `
attribute vec3 aPosition;
attribute vec3 aColor;
attribute float aSize;

uniform mat4 uViewProj;
uniform vec2 uViewport;

varying vec3 vColor;
varying float vAlpha;

void main() {
  vColor = aColor;
  vAlpha = aColor.r; // packed elsewhere — overwritten by aColor.a style via size sign
  vec4 clip = uViewProj * vec4(aPosition, 1.0);
  gl_Position = clip;
  float size = aSize;
  gl_PointSize = max(2.0, size * uViewport.y * 0.0015 / max(clip.w, 0.1));
}
`;

export const FX_FRAG = `
precision mediump float;
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = dot(p, p);
  if (d > 1.0) discard;
  float a = (1.0 - d) * 0.85;
  gl_FragColor = vec4(vColor, a);
}
`;
