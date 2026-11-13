# 镇江阁滨江样板区绿地与树木表现数据

## 实际地图轮廓

`greenspace.geojson` 收录 83 个经过局部裁剪的真实来源地块：54 个 OpenStreetMap 公园地块、29 个 ESA WorldCover 林地地块。包含来源标注的滨江公园及绿道；没有手工编造公园边界。覆盖范围为 `[111.24, 30.68, 111.32, 30.73]`，不是宜昌完整绿地名录。

分发来源为 **Overture Maps 2026-10-21.0**，通过官方 STAC 元数据和 Azure 公共 GeoParquet 范围读取取得。`properties.sources` 保留原始数据集、记录 ID、许可和年份；发布日期不代表现场调查日期。

- 公园：© OpenStreetMap contributors, Overture Maps Foundation。数据来源记录的 OSM 版本为 `2026-10-04T00:00:00.000Z`，各地块最后编辑时间各不相同。[Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/)；[OpenStreetMap 版权说明](https://www.openstreetmap.org/copyright)；[Overture 许可说明](https://docs.overturemaps.org/attribution/)。
- 林地：实际来源记录标注 **ESA WorldCover 2021**，许可为 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。使用 Overture 的 zoom 8–15 详细表示，排除了会覆盖整片城市的 zoom 0–7 概化表示。
- ESA 必要署名：**© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium**。详见 [ESA WorldCover 数据与署名规则](https://esa-worldcover.org/en/data-access)。源产品：ESA WorldCover 10 m 2021 v200，<https://doi.org/10.5281/zenodo.7254221>。

本项目对来源数据做了范围裁剪、最多 1.5 米的拓扑保留简化与坐标取整。林地分类可能受源产品年份和遥感误差影响，不能作为逐株树木位置的证据。

## 表现树木

`vegetation.json` 中的 **2,599 棵树均为程序化表现性配置**，包括位置、数量、8–12 米高度、形态和树种。它不是实测树木清单，不应作为绿化资产统计或现场施工依据。

生成范围为镇江阁参考点 `[111.270905, 30.703432]` 周边 1.8 公里。点位仅落在上述合格来源地块内部，并排除：

- 镇江阁参考点 60 米半径。
- 建筑轮廓及外扩 4 米范围。
- 水域及外扩 5 米范围。
- 以道路来源/估算宽度一半再加 3.5 米形成的道路排除带。
- 已标注的广场、步行铺地、球场、跑道、体育场和停车场。

将名为“广场”的公园地块保留为来源轮廓，但不直接据此布树。一般公园采用较疏的显示配置，遥感林地允许较密的配置。实际树木是否存在、树种与真实高度仍需现场调查。

### 可见树根的显示接地

树木外观使用项目生成的透明贴图。`root-profile.json` 记录该图片的哈希、透明度阈值与可见树根位置，运行时使三张交叉贴片的根干对齐，并在小范围根部查询解码后的地形三角面后放置。原树点、名义树高、图片和来源地块保持不变。显示时不生成一条与来源步道坡面发生穿插的树木配置，当前实际显示 2,598 棵；其原记录仍保留在数据文件中，具体四元组和原因见 `root-profile.json`。这是显示素材的接地校正，不是新增的树木测量或地面测绘；浏览器当时选择的地形层级与瓦片边缝仍可能影响最终画面。

## 组合数据来源与再分发

位置排除还使用本项目已经公开的道路、水域和建筑数据。相应原始许可与署名见 [GIS 数据说明](../gis-yichang/NOTICE.md)，其中包括 OpenStreetMap 的 ODbL 和 Qian Shi 等东亚建筑数据的 CC BY 4.0（DOI: <https://doi.org/10.5281/zenodo.8174931>）。

公园及本地组合派生数据按 ODbL-1.0 提供，同时保留 ESA WorldCover 和建筑来源各自的 CC BY 4.0 署名。可直接下载 [greenspace.geojson](greenspace.geojson)、[vegetation.json](vegetation.json) 和 [manifest.json](manifest.json)；再分发时应保留这些许可、来源和修改说明。

数据处理时间：2026-11-04。完整文件哈希和处理计数在 `manifest.json`，数据检查结果在 `validation.json`。
