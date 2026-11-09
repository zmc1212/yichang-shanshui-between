# 23 项楼宇接入：实际浏览器验收记录

日期：2026-11-09。原站：https://yichang-miniature-city.gaoronghai.chatgpt.site  
项目：`appgprj_6af0b8d6dbec81919ea6c30c51e88270`。

## 版本与环境

- V19：`028280ec254ea525081951f7912470ef8570e4d2`。新增模型实际 WebGL 加载与逐项查看、美联桌面独立预览检查。
- V20：`7bca16910ddaca3e25d0ec33b314be7682df2f9c`。扩大邻楼高度过渡范围、锦江默认镜头避让桥塔、福江/国际深玻璃有限日间提亮后的复查。
- V20 已成功部署，实际页面 script 为 `/assets/index-CM12Qa-T.js`。
- 使用已连接的 Chrome，在原站页面实际运行 Three.js r170 / WebGL。桌面默认宽度1920；手机布局测试使用390×844视口覆盖，结束后已恢复默认视口。
- 本记录不是实体手机帧率、峰值显存、发热/续航测试，也不是现场测量或实景建筑验收。此前管理预览环境的 WebGL 限制不能替代本次实际 Chrome 结果。
- 后续归档版只完善说明文本和加入本记录、截图；没有改变此处已验收的模型几何、配准数值或控制器逻辑。

## 加载与城市完整性

| 场景 | 实际观察 |
| --- | --- |
| V20全景 | 7个常驻自建模型全部加载；`residentModels=7`、`authoredModels=7`、`businessProjects=23`、`cityVisible=true`、`detailModels=0` |
| 桌面全景单帧 | 256 draw calls、1,237,062三角、254 geometry、14 texture；这是该镜头瞬时渲染计数，不是性能承诺 |
| 万达轻量近景 | 三塔、连续裙房和台阶可见，周边城市及江面持续显示；7个常驻模型、0个detail |
| 390×844万达细节 | `modelQuality=detail`、`detailModels=1`、72 draw calls、1,065,806三角、289 geometry、24 texture；三塔完整入镜，信息面板可操作 |
| 返回全景 | `detailModels=0`、`textures=14`、`cityVisible=true`；确认细节资源退出，不卸载其他轻量模型 |
| 美联独立窗口 | 主城市canvas持续存在且`cityVisible=true`；独立canvas先light，点击近景后detail，再切回light |
| 关闭美联窗口 | canvas数量恢复为1，城市继续显示；未在城市边缘创建模型展台 |

V19中人工依次查看了中南、锦江、万达、福江、国际、首信、九州的实际模型。V20复查影响本轮修正的万达周边高度、锦江默认镜头及福江/国际材质；重新加载页面确认全部7个常驻模型就绪。

## 视觉检查

- 万达：修正版三塔、幕墙和顶部保留；附近背景楼使用400/900米统一策略后可读性改善，自建模型本身不拉伸。
- 锦江：默认视角中楼体完整可见，夷陵大桥桥塔在侧前方，不再遮住主楼。此修正不移动建筑或桥。
- 福江：弧形幕墙与顶部形态可见；日/夜模式切换后均保留城市。深色玻璃仍保持本身的蓝绿色调，白日显示提亮有上限。
- 国际：三塔和裙房作为整组显示；页面持续标注“组团候选定位·相对布局待核·非实测”。本次画面可见不等于各塔地图位置已精确验收。
- 中南/九州/首信：V19实际浏览器中可见原模型外形、细分立面与顶部；没有用占位方盒替代。
- 美联：桌面与390像素宽度的独立预览均完整容纳候选组团，幕墙和台阶冠部由原模型显示；明确位置、朝向及绝对尺寸待核准。

## 交互检查

| 操作 | 结果 |
| --- | --- |
| “沙盘模型”筛选 | 7项，均可选中 |
| “待恢复”筛选 | 15项，不出现伪装成已恢复的模型入口 |
| “待配准”筛选 | 只有美联1项 |
| 搜索“金江” | 返回同一“锦江银座”项目1项，没有重复条目 |
| 点击实际三维网格 | 从国际视角直接点击万达塔楼网格，选中信息与镜头转为万达，验证射线拾取 |
| 选择“共同大厦” | 导览参考点和周边街区位于扩展后的板内，页面明确模型待恢复；未生成假模型 |
| 近景与全景 | 万达按需detail加载成功，回全景后释放；城市始终可见 |
| 日景/夜景 | 福江V20切换成功，控件状态与画面一致；首信V19也已实际检查 |
| 手机目录 | 390×844下打开目录、筛选、选择万达后目录收起，模型与底部信息面板可用 |
| 手机布局 | document宽度=390、scrollWidth=390，没有水平溢出 |
| 美联独立预览 | 打开、light/detail/light切换、关闭均成功；手机宽度下关闭/返回控件可操作 |

最后读取该页捕获的error/warn日志为空。浏览器连接曾出现一次工具超时，恢复连接后继续验收；没有将此认定为网站错误。

## 截图证据

以下均为实际页面原始截图，没有用离线渲染代替。

- [V20完整城市全景](qa/buildings-browser-20261109/desktop-overview-v20.png)
- [V20万达与周边城市](qa/buildings-browser-20261109/desktop-wanda-v20.png)
- [V20锦江镜头避让桥塔](qa/buildings-browser-20261109/desktop-jinjiang-v20.png)
- [V20福江日景](qa/buildings-browser-20261109/desktop-fujiang-day-v20.png)
- [V20福江夜景](qa/buildings-browser-20261109/desktop-fujiang-night-v20.png)
- [V20宜昌国际候选组团](qa/buildings-browser-20261109/desktop-international-v20.png)
- [V20共同大厦导览参考点](qa/buildings-browser-20261109/desktop-pending-reference-v20.png)
- [V19美联桌面独立细节预览](qa/buildings-browser-20261109/desktop-meilian-detail-v19.png)
- [V20手机宽度万达细节](qa/buildings-browser-20261109/mobile-width-wanda-detail-v20.png)
- [V20手机宽度美联独立预览](qa/buildings-browser-20261109/mobile-width-meilian-v20.png)

## 仍未通过的现实世界确认

本轮完成网页接入与候选地图配准，不能写成23个成品建筑。7项进入地图、1项独立预览、15项模型源件待恢复。所有候选都需继续以可靠影像/测绘核实。特别是宜昌国际相对塔间距约16.0–30.1米残差、福江后侧深度及美联完整组团占地/朝向，仍有明确未决项。

完整阶段、来源、23项名录和二进制审计见[集成说明](business-buildings-integration-20261109.md)与`business-buildings-evidence/`。
