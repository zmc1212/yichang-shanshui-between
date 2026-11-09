# 宜昌 · 江山之间

宜昌Online 的独立微缩城市站点。使用 React、Three.js 与 Vite，将宜昌中心城区的真实道路、水域与建筑轮廓，呈现为明亮的立体沙盘；地标采用风格化模型。

## 本地运行与构建

需要 Node.js（支持 Vite 6 的版本）和 npm，以及支持 WebGL 的浏览器。

```bash
npm ci
npm run dev
```

生产构建与本地预览：

```bash
npm run build
npm run preview
```

构建产物位于 `dist/`，可部署到静态网站托管服务。运行使用仓库中的 `public/data/city.json`，无需地图服务密钥；启动网站不需要重新生成地理数据。

## 探索方式

- 左侧目录或地图标签可定位七处地标；介绍卡右上角可以切换上一处、下一处。
- “靠近看看”进入更近一级的构图，再次点击可回到地标全景。“观察视角”中提供地标近景和俯瞰，镇江阁、天然塔还提供从水面望向建筑的江岸视角。
- 日夜按钮同时切换界面、环境与局部照明。镇江阁和天然塔以檐下灯线、窗光突出建筑层次，桥面使用小型灯头。
- 图层面板可控制建筑、树木和地标名称，也可暂停江面动态。船只和岸边家具是装饰性场景，不代表实时船舶或实测设施。
- 顶部“保存画面”导出当前三维画面的 PNG，文件名包含地标与日夜状态；导出不包含界面面板和 HTML 地标标签。
- 手机宽度下，目录改为侧边抽屉，地标介绍使用底部面板；单指旋转，双指缩放与平移。

场景尊重系统的减少动态效果设置。暂停江面动态不影响主动缩放和镜头切换；用户手动操纵镜头会停止自动环绕。

## 场景内容与表现范围

覆盖范围为 WGS84 `[111.225, 30.645, 111.355, 30.755]`，约 **12.44 × 12.25 公里**。中心为 `[111.29, 30.7]`；局部坐标向东为 x 正方向、向南为 z 正方向，每米对应 0.02 世界单位。

当前数据包含 **13,800 个建筑轮廓部件、2,950 条道路段、47 个水体多边形、100 个绿地多边形、7 个地标**。建筑经过范围裁切与面积优先的远景筛选；这些数量不是宜昌全市的完整资产统计。

真实来源数据用于确定街道、江岸、岛屿和建筑的空间布局。建筑高度包含来源标签、楼层换算、2020 年遥感估算及固定 12 米参考值；渲染可对高度作微缩视觉夸张。地标模型、山体、桥梁细节、树木位置与比例是风格化表现，本项目不属于实景测绘或精确复原成果。当前数据不含 DEM 网格，绿地来源仅覆盖部分城区。

### 七个地标

| 地标 | 场景主题 |
| --- | --- |
| 镇江阁 | 老城滨江楼阁 |
| 葛洲坝水利枢纽 | 水利工程 |
| 至喜长江大桥 | 以大江桥的悬索轮廓表现 |
| 夷陵长江大桥 | 三塔、中央单索面斜拉桥 |
| 磨基山公园 | 江南山水与登高远眺 |
| 天然塔 | 江畔古塔 |
| 西坝岛 | 江心岛与滨江生活 |

至喜项目还包含采用高低塔中央索面斜拉桥的三江桥；它与大江桥具有不同结构。结构依据见[中国中铁](https://www.crecg.com/web/xwzx61/zfgsdt39/2025021110083284204/index.html)、[桥梁运营方官方招标公告](https://www.hbbidcloud.cn/shengbenji/jyxx/004001/004001003/20240716/19fe53bc-3d2a-4920-8662-e325de050014.html)、[湖北省文旅厅](https://wlt.hubei.gov.cn/bmdt/ztzl/zshb/201912/t20191226_1799512.shtml)和[湖北省住建厅](https://zjt.hubei.gov.cn/bmdt/ztzl/hbcjda/dayd/201910/t20191028_82017.shtml)。

## 数据来源与许可

- 道路与水域：© OpenStreetMap contributors，源导出获取日期为 2026-11-04，ODbL-1.0。
- 建筑轮廓：© Overture Maps Foundation，发行版本 `2026-10-21.0`；保留 ODbL 条款以及原始来源署名。
- 东亚建筑轮廓：Qian Shi 等，[DOI: 10.5281/zenodo.8174931](https://doi.org/10.5281/zenodo.8174931)，CC BY 4.0。
- 遥感楼高：Yangzi Che 等，3D-GloBFP v3，参考年份 2020，[DOI: 10.5281/zenodo.15459025](https://doi.org/10.5281/zenodo.15459025)，CC BY 4.0。
- 公园与林地：OpenStreetMap / Overture Maps，以及 [ESA WorldCover 2021](https://doi.org/10.5281/zenodo.7254221)。林地来源为 CC BY 4.0；© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium。

完整许可链接、地标参考点来源、加工方法与输入 SHA-256 见 [`public/data/sources.txt`](public/data/sources.txt)。数据发行日期不等于影像拍摄或现场调查日期。游客文案与坐标、模型表现说明分别保存，不能以文案替代来源元数据。

## 复现地理数据

依赖 **Python 3.10+、Shapely 2.x**。输入取自原宜昌Online 项目导出，源提交为：

```text
38c01bf002511c01294feacd8aa85e54e6342724
```

需要取得该提交对应的原项目 checkout；本仓库不重复收录整套原始导出。脚本读取其中的：

- `dist/data/gis-yichang/roads.geojson`、`water.geojson` 和 `buildings/*.geojson`
- `dist/data/riverside-yichang/greenspace.geojson`
- `dist/pois.json`

```bash
python -m pip install "shapely>=2,<3"
python scripts/prepare-city-data.py --source /path/to/original-checkout
```

默认重新写入 `public/data/city.json` 与 `public/data/sources.txt`。也可用 `--output /path/to/review-output` 生成到独立目录进行核对。脚本保留来源、坐标说明、模型表现范围、桥型依据及当前七条游客文案；它不会生成随机建筑位置或随机建筑高度。
