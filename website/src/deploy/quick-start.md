# Docker Compose 部署

首次部署建议使用仓库内的 Docker Compose。它启动 Web、API、Scheduler、Runtime、网关和 PostgreSQL，题目容器由 Runtime 在同一 Docker 主机上创建。

## 准备环境

准备一台 Linux 主机，安装 Git、Docker Engine 26 或更高版本，以及 Docker Compose v2。管理员初始化脚本需要 Node.js 24.14 或更高版本；应用本身会在容器中构建和运行。

默认配置允许平台服务合计使用约 4.2 GiB 内存，还需要为系统、镜像构建和题目预留空间。小内存测试机可使用 `deploy/compose.small.yaml`，正式比赛应按实际题目测试容量。

```sh
git clone https://github.com/yemaster/nebuctf.git
cd nebuctf
cp .env.example .env
chmod 600 .env
```

## 填写配置

分别生成数据库密码和站点密钥，将两次生成的结果填入 `.env`，不要使用同一个值：

```sh
openssl rand -hex 32
openssl rand -hex 32
stat -c '%g' /var/run/docker.sock
```

`POSTGRES_PASSWORD` 填数据库密码，`APP_SECRET` 填站点密钥，`DOCKER_GID` 填 Docker Socket 的实际组 ID。

初次在本机验证时保留这些设置：

```dotenv
APP_ORIGIN=http://localhost:8080
HTTP_BIND=127.0.0.1
HTTP_PORT=8080
CHALLENGE_HOST=localhost
CHALLENGE_BIND=127.0.0.1
COOKIE_SECURE=false
```

站点密钥用于会话、答案及其他敏感数据的处理，必须随备份保留。不要在已有数据后随意更换它。

## 构建并启动

```sh
docker build -t nebuctf/terminal:local deploy/terminal
docker compose up -d --build
docker compose ps
```

需要流量采集时，再构建 `deploy/traffic` 对应镜像。仅部署平台不需要立即打开采集。

等待服务就绪后检查：

```sh
curl --fail http://localhost:8080/api/health
```

正常返回 `{"status":"ok"}`。若 API 已就绪但靶机排队不动，还应检查 Runtime，而不是仅凭健康接口判断整个环境可用。

## 创建管理员

```sh
node scripts/admin.mjs
```

按提示输入用户名、邮箱和密码。密码不回显，也不写入命令行参数。平台不提供默认管理员或默认口令。

浏览器打开 `http://localhost:8080` 登录，进入管理中心。容器部署不需要运行开发用的 seed 命令。

## 完成第一次验收

设置站点名称和资源池，准备一道容器测试题，核对镜像、端口、动态 Flag、停止及到期回收。再创建测试比赛，用普通账号检查组队、报名和提交。

对外开放前继续阅读[域名、端口与 HTTPS](./network)。不要直接将数据库、Docker Socket 或管理服务发布到公网。
