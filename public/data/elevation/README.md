# Elevation data contract

本目录预留真实 DEM 栅格导出文件。禁止把示意高程或随机高度作为真实宜昌地形发布。

推荐 JSON 结构见 `src/scene/elevationField.js` 的 `validateElevationGrid`。坐标必须转换到项目局部米制坐标（x 向东、z 向南），并记录：

- 数据集名称、版本、获取日期、许可与原始下载地址；
- DEM 水平坐标系、垂直基准、像元分辨率；
- 重投影/裁切参数和输入文件 SHA-256；
- NoData 值、单位、垂直夸张参数（仅渲染参数）。

当前目录没有 DEM 文件；只有完成数据来源审查和空间配准后才能增加真实数据。
