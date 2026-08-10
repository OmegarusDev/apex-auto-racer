/** GLSL ES 1.0 — bright daylight terrain with fuzzy procedural surfaces. */

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
uniform float uExposure;

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
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.07 + vec2(19.3, 11.1);
    a *= 0.5;
  }
  return v;
}

/** Fine dual-scale speckles — reads as soft “fuzz” from tabletop distance. */
float fuzz(vec2 uv, float coarse, float fine) {
  float a = fbm(uv * coarse);
  float b = noise(uv * fine);
  float c = noise(uv * fine * 2.3 + 3.7);
  return a * 0.55 + b * 0.3 + c * 0.15;
}

// Dark-grey asphalt fuzz — mid contrast (not black, not chalk)
vec3 tarmacAlbedo(vec2 uv) {
  float g = fuzz(uv, 2.8, 22.0);
  float agg = noise(uv * 36.0);
  float seam = abs(noise(uv * 1.1) - 0.5) * 2.0;
  vec3 charcoal = vec3(0.24, 0.25, 0.26);
  vec3 mid = vec3(0.34, 0.345, 0.35);
  vec3 stone = vec3(0.44, 0.43, 0.41);
  vec3 alb = mix(charcoal, mid, g);
  alb = mix(alb, stone, smoothstep(0.55, 0.9, agg) * 0.28);
  alb *= 1.0 - smoothstep(0.4, 0.85, seam) * 0.1;
  alb += (agg - 0.5) * 0.04;
  return alb;
}

// Sandy / dirt runoff fuzz
vec3 sandAlbedo(vec2 uv) {
  float g = fuzz(uv, 2.2, 16.0);
  float peb = noise(uv * 28.0);
  vec3 sand = vec3(0.62, 0.52, 0.34);
  vec3 dust = vec3(0.72, 0.64, 0.46);
  vec3 soil = vec3(0.46, 0.36, 0.22);
  vec3 alb = mix(soil, sand, g);
  alb = mix(alb, dust, smoothstep(0.45, 0.8, peb) * 0.4);
  alb += (noise(uv * 48.0) - 0.5) * 0.05;
  return alb;
}

// Green grass fuzz
vec3 grassAlbedo(vec2 uv) {
  float g = fuzz(uv, 2.4, 26.0);
  float blades = noise(uv * 40.0 + g * 3.0);
  float patch = fbm(uv * 0.85);
  vec3 lush = vec3(0.22, 0.48, 0.18);
  vec3 bright = vec3(0.34, 0.6, 0.24);
  vec3 dry = vec3(0.48, 0.54, 0.24);
  vec3 earth = vec3(0.4, 0.34, 0.18);
  vec3 alb = mix(lush, bright, g);
  alb = mix(alb, dry, smoothstep(0.55, 0.85, patch) * 0.35);
  alb = mix(alb, earth, (1.0 - smoothstep(0.25, 0.55, patch)) * 0.2);
  alb *= 0.9 + blades * 0.2;
  alb += (blades - 0.5) * vec3(0.015, 0.04, 0.01);
  return alb;
}

vec3 rumbleAlbedo(vec2 uv, vec3 base) {
  float grit = fuzz(uv, 4.0, 30.0);
  vec3 alb = base * (0.92 + grit * 0.16);
  // Keep red/white punchy
  alb = mix(alb, base, 0.35);
  return clamp(alb, 0.05, 1.0);
}

vec3 grooveAlbedo(vec2 uv) {
  float g = fuzz(uv, 5.0, 24.0);
  vec3 rail = vec3(0.22, 0.23, 0.24);
  vec3 lip = vec3(0.38, 0.37, 0.35);
  return mix(rail, lip, g);
}

vec3 concreteAlbedo(vec2 uv) {
  float g = fuzz(uv, 1.6, 14.0);
  vec3 c = mix(vec3(0.52, 0.51, 0.48), vec3(0.64, 0.63, 0.6), g);
  c *= 0.95 + noise(uv * 8.0) * 0.08;
  return c;
}

void main() {
  vec3 n = normalize(vNormal);
  vec2 uv = vWorld.xz;

  float matId = floor(vMat + 0.5);
  vec3 albedo;

  if (matId < 0.5) {
    albedo = vColor * uTint;
    albedo = max(albedo, vec3(0.08));
    albedo *= 1.0 + noise(uv * 3.0) * 0.05;
  } else if (matId < 1.5) {
    albedo = tarmacAlbedo(uv);
  } else if (matId < 2.5) {
    albedo = sandAlbedo(uv);
  } else if (matId < 3.5) {
    albedo = grassAlbedo(uv);
  } else if (matId < 4.5) {
    albedo = rumbleAlbedo(uv, vColor);
  } else if (matId < 5.5) {
    albedo = grooveAlbedo(uv);
  } else {
    albedo = concreteAlbedo(uv);
  }

  vec3 L = normalize(uLightDir);
  float ndl = max(dot(n, L), 0.0);
  float wrap = ndl * 0.78 + 0.22;
  float hemi = 0.55 + 0.45 * n.y;
  vec3 sky = vec3(0.65, 0.74, 0.85) * hemi;
  vec3 groundBounce = vec3(0.35, 0.4, 0.22) * (1.0 - n.y * 0.5) * 0.2;

  vec3 lit = albedo * (uAmbient + uLightColor * wrap + sky * 0.22 + groundBounce);

  if (matId > 0.5 && matId < 1.5) {
    vec3 viewDir = normalize(uCameraPos - vWorld);
    vec3 H = normalize(L + viewDir);
    float spec = pow(max(dot(n, H), 0.0), 22.0) * 0.1;
    lit += uLightColor * spec;
  }

  float dist = length(uCameraPos - vWorld);
  float fog = 1.0 - exp(-uFogDensity * dist * dist * 0.00014);
  vec3 col = mix(lit, uFogColor, clamp(fog, 0.0, 0.34));

  col *= uExposure;

  if (uNight > 0.5) {
    col *= vec3(0.58, 0.64, 0.78);
    col += vec3(0.03, 0.035, 0.05);
  }

  gl_FragColor = vec4(col, uAlpha);
}
`;
