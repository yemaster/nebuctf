# 本地开发

前端使用 React、Vite 和 shadcn/ui，后端使用 Fastify。需要 Node.js 24.14 或更高版本，依赖通过仓库的 npm lockfile 安装。

## 启动网页和 API

```sh
npm ci
npm run seed
npm run dev
```

seed 只用于空的本地开发题库，加载示例内容，不创建管理员。前端默认是 `http://localhost:5173`，API 是 `http://127.0.0.1:3000`。浏览器使用 localhost，以匹配默认 origin。

本地 API 可使用 PGlite。创建本地管理员前停止 API，避免两个进程同时打开同一嵌入数据库：

```sh
DATA_DIR="$PWD/.data" node scripts/admin.mjs --local
```

## 调试容器和后台任务

独立 Scheduler、Runtime 和 gateway 需要共享 PostgreSQL。设置相同的 `DATABASE_URL`、`APP_SECRET` 和文件目录，再启动相关入口。只启动网页和 API 不会自动提供 Docker 执行能力。

资源和网关改动需要真实 Docker 验证。使用隔离测试库，不能把测试脚本连接到正式数据。

## 代码位置

| 目录 | 内容 |
| --- | --- |
| `apps/api/src` | API、规则、数据库迁移与执行组件 |
| `apps/web/src` | 页面、业务组件和共享 UI |
| `apps/api/test`、`apps/web/test` | 后端与前端回归 |
| `examples` | 题目与检查器示例 |
| `deploy` | 容器、代理和部署清单 |
| `website` | 独立文档站 |

## 验证修改

```sh
npm run typecheck
npm test
npm run build
```

页面修改还需要实际检查桌面、窄屏、键盘操作和明暗主题。数据库迁移应验证重复执行与旧数据保留。涉及资源生命周期时，检查失败清理、限额、网络和到期行为。

提交问题或改动时说明复现条件和验证结果，避免把计划中的行为写成已经支持的功能。
