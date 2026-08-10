/** GLSL ES 1.0 — lit world with procedural terrain materials. */

export const LIT_VERT = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec3 aColor;
attribute float aMat;

uniform mat4 uMVP;
uniform mat4 uModel;
uniform mat3 uNormalMat;

varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vColor;
varying float vMat;

void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(uNormalMat * aNormal);
  vColor = aColor;
  vMat = aMat;
  gl_Position = uMVP * vec4(aPosition, 1.0);
}
`;

export const LIT_FRAG = `
precision mediump float;

varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vColor;
varying float vMat;

uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uAmbient;
uniform vec3 uTint;
uniform float uAlpha;
uniform float uNight;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec3 uCameraPos;

// --- cheap hash / value noise (no textures) ---
float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(17.1, 9.7);
    a *= 0.5;
  }
  return v;
}

vec3 tarmacAlbedo(vec2 uv, vec3 base) {
  float grit = fbm(uv * 3.2);
  float fine = noise(uv * 18.0);
  float wear = smoothstep(0.35, 0.75, fbm(uv * 0.55 + 4.0));
  // Cool grey asphalt with aggregate speckles — not neon.
  vec3 dark = vec3(0.11, 0.115, 0.12);
  vec3 mid = vec3(0.18, 0.185, 0.19);
  vec3 stone = vec3(0.24, 0.23, 0.22);
  vec3 alb = mix(dark, mid, grit);
  alb = mix(alb, stone, fine * 0.22);
  alb = mix(alb, alb * 0.78, wear * 0.45);
  // Mild tire-path darkening toward world origin noise
  float path = smoothstep(0.55, 0.15, abs(noise(uv * 0.15) - 0.5) * 2.0);
  alb *= 1.0 - path * 0.12;
  return mix(base * 0.55, alb, 0.92);
}

vec3 dirtAlbedo(vec2 uv, vec3 base) {
  float n = fbm(uv * 2.4);
  float peb = noise(uv * 11.0);
  vec3 soil = vec3(0.28, 0.22, 0.14);
  vec3 dry = vec3(0.38, 0.30, 0.18);
  vec3 wet = vec3(0.18, 0.14, 0.09);
  vec3 alb = mix(soil, dry, n);
  alb = mix(alb, wet, smoothstep(0.55, 0.85, peb) * 0.35);
  alb += (peb - 0.5) * 0.04;
  return mix(base * 0.7, alb, 0.85);
}

vec3 grassAlbedo(vec2 uv, vec3 base) {
  float n = fbm(uv * 2.8);
  float blades = noise(uv * 22.0 + n * 2.0);
  float patch = smoothstep(0.35, 0.7, fbm(uv * 0.7));
  vec3 lush = vec3(0.18, 0.32, 0.12);
  vec3 dry = vec3(0.32, 0.36, 0.14);
  vec3 dirtShow = vec3(0.26, 0.22, 0.12);
  vec3 alb = mix(lush, dry, n * 0.65);
  alb = mix(alb, dirtShow, (1.0 - patch) * 0.35);
  alb *= 0.88 + blades * 0.22;
  return mix(base * 0.5, alb, 0.9);
}

vec3 rumbleAlbedo(vec2 uv, vec3 base) {
  // base already red/white striped from mesh; add chalk wear + rubber scuffs
  float grit = noise(uv * 14.0);
  float scuff = smoothstep(0.6, 0.9, fbm(uv * 3.5));
  vec3 alb = base;
  alb = mix(alb, alb * 0.75, scuff * 0.4);
  alb += (grit - 0.5) * 0.06;
  return clamp(alb, 0.0, 1.0);
}

vec3 grooveAlbedo(vec2 uv, vec3 base) {
  float n = fbm(uv * 6.0);
  vec3 rail = vec3(0.06, 0.065, 0.07);
  vec3 shine = vec3(0.14, 0.13, 0.12);
  return mix(rail, shine, n * 0.35) * (0.85 + base.r * 0.2);
}

vec3 concreteAlbedo(vec2 uv, vec3 base) {
  float n = fbm(uv * 1.8);
  float stain = noise(uv * 5.0);
  vec3 c = vec3(0.42, 0.41, 0.38);
  c = mix(c, vec3(0.32, 0.31, 0.29), n);
  c *= 0.92 + stain * 0.1;
  return mix(base * 0.4, c, 0.88);
}

void main() {
  vec3 n = normalize(vNormal);
  vec2 uv = vWorld.xz;

  float matId = floor(vMat + 0.5);
  vec3 albedo;
  float roughBoost = 0.0;

  if (matId < 0.5) {
    // Generic / cars — tinted mesh color, slight grit only
    albedo = vColor * uTint;
    albedo *= 0.92 + noise(uv * 4.0) * 0.08;
  } else if (matId < 1.5) {
    albedo = tarmacAlbedo(uv, vColor);
    roughBoost = 0.15;
  } else if (matId < 2.5) {
    albedo = dirtAlbedo(uv, vColor);
    roughBoost = 0.35;
  } else if (matId < 3.5) {
    albedo = grassAlbedo(uv, vColor);
    roughBoost = 0.45;
  } else if (matId < 4.5) {
    albedo = rumbleAlbedo(uv, vColor);
    roughBoost = 0.2;
  } else if (matId < 5.5) {
    albedo = grooveAlbedo(uv, vColor);
    roughBoost = 0.1;
  } else {
    albedo = concreteAlbedo(uv, vColor);
    roughBoost = 0.25;
  }

  vec3 L = normalize(uLightDir);
  float ndl = max(dot(n, L), 0.0);
  // Soft wrap lighting — less harsh neon contrast
  float wrap = max(dot(n, L) * 0.5 + 0.5, 0.0);
  float hemi = 0.5 + 0.5 * n.y;
  vec3 sky = vec3(0.55, 0.62, 0.7) * hemi * (uNight > 0.5 ? 0.25 : 0.45);
  vec3 groundBounce = vec3(0.12, 0.11, 0.08) * (1.0 - hemi) * 0.35;

  float diffuse = mix(wrap, ndl, 0.55) * (1.0 - roughBoost * 0.35);
  vec3 lit = albedo * (uAmbient + uLightColor * diffuse + sky * 0.2 + groundBounce);

  // Very subtle specular on tarmac/groove only
  if (matId < 1.5 || (matId > 4.5 && matId < 5.5)) {
    vec3 viewDir = normalize(uCameraPos - vWorld);
    vec3 H = normalize(L + viewDir);
    float spec = pow(max(dot(n, H), 0.0), 28.0) * 0.08 * (1.0 - roughBoost);
    lit += uLightColor * spec * (uNight > 0.5 ? 0.35 : 1.0);
  }

  // Soft distance haze — environmental, not neon fog
  float dist = length(uCameraPos - vWorld);
  float fog = 1.0 - exp(-uFogDensity * dist * dist * 0.00022);
  vec3 col = mix(lit, uFogColor, clamp(fog, 0.0, 0.55));

  if (uNight > 0.5) {
    col *= vec3(0.72, 0.76, 0.88);
  }

  gl_FragColor = vec4(col, uAlpha);
}
`;
