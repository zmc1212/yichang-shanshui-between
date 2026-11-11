# 车辆与路面接触核验

本目录保存本次车流修复的 CPU 几何审计结果。测试直接读取实际渲染网格和车辆实例矩阵，不以车辆自己的路线或高度采样函数作为预期结果。

## 记录

- `audit-before.json`：V69、源码 `e583f129f8dbfb488bd9f95546b4a54753bee250` 的根因定位。包含全部路线、地形覆盖位置和最坏高度差。
- `audit-after.json`：修复后的实际路面与车体矩阵核验。源码 SHA256 位于 `checksums`，车辆最终验收位于 `actualVehicleMatrices.summary`；`roadGeometrySummary` 的旧车轴心差值仅用于诊断，不能混同最终车辆结果。

18 条路线的 13,363 个位置和 53,452 个完整足迹角点检查未发现平面越界。修复后道路均在实际地形三角面之上，同层交叉路面的最高差异为 3.666 cm；不同层级的桥面单独识别，不能作为地面车辆接触面。

完整动画审计覆盖 36 辆车、146.28 秒和 87,804 个实际实例矩阵。车身底角和含车灯完整足迹各检查 351,216 个：越界、涉水、无效矩阵、无法放置车辆和下陷均为 0。车身底部与路面的间隙为 5.000–13.286 cm，包含端点渐隐缩放。

## 可重复检查

```sh
node scripts/check-road-network.mjs
node scripts/check-city-traffic.mjs
node scripts/check-traffic-road-contact.mjs
node scripts/check-scene-environment.mjs
```

接触回归使用独立 Three.js 射线，分别检查自身源道路和同地面层道路，保留上方桥面覆盖的案例。真实城市回归模拟 194.22 秒，覆盖全部路线至少一个循环；窄斜路案例逐帧覆盖端点回收。

所有距离按 `meta.unitsPerMeter = 0.02` 换算，仅为模型内距离。此目录不是 GPU 帧率测试或 WebGL 视觉验收记录。
