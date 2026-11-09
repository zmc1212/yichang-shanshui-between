美联御峰 — 网页模型交接说明
生成日期：2026-11-09

一、当前来源与阶段
阶段：S05 central crown transition candidate
边界：来自已核对原生SHA的原湖北站网页GLB；只代表S05冠部候选，未将S06只读研究当正式版本。
输入GLB文件：meilian-s05-source.glb
输入GLB字节：37675976
输入GLB SHA-256：4884e9fa19216530d3c5f13db6ed07ad508c663f13318bc4f8ae6cc5d046af0a

原生 Blender SHA-256：b3a9b325359132832b08fb838109314d7fc82727999889731be378d30d114f34

二、网页派生文件
light.glb：全景使用；detail.glb：近景按需使用。
light.glb：1,397,792 字节；71,382 三角；199,410 顶点；27 图元/材质绘制分组；0 张贴图。
light 贴图解码内存估算：0.00 MiB（RGBA8+完整mipmap，不含几何、渲染目标，不是设备实测）。
light SHA-256：8ded608af1a893069c2c6dc119bfafbd50e4a3a477c2434558ab0ebf38c514af
detail.glb：8,163,304 字节；529,328 三角；997,857 顶点；27 图元/材质绘制分组；0 张贴图。
detail 贴图解码内存估算：0.00 MiB（RGBA8+完整mipmap，不含几何、渲染目标，不是设备实测）。
detail SHA-256：68101a0bd037113042b5c2d8b04411592ccfebd26a288ef5822c130cbb0e6685

两级共同基准：保留建筑源几何529,328三角；light几何量减少86.51%。detail保留该源几何三角数。
必须以web-manifest.json中的共同sourceBounds做相同均匀缩放，不能分别用两个量化输出包络归一化，也不能单独拉伸高度。
sourceBounds（glTF Y-up，源建模单位，非米制测量）：{"min": [-36.964999198913574, -0.20000076293945312, -49.489999771118164], "max": [31.300003051757812, 100.08999633789062, 7.850000381469727]}

三、优化方式与外观边界
原生 .blend 和未优化源GLB均保持不变，所有网页输出另存。
保留建筑外形、塔楼组团、幕墙分格和顶部结构；按材质合并/weld，light有界简化，detail不做几何简化。
light去除烘焙微表面法线图并重建面法线；有颜色图的UV保留。light纹理上限512，detail上限1024；颜色/法线图按需转为WebP。
原始基色保留，网页微缩风格使用不透明材质，减少金属度、增加粗糙度，去transmission/volume/clearcoat。材质显示不是原生程序材质的逐节点还原。
light在细分格与斜面阴影上会比detail更硬，近景应切换detail。
必需解码：EXT_meshopt_compression 与 KHR_mesh_quantization；含贴图输出还需 EXT_texture_webp。前端应配置MeshoptDecoder。

四、已完成检查与未验收范围
已独立解码回读：GLB头/长度/哈希、无外链、索引有效、属性有限值、三角数、detail源几何守恒、贴图尺寸、共同包络；通过。
light包络最大偏差0.010965563源单位；detail最大偏差0.000438957源单位。
本模型为阶段候选，不等于实景准确性或完整建筑形制已通过验收。高度、占地、朝向、GPS配准需依据站内登记置信度；源单位不能冒充测量米制。
本说明记录的是模型导出与离线检查，未宣称站内WebGL验收、手机帧率/内存实测或实景校准完成。
建议全景模型并发请求上限2，近景同时只保留1栋detail；退出近景后释放不再使用的detail资源。

详细数据：同目录 web-manifest.json。
