# 测试题目与赛制验收

这组数据通过运行中平台的 HTTP API 创建，用普通账号报名、作答、启动环境和上传补丁。数据库只用于备份及只读检查，不直接写入成绩，也不提前修改到期时间。

## 保留的体验数据

所有题目、比赛与战队都带有 `[测试]` 标记。10 道入门题包含固定分、动态分、多 Flag、单选、多选、填空、单容器多 Flag、专属附件、AWDP 和 AWD；其中 9 道开放练习，AWD 通过比赛使用。

| 战队   | 账号                         | 用途                                         |
| ------ | ---------------------------- | -------------------------------------------- |
| ALPHA  | `test_alpha1`、`test_alpha2` | 队长与队员协作、攻击与补丁验证               |
| BRAVO  | `test_bravo1`、`test_bravo2` | 报名审核、错误答案、失败补丁后重试           |
| 体验队 | `test_charlie`               | 综合赛只读组；自由计时赛尚未开始，可手动体验 |

登录可使用用户名或邮箱，例如 `test_alpha1` 或 `alpha1@nebuctf.test`。每个账号使用独立随机密码；账号、密码和战队名存放于服务器 `/opt/nebuctf/.data/server-demo/accounts.json`，权限为 `0600`。该文件不包含管理员密码和会话。只有 `state.json` 包含运行所需的会话与管理员资料，不应对外分发。

综合解题体验赛和自由计时体验赛保留 7 天作答窗口。限时赛、轮次赛与 AWD 在真实时间内完成后保留成绩，供查看排行榜、解答人和逐轮明细。已有最终提交和已用完的自由计时不能重置；体验队的自由计时尚未启动。

## 执行方式

脚本用于已授权写入的开发服务器，不加入普通 CI，也不会自动清空数据。运行前先备份数据库。需要 Node.js 24、已安装的 workspace 依赖、Python 3、运行中的 Worker 和以下本地题目镜像：

```sh
docker build -t nebuctf/example-ad:local examples/attack-defense/service
docker build -t nebuctf/example-checker:local examples/attack-defense/checker
docker build -t nebuctf/example-multi:local examples/multi-flag
docker build -t nebuctf/example-generator:local examples/dynamic-attachment
```

题目使用宿主机端口模式，脚本只访问与 `DEMO_ORIGIN` 同主机且处于 `30000–50000` 的测试靶机端口。示例镜像用于功能验证，题面会说明简单解法。

双队 AWD 同时需要靶机和巡检预留资源，补丁判题也会预留构建与检查资源。本次验收临时使用 `MAX_INSTANCES=6`、`MAX_CPU=1500`、`MAX_MEMORY=768`，每队环境上限仍为 1。运行前保存原值，完成后恢复原配额并重建对应服务；脚本不会自行修改宿主机或 `.env`。

```sh
cd /opt/nebuctf
export DEMO_ALLOW_WRITE=1
export DEMO_ORIGIN=http://服务器IP:61001
export DEMO_ADMIN_FILE=/root/.config/nebuctf/admin.json

node scripts/test-competition-live.mjs seed
node scripts/test-competition-live.mjs core
node scripts/test-competition-live.mjs resources
node scripts/test-competition-live.mjs timing
node scripts/test-competition-live.mjs rounds
node scripts/test-competition-live.mjs awd
```

按上述顺序串行执行，各阶段共享状态。`seed` 建立数据；其余阶段逐项记录断言。成功步骤会被跳过，因此同一状态目录用于续跑和核对，不等于重新测试一遍。失败步骤可能已经提交答案或启动计时，需先核对已发生的操作；完整重跑应使用独立、可重置的开发部署，不能删除状态文件后在原数据库中直接重跑。测试用户名固定，注册还有频率限制。

默认输出目录为 `.data/server-demo`，可用 `DEMO_STATE_DIR` 指定。`report.json` 保留题目、比赛标识与通过结果，不包含账号密码、Cookie 或动态 Flag。各阶段的实际时间由服务器决定，多轮赛不会跳过真实轮次等待。

## 验收范围

- 报名审核、队长报名、未报名拒绝、只读组权限和组内排行。
- 固定分覆盖、动态分衰减、多人同时提交去重、多 Flag 分项计分和实践/比赛隔离。
- 三类客观题、保存草稿、最终提交不可覆盖、题目解答人与队员贡献。
- 两队动态 Flag 隔离、单容器多 Flag 注入、私有附件下载、操作冷却和到期回收。
- AWDP 攻击与防守分开计分，真实补丁构建、功能与安全检查、失败后重试。
- 全队共享自由计时、独立阶段时钟、固定时间窗口、提前与超时提交拒绝。
- 多轮积分的持续得分、每轮重新提交、结算去重和 WebSocket 三血通知。
- AWD 自动分配、每轮 Flag 轮换、自队 Flag 拒绝、跨队攻击去重、攻击/防守/可用性分别结算，以及补丁部署后重启保留修复。

这组验收覆盖接口与真实 Docker 调度。没有打开浏览器，不将其视为视觉验收或并发容量测试。当前没有域名，泛域名代理与 TLS 不在本轮现场验收范围内。

## 2026-10-25 远程实测结果

12 组验收全部完成。保留 5 场已发布测试赛、10 道题、5 个账号和 3 支战队；另有 1 场未发布的 AWD 初测记录，用于保留异常现场。以下为完整验收后的成绩，后续人工体验可能继续改变未结束比赛的分数。

| 比赛           | ALPHA | BRAVO |               体验队 |
| -------------- | ----: | ----: | -------------------: |
| 综合解题体验赛 |  1170 |   780 | 只读，不参与全局排名 |
| 自由计时体验赛 |   977 |   847 |  0，两个阶段均未开始 |
| 分阶段限时赛   |   150 |   150 |               未报名 |
| 三轮积分赛     |   210 |   210 |                  100 |
| AWD 双队对抗赛 |   220 |   360 |               未报名 |

AWD 的四轮分数分别为 ALPHA `150 / 10 / 10 / 50`、BRAVO `10 / 150 / 150 / 50`。第二轮提交修复后，漏洞入口返回 403，健康检查仍正常；第三轮重启后仍使用修复镜像。每轮 Flag 轮换、旧 Flag 失效、自队 Flag 拒绝、队友重复攻击去重均通过。两个靶机端口还从服务器外实际访问了 `/health`。

三轮积分赛通过真实 WebSocket 收到 6 帧动态，包含三血通知。AWDP 完成 2 次有效补丁判定和 1 次无效补丁判定；同时验证了非法归档路径拒绝、操作冷却、失败后重试和攻防分项计分。

初测暴露并修复了 AWD 靶机列表的 SQL 类型问题：同一参数同时用于文本范围与 UUID 比赛标识，导致 PostgreSQL 返回 500。已为 UUID 比较添加明确转换，并补充未分配环境、运行状态、自队标识和历史积分的接口回归断言。新增断言在修复前失败，修复后赛制测试的 10 项在 PGlite 与隔离 PostgreSQL 17 中全部通过；后端类型检查和 Docker 镜像构建也通过。修复已部署，再重新建立完整 AWD 测试赛验证。

初测的示例环境使用 0.1 核 CPU 时，Python 健康检查超过镜像规定的 2 秒超时；独立容器复现后，将示例配置调整为 0.25 核，健康检查恢复。测试结束后恢复全局配额为 2 个环境槽位、1000 毫核 CPU、512 MiB 内存，保留题目与成绩，不保留运行中的测试环境。
