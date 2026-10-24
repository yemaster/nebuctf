# 开发约定

## 工作流

Node.js 24.14+，提交 `package-lock.json`，使用 `npm ci` 安装。开发数据库使用 PGlite；涉及并发、Worker 或网关的改动还必须验证独立 PostgreSQL 与 Docker 环境。

```sh
npm ci
npm run seed
npm run dev
npm run typecheck
REQUIRE_DB_TESTS=1 npm test
npm run build
npm run format
```

前端 5173、API 3000，Vite 将 `/api` 代理到后端。APP_ORIGIN 必须与浏览器地址完全一致；不要用关闭 CSRF 的方式处理开发代理问题。

`.env` 由 Compose 使用，原生 Node 进程不会自动读取它。生产镜像不包含 PGlite 或开发工具。管理员通过 CLI 创建，账号密码经 stdin，不在命令行参数中传递。

## 组织方式

- HTTP 接口位于 `apps/api/src`，按身份、战队、题目、赛事、资源、学习与管理划分模块；`schemas.ts` 负责输入，`context.ts` 负责共享权限上下文。
- PostgreSQL 查询使用参数绑定；动态列名只能来自内部固定 schema 的键，不能来自客户端字符串。公开响应使用字段白名单，禁止直接序列化包含 Flag、镜像或密码的内部记录。
- 数据库修改采用可重复执行的迁移语句，追加迁移版本，保留旧数据。不得在启动时删除或重建已有业务表。部署前备份和独立恢复验证见部署文档。
- 资源模块只入队；Docker 操作放在 Worker。API 和 gateway 不挂载 Docker Socket。生产镜像采用多阶段构建并仅包含必要运行依赖。
- 前端页面位于 `apps/web/src/pages`；通用交互与 shadcn/ui 组件位于 `components`。请求集中在 `lib/api.ts`，统一查询失效、错误和加载反馈。管理员与学习模块按需加载。

## 一致性和安全约束

不要绕过领域锁和唯一索引：重复解题只能计一次；报名后保持战队身份稳定；资源预约、配额和实例插入必须在同一事务内。配额在真实清理完成后释放，不能在收到停止请求时提前释放。

镜像必须由运维预安装并满足前缀策略；推荐按 digest 固定正式镜像。所有实例继承非 root、cap-drop、只读根、禁止宿主挂载与限额约束。新增题目配置不能允许用户任意覆盖 Docker HostConfig。

动态附件输出仅允许单一 artifact.zip；不可把生成器归档直接解压到宿主。网关路由必须来自运行且未过期的数据库实例，不能允许请求方指定目标 IP。

密码、Flag、Cookie、邀请码不写日志。所有写接口保留 Origin + CSRF 头验证。修改密码与禁用账号需撤销会话。Markdown 禁止原始 HTML，保留危险链接协议过滤。

## 验证

`apps/api/test` 包含领域、HTTP、Docker 调度、真实 HTTP 网关和数据库集成测试；`apps/web/test` 检查 Markdown 安全、API 错误与动作链接、进度无障碍属性和定时器生命周期、部分/全部解题状态、比赛工作区导航。数据库集成默认使用内存 PGlite；设置 `TEST_POSTGRES=1` 和 `DATABASE_URL` 可改用**独立空 PostgreSQL 数据库**，不要连接业务数据库执行此测试。CI 会执行两种数据库路径。

资源或网关变更必须在本地运行 `npm run smoke` 并 inspect 限额、网络和清理结果；该脚本有意写入示例数据，仅用于开发环境。运行前阅读 [本地测试](LOCAL_TEST.md)。页面变更需要补充桌面、移动端、键盘操作的浏览器验收记录；构建通过不等于视觉验收通过。
