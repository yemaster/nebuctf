# 部署与运维

## Docker Compose

要求：Linux Docker Engine 26+（API v1.45）、Compose v2；建议专用靶机 VM。平台容器默认预算约 4 GiB，另为题目资源池预留内存。开始前检查宿主网络地址池与内网无冲突。

```sh
cp .env.example .env
openssl rand -hex 32
openssl rand -hex 32
```

将两次输出分别填入 `.env` 的 `POSTGRES_PASSWORD` 和 `APP_SECRET`。密码使用十六进制可避免数据库 URL 转义问题。不要提交 `.env`。首次构建需要能访问 npm 和 Docker 镜像仓库。

```sh
# Linux 下确认 Socket 组号，并写入 .env 的 DOCKER_GID
stat -c '%g' /var/run/docker.sock

docker build -t nebuctf/terminal:local deploy/terminal
docker compose up -d --build
docker compose ps
node scripts/admin.mjs
```

最后一个命令在终端输入管理员资料，密码不回显，通过 stdin 传给容器。无需本机 Node 时，可使用以下交互命令，输入单行 JSON 后按 Ctrl-D；该方式会回显，勿在共享屏幕使用：

```sh
docker compose exec -T api node dist/cli.js admin
```

JSON 字段为 `username`、`email`、`password`，密码至少 8 位。已有邮箱不能被此命令静默提升或覆盖。

访问 `http://localhost:8080`。默认只绑定回环地址。本次已启动的测试栈及随机账号位置见 [本地测试](LOCAL_TEST.md)。正式部署通过宿主反向代理终止 TLS，将 `APP_ORIGIN` 设置为精确的外部 origin，例如 `https://ctf.example.com`，同时设置 `COOKIE_SECURE=true`。HTTPS 使用 `__Host-nebu_session`，不设置 Domain 属性。

API、数据库、Worker 不发布主机端口。数据库只在平台网络可达。Worker 用户 1000 需要 Docker Socket 对应组权限；不要通过给 Socket 设置 0666 来解决权限问题。附件卷由 uid 1000 读写。

## 登录与战队安全验证

登录、注册、创建和加入战队默认要求计算验证码。`CAPTCHA_DIFFICULTY` 为 SHA-256 前导零位数，默认 22，允许 12–22；相较原先的 18 位，平均计算量增加约 16 倍。实际耗时受设备性能和随机求解影响，不设置固定等待时间。修改后重新创建 API 容器使配置生效。无需第三方账号、站点密钥或部署域名，HTTP 与 HTTPS 都能运行。

验证方案参考 [GZCTF HashPow](https://github.com/GZTimeWalker/GZCTF/blob/develop/src/GZCTF/Services/CaptchaService.cs)，浏览器使用 [noble-hashes](https://github.com/paulmillr/noble-hashes) 的 SHA-256。计算放在独立 Worker，页面仍可操作；Worker 静态资源需与前端一同部署，并由同源 CSP 允许加载。PoW 增加自动请求的成本，平台同时保留频率限制。

迁移 17 添加 `captcha_uses` 表及过期索引，用于跨 API 实例的一次性消费，不修改账户或成绩。发布前备份数据库，API 与 Web 一同更新；旧前端页面需刷新后才能提交受保护的表单。API 详情见 [计算验证码](API.md#计算验证码)。

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

Worker 持有 PostgreSQL 会话级调度锁，单调度器最多并行创建 4 个资源。每 2 秒处理过期/停止任务，每约 30 秒对账 Docker；异常 starting 任务在 2 分钟后重试。生成附件期间不会阻塞正常环境回收。Worker 中断期间 Docker 本身不提供 TTL，必须监控 Worker 健康与宿主资源。

## 备份和恢复

需要同时备份数据库、附件卷和 `.env` 中的 APP_SECRET。更换 APP_SECRET 会使静态 flag 摘要和动态 flag 失效。数据库备份不包含原始 flag 或用户密码明文。

```sh
mkdir -p backups
docker compose exec -T db pg_dump -U nebuctf -d nebuctf -Fc > backups/nebuctf.dump
# 维护窗口停止写入后，备份 volumes 中的 files；按宿主备份系统操作。
```

恢复应先在独立测试栈验证数据库与附件匹配，再维护窗口停止 API/Worker/gateway，以 `pg_restore` 恢复到空数据库。不要把 `docker compose down -v` 用于普通升级，它会删除数据卷。

运行状态恢复：Worker 对账带本平台标签的 Docker 容器/网络，清理数据库中已停止或不存在的资源，并为运行中的域名题重新连接重建后的 gateway。

## 监控与故障定位

- `docker compose logs --tail=100 api worker gateway`：不应包含密码、flag、Cookie。
- `/api/health`：数据库连通；Worker heartbeat：最后一次成功访问 Docker 并调度的时间。
- 管理中心 → 资源：预约用量、错误和强制回收；审计：管理员变更记录。
- 队列不动：检查 Worker 健康、Docker Socket 组号、镜像是否已预拉取、镜像前缀。
- 域名 404：检查 Host、实例是否 running、TTL、访问方式、DNS；502：检查监听端口、容器用户权限和 gateway 网络。
- 创建失败：检查镜像是否依赖 root、写根文件系统或额外 capabilities。首版不允许通过管理页面放宽这些安全约束。

## 性能验证

先导入接近真实规模的数据，在测试部署执行 `BENCH_ORIGIN=http://localhost:8080 npm run benchmark`。脚本仅做只读请求，输出失败数、吞吐和 p50/p95。默认会受到 Nginx 限流；应按目标负载与多客户端真实场景设计压测。不要将本机空库或 mock 测试耗时作为生产容量结论。

API 默认连接池 20、参数化查询、唯一约束和关键索引；提交按赛场/题目/主体细粒度加锁，资源预约全局原子控制。榜单当前实时聚合，极大赛事需要依据真实压测增加缓存/物化榜单，而非直接扩大连接池。

## 镜像库存与拉取任务

管理端可发起镜像拉取，只有 Worker 挂载 Docker Socket，API 仅操作数据库任务。升级镜像管理功能时同时更新 API、Web 和 Worker；数据库迁移版本为 10，更新前按本文备份。Worker 使用原有单调度域选主锁，不可另起一个连接相同 Docker 的独立调度器。

`IMAGE_PREFIXES` 同时约束拉取和执行，使用逗号分隔，建议以仓库命名空间及 `/` 结尾，例如 `nebuctf/,registry.example.org/ctf/`。默认 `nebuctf/`。列表每 10 秒同步允许仓库下的本地标签/digest 和题目引用；外部删除镜像也会更新为未就绪。私有仓库当前需要在 Worker 主机手动登录、预拉取；网页拉取不传 registry credentials。

拉取并发为 1，总队列上限 16，每个任务有超时和输出上限。下载使用 Docker daemon 所在主机的网络与镜像缓存，磁盘容量仍需由运维监控；容器 CPU/内存配额不等于镜像存储配额。页面关闭不终止后台下载。Worker 正常停止会中断当前拉取并记录失败，排队任务保留；重启后可从日志查看并重试。

测试环境同样受实例数量和资源总额约束，就绪后 10 分钟自动回收，最长占用 15 分钟。测试不创建正式公共环境，不自动修改题目配置。只运行活跃测试环境时允许编辑题目；已有正式实例或解题记录时继续执行原来的配置锁定规则。


## 迁移 11 与实时比赛

此次升级增加题型、独立资源、阶段计时、轮次账本、补丁任务和动态通知。升级前执行 PostgreSQL 备份；同时构建并更新 API、Worker、Gateway 和 Web，不混跑新旧版本。数据库迁移会将原题库定时上线转到关联比赛，保留已有解题、报名与资源记录。启动过程会重放幂等迁移，支持同题靶机与生成器并存。

WebSocket 路径为 `/api/contests/:id/activity/ws`，Nginx 已设置 Upgrade、Connection 和 75 秒读取超时。外层代理应保留 Origin、Cookie 和 Upgrade，连接超时应大于 20 秒心跳间隔；HTTPS 站点使用 wss。APP_ORIGIN 必须精确匹配公开地址，不能使用通配 Origin。

API 通过独立 PostgreSQL LISTEN 连接接收提交后的通知，连接中断自动恢复，另有共享房间定时校验。普通 HTTP API 连接池与通知连接分开。多 API 实例使用同一数据库和密钥即可接收通知；Worker 仍使用数据库租约限制为一个调度域，不宣称支持多机资源调度。

攻防判题在可信 Worker 上运行，需提前拉取基础靶机、补丁校验和巡检镜像。检查器镜像必须属于 IMAGE_PREFIXES，库存与管理页可直接查看和拉取。按各队服务与检查器预留 CPU、内存和容器数，再为同时运行的补丁任务留出资源，避免启动比赛后资源不足。配额、协议和失败行为见 [比赛规则](COMPETITION-RULES.md)。

重新创建 Gateway 后 Worker 会重新连接既有域名靶机网络；已有题目容器不属于 Compose 服务。恢复备份必须配套原版本程序及附件卷，不能仅将旧镜像启动到已经升级的数据库上。


迁移 12 增加单题和小题的 Flag 环境变量名。升级前备份数据库，同步更新 API、Worker、Gateway、Web；旧快照保持原有注入方式。没有新增密钥或部署配置项，变量值仍由 Worker 使用现有 APP_SECRET 派生。示例与配置见 [单容器多 Flag](../examples/multi-flag/README.md)。


## 分组权限升级（迁移 13）

升级前备份数据库，并在隔离数据库恢复验证。迁移为 contest_groups 增加 permissions 与 challenge_permissions 两个 JSONB 字段，默认空对象在业务层解释为全部允许，不改变旧组别行为。API、Worker、Gateway、Web 应同步更新；不要在新 API 下长期运行旧 Worker，否则攻防资源调度与计分不会遵守分组权限。

收回资源或查看权限后，API 将对应私有实例标为 stopping，Worker 完成回收后释放额度。已排队补丁在启动和最终提交前重验权限。公共环境继续服务其他有权限的组，已获公共地址不能按组撤回直接访问；正式隔离场景选择私有环境。

多 API 节点使用 PostgreSQL LISTEN/NOTIFY 同步配置变更，比赛动态按组复用快照。原有连接来源检查、会话撤销和每用户连接上限继续有效。共享资源池的 CPU、内存、实例数量限制仍由平台统一管理，分组权限不会提高资源配额。

## 报名审核与监控迁移（14–15）

升级前备份 PostgreSQL，API、Worker、Gateway、Web 使用同一版本。迁移 14 添加报名状态和审核字段，旧报名默认已通过；比赛和组别默认不要求审核。迁移 15 添加动态 Flag 指纹、作弊线索和核实历史。迁移可重复执行，不改动既有 Flag、解题记录或比赛计分规则。

API 启动时为现有仍运行 / 可下载的专属资源回填指纹；Worker 在新资源成功就绪后写入指纹。升级前已销毁的资源不会补造历史线索。WebSocket 代理沿用现有 `/api/` 升级配置，管理连接地址为 `/api/admin/contests/:id/activity/ws`。

## WriteUp 与参赛名单快照（迁移 16）

升级前备份数据库和 files 卷，同步构建并更新 API、Worker、Gateway、Web。迁移增加 contests.writeup、contest_members、contest_writeups 和 writeup_history；旧比赛默认关闭收集，既有报名、题目、成绩与文件不变。现有已通过/暂停报名按升级时的战队成员建立快照；历史成员未存档，不能恢复已经离队的历史名单。新报名在审核通过时冻结此名单用于 WriteUp 权限。

WriteUp 存于现有私有 files 卷，文件名为 writeup-UUID、权限 600，不需新增服务或密钥。应用使用流式限制，最高 20 MiB；Nginx 的 21m 请求上限保留 multipart 余量。反向代理另行部署时需配置相应请求大小和上传超时。导出按筛选流式生成 ZIP，每次最多 100 文件、250 MiB，不在服务器解压或执行提交内容。

文件仅保留最新版本，历史元数据存数据库。备份须同时包含数据库和 files 卷，并在停止写入或一致性快照下进行。不要只恢复数据库后假设历史文件仍可下载。收集期应监控磁盘余量，按比赛规模规划存储；未进行生产规模容量测试。


## 观战与赛后练习升级

迁移 18 增加比赛访问/报名配置、赛后报名标记和练习提交标记，并将客观题答案唯一键扩展为正式/练习两个上下文。已有比赛默认允许公开排行榜和观战大屏、公开报名、关闭赛后练习；既有提交和报名保持正式记录。

升级前备份数据库，更新 API、Worker、Gateway 共用后端镜像及 Web。观战复用现有 HTTP 端口和同源 WebSocket 代理，无新增端口或域名要求。Three.js 模块仅访问观战路由时加载；客户端需要支持 WebGL 2，失败时保留排行及动态。观战限流和渲染上限不是并发容量保证，生产比赛需按参赛规模另行压测。

回滚迁移 18 时，应恢复升级前数据库备份并同时恢复旧后端镜像；不要只切换旧 API 镜像，因为旧版客观题写入依赖原来的三列唯一键。备份包含账户和比赛数据，应保留为仅管理员可读。

## 交互终端

先在 Worker 所在宿主构建工具镜像，再发布 API、Worker 和 Web：

```sh
docker build -t nebuctf/terminal:local deploy/terminal
docker compose up -d --build api worker web
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
