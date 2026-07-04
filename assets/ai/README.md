# 🎨 AI 贴图素材目录

把 AI 生成的**无缝平铺(seamless/tileable)贴图**放进这个目录,游戏启动时会自动加载并替换程序化贴图,法线贴图(凹凸细节)会由图像亮度自动推导——无需任何配置。

## 支持的文件

| 文件名 | 用途 | 推荐提示词(复制到 Midjourney / Stable Diffusion / DALL·E) |
|---|---|---|
| `grass.jpg` | 草地地面 | `seamless tileable photorealistic lush green grass lawn texture, top-down view, game asset, 4k, PBR albedo --tile` |
| `cobble.jpg` | 城内鹅卵石街道 | `seamless tileable photorealistic medieval cobblestone street texture, worn round stones, top-down, game asset, PBR albedo --tile` |
| `stone.jpg` | 城墙/城堡石砖 | `seamless tileable photorealistic medieval castle stone brick wall texture, weathered gray blocks, game asset, PBR albedo --tile` |
| `roof.jpg` | 屋顶瓦片 | `seamless tileable photorealistic medieval terracotta roof tiles texture, overlapping clay shingles, game asset, PBR albedo --tile` |
| `plaster.jpg` | 民居灰泥墙面 | `seamless tileable photorealistic old white plaster wall texture, medieval house facade, subtle stains, game asset --tile` |
| `wood.jpg` | 木门/木桶/围栏 | `seamless tileable photorealistic weathered oak wood planks texture, medieval, game asset, PBR albedo --tile` |
| `dirt.jpg` | 城外土路/农田 | `seamless tileable photorealistic dirt road texture with wheel ruts, dry mud, top-down, game asset, PBR albedo --tile` |
| `title.jpg` | 标题画面背景(键艺术) | `epic cinematic medieval kingdom at sunset, castle on hill, knight on horseback in green tunic, GTA loading screen art style, dramatic lighting, 16:9` |

- 支持 `.jpg` / `.png` / `.webp`
- Midjourney 用 `--tile` 参数、Stable Diffusion 勾选 "Tiling" 可直接生成无缝贴图
- 分辨率建议 512–1024,加载时会统一重采样为 512
- 删除文件即回退到内置程序化贴图
