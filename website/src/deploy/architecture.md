# 服务架构与 k3s

NebuCTF 将网页请求、定时任务和 Docker 执行分开。生产服务连接同一个 PostgreSQL，使用相同的站点密钥。

| 服务 | 职责 | Docker Socket |
| --- | --- | --- |
| Web | 静态页面、同源 API 与 WebSocket 代理 | 无 |
| API | 登录、题目、比赛、权限与请求入队 | 无 |
| Scheduler | 定时发布、提醒、轮次与数据清理 | 无 |
| Runtime | Docker 环境、附件生成、判题、采集和回收 | 有 |
| gateway | 题目 HTTP/WebSocket 转发 | 无 |
| PostgreSQL | 配置、账号、比赛和任务状态 | 无 |

API、Scheduler、Runtime 和 gateway 使用同一个后端镜像，通过不同入口启动。独立进程需要共享 PostgreSQL，不能分别打开本地 PGlite 数据目录。

## Compose 与 k3s

Compose 将平台和执行域放在同一部署中，适合首次安装和单机维护。仓库也提供 k3s + Docker 方案：平台、Scheduler 和 PostgreSQL 在 k3s 中，Runtime 和 gateway 在独立的 Docker 执行域中。

k3s 在这里承载平台服务，题目仍由 Docker 创建，并不是 Kubernetes 原生靶机后端。不要将题目镜像只导入 k3s 的 containerd，然后期待 Docker Runtime 能使用它。

## Runtime 的边界

一个数据库对应一个 Docker 调度域，Runtime 通过数据库锁选主。不要直接增加多个 Runtime 副本来扩容题目池，也不要让不同主机上的 Runtime 轮流管理同一批本地 Docker 资源。

API 与 Runtime 需要一致的附件存储，流量采集目录也必须按部署方式共享。跨服务的文件所有者和权限应保持一致。

## 使用仓库的 k3s 配置

`deploy/k3s`、`deploy/k3s-api-first` 和 `deploy/runtime-compose.yaml` 提供现有部署所用的清单。节点名、网段、持久目录、数据库访问地址和防火墙包含环境相关配置，应先阅读[仓库部署说明](https://github.com/yemaster/nebuctf/blob/main/docs/DEPLOYMENT.md)并逐项调整。

基本顺序是准备节点和隔离规则，创建数据库与应用角色，恢复数据和文件，导入平台及题目镜像，再依次启动 API、Scheduler、Runtime、网关和 Web。API 迁移完成后再启动新版本执行组件。
