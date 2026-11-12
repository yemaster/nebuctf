# 部署与运维

## 服务边界与两种部署路径

同一后端镜像有四个入口：API (`dist/main.js`)、Scheduler (`dist/scheduler-main.js`)、Runtime (`dist/worker-main.js`，原 Worker) 和 gateway (`dist/gateway-main.js`)。Web 使用独立 Nginx 镜像。Scheduler 负责定时发布、提醒、轮次推进及非执行数据保留；Runtime 负责 Docker、终端、题目/附件/采集资源生命周期和心跳。API、Scheduler、gateway 均无 Docker Socket。Scheduler 使用 PostgreSQL advisory lock `760004`，Runtime 保留独立锁 `760003`；两者连接失效时停止领袖工作，不依赖 Redis 或消息代理。

| 路径 | 平台与数据库 | 执行域 |
| --- | --- | --- |
| 完整 Compose | `web`、`api`、`scheduler`、`db` | 同一 Compose 的 `worker`、`gateway` |
| 单节点 k3s + Docker | `nebuctf` 命名空间的 `web`、`api`、`scheduler`；`platform-data/postgres` | `deploy/runtime-compose.yaml` 的 `runtime`、`nebuctf-gateway` |

两条路径都是 **Docker 题目执行**，不是 Kubernetes 原生题目；k3s 仅承载平台。一个数据库只对应一个 Docker 调度域和固定名 `nebuctf-gateway`。不要同时启动两套 Runtime，也不要部署 Registry 或 Agent 评测服务。

## Docker Compose

要求：Linux Docker Engine 26+（API v1.45）、Compose v2；建议专用靶机 VM。默认平台内存上限合计约 4.2 GiB，另留题目资源池和宿主余量。2 GiB 开发机可叠加 `deploy/compose.small.yaml`，并相应降低 `MAX_MEMORY/MAX_CPU`。部署前检查 Docker 地址池与 LAN/VPN/VPC 无冲突。

```sh
cp .env.example .env
openssl rand -hex 32
openssl rand -hex 32
stat -c '%g' /var/run/docker.sock
```

分别填入 `.env` 的 `POSTGRES_PASSWORD`、`APP_SECRET` 和 `DOCKER_GID`。十六进制密码避免数据库 URL 转义问题；不要提交 `.env`，权限设为 `0600`。Compose 保持原有本地默认 origin、端口及卷：`http://localhost:8080`，仅绑定回环地址。现有 Compose 的数据库初始化约定保持兼容；k3s 则强制区分数据库管理员与应用角色。

```sh
docker build -t nebuctf/terminal:local deploy/terminal
docker build -t nebuctf/traffic:local deploy/traffic
docker compose up -d --build
# 小内存开发机改用：
# docker compose -f compose.yaml -f deploy/compose.small.yaml up -d --build
docker compose ps
node scripts/admin.mjs
```

六个服务都必须运行。API、Scheduler、Runtime、gateway 使用同一个 `nebuctf-platform:local` 镜像，只 Runtime 挂载 Docker Socket。Scheduler 与 Runtime 均有独立健康文件和 120 秒停止宽限。Web 的 `/etc/nginx/conf.d` 是 uid/gid 101 的 tmpfs，入口脚本从模板生成配置；默认 `NGINX_RESOLVER=127.0.0.11`、`NGINX_TRUSTED_PROXY_CIDR=127.0.0.1/32`。

管理员命令通过 stdin 传入资料，密码不回显。无需本机 Node 时使用 `docker compose exec -T api node dist/cli.js admin`，输入一行含 `username`、`email`、`password` 的 JSON 后 Ctrl-D；这个方式会回显，不要在共享屏幕执行。密码至少 8 位，已有邮箱不能被静默提升或覆盖。

正式 HTTPS 部署由外层反向代理终止 TLS，`APP_ORIGIN` 必须精确匹配外部 origin，并设置 `COOKIE_SECURE=true`；HTTPS Cookie 使用 `__Host-nebu_session`，无 Domain 属性。API、数据库、Scheduler、Runtime 不发布宿主端口。gateway 仅发布回环 8081。Runtime 用户 1000 需要 Socket 所属组权限，不能把 Socket 改为 0666。附件与采集文件由 uid 1000 读写。

## k3s 平台 + Docker 执行域（tencent-sh）

### 固定拓扑与权限边界

公开 origin 是 `http://101.34.76.52:61001`，`COOKIE_SECURE=false`。Traefik 保留标准 80/443，额外监听 legacy 61001；无 host 条件的 Ingress 支持 IP 访问，未配置 TLS、自动跳转或虚构证书。443 监听不代表当前站点已启用 HTTPS。

Traefik Service 使用 `externalTrafficPolicy: Local` 保留客户端地址，并禁用 LoadBalancer 的 NodePort 分配，避免与题目端口池 `30000-50000` 重叠。已有 Traefik Service 切换此设置时，需要显式清除旧 `spec.ports[].nodePort`；仅改 `allocateLoadBalancerNodePorts` 不会释放旧分配。

| 组件 | 固定地址/路径 |
| --- | --- |
| 单节点 / Pod CIDR / Service CIDR | `tencent-sh` / `10.42.0.0/16` / `10.43.0.0/16` |
| PostgreSQL | `platform-data/postgres`，ClusterIP `10.43.0.20:5432` |
| Pod 数据库 URL 主机名 | `postgres.platform-data.svc.cluster.local` |
| Docker 管理桥 | `nebuctf_management`，Linux 接口 `nebu-mgmt`，`172.31.80.0/24`，宿主 `.1` |
| Runtime / gateway | `172.31.80.3` / `172.31.80.4`，容器名 `nebuctf-worker` / `nebuctf-gateway` |
| API → 终端 Runtime | `TERMINAL_WORKER_URL=ws://172.31.80.3:8082`，不发布宿主 8082 |
| Docker → 数据库 | `DATABASE_URL` 必须指向 `10.43.0.20:5432`，不依赖 Kubernetes DNS |
| data | `/srv/nebuctf/data` → API 与 Runtime 的 `/data`，uid/gid 1000 |
| traffic | `/srv/nebuctf/traffic` → API 只读 `/captures`、Runtime 可写 `/captures`，uid/gid 1000 |
| web-assets | `/srv/nebuctf/web-assets` → Web `/var/cache/nebuctf`，uid/gid 101 |
| PostgreSQL 数据 | `/srv/platform/postgres` → `/var/lib/postgresql/data`，Alpine uid/gid 70 |

PV 是显式绑定、`Retain`、限定节点名的 local PV，不是跨节点共享存储或备份。PostgreSQL/data/traffic/web-assets 分别声明 12/16/8/2 GiB，共 38 GiB，为当前磁盘上的镜像、系统及后续项目保留余量。声明容量不是目录磁盘限额，四个目录可共用一个文件系统，须监控真实可用空间。API 的 data PVC 可写、captures PVC 只读；Scheduler 没有业务卷。Docker 名为 `nebuctf_traffic` 的卷必须使用 local bind driver 指向同一个 `/srv/nebuctf/traffic`，否则采集容器和 API 看到的文件会不一致。已有同名普通 Docker 卷不能原地更换 driver options；停掉旧执行域、备份并迁移后再移除旧卷元数据，不能删掉迁移后的目录。

命名空间启用 restricted Pod Security；每个服务用独立 ServiceAccount，默认和专用账号都禁用 token 自动挂载，不创建任何 Role/RoleBinding。容器非 root、只读根文件系统、drop ALL、RuntimeDefault seccomp，无 hostPath/hostNetwork/Docker Socket。Web 使用 fsGroup 101 的空内存卷生成 `/etc/nginx/conf.d/default.conf`，与 Compose 的 tmpfs 行为一致。

Nginx 的动态 resolver 不使用 Pod 的 DNS search 列表。k3s Web 必须配置 `NGINX_API_UPSTREAM=api.nebuctf.svc.cluster.local:3000`；Compose 默认是 `api:3000`。两种部署复用同一模板镜像，不硬编码服务 IP。

NetworkPolicy 默认拒绝两边命名空间 ingress/egress，只开放：Traefik Pods → Web:8080、Web → API:3000、API/Scheduler → PostgreSQL:5432、API → Runtime `.3:8082`、集群 DNS。数据库另允许 Docker `.3/.4` 及可能 SNAT 的桥宿主 `.1` 访问 5432。API 的邮件/既有 AI 上游允许公网 TCP 80/443/25/465/587，排除私网、保留地址和本机公网 IP；私网或自定义端口上游必须单独加入精确策略，不能放开所有私网。

**Pod 策略不保护 Docker 题目和宿主，也不能代替宿主防火墙。** k3s API 监听 `0.0.0.0` 以支持 CoreDNS 等集群内客户端；安装前必须先用宿主规则限制 6443/10250 只接受回环和本机 Pod CIDR，禁止公网/VPC 非授权访问，保护 `/etc/rancher/k3s/k3s.yaml`（0600），不发布数据库端口。Docker 执行域必须额外阻止题目访问宿主、Pod/Service CIDR、管理桥、云元数据及其他项目；仅保留必要已建立流量和指定题目入口。宿主转发规则需允许平台 Pod → Runtime:8082、Runtime/gateway → DB ClusterIP:5432 及 Flannel/Traefik 正常流量，不能用一条无条件 ACCEPT 绕过隔离。跨 Docker/kube-proxy 的源地址可能被 SNAT，必须由部署者实际验证；节点本机流量本身不受 Pod NetworkPolicy 的完整隔离保证。

### 初次部署与精确顺序

以下命令在目标 Debian 13 amd64 主机以 root 执行，工作目录是仓库根目录；其他平台先自行安装兼容的 Docker/Compose、k3s、kubectl/kustomize。端口 80/443/61001 须未被旧代理占用。仓库 bootstrap 固定 k3s `v1.37.2+k3s1`、校验二进制及 airgap 包、设置 sysctl/数据目录/Docker 地址池和系统预留，并在 k3s 启动前安装宿主隔离规则。保持内置 Traefik、ServiceLB、网络策略控制器开启；不要使用 `--disable-network-policy`。k3s 是独立 containerd，不能因为 Docker 中有镜像就认为 Pod 也有。节点配置由 `deploy/bootstrap-k3s-node.sh` 生成到 `/etc/rancher/k3s/config.yaml`，不作为 Kubernetes 资源 apply。

下面 image 替换命令需要独立 `kustomize` CLI；`kubectl apply -k` 本身使用 kubectl 内置 Kustomize。bootstrap 安装 Docker/Compose 和 k3s，不会安装独立 kustomize CLI。也可由发布工具修改根 `deploy/k3s/kustomization.yaml` 的两个 image tag，其他清单无需手工替换。

```sh
NODE_NAME=tencent-sh NODE_IP=10.0.16.2 sudo -E sh deploy/bootstrap-k3s-node.sh
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
# bootstrap 将 firewall.sh 和 k3s-host-firewall.sh 安装到 /usr/local/lib/nebuctf，
# Docker ExecStartPost 在 daemon 重启时重建隔离规则。
kubectl apply -k deploy/k3s/bootstrap
```

若目标机直连 GitHub 严重限速，可在可信机器下载同一版本的 `k3s` 和 `k3s-airgap-images-amd64.tar.zst`。按 bootstrap 中固定 SHA-256 校验后，将二进制安装到 `/usr/local/bin/k3s`（0755），镜像包放到 `/var/lib/rancher/k3s/agent/images/`，再运行同一 bootstrap；已有匹配版本和镜像包会复用，镜像包仍校验哈希。不要换用未知镜像站或跳过校验。

迁移时在这里恢复附件/流量/旧版静态资源（保留原 uid/gid/权限），数据库逻辑备份不能直接放进 PGDATA。下面使用外部受保护文件作为真实 Secret 输入，均须先由部署者生成/迁移，文件权限 `0600`，不放进仓库：

| 文件 → Secret | 内容 |
| --- | --- |
| `/root/nebuctf-secrets/postgres-admin.env` → `platform-data/postgres-admin` | `POSTGRES_PASSWORD`，独立随机管理员密码 |
| `/root/nebuctf-secrets/api.env` → `nebuctf/api-secrets` | `DATABASE_URL`、迁移的 `APP_SECRET` |
| `/root/nebuctf-secrets/scheduler.env` → `nebuctf/scheduler-secrets` | 同应用角色的 `DATABASE_URL`、完全相同的 `APP_SECRET` |
| `/root/nebuctf-runtime.env` → Docker Compose 插值 | 从 `deploy/k3s/runtime.env.example` 复制后填入真实配置 |

Pod URL 用 DNS 主机名，Docker URL 用固定 `10.43.0.20`；用户/数据库均是 `nebuctf`。密码若非十六进制须 URL 编码。管理员是 `postgres`，绝不把管理员密码/URL交给应用。`POSTGRES_PASSWORD` 仅初始化空 PGDATA；修改 Secret 不会改变已有数据库密码，轮换须同时执行数据库 `ALTER ROLE`。

```sh
kubectl -n platform-data create secret generic postgres-admin \
  --from-env-file=/root/nebuctf-secrets/postgres-admin.env --dry-run=client -o yaml | kubectl apply -f -
kubectl -n nebuctf create secret generic api-secrets \
  --from-env-file=/root/nebuctf-secrets/api.env --dry-run=client -o yaml | kubectl apply -f -
kubectl -n nebuctf create secret generic scheduler-secrets \
  --from-env-file=/root/nebuctf-secrets/scheduler.env --dry-run=client -o yaml | kubectl apply -f -
# 数据库镜像须在首次启动前可用；与应用镜像不同，它也允许直接拉取。
docker pull postgres:17-alpine
docker save -o /root/nebuctf-postgres-image.tar postgres:17-alpine
sudo k3s ctr images import /root/nebuctf-postgres-image.tar
kubectl apply -k deploy/k3s/database
kubectl -n platform-data rollout status statefulset/postgres --timeout=300s
kubectl -n platform-data exec -it postgres-0 -- psql -U postgres -d postgres
```

在首次、空数据库的交互 psql 中执行下列初始化（迁移脚本已建立角色/库时不要重复创建）。`\password` 安全提示输入与应用 Secret 一致的密码，不能把明文写进 shell 命令或提交 SQL 文件：

```sql
CREATE ROLE nebuctf LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
\password nebuctf
CREATE DATABASE nebuctf OWNER nebuctf;
REVOKE ALL ON DATABASE nebuctf FROM PUBLIC;
\connect nebuctf
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO nebuctf;
\quit
```

迁移逻辑备份在启动平台前恢复：

```sh
kubectl -n platform-data exec -i postgres-0 -- \
  pg_restore -U postgres -d nebuctf --role=nebuctf --no-owner --no-privileges --exit-on-error < /root/nebuctf.dump
```

`pg_restore` 目标必须为空且 PostgreSQL 主版本兼容；先检查备份是否完整、所有表/序列归应用角色。不要恢复旧集群的 globals 来把应用角色重新变为 superuser。应用启动会幂等迁移，首次升级先仅启动 API 完成迁移，随后才启动 Scheduler/Runtime。全新安装无 dump 时跳过恢复。

```sh
: "${RELEASE:?set an immutable release identifier}"
docker build --target api -t "nebuctf-api:$RELEASE" .
docker build --target web -t "nebuctf-web:$RELEASE" .
docker save -o /root/nebuctf-images.tar "nebuctf-api:$RELEASE" "nebuctf-web:$RELEASE"
sudo k3s ctr images import /root/nebuctf-images.tar
docker build -t nebuctf/terminal:local deploy/terminal
docker build -t nebuctf/traffic:local deploy/traffic
# 题目镜像也在 Docker 中预拉取/导入，且符合 IMAGE_PREFIXES。
(cd deploy/k3s && kustomize edit set image "nebuctf-api=nebuctf-api:$RELEASE" "nebuctf-web=nebuctf-web:$RELEASE")
```

构建、导入镜像的架构必须匹配目标节点；不需要 Registry，也不自动把题目镜像导入 containerd。后端/Web 镜像 `imagePullPolicy: Never`，缺少本地准确 tag 会真实失败，不会拉取伪造替代品。

已有数据库升级前先停止旧 API/Scheduler/Runtime，并使用仓库内 `api-first` Kustomization：它继承根目录 image 设置，只把 Scheduler/Web 副本降为 0。API 启动迁移并 ready 后再 apply 根目录恢复常态副本；不需要临时手改清单或缺省的外部 overlay。

```sh
kubectl apply -k deploy/k3s-api-first
kubectl -n nebuctf rollout status deployment/api --timeout=300s
kubectl apply -k deploy/k3s
# 根目录 apply 恢复 Scheduler/Web；API 镜像和配置不变。
kubectl -n nebuctf rollout status deployment/scheduler --timeout=300s
kubectl -n nebuctf rollout status deployment/web --timeout=300s
# runtime.env 中的 NEBUCTF_RELEASE 必须与上面 RELEASE 完全相同。
docker compose --env-file /root/nebuctf-runtime.env -f deploy/runtime-compose.yaml up -d
docker compose --env-file /root/nebuctf-runtime.env -f deploy/runtime-compose.yaml ps
```

完整根目录 Kustomization 会包含 bootstrap/DB/platform，供后续声明式更新；**首次启动顺序是宿主准备 → bootstrap → 外部 Secrets → database → 建角色/恢复 → 镜像与平台配置 → API 迁移 → Scheduler/Web → Docker 执行域**。`api`、`scheduler`、`web` Deployment 均为单副本 Recreate，Scheduler 不监听端口，因此不创建无意义的 Service。API/Web Service 分别名为 `api`/`web`，Web 通过完整集群 DNS 访问 API。不要扩容 Runtime；Scheduler 可依赖独立选主故障转移，但此小机配置保持一副本。

更新 ConfigMap/Secret 后必须重启对应 Pod/容器，环境变量不会热更新。管理员初始化可用 `kubectl -n nebuctf exec -i deployment/api -- node dist/cli.js admin`，输入方式与 Compose 相同。检查 `/api/health`、Scheduler 健康文件、Runtime 健康文件和管理端资源心跳；实际验证 HTTP origin、会话、榜单 WS、附件、终端 WS、TCP 范围及域名题。不要把资源 apply 成功当成业务验证成功。

### 预算、迁移与回滚

4 核约 3.64 GiB 主机的 Pod requests 合计 375m CPU / 576 MiB，limits 合计 2.75 CPU / 1184 MiB；Docker Runtime/gateway 上限另计 1.25 CPU / 352 MiB。题目池初始继承源端 `MAX_INSTANCES=2`、`MAX_CPU=1000`、`MAX_MEMORY=512`，还须为 k3s、Docker、文件缓存及 SSH 留足余量。Pod ResourceQuota 不约束 Docker 题目，应用配额不约束系统总内存，limits 也不意味着这些组件可同时长期满载。不要在缺少容量观测时提高副本或题目配额。

本机预演中，Python 示例容器用 500m CPU / 256 MiB 完成比赛题目、Flag 及抓包链路；100m / 64 MiB 组合触发镜像的 3 秒健康检查超时（无 OOM）。不同题目镜像须自行确认可用配额，不能把最低可填值当作示例的运行预算。

从 huawei-sh 切换到 tencent-sh：

1. 保留旧镜像和回滚配置，维护公告后阻止新写入，先停止旧 Scheduler/API，再让旧 Runtime 完成已排队清理并优雅停止，最后停止旧 gateway/Web。确认活跃实例/判题为零；有活跃 Docker 资源时先回收，不搬运运行中的题目容器。
2. 在旧 Runtime/API 都停止后生成一致性 `pg_dump -Fc`，复制全部 data、traffic、web-assets 与原 `APP_SECRET`；把数据库密码、环境、版本、所有者及校验结果保存在受保护备份中。不要公开上传 `.env` 或 kubeconfig。
3. 按初次顺序初始化新数据库并以 `--role=nebuctf --no-owner` 恢复；旧应用若曾是 superuser，不继承其权限。保留原端口范围 `30000-50000`、`CHALLENGE_BIND=0.0.0.0`、`CHALLENGE_DOMAIN=labs.localhost`、`DOMAIN_SCHEME=http`，将 origin/题目公网主机改成 `101.34.76.52:61001` / `101.34.76.52`。
4. 仅启动新执行域，核验防火墙与完整业务，再开放新 origin。旧主机保持停止且不可写，不能为“试运行”让两套 Scheduler/Runtime 连接同一份业务库。此 IP-origin 切换不会自动迁移旧 origin 的浏览器 Cookie。
5. 回滚先停止新 API/Scheduler/Runtime/gateway 并禁止新写入。若切换后有有效写入，先在维护窗口确定权威数据、导出并向旧端迁回一致 DB+文件；绝不能直接启动过期旧库形成分叉。程序/迁移不兼容则配套恢复切换前数据库、文件、密钥与旧镜像，明确接受备份后的数据损失，再恢复旧 origin。

普通发布不要删 PVC/PV 或执行 `down -v`。PV Retain 后删除/重建 PVC 会保留旧 claim UID，须由管理员确认数据路径和绑定关系后显式重新绑定，不能依赖自动回收。节点故障需要手动恢复本地目录、原节点名/新 nodeAffinity 和数据库，再启动平台；不是 HA。

### 添加独立项目

每个非 CTF 项目建立独立命名空间、专用无 token ServiceAccount、restricted Pod Security、ResourceQuota、默认拒绝策略及只允许自己的 Ingress/DB 路径。由数据库管理员为项目创建独立 LOGIN 角色和 OWNER 数据库，撤销 PUBLIC 数据库/公共 schema 权限，只授予该项目命名空间的精确客户端策略；项目 Secret 只含本项目凭据，不能复用 `nebuctf` 或管理员角色。共享 PostgreSQL 可复用 `10.43.0.20`，但新增策略须同时限制 namespaceSelector 与 podSelector，不得开放整个 Pod CIDR 到 DB。

不要为其他项目授予 Docker Socket 或接入 `nebuctf_management`/题目桥；数据库与管理端口继续不公开。新增执行不可信代码的项目应独立 VM/Docker daemon，不能把共享单节点命名空间或此 gateway 视为强租户隔离。每个项目需独立备份/恢复和资源预算，不安装 Registry 或 Agent 评测来作为本部署前置。

## 登录与战队安全验证

登录、注册、创建和加入战队默认要求计算验证码。新版采用有界 SHA-256 目标求解：服务端随机选择 0–16383 的 nonce，客户端最多尝试 16384 次，避免随机前导零搜索的长尾。原 `CAPTCHA_DIFFICULTY` 配置已移除，现有环境可删除该变量。浏览器从点击起至少 500 ms 后显示通过，正常网络与设备目标为 0.5–1 秒；不保证慢网、后台标签页或极慢设备的上限。无需第三方账号、站点密钥或部署域名，HTTP 与 HTTPS 都能运行。

浏览器使用 [noble-hashes](https://github.com/paulmillr/noble-hashes) 的 SHA-256，计算放在独立 Worker，页面仍可操作；Worker 静态资源需与前端一同部署，并由同源 CSP 允许加载。PoW 增加自动请求的成本，平台同时保留频率限制。

迁移 17 添加的 `captcha_uses` 表及过期索引继续用于跨 API 实例的一次性消费，本次无需数据库迁移。发布前备份数据库，API 与 Web 一同更新；签名协议升级到版本 2，旧前端页面需刷新、未消费的旧证明需重新计算。API 详情见 [计算验证码](API.md#计算验证码)。

## 题目访问：端口与泛域名

同一部署、同一比赛内可以混用两种模式，管理员在每道题的「访问方式」选择。

| 模式 | 用途 | 路由与隔离 |
| --- | --- | --- |
| 宿主机端口 | Pwn / TCP / HTTP | Docker 分配端口，显示 `CHALLENGE_HOST:端口`；每实例独立网络 |
| 泛域名代理 | HTTP / WebSocket | 显示 `https://实例UUID.CHALLENGE_DOMAIN`；不发布题目端口，网关接入每个实例的 internal 网络 |

当前域名代理以 HTTP 连接题目内部端口，外部 HTTPS 在反向代理终止。不是任意 TCP/SNI 代理，不支持 UDP、多端口题目或容器内部 HTTPS；这些场景需要后续扩展。

### 端口模式

设置 `CHALLENGE_HOST` 为靶机主机的域名或 IP；本地测试默认 localhost。对外访问时设置 `CHALLENGE_BIND=0.0.0.0`，并确认云安全组允许访问。`CHALLENGE_PORT_RANGE=30000-50000` 将端口模式限制在该范围内；留空则沿用 Docker 的默认分配范围。范围必须有序且位于 1024–65535 内。

平台将范围交给 Docker 的端口分配器，由 Docker 为每个实例占用一个空闲 TCP 端口，并发创建不会重复占用同一端口。池满时环境创建失败，释放实例后端口可复用。该配置适用于公共、专属和管理员测试环境，域名环境与附件生成器不发布端口。它不修改安全组、宿主防火墙或系统临时端口范围。

无域名、固定端口及小内存开发服务器的完整配置见 [远程开发](REMOTE_DEVELOPMENT.md)。

发布端口可能绕过某些 UFW 规则，应使用 Docker 官方支持的防火墙链。`deploy/firewall.sh` 提供 Linux iptables 后端的出站封锁：阻断端口题目主动发起的连接，保留已建立连接的响应，并阻止题目访问宿主服务。它只匹配本平台创建的桥接接口；需要运维明确执行并持久化。Docker Desktop 或 nftables 后端不能直接照用这份脚本。

```sh
sudo sh deploy/firewall.sh
```

### 泛域名模式

1. 准备独立靶机域，例如 `labs.example.net`，尽量与平台使用不同的可注册域。
2. 添加 `*.labs.example.net` 的 A 记录到反向代理公网 IP；配置 IPv6 时同时验证 AAAA 和防火墙。
3. 通过 DNS-01 或已有证书体系取得 `*.labs.example.net` 的通配符证书。证书不会由平台自动申请。
4. `.env` 设置 `CHALLENGE_DOMAIN=labs.example.net`、`DOMAIN_SCHEME=https`。
5. 修改并启用 `deploy/domain-proxy.conf` 的域名和证书路径。示例假设 Nginx 运行在宿主机，转发到回环地址 `127.0.0.1:8081`，保留 Host 和 WebSocket Upgrade。
6. `docker compose up -d`，题目选择「泛域名代理」，内部端口填写题目 HTTP 服务监听端口。

网关仅识别严格 UUID 子域名，只查询 running 且未过期的 domain 实例；不接受客户端指定上游 IP。它移除平台 Cookie、伪造的转发头和代理认证头。WebSocket 连接到期会关闭。普通 HTTP 请求最大 20 MiB，最长 5 分钟，空闲上游超时 30 秒。

每个域名实例网络仅含该题目与网关。网关没有 Docker Socket；Worker 根据受信任的 `io.nebuctf.gateway=true` 标签连接它。域名网络为 internal，无默认公网出口；应仍应用宿主 INPUT 防火墙阻止访问桥接网关地址。单个受信任网关同时连接多个题目网络，不能把它当作 VM 级隔离边界。

当前支持单 Docker 调度域、单 gateway 容器，名称固定 `nebuctf-gateway`。请勿在同一 Docker daemon 上部署多个同名栈或直接扩容 gateway。独立 Worker 主机部署时，gateway 也必须运行在该靶机 Docker daemon；平台 API 与数据库可另行部署并通过受控私网连接。

### 网络地址池

每个环境占用一个网络，Docker 默认地址池可能先于实例数上限耗尽。`deploy/daemon.example.json` 是专用主机的地址池示例，必须检查与 LAN/VPN/云 VPC 不冲突后合并进 daemon 配置。修改 daemon 需要维护窗口重启 Docker，不应直接覆盖已有配置。

## 资源配额与回收

`MAX_INSTANCES` 是全局活跃任务数；`MAX_CPU` 单位毫核；`MAX_MEMORY` 单位 MiB；`MAX_OWNER_INSTANCES` 约束个人或战队。配额计入 queued、starting、running、ready、stopping，只有清理成功后才释放，避免启动竞态透支资源。ready 附件仍占用预约额度，属于保守的容量策略。

单实例可配置 100–4000 毫核、32–4096 MiB、60–7200 秒；固定 PID 128、日志 2 × 1 MiB、nofile 1024、临时空间 32 MiB。根目录只读，不提供宿主挂载或特权模式。

动态环境累计最长 4 小时，且不超过比赛结束。公共环境由管理员启动，练习场最长 7 天、比赛中不超过结束时间；同一题目/赛场共享实例。排队时间也计入有效期。

Runtime（Compose 服务名 worker）持有 PostgreSQL 会话级执行锁 `760003`，最多并行创建 4 个资源。每 2 秒处理过期/停止任务，每约 30 秒对账 Docker；异常 starting 任务在 2 分钟后重试。生成附件期间不会阻塞正常环境回收。Scheduler 单独持有 `760004`，负责定时发布、提醒、tickRounds 和 sessions/rate_limits/captcha/email/ai 保留清理，无 Docker 权限。Runtime 中断期间 Docker 本身不提供 TTL，必须监控其健康与宿主资源。

## 备份和恢复

需要同时备份数据库、完整 data/files、traffic、web-assets 和原 APP_SECRET，以及受保护的部署配置/版本。k3s 的路径见拓扑表；Compose 为对应命名卷。更换 APP_SECRET 会使静态 flag 摘要和动态 flag 失效。数据库备份不包含原始 flag 或用户密码明文。

```sh
mkdir -p backups
docker compose exec -T db pg_dump -U nebuctf -d nebuctf -Fc > backups/nebuctf.dump
# k3s 替代命令：kubectl -n platform-data exec postgres-0 -- pg_dump -U postgres -d nebuctf -Fc > backups/nebuctf.dump
# 维护窗口停止 API/Scheduler/Runtime 写入后，备份完整数据、采集和资源归档卷。
```

恢复应先在独立测试栈验证数据库与文件匹配，再维护窗口停止 API/Scheduler/Runtime/gateway，以 `pg_restore` 恢复到空数据库。不要把 `docker compose down -v` 用于普通升级，它会删除数据卷；k3s 也不能删除 PVC 代替备份。

运行状态恢复：Worker 对账带本平台标签的 Docker 容器/网络，清理数据库中已停止或不存在的资源，并为运行中的域名题重新连接重建后的 gateway。

## 监控与故障定位

- Compose：`docker compose logs --tail=100 api scheduler worker gateway`。k3s：分别查看 `kubectl -n nebuctf logs deployment/api` / `deployment/scheduler`；Docker 执行域使用 `docker compose --env-file /root/nebuctf-runtime.env -f deploy/runtime-compose.yaml logs --tail=100 runtime nebuctf-gateway`。日志不应包含密码、flag、Cookie。
- `/api/health`：数据库连通；Runtime heartbeat：最后一次成功访问 Docker 并调度的时间；Scheduler `/tmp/scheduler-health` 表示循环健康，不能替代 Runtime 心跳。
- 管理中心 → 资源：预约用量、错误和强制回收；审计：管理员变更记录。
- 队列不动：检查 Worker 健康、Docker Socket 组号、镜像是否已预拉取、镜像前缀。
- 域名 404：检查 Host、实例是否 running、TTL、访问方式、DNS；502：检查监听端口、容器用户权限和 gateway 网络。
- 创建失败：检查镜像是否依赖 root、写根文件系统或额外 capabilities。首版不允许通过管理页面放宽这些安全约束。

## 性能验证

先导入接近真实规模的数据，在测试部署执行 `BENCH_ORIGIN=http://localhost:8080 npm run benchmark`。脚本仅做只读请求，输出失败数、吞吐和 p50/p95。默认会受到 Nginx 限流；应按目标负载与多客户端真实场景设计压测。不要将本机空库或 mock 测试耗时作为生产容量结论。

API 默认连接池 20、参数化查询、唯一约束和关键索引；提交按赛场/题目/主体细粒度加锁，资源预约全局原子控制。榜单当前实时聚合，极大赛事需要依据真实压测增加缓存/物化榜单，而非直接扩大连接池。

## 镜像库存与拉取任务

管理端可发起镜像拉取，只有 Runtime 挂载 Docker Socket，API 仅操作数据库任务。升级时同步更新 API、Scheduler、Runtime、gateway 共用后端镜像和 Web，按本文先备份、停旧执行域、完成 API 迁移。镜像管理最初引入于迁移 10；Runtime 仍使用原有单执行域选主锁，不可另起一个连接相同 Docker 的独立执行器。

`IMAGE_PREFIXES` 同时约束拉取和执行，使用逗号分隔，建议以仓库命名空间及 `/` 结尾，例如 `nebuctf/,registry.example.org/ctf/`。默认 `nebuctf/`。列表每 10 秒同步允许仓库下的本地标签/digest 和题目引用；外部删除镜像也会更新为未就绪。私有仓库当前需要在 Worker 主机手动登录、预拉取；网页拉取不传 registry credentials。

拉取并发为 1，总队列上限 16，每个任务有超时和输出上限。下载使用 Docker daemon 所在主机的网络与镜像缓存，磁盘容量仍需由运维监控；容器 CPU/内存配额不等于镜像存储配额。页面关闭不终止后台下载。Worker 正常停止会中断当前拉取并记录失败，排队任务保留；重启后可从日志查看并重试。

测试环境同样受实例数量和资源总额约束，就绪后 10 分钟自动回收，最长占用 15 分钟。测试不创建正式公共环境，不自动修改题目配置。只运行活跃测试环境时允许编辑题目；已有正式实例或解题记录时继续执行原来的配置锁定规则。


## 迁移 11 与实时比赛

此次升级增加题型、独立资源、阶段计时、轮次账本、补丁任务和动态通知。升级前执行 PostgreSQL 备份；同时构建并更新 API、Scheduler、Runtime、gateway 和 Web，不混跑新旧版本。数据库迁移会将原题库定时上线转到关联比赛，保留已有解题、报名与资源记录。启动过程会重放幂等迁移，支持同题靶机与生成器并存。

WebSocket 路径为 `/api/contests/:id/activity/ws`，Nginx 已设置 Upgrade、Connection 和 75 秒读取超时。外层代理应保留 Origin、Cookie 和 Upgrade，连接超时应大于 20 秒心跳间隔；HTTPS 站点使用 wss。APP_ORIGIN 必须精确匹配公开地址，不能使用通配 Origin。

API 通过独立 PostgreSQL LISTEN 连接接收提交后的通知，连接中断自动恢复，另有共享房间定时校验。普通 HTTP API 连接池与通知连接分开。多 API 实例使用同一数据库和密钥即可接收通知；Worker 仍使用数据库租约限制为一个调度域，不宣称支持多机资源调度。

攻防判题在可信 Worker 上运行，需提前拉取基础靶机、补丁校验和巡检镜像。检查器镜像必须属于 IMAGE_PREFIXES，库存与管理页可直接查看和拉取。按各队服务与检查器预留 CPU、内存和容器数，再为同时运行的补丁任务留出资源，避免启动比赛后资源不足。配额、协议和失败行为见 [比赛规则](COMPETITION-RULES.md)。

重新创建 Gateway 后 Worker 会重新连接既有域名靶机网络；已有题目容器不属于 Compose 服务。恢复备份必须配套原版本程序及附件卷，不能仅将旧镜像启动到已经升级的数据库上。


迁移 12 增加单题和小题的 Flag 环境变量名。升级前备份数据库，同步更新 API、Scheduler、Runtime、gateway、Web；旧快照保持原有注入方式。没有新增密钥或部署配置项，变量值仍由 Runtime 使用现有 APP_SECRET 派生。示例与配置见 [单容器多 Flag](../examples/multi-flag/README.md)。


## 分组权限升级（迁移 13）

升级前备份数据库，并在隔离数据库恢复验证。迁移为 contest_groups 增加 permissions 与 challenge_permissions 两个 JSONB 字段，默认空对象在业务层解释为全部允许，不改变旧组别行为。API、Scheduler、Runtime、gateway、Web 应同步更新；不要在新 API 下长期运行旧 Runtime，否则攻防资源调度与计分不会遵守分组权限。

收回资源或查看权限后，API 将对应私有实例标为 stopping，Worker 完成回收后释放额度。已排队补丁在启动和最终提交前重验权限。公共环境继续服务其他有权限的组，已获公共地址不能按组撤回直接访问；正式隔离场景选择私有环境。

多 API 节点使用 PostgreSQL LISTEN/NOTIFY 同步配置变更，比赛动态按组复用快照。原有连接来源检查、会话撤销和每用户连接上限继续有效。共享资源池的 CPU、内存、实例数量限制仍由平台统一管理，分组权限不会提高资源配额。

## 报名审核与监控迁移（14–15）

升级前备份 PostgreSQL，API、Scheduler、Runtime、gateway、Web 使用同一版本。迁移 14 添加报名状态和审核字段，旧报名默认已通过；比赛和组别默认不要求审核。迁移 15 添加动态 Flag 指纹、作弊线索和核实历史。迁移可重复执行，不改动既有 Flag、解题记录或比赛计分规则。

API 启动时为现有仍运行 / 可下载的专属资源回填指纹；Worker 在新资源成功就绪后写入指纹。升级前已销毁的资源不会补造历史线索。WebSocket 代理沿用现有 `/api/` 升级配置，管理连接地址为 `/api/admin/contests/:id/activity/ws`。

## WriteUp 与参赛名单快照（迁移 16）

升级前备份数据库和 files 卷，同步构建并更新 API、Scheduler、Runtime、gateway、Web。迁移增加 contests.writeup、contest_members、contest_writeups 和 writeup_history；旧比赛默认关闭收集，既有报名、题目、成绩与文件不变。现有已通过/暂停报名按升级时的战队成员建立快照；历史成员未存档，不能恢复已经离队的历史名单。新报名在审核通过时冻结此名单用于 WriteUp 权限。

WriteUp 存于现有私有 files 卷，文件名为 writeup-UUID、权限 600，不需新增服务或密钥。应用使用流式限制，最高 20 MiB；Nginx 的 21m 请求上限保留 multipart 余量。反向代理另行部署时需配置相应请求大小和上传超时。导出按筛选流式生成 ZIP，每次最多 100 文件、250 MiB，不在服务器解压或执行提交内容。

文件仅保留最新版本，历史元数据存数据库。备份须同时包含数据库和 files 卷，并在停止写入或一致性快照下进行。不要只恢复数据库后假设历史文件仍可下载。收集期应监控磁盘余量，按比赛规模规划存储；未进行生产规模容量测试。


## 观战与赛后练习升级

迁移 18 增加比赛访问/报名配置、赛后报名标记和练习提交标记，并将客观题答案唯一键扩展为正式/练习两个上下文。已有比赛默认允许公开排行榜和观战大屏、公开报名、关闭赛后练习；既有提交和报名保持正式记录。

升级前备份数据库，更新 API、Scheduler、Runtime、gateway 共用后端镜像及 Web。观战复用现有 HTTP 端口和同源 WebSocket 代理，无新增端口或域名要求。Three.js 模块仅访问观战路由时加载；客户端需要支持 WebGL 2，失败时保留排行及动态。观战限流和渲染上限不是并发容量保证，生产比赛需按参赛规模另行压测。

回滚迁移 18 时，应恢复升级前数据库备份并同时恢复旧后端镜像；不要只切换旧 API 镜像，因为旧版客观题写入依赖原来的三列唯一键。备份包含账户和比赛数据，应保留为仅管理员可读。

## 交互终端

先在 Runtime 所在宿主构建工具镜像，再同步发布后端各角色和 Web（k3s 按前文导入并更新镜像）：

```sh
docker build -t nebuctf/terminal:local deploy/terminal
docker compose up -d --build api scheduler worker gateway web
```

镜像包含 bash、nc、curl、Python 3、tmux、less 和 vim。需要国内 Debian 软件源时，可给构建追加 `--build-arg DEBIAN_MIRROR=https://mirrors.huaweicloud.com`，保留 apt 的软件包签名校验。`TERMINAL_IMAGE` 可覆盖镜像名称，仍须符合 `IMAGE_PREFIXES`。

终端从底部「终端」打开，地址为 `/terminal`。每位用户最多一个活跃终端，按 250m CPU、128 MiB 内存预约资源，计入平台总量和该用户的个人环境配额。启动后计时，使用平台默认时长、续期次数和续期增量；开始/销毁共用一分钟操作冷却。文件存放在 32 MiB 的临时 HOME 中，销毁或到期即清除。关闭页面只断开连接，重连继续同一 tmux 会话。

终端不发布主机端口。浏览器经同源 `/api/terminal/:id/connect` WebSocket 连接 API，API 再用短期签名凭据连接 Worker 内部 8082 端口。API 不挂载 Docker Socket。Worker 检查用户、会话、实例归属、到期时间和容器标签，随后用固定的非 root tmux 命令打开 PTY。在线连接每 10 秒重新检查授权，网络中断显示重新连接入口。无需修改现有靶机端口范围。

迁移 27 允许终端实例不绑定题目，并增加终端所属用户和唯一活跃实例约束。回滚到不支持终端的版本前，先回收终端实例。

## 发布时保留旧版页面资源

Web 使用 `web-assets` 卷保存最近 30 天的带哈希 JS、CSS、Worker 及版本化 PDF 资源。Nginx 优先读取当前镜像，缺失时读取保留资源。新页面始终加载当前 `index.html`，已经打开的旧页面可以继续加载尚未访问过的页面模块。

首次启用这一机制前，先归档仍在运行的 Web 镜像；旧版镜像标签也可作为参数补入：

```sh
sh scripts/archive-web-assets.sh
# 可选：sh scripts/archive-web-assets.sh nebuctf-web:previous

docker compose up -d --build
```

后续容器启动会自动更新资源卷并清理超过 30 天的历史文件。不要在普通更新时删除 `web-assets` 卷。资源加载失败会显示刷新入口，不再作为应用渲染异常显示 500；平台不会自动刷新并丢弃未保存内容。

nc 靶机在题目编辑的「连接方式」中设置；前端入口为 `/terminal?target=实例 UUID`。个人终端与题目容器分别计入现有配额，练习独立靶机与终端同时使用需要个人配额至少为 2，或使用管理员已配置的不限选项。平台不会因打开终端提高配额或销毁当前靶机。HTTP 靶机继续在浏览器打开。

## 用户头像存储

迁移 28 添加 `users.avatar_id` 和 `announcements.created_by`，根据创建审计记录回填历史公告作者。头像经 sharp 处理后存于 `DATA_DIR/avatars/<UUID>.webp`，默认 `/data/avatars`，复用现有 files 数据卷。备份文件卷时保留该目录，无需新增端口或外部存储。运行时 sharp 使用与容器架构匹配的原生依赖，Docker 构建会按 lockfile 安装。

## 比赛流量采集与角色权限

采集镜像需先运行 `docker build -t nebuctf/traffic:local deploy/traffic` 构建，再更新 Compose 服务。平台默认仅开启流量统计，抓包由管理员在流量监测页面启用。新增 `nebuctf_traffic` 数据卷，无新增对外端口。每个采集任务最多 0.1 CPU / 64 MiB，并计入全局资源预算。保留时间、容量、并发及单场开关均可配置。

角色配置入口在「管理中心 → 角色与权限」，用户的权限图标可分配多个角色及指定题目、比赛的权限。现有管理员保留为超级管理员。部署、容量、权限边界和 Flag 兼容说明见[资源、流量与管理权限](RESOURCE-ACCESS-PLAN.md)。
