九州方园 — 网页模型交接说明
生成日期：2026-11-09

一、当前来源与阶段
阶段：S01 native-derived candidate
边界：原生c389源未改；4.5.14 LTS只读导出，不宣称4.3.2精确运行复现。高度100/深度18为候选单位；程序材质到PBR有近似。
输入GLB文件：jiuzhou-s01-source.glb
输入GLB字节：6415320
输入GLB SHA-256：4be00d59d2ca4ef186cf35c98eb9f17f8cc1c228748a38440291c20c3e42afdc

原生 Blender SHA-256：c38936dcd1b7b861d918ee823685aa47ae0b1af9b6df296bf3771736932f68fe

上游只读导出已剔除的展示节点：DISPLAY_ONLY_forecourt_paving, DISPLAY_ONLY_paving_course_bands, DISPLAY_ONLY_low_planting
原生导出运行时为 Blender 4.5.14 LTS，原建模运行时4.3.2；未宣称4.3.2精确运行复现。几何独立回读核验通过，程序材质到PBR是近似；原生文件SHA前后不变。

二、网页派生文件
light.glb：全景使用；detail.glb：近景按需使用。
light.glb：852,736 字节；46,170 三角；123,238 顶点；16 图元/材质绘制分组；0 张贴图。
light 贴图解码内存估算：0.00 MiB（RGBA8+完整mipmap，不含几何、渲染目标，不是设备实测）。
light SHA-256：0dd82c8874a398dc47df782e87f30c97d921e845973dd6fe3133eaa4b4a2b4be
detail.glb：1,337,716 字节；117,744 三角；229,927 顶点；16 图元/材质绘制分组；0 张贴图。
detail 贴图解码内存估算：0.00 MiB（RGBA8+完整mipmap，不含几何、渲染目标，不是设备实测）。
detail SHA-256：01f832d29b8a80ec67005fabdbea4f04cd81d88ad71896581afd2abccaea2d88

两级共同基准：保留建筑源几何117,744三角；light几何量减少60.79%。detail保留该源几何三角数。
必须以web-manifest.json中的共同sourceBounds做相同均匀缩放，不能分别用两个量化输出包络归一化，也不能单独拉伸高度。
sourceBounds（glTF Y-up，源建模单位，非米制测量）：{"min": [-28.700000762939453, -0.03999999910593033, -9.032500267028809], "max": [25.017499923706055, 100.03250122070312, 25.049999237060547]}

三、优化方式与外观边界
原生 .blend 和未优化源GLB均保持不变，所有网页输出另存。
保留建筑外形、塔楼组团、幕墙分格和顶部结构；按材质合并/weld，light有界简化，detail不做几何简化。
light去除烘焙微表面法线图并重建面法线；有颜色图的UV保留。light纹理上限512，detail上限1024；颜色/法线图按需转为WebP。
原始基色保留，网页微缩风格使用不透明材质，减少金属度、增加粗糙度，去transmission/volume/clearcoat。材质显示不是原生程序材质的逐节点还原。
light在细分格与斜面阴影上会比detail更硬，近景应切换detail。
必需解码：EXT_meshopt_compression 与 KHR_mesh_quantization；含贴图输出还需 EXT_texture_webp。前端应配置MeshoptDecoder。

四、已完成检查与未验收范围
已独立解码回读：GLB头/长度/哈希、无外链、索引有效、属性有限值、三角数、detail源几何守恒、贴图尺寸、共同包络；通过。
light包络最大偏差0.000352372源单位；detail最大偏差0.000352372源单位。
本模型为阶段候选，不等于实景准确性或完整建筑形制已通过验收。高度、占地、朝向、GPS配准需依据站内登记置信度；源单位不能冒充测量米制。
本说明记录的是模型导出与离线检查，未宣称站内WebGL验收、手机帧率/内存实测或实景校准完成。
建议全景模型并发请求上限2，近景同时只保留1栋detail；退出近景后释放不再使用的detail资源。

详细数据：同目录 web-manifest.json。
