// 表面着色补丁(onBeforeCompile 注入,所有用到的材质共享同一段代码 → 同一个着色器程序):
// - worldTint:世界坐标低频明暗/冷暖斑块,打破平铺贴图的重复感(鹅卵石、墙、屋顶、木料)
// - 湿润:下雨时反照率压暗、粗糙度降到 ~0.3;地面另有水洼(见 terrain.js 的地表材质)
// 统一由 surfaceUniforms 驱动(天气系统每帧写 uWet / uTime)。
export const surfaceUniforms = {
  uWet: { value: 0 },      // 0 干 → 1 湿透
  uTime: { value: 0 },
  uRainK: { value: 0 },    // 正在下的雨量(水洼涟漪)
  uSkyCol: { value: { r: 0.6, g: 0.66, b: 0.72 } }, // 地平线天色(水洼的菲涅尔反射;sky.js 每帧写)
};

export const NOISE_GLSL = `
  float sfHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float sfNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(sfHash(i), sfHash(i + vec2(1.0, 0.0)), f.x), mix(sfHash(i + vec2(0.0, 1.0)), sfHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }`;

// 顶点:世界坐标(含实例矩阵)交给片元
const VERT_DECL = 'varying vec3 vSfW;';
const VERT_BODY = `
  {
    vec4 sfw = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      sfw = instanceMatrix * sfw;
    #endif
    vSfW = (modelMatrix * sfw).xyz;
  }`;

// 水洼:平地上按世界坐标噪声长出的积水斑(越湿越大),外面一圈颜色更深的湿泥;
// 水面压暗、偏光滑(不用镜面:环境贴图是室内灯箱,镜面反射会发白),天光反射走菲涅尔(掠射才亮),下雨时有涟漪
export const PUDDLE_GLSL = `
  vec2 sfPuddle(vec3 w, vec3 nView) {
    vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
    float flatK = smoothstep(0.94, 0.99, dot(normalize(nView), upV));
    float pn = sfNoise(w.xz * 0.14) * 0.72 + sfNoise(w.xz * 0.47 + 3.1) * 0.28;
    float wetK = smoothstep(0.35, 0.9, uWet);
    float grow = mix(0.77, 0.71, wetK);
    return vec2(smoothstep(grow, grow + 0.022, pn), smoothstep(grow - 0.08, grow, pn)) * flatK * wetK;
  }
  vec2 sfRipple(vec2 p, float t) {
    vec2 c = floor(p * 1.4);
    vec2 o = vec2(sfHash(c), sfHash(c + 5.3)) * 0.6 + 0.2;
    float ph = fract(t * 0.85 + sfHash(c + 9.1));
    vec2 dv = p * 1.4 - c - o;
    float d = length(dv);
    float ring = sin((d - ph * 0.5) * 50.0) * exp(-abs(d - ph * 0.5) * 16.0) * (1.0 - ph);
    return dv / max(d, 1e-3) * ring;
  }`;
// 四处注入片段(地表材质与 worldTint 共用,保证同一种水洼):颜色 / 粗糙度 / 法线 / 天光反射
export const PUDDLE_COLOR = `
  float sfPud = 0.0;
  #ifndef FLAT_SHADED
  {
    vec2 sfPR = sfPuddle(vSfW, vNormal);
    sfPud = sfPR.x;
    diffuseColor.rgb *= 1.0 - 0.16 * sfPR.y;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.3 + vec3(0.01, 0.013, 0.016), sfPud);
  }
  #endif`;
export const PUDDLE_ROUGH = `
  roughnessFactor = mix(roughnessFactor, 0.16, sfPud);`;
export const PUDDLE_NORMAL = `
  if (sfPud > 0.01) {
    vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
    vec2 rp = sfRipple(vSfW.xz, uSfTime) * uRainK * 0.35;
    vec3 rw = normalize((viewMatrix * vec4(rp.x, 0.0, rp.y, 0.0)).xyz + upV);
    normal = normalize(mix(normal, rw, sfPud));
  }`;
export const PUDDLE_EMISSIVE = `
  if (sfPud > 0.0) {
    float sfF = 0.02 + 0.98 * pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 5.0);
    totalEmissiveRadiance += uSkyCol * sfF * sfPud * 0.8;
  }`;
export const SURFACE_UNIFORMS_GLSL = 'uniform float uWet, uSfTime, uRainK;\nuniform vec3 uSkyCol;';
export function bindSurfaceUniforms(sh) {
  sh.uniforms.uWet = surfaceUniforms.uWet;
  sh.uniforms.uSfTime = surfaceUniforms.uTime;
  sh.uniforms.uRainK = surfaceUniforms.uRainK;
  sh.uniforms.uSkyCol = surfaceUniforms.uSkyCol;
}

export function worldTint(sh) {
  bindSurfaceUniforms(sh);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>\n${VERT_DECL}`)
    .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_BODY}`);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>\n${VERT_DECL}\n${SURFACE_UNIFORMS_GLSL}\n${NOISE_GLSL}\n${PUDDLE_GLSL}`)
    .replace('#include <map_fragment>', `#include <map_fragment>
      {
        float sa = sfNoise(vSfW.xz * 0.085 + vSfW.y * 0.06);
        float sb = sfNoise(vSfW.xz * 0.29 + vec2(vSfW.y * 0.23, 17.3));
        diffuseColor.rgb *= (0.86 + 0.2 * sa + 0.1 * (sb - 0.5)) * vec3(1.0 + 0.05 * (sb - 0.5), 1.0, 1.0 - 0.06 * (sb - 0.5));
        diffuseColor.rgb *= 1.0 - 0.26 * uWet;
      }
      ${PUDDLE_COLOR}`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, min(roughnessFactor, 0.32), uWet);
      ${PUDDLE_ROUGH}`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${PUDDLE_NORMAL}`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${PUDDLE_EMISSIVE}`);
}

export function setWetness(wet, rain, dt) {
  surfaceUniforms.uWet.value = wet;
  surfaceUniforms.uRainK.value = rain;
  surfaceUniforms.uTime.value += dt;
}
