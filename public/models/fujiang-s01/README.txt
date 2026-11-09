福江铭座 — 网页模型交接说明
生成日期：2026-11-09

一、当前来源与阶段
阶段：S01 corrected static candidate
边界：使用修正版；曲面、36层模块、冠部深度仍为阶段候选，HOLD背面闭合及NOT_INTERIOR遮挡面保留。
输入GLB文件：fujiang_mingzuo_s01_static_candidate(1).glb
输入GLB字节：164867984
输入GLB SHA-256：250241c787121703bcda53c7efd0f9c11225ac9b635f750e605faa1906bf00b9

二、网页派生文件
light.glb：全景使用；detail.glb：近景按需使用。
light.glb：2,334,232 字节；94,130 三角；265,444 顶点；18 图元/材质绘制分组；5 张贴图。
light 贴图解码内存估算：6.67 MiB（RGBA8+完整mipmap，不含几何、渲染目标，不是设备实测）。
light SHA-256：efdeb253b9fe459a4a9e6e6aa822f77577f6b1cc366b09a823b31e4e78c4b10b
detail.glb：6,794,540 字节；435,656 三角；863,010 顶点；18 图元/材质绘制分组；10 张贴图。
detail 贴图解码内存估算：53.33 MiB（RGBA8+完整mipmap，不含几何、渲染目标，不是设备实测）。
detail SHA-256：d2ec0d62e0d0b73a95fb3b1b71ed91b4b2d5250bc49595bf96897dac9ca49b8e

两级共同基准：保留建筑源几何435,656三角；light几何量减少78.39%。detail保留该源几何三角数。
必须以web-manifest.json中的共同sourceBounds做相同均匀缩放，不能分别用两个量化输出包络归一化，也不能单独拉伸高度。
sourceBounds（glTF Y-up，源建模单位，非米制测量）：{"min": [-24.24829864501953, -0.125, -21.674999237060547], "max": [24.24829864501953, 100, 12.180000305175781]}

三、优化方式与外观边界
原生 .blend 和未优化源GLB均保持不变，所有网页输出另存。
保留建筑外形、塔楼组团、幕墙分格和顶部结构；按材质合并/weld，light有界简化，detail不做几何简化。
light去除烘焙微表面法线图并重建面法线；有颜色图的UV保留。light纹理上限512，detail上限1024；颜色/法线图按需转为WebP。
原始基色保留，网页微缩风格使用不透明材质，减少金属度、增加粗糙度，去transmission/volume/clearcoat。材质显示不是原生程序材质的逐节点还原。
light在细分格与斜面阴影上会比detail更硬，近景应切换detail。
必需解码：EXT_meshopt_compression 与 KHR_mesh_quantization；含贴图输出还需 EXT_texture_webp。前端应配置MeshoptDecoder。

四、已完成检查与未验收范围
已独立解码回读：GLB头/长度/哈希、无外链、索引有效、属性有限值、三角数、detail源几何守恒、贴图尺寸、共同包络；通过。
light包络最大偏差0.011941777源单位；detail最大偏差0.000437670源单位。
本模型为阶段候选，不等于实景准确性或完整建筑形制已通过验收。高度、占地、朝向、GPS配准需依据站内登记置信度；源单位不能冒充测量米制。
本说明记录的是模型导出与离线检查，未宣称站内WebGL验收、手机帧率/内存实测或实景校准完成。
建议全景模型并发请求上限2，近景同时只保留1栋detail；退出近景后释放不再使用的detail资源。

详细数据：同目录 web-manifest.json。
