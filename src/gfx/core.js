// 渲染核心:渲染器/场景/相机、后处理链(GTAO→泛光→输出→调色→画风→SMAA)与 8 种画风预设。
// 只做"怎么画",不碰玩法状态;main.js 与各系统从这里取 renderer/scene/camera 等。
import * as THREE from 'three';
import { EffectComposer } from '../../lib/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../../lib/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../../lib/jsm/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from '../../lib/jsm/postprocessing/SMAAPass.js';
import { GTAOPass } from '../../lib/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from '../../lib/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from '../../lib/jsm/postprocessing/ShaderPass.js';
import { RoomEnvironment } from '../../lib/jsm/environments/RoomEnvironment.js';

export const container = document.getElementById('game');
export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // 1.5 上限:SMAA 在,肉眼无差,填充率省一半
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// 阴影图每帧只画一次:GTAO 等后续 pass 会再调 render,自动更新会让阴影整场景重画第二遍
renderer.shadowMap.autoUpdate = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
container.appendChild(renderer.domElement);

export const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x99a8b2, 90, 390); // 北境雾:灰蓝厚重,远山半隐在大气里

// 近裁剪面 0.3m(镜头离人 6m,0.3 足够):远处深度精度高一截,远山上不再出 AO 横纹与 z 冲突
export const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.3, 1600);

// PBR 环境反射
export const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

// 后处理:泛光 + SMAA 抗锯齿 + 输出色调
// 低画质模式(?lowfx=1):跳过后处理,适合低配设备
export const LOWFX = new URLSearchParams(location.search).has('lowfx');
export const composer = new EffectComposer(renderer);
// 主 pass 的深度直接写进可采样的深度纹理(两个乒乓缓冲各一张),GTAO 从它重建法线——
// 不再用 overrideMaterial 把整个场景再画一遍法线(那一遍等于主 pass 的全部绘制 + 两次全场景遍历)
for (const rt of [composer.renderTarget1, composer.renderTarget2]) {
  rt.depthTexture = new THREE.DepthTexture(rt.width, rt.height);
  rt.depthTexture.type = THREE.UnsignedIntType;
}
composer.addPass(new RenderPass(scene, camera));
// 环境光遮蔽:让物体接触处产生柔和阴影,大幅提升体积感(只在"精致"档开)
export const gtao = new GTAOPass(scene, camera, window.innerWidth, window.innerHeight);
gtao.setGBuffer(composer.readBuffer.depthTexture); // 只给深度:法线由深度重建,跳过 G-buffer 重画
gtao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.5, thickness: 1.2, scale: 0.85, samples: 12 });
// AO 只管近处的接触阴影:55~80m 渐隐为 0,80m 外的像素直接跳过采样(远山上不再有大片暗斑与横纹,远景也省一大截)
gtao.gtaoMaterial.fragmentShader = gtao.gtaoMaterial.fragmentShader
  .replace('vec3 viewNormal = getViewNormal(vUv);',
    'if (-viewPos.z > 80.0) { float ao = 1.0; gl_FragColor = FRAGMENT_OUTPUT; return; }\n\t\t\tvec3 viewNormal = getViewNormal(vUv);')
  .replace('ao = pow(ao, scale);', 'ao = pow(ao, scale);\n\t\t\tao = mix(ao, 1.0, smoothstep(55.0, 80.0, -viewPos.z));');
gtao.gtaoMaterial.needsUpdate = true;
// AO 与降噪在半分辨率算,混合时双线性放大(深度仍按全分辨率采样)
gtao.setSize = (w, h) => GTAOPass.prototype.setSize.call(gtao, Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
{
  const render = gtao.render.bind(gtao);
  gtao.render = (r, writeBuffer, readBuffer, dt, mask) => {
    // 主 pass 刚画进 readBuffer:用它那张深度(乒乓缓冲每帧可能换边)
    const depth = readBuffer.depthTexture;
    if (depth && gtao.depthTexture !== depth) {
      gtao.depthTexture = depth;
      gtao.gtaoMaterial.uniforms.tDepth.value = depth;
      gtao.pdMaterial.uniforms.tDepth.value = depth;
    }
    render(r, writeBuffer, readBuffer, dt, mask);
  };
}
gtao.enabled = !LOWFX;
composer.addPass(gtao);
export const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight), 0.32, 0.6, 0.85);
bloom.enabled = !LOWFX;
composer.addPass(bloom);
// 参数化电影调色:对比/饱和/分离色调/暗角/胶片颗粒/怀旧褪色——画风预设的载体
export const gradePass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    uContrast: { value: 1.07 },
    uSat: { value: 1.16 },
    uLift: { value: 0.0 },
    uSplit: { value: new THREE.Vector3(0.04, 0.014, -0.04) },
    uVig: { value: 0.18 },
    uGrain: { value: 0.0 },
    uSepia: { value: 0.0 },
    uTime: { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uContrast, uSat, uLift, uVig, uGrain, uSepia, uTime;
    uniform vec3 uSplit;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = (c.rgb - 0.5) * uContrast + 0.5 + uLift;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, uSat);
      col += (l - 0.5) * uSplit;
      // 怀旧褪色(sepia)
      vec3 sep = vec3(dot(col, vec3(0.393, 0.769, 0.189)),
                      dot(col, vec3(0.349, 0.686, 0.168)),
                      dot(col, vec3(0.272, 0.534, 0.131)));
      col = mix(col, sep, uSepia);
      // 暗角
      float d = distance(vUv, vec2(0.5));
      col *= 1.0 - uVig * smoothstep(0.32, 0.86, d);
      // 胶片颗粒
      float n = fract(sin(dot(vUv * (uTime + 1.0), vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
      col += n * uGrain;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
});
// ---- 画风预设:油画(默认)/ 电影 / 动画 / 复古,一键切换、独立持久化 ----
// mode:0 纯调色 · 1 油画(Kuwahara 笔触)· 2 卡通(色阶+描边)· 3 水墨(宣纸+墨线)· 4 像素(马赛克+抖动)· 5 版画(粗描边+网点)
// · 6 电影(2.39:1 遮幅 + 边缘色散)· 7 复古(老胶片:划痕、尘点、片门抖动、闪烁)
export const STYLE_PRESETS = {
  nordic: { name: '天际写实', mode: 0, contrast: 1.12, sat: 0.96, lift: -0.006, split: [0.03, 0.012, -0.045], vig: 0.22, grain: 0.015, sepia: 0, bloom: 0.26, exposure: 1.0 },
  oil:    { name: '油画', mode: 1, contrast: 1.1, sat: 1.22, lift: 0, split: [0.04, 0.014, -0.04], vig: 0.2, grain: 0, sepia: 0, bloom: 0.3, exposure: 1.0 },
  toon:   { name: '卡通', mode: 2, contrast: 1.1, sat: 1.16, lift: 0.015, split: [0.015, 0.008, -0.02], vig: 0.06, grain: 0, sepia: 0, bloom: 0.36, exposure: 1.04 },
  ink:    { name: '水墨', mode: 3, contrast: 1.0, sat: 1.0, lift: 0, split: [0, 0, 0], vig: 0.3, grain: 0, sepia: 0, bloom: 0.12, exposure: 1.02 },
  pixel:  { name: '像素', mode: 4, contrast: 1.12, sat: 1.25, lift: 0, split: [0.03, 0.01, -0.03], vig: 0.1, grain: 0, sepia: 0, bloom: 0.2, exposure: 1.02 },
  print:  { name: '版画', mode: 5, contrast: 1.2, sat: 0.9, lift: 0, split: [0.05, 0.02, -0.04], vig: 0.22, grain: 0, sepia: 0.2, bloom: 0.15, exposure: 1.0 },
  film:   { name: '电影', mode: 6, contrast: 1.15, sat: 1.02, lift: -0.012, split: [0.065, 0.012, -0.06], vig: 0.34, grain: 0.028, sepia: 0, bloom: 0.26, exposure: 1.04 },
  retro:  { name: '复古', mode: 7, contrast: 1.08, sat: 0.82, lift: 0.01, split: [0.03, 0.01, -0.02], vig: 0.42, grain: 0.06, sepia: 0.45, bloom: 0.2, exposure: 0.97 },
};
export const STYLE_ORDER = ['nordic', 'oil', 'toon', 'ink', 'pixel', 'print', 'film', 'retro'];

// 风格化着色器:在调色之后、抗锯齿之前对整帧重绘(显示域 LDR)
export const stylePass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    uMode: { value: 0 },
    uRes: { value: new THREE.Vector2(window.innerWidth * renderer.getPixelRatio(), window.innerHeight * renderer.getPixelRatio()) },
    uTime: { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform int uMode;
    uniform vec2 uRes;
    uniform float uTime;
    varying vec2 vUv;
    float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    // 亮度 Sobel:描边强度
    float edge(vec2 uv, float s) {
      vec2 t = s / uRes;
      float tl = lum(texture2D(tDiffuse, uv + vec2(-t.x, t.y)).rgb), tc = lum(texture2D(tDiffuse, uv + vec2(0.0, t.y)).rgb);
      float tr = lum(texture2D(tDiffuse, uv + t).rgb), ml = lum(texture2D(tDiffuse, uv - vec2(t.x, 0.0)).rgb);
      float mr = lum(texture2D(tDiffuse, uv + vec2(t.x, 0.0)).rgb), bl = lum(texture2D(tDiffuse, uv - t).rgb);
      float bc = lum(texture2D(tDiffuse, uv - vec2(0.0, t.y)).rgb), br = lum(texture2D(tDiffuse, uv + vec2(t.x, -t.y)).rgb);
      float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
      float gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
      return sqrt(gx * gx + gy * gy);
    }
    // 四象限 Kuwahara:取方差最小的象限均值 → 油画笔触
    vec3 kuwahara(vec2 uv) {
      vec2 t = 1.0 / uRes;
      vec3 m[4]; vec3 s2[4];
      for (int k = 0; k < 4; k++) { m[k] = vec3(0.0); s2[k] = vec3(0.0); }
      for (int j = 0; j <= 3; j++) {
        for (int i = 0; i <= 3; i++) {
          vec3 a = texture2D(tDiffuse, uv + vec2(-float(i), -float(j)) * t * 2.3).rgb;
          vec3 b = texture2D(tDiffuse, uv + vec2(float(i), -float(j)) * t * 2.3).rgb;
          vec3 c = texture2D(tDiffuse, uv + vec2(float(i), float(j)) * t * 2.3).rgb;
          vec3 d = texture2D(tDiffuse, uv + vec2(-float(i), float(j)) * t * 2.3).rgb;
          m[0] += a; s2[0] += a * a; m[1] += b; s2[1] += b * b;
          m[2] += c; s2[2] += c * c; m[3] += d; s2[3] += d * d;
        }
      }
      vec3 best = vec3(0.0); float bv = 1e9;
      for (int k = 0; k < 4; k++) {
        vec3 mu = m[k] / 16.0;
        vec3 v = abs(s2[k] / 16.0 - mu * mu);
        float vs = v.r + v.g + v.b;
        if (vs < bv) { bv = vs; best = mu; }
      }
      return best;
    }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      if (uMode == 1) {
        col = kuwahara(vUv);
        // 画布纹理:细微的织物颗粒
        float cv = hash(floor(vUv * uRes / 2.0)) * 0.05 - 0.025;
        col += cv;
      } else if (uMode == 2) {
        // 卡通:亮度分 4 阶,保留色相;粗黑描边
        float l = lum(col);
        float q = floor(l * 4.0 + 0.5) / 4.0;
        col = col * (q / max(l, 0.05));
        col = mix(col, col * 1.08, 0.5);
        float e = smoothstep(0.22, 0.48, edge(vUv, 1.2));
        col = mix(col, vec3(0.06, 0.05, 0.08), e * 0.9);
      } else if (uMode == 3) {
        // 水墨:灰阶分层 + 浓淡墨线 + 宣纸底色与纤维
        float l = lum(col);
        float tone = floor(pow(l, 0.85) * 5.0) / 5.0;
        tone = mix(tone, l, 0.35);
        vec3 paper = vec3(0.93, 0.9, 0.82);
        vec3 ink = vec3(0.1, 0.09, 0.08);
        col = mix(ink, paper, tone);
        float e = smoothstep(0.12, 0.42, edge(vUv, 1.5));
        col = mix(col, ink, e * 0.85);
        float fib = hash(floor(vUv * uRes / 1.5)) * 0.06 + hash(floor(vUv * uRes / 9.0) + 3.1) * 0.04;
        col -= fib * 0.5;
        // 远景晕染:画面上部偏淡(留白)
        col = mix(col, paper, smoothstep(0.55, 1.0, vUv.y) * 0.25);
      } else if (uMode == 4) {
        // 像素:按分辨率自适应的马赛克块 + 每通道 6 阶 + 4×4 Bayer 抖动
        float bs = max(3.0, floor(uRes.y / 200.0));
        vec2 cell = floor(vUv * uRes / bs);
        vec2 suv = (cell + 0.5) * bs / uRes;
        col = texture2D(tDiffuse, suv).rgb;
        int bx = int(mod(cell.x, 4.0)), by = int(mod(cell.y, 4.0));
        float bayer[16];
        bayer[0] = 0.0; bayer[1] = 8.0; bayer[2] = 2.0; bayer[3] = 10.0;
        bayer[4] = 12.0; bayer[5] = 4.0; bayer[6] = 14.0; bayer[7] = 6.0;
        bayer[8] = 3.0; bayer[9] = 11.0; bayer[10] = 1.0; bayer[11] = 9.0;
        bayer[12] = 15.0; bayer[13] = 7.0; bayer[14] = 13.0; bayer[15] = 5.0;
        float d = (bayer[by * 4 + bx] / 16.0 - 0.5) / 6.0;
        col = floor((col + d) * 6.0 + 0.5) / 6.0;
      } else if (uMode == 5) {
        // 版画:双色调 + 网点 + 粗刻线
        float l = lum(col);
        vec2 g = vUv * uRes / 5.0;
        vec2 f = fract(g) - 0.5;
        float dotR = sqrt(clamp(1.0 - l, 0.0, 1.0)) * 0.62;
        float dotK = 1.0 - smoothstep(dotR - 0.08, dotR + 0.08, length(f));
        vec3 paper = vec3(0.95, 0.91, 0.82), inkC = mix(vec3(0.16, 0.12, 0.1), col * 0.5, 0.35);
        col = mix(paper, inkC, max(dotK * 0.85, smoothstep(0.75, 0.2, l) * 0.55));
        float e = smoothstep(0.18, 0.45, edge(vUv, 1.4));
        col = mix(col, vec3(0.08, 0.06, 0.05), e);
      } else if (uMode == 6) {
        // 电影:边缘轻微色散 + 2.39:1 遮幅黑边
        vec2 dc = vUv - 0.5;
        float ca = dot(dc, dc) * 0.012;
        col = vec3(texture2D(tDiffuse, vUv + dc * ca * 2.0).r, col.g, texture2D(tDiffuse, vUv - dc * ca * 2.0).b);
        float bar = clamp((1.0 - (uRes.x / uRes.y) / 2.39) * 0.5, 0.0, 0.2);
        col *= smoothstep(bar - 0.002, bar + 0.002, vUv.y) * smoothstep(bar - 0.002, bar + 0.002, 1.0 - vUv.y);
      } else if (uMode == 7) {
        // 复古:老胶片——片门抖动、帧间闪烁、竖向划痕、尘点
        float fr = floor(uTime * 96.0);
        vec2 juv = vUv + vec2(0.0, (hash(vec2(fr, 1.7)) - 0.5) * 0.003);
        col = texture2D(tDiffuse, juv).rgb;
        col *= 0.94 + 0.06 * hash(vec2(fr, 9.1));
        float sx = hash(vec2(fr, 3.3));
        if (sx > 0.55) col *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.0012, abs(vUv.x - hash(vec2(fr, 5.5)))));
        float dust = step(0.9993, hash(floor(vUv * uRes / 3.0) + fr));
        col = mix(col, vec3(0.08, 0.06, 0.05), dust * 0.8);
      }
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
});
stylePass.uniforms.uTime = gradePass.uniforms.uTime; // 复古胶片的帧时钟与颗粒共用(主循环每帧写)
export let styleKey = 'nordic';
try { if (STYLE_PRESETS[localStorage.getItem('gth-style')]) styleKey = localStorage.getItem('gth-style'); } catch { /* 隐私模式 */ }
export function applyStyle(key) {
  const p = STYLE_PRESETS[key];
  if (!p) return;
  styleKey = key;
  const u = gradePass.uniforms;
  u.uContrast.value = p.contrast;
  u.uSat.value = p.sat;
  u.uLift.value = p.lift;
  u.uSplit.value.set(...p.split);
  u.uVig.value = p.vig;
  u.uGrain.value = p.grain;
  u.uSepia.value = p.sepia;
  bloom.strength = p.bloom;
  stylePass.uniforms.uMode.value = p.mode || 0;
  stylePass.enabled = (p.mode || 0) > 0;
  renderer.toneMappingExposure = p.exposure;
  styleExp = p.exposure;          // 昼夜循环每帧重算曝光/泛光,预设作为基准乘子参与
  styleBloomMul = p.bloom / 0.32;
  try { localStorage.setItem('gth-style', key); } catch { /* 隐私模式 */ }
}
export let styleExp = 1, styleBloomMul = 1;
export function cycleStyle() {
  const next = STYLE_ORDER[(STYLE_ORDER.indexOf(styleKey) + 1) % STYLE_ORDER.length];
  applyStyle(next);
  return STYLE_PRESETS[next].name;
}
applyStyle(styleKey); // 上次选的画风,开局就生效
// OutputPass(ACES 色调映射 + sRGB)先行,调色与 SMAA 作用于显示域 LDR,避免裁剪 HDR 高光
composer.addPass(new OutputPass());
gradePass.enabled = !LOWFX;
composer.addPass(gradePass);
composer.addPass(stylePass); // 风格化不受"流畅"画质开关影响:画风是玩家的选择
export const smaa = new SMAAPass(window.innerWidth, window.innerHeight);
smaa.enabled = !LOWFX;
composer.addPass(smaa);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  stylePass.uniforms.uRes.value.set(window.innerWidth * renderer.getPixelRatio(), window.innerHeight * renderer.getPixelRatio());
});
