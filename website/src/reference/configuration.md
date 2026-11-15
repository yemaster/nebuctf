# 环境变量

Compose 自动读取仓库根目录的 `.env`。直接运行 Node.js 时，应用不会自动加载这个文件，需要由 Shell 或进程管理器传入环境变量。

## 基础配置

| 变量 | 说明 |
| --- | --- |
| `POSTGRES_PASSWORD` | Compose 数据库密码，首次部署生成独立随机值 |
| `DATABASE_URL` | 独立进程使用的 PostgreSQL 连接地址；Compose 内部生成 |
| `APP_SECRET` | 至少 32 字符的站点密钥，所有后端入口必须一致 |
| `APP_ORIGIN` | 浏览器访问平台的完整 origin，包含协议和必要端口 |
| `COOKIE_SECURE` | HTTPS 入口设为 true，本地 HTTP 设为 false |
| `DATA_DIR` | 文件和本地开发数据目录；容器内默认 `/data` |
| `HTTP_BIND` / `HTTP_PORT` | Compose Web 的宿主监听地址和端口 |
| `TRUST_PROXY` | API 信任的代理地址，按真实代理拓扑设置 |

## Docker 与入口

| 变量 | 说明 |
| --- | --- |
| `DOCKER_SOCKET` | Runtime 使用的 Docker Socket 路径 |
| `DOCKER_GID` | Socket 所属组，不要用放宽 Socket 权限替代 |
| `IMAGE_PREFIXES` | 允许的题目镜像前缀，逗号分隔；默认 `nebuctf/` |
| `CHALLENGE_HOST` | 端口直连展示给选手的主机名或 IP |
| `CHALLENGE_BIND` | 靶机宿主端口监听地址 |
| `CHALLENGE_PORT_RANGE` | 有序 TCP 端口范围，如 `30000-40000`；留空由 Docker 分配 |
| `CHALLENGE_DOMAIN` | 泛域名后缀，不包含 `*.` |
| `DOMAIN_SCHEME` | 题目域名对外使用 http 或 https |
| `GATEWAY_HTTP_PORT` | Compose 网关的本机端口，默认 8081 |
| `TERMINAL_IMAGE` | 网页终端所用镜像 |
| `TRAFFIC_IMAGE` | 流量采集所用镜像 |

## 资源池

| 变量 | 单位与作用 |
| --- | --- |
| `MAX_INSTANCES` | 全局容器数量初始上限 |
| `MAX_OWNER_INSTANCES` | 每个用户或战队的环境数量初始上限 |
| `MAX_CPU` | 全部题目及执行任务可使用的 CPU 总预算，单位毫核 |
| `MAX_MEMORY` | 全部题目及执行任务可使用的内存总预算，单位 MiB |

后台容器策略可以管理部分数量与时长规则，持久化策略不应与 `.env` 初始值混为一谈。比赛的并发和开启次数限制在比赛编辑中设置。

调整环境变量后重建对应服务，现有进程不会自动读取新值。配置默认值与完整字段以仓库的 `.env.example`、Compose 文件和 `apps/api/src/config.ts` 为准。
