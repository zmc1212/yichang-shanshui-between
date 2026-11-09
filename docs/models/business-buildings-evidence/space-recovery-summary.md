# 宜昌23楼宇：Space资产恢复记录

2026-11-09。此目录只恢复与核验已有资产，没有修改原站运行代码、源模型、GitHub或发布网站。

## 已准备的可用来源

`downloads/` 中5个当前静态GLB均已按先读恢复说明、再下载、核对SHA-256完成恢复：

| 楼宇 | 当前文件 | 状态 |
| --- | --- | --- |
| 万达SOHO | Wanda_SOHO_S01_corrected_static.glb | S01修正版，约63.18MB；三塔组团 |
| 福江铭座 | fujiang_mingzuo_s01_static_candidate(1).glb | S01修正版，约164.87MB |
| 宜昌国际广场 | yichang_international_s01_static_candidate.glb | S01，约92.15MB；两住宅塔+一办公/酒店塔 |
| 中南冶金 | S09_baseline_original_height_hotel_OFF_static.glb | 约49.31MB；原高度，hotel/height/envelope研究均OFF |
| 金江银座（原模型名锦江） | jinjiang_s03_00_static.glb | S03默认00，约2.83MB；S02/S03研究均OFF |

这些文件含大量原始网格或4K贴图，需要生成独立网页派生版；文件存在与旧离线检查通过不能等同浏览器/手机验收。源GLB的形体与修正UV/贴图应保留。

原生档也已恢复：万达完整候选包（仅使用其中native部分，包内旧static仍HOLD）、福江完整native tar.gz、国际native ZIP、锦江S03完整包、九州S01完整包与独立blend、美联S05完整包与独立blend、中南S09独立blend及static恢复tar.zst。完整原包均保留，`extracted/` 只提取自写文本/代码/JSON及blend，未提取旧HOLD GLB。原源文件未被修改。

九州原生包明确排除了未完成GLB项，需要单独网页导出。美联原生S05来源已恢复，父任务另从原湖北站取得同一源SHA的既有GLB。

完整来源ID、字节数、SHA及本地路径见 `SPACE_RECOVERY_INDEX.json`。对应阶段说明全文在 `notes/`。

## 23条名录的资产边界

23是既有伍家岗楼宇导图的项目条目数，有的包含多塔；不是23个单体塔楼都已验收完成。

前8项（美联、中南、金江/锦江、万达、福江、国际、首信、九州）已有可恢复的模型来源。其余15项已用中文名、英文/拼音名、GLB/blend标题及近期递归文件清单交叉检查：

- 兴发集团宜昌总部：找到 `xingfa_hq_s04_s05_fixed_view_comparison.png`、`xingfa_v2i_v2j_fixed_view_comparison.png`。
- 丽景国际综合楼：找到 `lijing_r05_r06_full_building_comparison.png`、`lijing_r02_r03_comparison.png`。
- 共和景晨创业中心：找到 `共和景晨_R13-R14_同机位整楼对照.png`。
- 以上3处有建模截图证据，但本轮尚未恢复到源模型或GLB。不能写作“模型不存在”。
- 另外12条目前未检索到可直接接入的几何资产；其名录与原导图坐标仍可保留，状态应是“待恢复模型”。

独立GLB标题检索返回14个阶段文件（均属于上面5类）；blend标题检索返回23个阶段文件。递归列举2026-11-04以来非图片/办公文档87项，没有下一页；未发现其余15处的隐藏新模型文件。搜索覆盖不保证跨对话临时工作区或从未保存的文件不存在。

## 必须保留的限制

- 万达、福江使用已指定修正版；旧HOLD静态文件不替换历史、也不接入。
- 中南S09 baseline保留原始高度；S06酒店、S08低/高研究、S09底部外包络默认关闭。
- 锦江S03默认00；S04仍ART_HOLD，不作正式新版。
- 所有模型尺寸是归一化候选，实际米数、精确真北与未见背面/屋顶仍有未决项。
- 元数据里旧“导图坐标系未知”是创建时记录；父任务已从实际Wasee/AMap代码核实GCJ-02，须先转换再映射到底图。
- 原照片没有进入模型或此次恢复输出的纹理；原始自建模型、源包及身份记录保持独立可恢复。
