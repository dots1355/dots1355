// 表面着色补丁(onBeforeCompile 注入,所有用到的材质共享同一段代码 → 同一个着色器程序):
// - worldTint:世界坐标低频明暗/冷暖斑块,打破平铺贴图的重复感(鹅卵石、墙、屋顶、木料)
// - 湿润:下雨时反照率压暗、粗糙度降到 ~0.3;地面另有水洼(见 terrain.js 的地表材质)
// 统一由 surfaceUniforms 驱动(天气系统每帧写 uWet / uTime)。
export const surfaceUniforms = {
  uWet: { value: 0 },      // 0 干 → 1 湿透
  uTime: { value: 0 },
  uRainK: { value: 0 },    // 正在下的雨量(水洼涟漪)
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

export function worldTint(sh) {
  sh.uniforms.uWet = surfaceUniforms.uWet;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>\n${VERT_DECL}`)
    .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_BODY}`);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>\n${VERT_DECL}\nuniform float uWet;\n${NOISE_GLSL}`)
    .replace('#include <map_fragment>', `#include <map_fragment>
      {
        float sa = sfNoise(vSfW.xz * 0.085 + vSfW.y * 0.06);
        float sb = sfNoise(vSfW.xz * 0.29 + vec2(vSfW.y * 0.23, 17.3));
        diffuseColor.rgb *= (0.86 + 0.2 * sa + 0.1 * (sb - 0.5)) * vec3(1.0 + 0.05 * (sb - 0.5), 1.0, 1.0 - 0.06 * (sb - 0.5));
        diffuseColor.rgb *= 1.0 - 0.26 * uWet;
      }`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, min(roughnessFactor, 0.32), uWet);`);
}

// 其余可湿润材质(没有贴图平铺问题的)只要湿润这一段
export function wetOnly(sh) {
  sh.uniforms.uWet = surfaceUniforms.uWet;
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float uWet;')
    .replace('#include <color_fragment>', `#include <color_fragment>
      diffuseColor.rgb *= 1.0 - 0.24 * uWet;`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, min(roughnessFactor, 0.34), uWet);`);
}

export function setWetness(wet, rain, dt) {
  surfaceUniforms.uWet.value = wet;
  surfaceUniforms.uRainK.value = rain;
  surfaceUniforms.uTime.value += dt;
}
