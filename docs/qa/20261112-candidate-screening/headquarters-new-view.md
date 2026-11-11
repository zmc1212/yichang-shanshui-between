# 兴发总部独立高机位复核，H 实质补齐

本轮目标是主动寻找陆侧上段/冠顶新实景，不复用雅高 ho00..07 作为新增证据，不重启九州延肋误判。

## 新证据与实际采用
Trip 酒店 113067476 外观图库：
https://hk.trip.com/hotels/yichang-hotel-detail-113067476/grand-mercure-yichang-waitan/photo.html
实际图：https://dimg04.tripcdn.com/images/1mc5912000dim1zy0BE21.jpg

该图为独立高机位，朝裙房的大面完整可见，另一侧街面长入口棚清楚，足以对应当前模型 +Y。360×480 真图，可支持浅竖肋/青玻璃大域延至浅冠前表面、两道暗带，但不足以重建窗格、测量高程或判断屋顶设备。摄影日期未知。平台将该图列于酒店外观，不把未认证上传身份当作独立官方署名。

三域 dimg04.tripcdn.com / dimg04.c-ctrip.com / ak-d.tripcdn.com 无尺寸 JPG 均360×480；1920变体仍为360裁图，1280变体400错误。未获更高原始分辨率，未AI补图。

相对定位以同面冠底与既有下暗带为显示锚，第二带落在约40.7..43.2而不是必在旧G截止44之上。H采用41.3..42.7示意深色带，并互斥替换整层G。详细取点、公式、局限见交付docs/source_mapping.json。冠底62.1/顶64来自既有模型，13肋/12玻璃域仍是继承示意数量。

## 其他实际搜索/实看结果
- https://news.hubeidaily.net/mobile/c_1873514.html：三图已下载实看，江侧全楼、庆典、江侧近地入口，不揭示陆侧上域。
- https://news.hubeidaily.net/pc/c_1873599.html：两张1200px航拍已实看，包括江侧高斜及冠顶俯视。可见有限屋顶设备但不能完整推出陆侧屋面结构，本轮不建。
- https://www.jtathorp.com/nd.jsp?fromMid=3&groupId=2&id=42：检索指向2020设计介绍；页面503/超时，不能用设计效果图冒充落成实景。
- https://m.cnhubei.com/content/2023-10/15/content_16777982.html：页面重定向循环。
- https://www.sohu.com/a/792423778_121374370：403。
- https://grandmercure.hotelyichang.cn/en：503，且页面自称官方不等于已核验官方身份。
- 英文检索米其林/多家OTA有酒店信息，未额外确认可用于模型的更高新机位。
- 丽景仅作备选初搜，既然总部新图已解锁高收益大域，本轮未继续扫丽景；不声称丽景证据耗尽。

## 产物与边界
原生/full GLB/脚本/五张CPU前后与独立导入图：
advance23_20261111/model_refinement/XingfaHQ_H20261112_FullLandwardField
完整包ZIP同目录同名.zip。
full GLB SHA256：532925745fb91cf93f440ee6ddb8dbbcd031dbad902856ab97a6dbcdacc6924b
ZIP SHA256：86e07425d933818b574e6bac308449871360aebb7476cd29efd8c27316443ab1

75新网格/900三角，161旧网格（含render地板）几何/材质/矩阵签名一致。旧G仅改集合可见性，完整保存为互斥旧阶段。97,650新AABB/原F旧面组合均分离；450新面无同向正面积共面重叠；全模型bbox不变；移除原生网格后独立GLB导入185网格且重渲通过。

本报告与ZIP不含外部参考照片。子线程未改网站或发布。
