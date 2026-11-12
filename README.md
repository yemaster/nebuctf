# NebuCTF

自托管的 CTF 竞赛与学习平台。React + shadcn/ui、Fastify、PostgreSQL；支持 Docker Compose，或 k3s 平台配合独立 Docker 执行域，部署边界见 [部署文档](docs/DEPLOYMENT.md)。实现范围和真实验收状态分别见 [方案](docs/PLAN.md) 与 [验证记录](docs/VERIFICATION.md)。本次运行入口与账号说明见 [本地测试](docs/LOCAL_TEST.md)。

## 功能

- 注册、登录、头像上传、改密、会话撤销；超级管理员、普通用户、自定义多角色及单题目/单比赛授权。
- 战队创建、Logo 上传、邀请码、成员管理、队长转让、比赛报名与成员锁定。
- [自定义报名表单](docs/REGISTRATION_FORMS.md)、逐成员资料、分组审核覆盖、行内审核及刷新恢复草稿。
- 分页题库与题单、多小题独立计分、Flag 提交、提交记录、动态积分、比赛封榜。
- 公告首页、近期比赛与日历、比赛专属导航、独立全屏赛场、选队与分组报名。
- 客观题、CTF、AWDP、AWD 混合选题，比赛独立分值覆盖、动态曲线与轮次结算。
- 客观题/实操分阶段时间、战队共享自由开始、AWDP/AWD `tar.gz` + `update.sh` 隔离更新与双项校验、AWD 服务巡检与 Flag 轮换。
- WebSocket 比赛动态，上线/下线、新提示、三血及收起状态提醒。
- [消息中心](docs/MESSAGES.md)：实时未读提醒、比赛与 WriteUp 审核通知、开赛/截止提醒、分类搜索和归档，后台定向发送及撤回系统消息、注册欢迎消息与引导按钮。
- 静态附件、动态专属附件、公共容器、个人/战队动态容器。
- 靶机按题选择宿主端口或泛域名 HTTP/WebSocket 代理；独立网关和实例网络。
- [比赛流量统计与 PCAP 采集](docs/RESOURCE-ACCESS-PLAN.md)：全局及比赛策略、收发量、速率、容量轮转、授权下载。
- CPU、内存、PID、实例数、TTL 配额，排队、续期、销毁、到期自动释放与对账回收。
- Markdown 知识库与教程、阅读进度、技能树、前置技能和练习联动。
- 题目、赛事、公告、文档、技能树、资源、用户、审计管理。
- 基础概览、系统名称与页脚、容器续期与确认替换、SMTP 注册验证与邮箱白名单、OpenAI/Anthropic AI 路由转发，见 [基础管理教程](docs/SYSTEM-SETTINGS.md)。

题型配置、计分公式、检查器协议与实时动态见 [比赛规则](docs/COMPETITION-RULES.md)，攻防出题模板见 [示例](examples/attack-defense/README.md)。

## Docker 部署

按 [部署文档](docs/DEPLOYMENT.md) 配置 `.env`、生成独立密钥，再执行：

```sh
docker build -t nebuctf/terminal:local deploy/terminal
docker compose up -d --build
node scripts/admin.mjs
```

默认入口 `http://localhost:8080`，不包含默认管理员或默认口令。支持泛域名的配置、DNS、通配符证书及网络防火墙见部署文档。

## 本地开发

需要 Node.js 24.14+。生产使用 PostgreSQL，本地 API 可使用 PGlite；独立 Scheduler、Runtime/gateway 必须连接共享 PostgreSQL。

```sh
npm ci
npm run seed
npm run dev
```

前端 `http://localhost:5173`，API `http://127.0.0.1:3000`。使用 localhost 访问以匹配默认 APP_ORIGIN；更换地址时需同时设置该变量。示例数据显式加载，不创建账号或伪造排行榜。创建本地管理员前先停止 API，避免两个进程同时打开嵌入数据库：

```sh
DATA_DIR="$PWD/.data" node scripts/admin.mjs --local
```

使用 PostgreSQL 时通过环境变量设置 DATABASE_URL；环境变量不会由程序自动从 `.env` 读取，Compose 会自动使用根目录 `.env`。API、Scheduler、Runtime、gateway 必须使用相同的数据库和 APP_SECRET。根目录 `npm run dev` 在 PostgreSQL 模式同时启动 Scheduler；直接运行 API 工作区时另启 `npm run scheduler:dev -w apps/api`。PGlite 开发模式由 API 进程复用同一 DB handle 运行 Scheduler，不能另开嵌入数据库进程。Runtime：`npm run worker -w apps/api`；网关：`node --import tsx apps/api/src/gateway-main.ts`。

## 检查

```sh
npm run typecheck
npm test
npm run build
npm run format
```

`REQUIRE_DB_TESTS=1 npm test` 要求数据库集成依赖存在，CI 使用此模式，不接受跳过数据库集成测试。实际通过项目与尚未覆盖的范围详见验证记录。

开发流程、结构与安全边界见 [开发约定](docs/DEVELOPMENT.md)。

## 目录

| 路径 | 用途 |
| --- | --- |
| `apps/api/src` | HTTP API、领域规则、SQL、Scheduler、Docker Runtime、反向代理网关 |
| `apps/web/src` | 前端页面、数据请求、shadcn/ui 组件 |
| `apps/api/test` | 权限、计分、隔离、调度、技能图与数据库集成测试 |
| `examples` | 动态附件生成器和靶机镜像示例 |
| `deploy` | Compose/k3s 混合部署、节点引导、Nginx、通配符代理与隔离防火墙 |
| `docs` | 实现方案、部署、出题、用户/管理员教程、验收记录 |

本项目独立实现，参考 [GZCTF](https://github.com/GZTimeWalker/GZCTF)、[Ret2Shell](https://github.com/ret2shell/ret2shell) 与 [CTFd](https://docs.ctfd.io/) 的公开功能设计。未复制其源码、品牌或界面资产。


比赛支持独立配置公开排行榜与 [3D 观战大屏](docs/CONTEST-SPECTATING.md)、邀请码/指定战队报名，以及不影响正式成绩的赛后练习。后台入口：比赛管理 → 编辑比赛 → 访问与报名。

比赛与题目迁移：[导入导出教程](docs/IMPORT_EXPORT.md)。
