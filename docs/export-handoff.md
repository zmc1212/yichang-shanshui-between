# 原生 Sites V78 本地迁移记录

## 来源与隔离

- 原站：宜昌 · 江山之间，项目 ID `appgprj_6af0b8d6dbec81919ea6c30c51e88270`；需求中使用的名称为「宜昌 · 山水之间」，以提供的项目 ID 为准。
- 2026-11-13 12:29（北京时间）读取的最新保存版本：V78；源码提交 `bb919a6ade05f03f7f3150aae703b45c48cd5bd4`。本地保留该提交及其原有 Git 历史。
- 该提交包含 690 个版本控制文件、181,537,938 字节（按原始 Git blob 计算，不含 `.git`、依赖与构建产物）。除更新的 README 和 `.gitignore` 外，原有文件的工作区字节均与原始 Git blob 一致。新增的上游 GIS 快照、交接文档、清点脚本和 Git 配置不改变原站运行源码。
- `.openai/hosting.json` 保留原始项目 ID 供追溯；本地仓库只用于独立开发，禁止未经用户明确授权向原 Sites 仓库推送或发布。

## 场景和资产

- 原仓库包含 78 个 GLB，合计 129,199,872 字节；其中 8 组各有两个字节相同的文件，均按原引用保留，共 70 种不同内容。`public/` 原有静态文件合计 133,526,143 字节。当前 23 项商务楼宇对应 46 个当前 light/detail GLB，其他为保留的历史/独立预览资产。程序化生成的七处地标不计入 GLB 数量。
- `node scripts/audit-export-models.mjs` 对 78 个 GLB 执行头部、buffer、Meshopt、几何与索引解析，检查材质/纹理索引、内嵌图像类型、外部引用和源码中的模型 URL；检查通过。64 份内嵌图像另以 Pillow 实际解码通过。解析几何时不解码材质贴图，这不是逐张视觉质量验收。
- 逐文件大小、SHA-256、材质/纹理和图像引用、GLB 节点姿态及包围盒、重复文件、七处地标坐标和 23 项楼宇的坐标/旋转/等比缩放记录于 `docs/export-model-inventory.json`。坐标与尺度是原站的展示配准，并非实测。
- `public/data/city.json` 原站数据包括 16,000 个建筑轮廓部件、3,600 条道路段、64 个水体多边形、100 个绿地多边形和七处地标；地图坐标转换与场景、POI、镜头和漫游逻辑均保留于 `src/`。23 项楼宇中 16 项为近似落位，详见原有资料。
- 镇江阁、葛洲坝、磨基山、西坝岛均在七个原站地标中；这些地标和山体是原站程序化、风格化表现。葛洲坝模型表示西侧大江主体坝段；西坝岛是区域参考，原数据明确不代表龙园等具体建筑。原站七项列表没有单列三峡大坝或西坝龙岛模型，也没有 DEM 高程网格；这些不是迁移时删除的内容。

## 补充源数据和未随站点提供的输入

已从原站记录的上游「湖北省 · 数字孪生空间」V63、源码提交 `38c01bf002511c01294feacd8aa85e54e6342724` 只读恢复 158 个 GIS/POI 输入文件，共 22,754,086 字节，逐文件与上游 Git blob 一致。位置和许可见 `data/gis-source-38c01bf/SOURCE.md`。在 Python 3.10+、Shapely 2.x、UTF-8 模式下可在独立目录成功运行 `prepare-city-data.py`；生成的基础数据不能自动视为原站 V78 后续增量处理的逐字节复本。

站点运行所需的已引用 GLB、其内部纹理及编译后的城市数据均在原站仓库内。原站仓库未包含所有模型的 Blender 原件和 `Yichang_Current23_IntegratedAssets_20261111` 交接源文件；它们是离线建模/再次核验的上游输入，不是当前页面启动时的外链。每栋楼宇的源文件名、SHA-256、部分 Library 恢复 ID 记录于 `src/data/current23-models.json` 和本清单的 `authoredPlacements`；更早资产来源与限制见 `docs/models/asset-inventory-20261109.md` 和 `public/models/*/README.txt`。本次没有声称这些外部建模原件已导出。

地图数据来源、许可和公开地址见 `public/data/sources.txt`：OpenStreetMap、Overture Maps、东亚建筑轮廓、3D-GloBFP、ESA WorldCover。当前运行时不需要地图 API Key；这些来源记录不代表实时在线图层。Site 专属运行绑定未在 `.openai/hosting.json` 中声明，本次静态应用通过 Vite 本地启动，不需 Sites 登录能力。

## 验证和已知问题

- `npm ci` 成功；`npm run build` 成功，Vite 提示主 JS chunk 超过 950 kB。
- 原始 V78 未修改时，35 个 `scripts/check-*.mjs` 中 28 项通过、7 项失败。失败项：`check-business-models.mjs` 的旧断言要求 7 项，当前为 23 项；`check-building-coverage.mjs` 的精度例外集合多出 `undefined`；`check-city-render-lifecycle.mjs` 未能在测试预算内停止调度；`check-international-street.mjs`、`check-street-details.mjs` 和 `check-wanda-international-link.mjs` 的九州街区固定计划哈希不符；`check-street-appearance.mjs` 的入口台阶高度断言不符。Windows 首次检出的 CRLF 曾使城市数据文件哈希不符，已恢复与源 Git blob 一致的换行并重新检查；余下原因尚未逐项定性为测试过期或运行缺陷，未修改原场景或断言。
- 页面可通过本地 HTTP 正常打开。用户于 2026-11-13 指定最终渲染效果由本人肉眼检查；本项目后续只检查页面能否打开，不做自动化视觉验收，除非用户另行要求。
- 双击 HTML 的 `file://` 不是本项目支持入口；使用 README 中的 Vite 本地 HTTP 地址。
