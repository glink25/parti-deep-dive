# Deep Dive: Sunken Signal

一个按 Parti Quick Start 基线开发的原创多人 Room。3–8 名潜水员进行 5 次深潜：每次翻开探索牌后，仍在场的玩家同时秘密选择继续深潜或返回母舰。宝藏按活跃人数均分；同类危险第二次出现会让仍在深潜的玩家失去本次未入账收益。

## 原创实现说明

本项目采用原创深海主题、牌名与 UI 文案，不复刻任何现成作品的美术与文字。输入规格只规定了“15 张宝藏牌”但没有规定 15 个宝藏数值，因此本实现使用可重平衡的原创序列：`4..18`。这只是数值实现选择，不改变核心规则结构。

## 规则落地

- 3–8 人，5 次 Dive。
- 牌池：15 宝藏、15 危险（5 类 × 3）、5 遗物。
- 每个 Dive 将未永久移除的牌重新洗回牌堆。
- 宝藏 `floor(value / activeDivers)` 分给每位仍在场玩家，余数留在路径。
- 第二张同类危险出现时，在进入玩家选择前立即 Crash；触发 Crash 的那张危险牌永久移出本局牌池。
- 同时选择使用 `choice -> lock -> allLocked -> resolve`：锁定前可覆盖选择，锁定后拒绝修改。
- 至少一人 LEAVE 时，离开者均分路径余宝；只有恰好一人离开时，该玩家才能带走路径全部遗物。
- 前 3 个成功带回母舰的遗物各 5 分，此后各 10 分。
- 5 次 Dive 后比较 `banked + relicPoints`；并列最高分共享胜利。

## 秘密选择与断线

实际 `GO/LEAVE` 选择不会写进公共 `ctx.state`。公共 snapshot 只包含 `chosen/locked` 状态；真实选择保存在 Worker 内，并通过 `ctx.send(playerId, ...)` 只回显给本人。全部锁定后才把已公开的选择写入公共事件历史。

断线玩家：

- 已锁定选择继续有效；
- 未锁定时等待 15 秒；若仍未重连，Worker 自动为其选择并锁定 `LEAVE`；
- 重连会取消自动离开 timer，并恢复该玩家尚未公开的本地选择提示。

若房间发生 Host 快照恢复，Worker 内未公开选择无法从公共 snapshot 安全重建，因此当前 decision 会清空并要求所有仍在场玩家重新选择；已结算状态不回滚。

## 随机与复盘

每局开始时仅用一次 Parti Worker 的 `ctx.random()` 生成 32-bit seed。之后所有洗牌都使用项目内确定性 PRNG，并把 seed、shuffle 状态、每次抽牌结果和公开结算写入事件日志，以便复盘与测试。

## 开发

正常联网开发环境：

```bash
npm install
npm run dev
npm run validate
```

`npm run build` 在依赖已安装时使用 Vite + esbuild，并按 Quick Start 要求把 Worker 单独 bundle，保留：

```js
import { defineRoom } from '@parti/worker-sdk';
```

当前 ChatGPT sandbox 无法访问 npm registry，因此仓库还提供一个零第三方运行时依赖的 fallback builder；只有在检测不到本地 Vite 时才启用，用于完成相同的产物结构与 Worker import 校验。

## 产物

```text
dist/
├─ parti.room.json
├─ index.html
├─ room.worker.js
└─ assets/
```

打包：

```bash
npm run package
```

## 验证边界

自动验证覆盖：核心规则边界、3/8 人完整结束、重复结算拒绝、Crash 移牌、遗物估值、平局共享胜利、seed 可复现，以及标准构建产物/Worker import 检查。

按照 Parti Quick Start，最终“能被 Parti 加载”和手机/桌面实际 UI 手感仍需开发者或玩家在 Parti Runtime 内真人试玩确认。
