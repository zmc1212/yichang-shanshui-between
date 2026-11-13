# 宜昌城市源 GIS 快照

这些文件只用于复现和核对当前站点使用的地理输入，不是另一套站点源码。2026-11-13 从只读的上游原生 Sites 项目「湖北省 · 数字孪生空间」V63 导出，该项目 ID 为 `appgprj_6ae992201bfc8191b92aedb2ff85349b`，源码提交为 `38c01bf002511c01294feacd8aa85e54e6342724`，与本项目 `public/data/city.json` 和处理脚本记录的 `sourceSnapshotCommit` 一致。上游站点地址：<https://hubei-landmarks-3d-studio.gaoronghai.chatgpt.site/>。

保留的相对路径：

- `dist/data/gis-yichang/`：道路、水域、建筑 GeoJSON 分片及来源、许可、楼高关联文件。
- `dist/data/riverside-yichang/`：绿地 GeoJSON 及同目录元数据。
- `dist/data/landmark-scenes/zhenjiang/gis/`：镇江阁周边 GIS 输入。
- `dist/pois.json`：上游 POI 数据。

复制的 158 个文件共 22,754,086 字节，逐文件与上游 Git 提交的 blob 核对一致；本说明为迁移后新增，不属于上游快照。许可与来源以各目录 `NOTICE.md`、来源 JSON 和本项目 `public/data/sources.txt` 为准：数据包括 OpenStreetMap、Overture Maps、东亚建筑轮廓、3D-GloBFP 及 ESA WorldCover 衍生内容。此目录不是原始提供方的完整全球数据集。

运行数据生成：`python scripts/prepare-city-data.py --source data/gis-source-38c01bf --output /path/to/review-output`。原站 V78 的后续处理和资源集成见项目原有的 `docs/iterations/`；不可把单次生成结果直接视为与 V78 完全一致。
