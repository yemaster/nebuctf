# 远程开发与首次部署

适用于通过 SSH 开发、Docker Compose 运行平台的独立 Linux 服务器。当前部署目录为 `/opt/nebuctf`，SSH 别名为 `huawei-sh`。使用独立数据库和附件卷，不复制本机测试账号、数据或 `.env`。

## 环境

- Debian 12，Docker Engine 与 Compose 插件，Git，Node.js 24.14.1 / npm。
- 官方 Docker 安装步骤：[Debian 安装文档](https://docs.docker.com/engine/install/debian/)。镜像安装源仍须使用 Docker 官方 GPG 密钥校验，不关闭证书或签名检查。
- Node.js 官方二进制通过同版本 `SHASUMS256.txt` 校验后安装到 `/opt/nebuctf-tools`，`node`、`npm`、`npx` 链接到 `/usr/local/bin`。
- 2 GiB 内存开发机可添加 2 GiB swap 缓冲构建峰值；swap 不计入靶机配额，不能替代运行内存。
- 云安全组由服务器管理员维护。部署不会自动修改宿主机防火墙、SSH 配置或系统端口范围；不要额外执行 `deploy/firewall.sh`，除非管理员明确需要。

仓库可用 HTTPS 拉取。服务器不保存本机 SSH 私钥或 GitHub token；需要从服务器推送时，由开发者配置自己的 GitHub 认证。网络不稳定时，可以通过 SSH 传输 `git bundle`，保留完整提交历史，再设置 `origin`。

## 无域名访问

在项目目录创建权限为 `0600` 的 `.env`，两项密钥分别使用 `openssl rand -hex 32` 生成。以下 IP 只是示例，请替换为服务器公网 IP。

```dotenv
POSTGRES_PASSWORD=<独立随机值>
APP_SECRET=<独立随机值>
APP_ORIGIN=http://203.0.113.10:61001
COOKIE_SECURE=false
HTTP_BIND=0.0.0.0
HTTP_PORT=61001
CHALLENGE_HOST=203.0.113.10
CHALLENGE_BIND=0.0.0.0
CHALLENGE_PORT_RANGE=30000-50000
IMAGE_PREFIXES=nebuctf/
DOCKER_GID=<stat -c '%g' /var/run/docker.sock 的结果>
DOCKER_SOCKET=/var/run/docker.sock
GATEWAY_HTTP_PORT=8081
```

平台访问地址为 `http://公网IP:61001`，题目使用「宿主机端口」模式。网关只绑定 `127.0.0.1:8081`；数据库、API 和 Worker 不发布主机端口。当前没有域名与证书，泛域名模式需要以后另行配置。

## 2 GiB 开发配置

在 `.env` 增加以下配置，让普通 `docker compose` 命令自动使用小内存覆盖文件：

```dotenv
COMPOSE_FILE=compose.yaml:deploy/compose.small.yaml
COMPOSE_PARALLEL_LIMIT=1
MAX_INSTANCES=2
MAX_OWNER_INSTANCES=1
MAX_CPU=1000
MAX_MEMORY=512
```

平台容器内存上限合计 896 MiB，靶机池上限 512 MiB、1 核 CPU。每人或每队同时一个环境，全局最多两个。较大的题目和并行 AWD/AWDP 环境需按实际容量调整配额或扩容。这是开发配置，不是赛事容量承诺。

每个靶机使用独立 Docker 网络；默认地址池可参考 `deploy/daemon.example.json`，先确认与云 VPC 路由不冲突。地址池配置与安全组、出站策略相互独立。

## 启动与开发

```sh
ssh huawei-sh
cd /opt/nebuctf
npm ci --no-audit --no-fund
docker compose config --quiet
docker compose build api web
docker compose up -d --no-build --wait --wait-timeout 180
docker compose ps
curl --fail http://127.0.0.1:61001/api/health
```

Docker 服务启用开机启动，Compose 容器使用 `restart: unless-stopped`。修改代码后重新构建对应服务即可；不要删除数据卷。

```sh
git pull --ff-only
npm ci --no-audit --no-fund
npm run typecheck
npm test
docker compose build api web
docker compose up -d --no-build --wait --wait-timeout 180
```

API、Worker 和 Gateway 共用后端镜像，后端修改需同时更新这三个服务。仅修改前端时可用 `docker compose build web`，然后 `docker compose up -d --no-deps --no-build web`。

首次管理员使用 `npm run admin` 交互创建。由部署工具生成的初始管理员资料应单独存放在服务器的 `/root/.config/nebuctf/admin.json`，权限为 `0600`；不要写进仓库、构建上下文或日志。

Docker Hub 访问不稳定时，在可访问的可信机器拉取相同架构的官方基础镜像，使用 `docker image save --platform linux/amd64` 导出，再通过 SSH 传输并 `docker load`。核对导入后的镜像 ID，避免随意切换未知镜像源。题目镜像也可以采用同一流程；在线拉取仍取决于服务器到对应 registry 的连通性。

## 验证

普通 `npm test` 包含数据库集成与前端交互测试；真实 Docker 测试默认跳过。端口池单独验证不连接平台数据库：

```sh
docker build -t nebuctf/example-web:local examples/dynamic-container
TEST_PORT_POOL=1 node --import tsx --test apps/api/test/port-range-docker.test.ts
```

该测试在 `30000–50000` 内选择一个仅含两个端口的小池，验证并发启动、池满失败、HTTP 访问和释放后复用，结束后清理自己的容器与网络。请在 Worker 启动前执行，避免平台对账清理测试环境。

真实 PostgreSQL 测试须使用单独的空数据库，不要将部署数据库的 `DATABASE_URL` 传入测试。公网验证另需从服务器外访问 `61001` 和实际分配的靶机端口；本机 curl 成功不能证明安全组已放通。

已授权的演示数据和完整赛制验收使用 [测试题目与赛制验收](LIVE_DEMO.md) 中的独立脚本。它会创建真实账号、比赛和提交记录，不能作为无副作用的健康检查运行。
