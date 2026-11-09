宜昌国际广场 — 网页模型交接说明
生成日期：2026-11-09

一、当前来源与阶段
阶段：S01 static candidate
边界：完整三塔组团、裙房、开放内街及桥梯保留。四类有现场形态依据的前场context保留；不得据此声称精确地块。
输入GLB文件：yichang_international_s01_static_candidate.glb
输入GLB字节：92151672
输入GLB SHA-256：4a27c65bc02a1de7f25e596c1961dea11f477dd69a0f78de0bf8a97a002fd090

展示节点处理：原生 build_yichang.py 345–348 注明 Local site presentation；仅删除 SITE local paving / SITE paving joints，共848三角。geo代理复核余4类context无道路/背景楼相交后保留。

二、网页派生文件
light.glb：全景使用；detail.glb：近景按需使用。
light.glb：2,761,776 字节；132,122 三角；381,749 顶点；18 图元/材质绘制分组；1 张贴图。
light 贴图解码内存估算：1.33 MiB（RGBA8+完整mipmap，不含几何、渲染目标，不是设备实测）。
light SHA-256：6531a8d0d9007c6b5a03e586dcbe61f89548cb12b4d1826db5b7f0cc0fb7564d
detail.glb：9,063,840 字节；738,676 三角；1,460,392 顶点；18 图元/材质绘制分组；6 张贴图。
detail 贴图解码内存估算：32.00 MiB（RGBA8+完整mipmap，不含几何、渲染目标，不是设备实测）。
detail SHA-256：b9ddf888b54514f22acf1c6e54812ea2cac07026e0468f99bc313a8ca73db8f0

两级共同基准：保留建筑源几何738,676三角；light几何量减少82.11%。detail保留该源几何三角数。
必须以web-manifest.json中的共同sourceBounds做相同均匀缩放，不能分别用两个量化输出包络归一化，也不能单独拉伸高度。
sourceBounds（glTF Y-up，源建模单位，非米制测量）：{"min": [-43.900001525878906, -0.15000000596046448, -16.060869216918945], "max": [45.79999923706055, 100.06999969482422, 29.799999237060547]}

三、优化方式与外观边界
原生 .blend 和未优化源GLB均保持不变，所有网页输出另存。
保留建筑外形、塔楼组团、幕墙分格和顶部结构；按材质合并/weld，light有界简化，detail不做几何简化。
light去除烘焙微表面法线图并重建面法线；有颜色图的UV保留。light纹理上限512，detail上限1024；颜色/法线图按需转为WebP。
原始基色保留，网页微缩风格使用不透明材质，减少金属度、增加粗糙度，去transmission/volume/clearcoat。材质显示不是原生程序材质的逐节点还原。
light在细分格与斜面阴影上会比detail更硬，近景应切换detail。
必需解码：EXT_meshopt_compression 与 KHR_mesh_quantization；含贴图输出还需 EXT_texture_webp。前端应配置MeshoptDecoder。

四、已完成检查与未验收范围
已独立解码回读：GLB头/长度/哈希、无外链、索引有效、属性有限值、三角数、detail源几何守恒、贴图尺寸、共同包络；通过。
light包络最大偏差0.058185371源单位；detail最大偏差0.000688715源单位。
本模型为阶段候选，不等于实景准确性或完整建筑形制已通过验收。高度、占地、朝向、GPS配准需依据站内登记置信度；源单位不能冒充测量米制。
本说明记录的是模型导出与离线检查，未宣称站内WebGL验收、手机帧率/内存实测或实景校准完成。
建议全景模型并发请求上限2，近景同时只保留1栋detail；退出近景后释放不再使用的detail资源。

详细数据：同目录 web-manifest.json。
