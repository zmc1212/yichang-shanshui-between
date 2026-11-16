# 宜昌程序化城市引擎 · R2

## 真实地形接入

- 数据源：AWS Open Data Registry 的 Terrain Tiles / Mapzen joerd，读取 SRTM 1 arc-second HGT。
- 本样板使用 N30E111 单度瓦片，覆盖宜昌核心城区现有城市数据边界。
- 构建时下载 HGT，不把 25.9 MB 原始瓦片提交进 Git；裁切并双线性采样为 121 × 111 网格。
- 输出写入 `public/data/elevation/terrain-grid.json`，由现有 Three.js 地形采样逻辑读取。
- 项目局部坐标采用 x 向东、z 向南；源高程采用 EGM96。为适配现有微缩沙盘，显示高度按 0.02 world-units/metre，并以约 40 m 作为视觉河面参考。该参考值不是实测水位，河面仍由现有水体数据表达。
- HGT void（-32768）保留为 null；数据覆盖不足 98% 时构建失败，不以零高程填洞。

## 构建与发布

```bash
python scripts/build-yichang-dem.py
npm ci
npm run check:dem
npm run build
```

GitHub Actions 在 R2 分支 push 或手动触发时构建并发布到仓库独立 GitHub Pages 地址。它不发布到 `.openai/hosting.json` 所指向的原生 Sites 项目，不更改原站。

## 当前精度边界

SRTM 约 30 m 级地形用于城市级山体和地形起伏，不足以表达道路边坡、桥面高程、堤岸断面或单栋建筑基底的测绘精度。道路、桥梁、建筑继续沿用现有数据及局部高程处理；下一轮再做道路/桥梁与 DEM 的高程融合和局部精修。

## 来源与署名

Terrain Tiles 数据集注册信息与许可说明：https://registry.opendata.aws/terrain-tiles/
Mapzen/Terrain Tiles attribution：https://github.com/tilezen/joerd/blob/master/docs/attribution.md
AWS HGT 路径格式参考：https://www.nextzen.org/
