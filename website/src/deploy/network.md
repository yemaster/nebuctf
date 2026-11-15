# 域名、端口与 HTTPS

平台入口、题目端口和题目域名是不同的地址。修改其中一项，不会自动修改其他项。

## 平台入口

正式站点建议由外部反向代理提供 HTTPS，再转发到 Compose 的 Web 端口。设置 `APP_ORIGIN` 为选手实际访问的完整 origin，例如 `https://ctf.example.com`；使用 HTTPS 时设置 `COOKIE_SECURE=true`。

如果反向代理位于同一主机，可保留 `HTTP_BIND=127.0.0.1`。代理必须转发 HTTP 和 WebSocket，并保留正确的 Host 与转发头。不要关闭 CSRF 检查来迁就不一致的地址。

## 题目端口直连

端口模式为每个主服务分配一个 TCP 端口。设置对外可达的 `CHALLENGE_HOST`、监听地址 `CHALLENGE_BIND`，以及防火墙允许的端口范围：

```dotenv
CHALLENGE_HOST=labs.example.com
CHALLENGE_BIND=0.0.0.0
CHALLENGE_PORT_RANGE=30000-40000
```

让 DNS 指向实际 Docker 主机，并在主机和云防火墙开放相同范围。范围需要覆盖预期并发环境，不能与其他服务占用端口冲突。

主服务需要监听容器内的 `0.0.0.0:配置端口`。仅监听 `127.0.0.1` 会导致容器外无法连接。

## 泛域名 HTTP/WebSocket

为 `*.labs.example.com` 配置 DNS 和通配符 TLS 证书，将请求转发到题目网关，并保留原 Host：

```dotenv
CHALLENGE_DOMAIN=labs.example.com
DOMAIN_SCHEME=https
GATEWAY_HTTP_PORT=8081
```

网关通过运行中的实例记录查找目标，不接受客户端指定任意后端地址。题目内部提供明文 HTTP，WebSocket 升级由代理继续转发。原始 nc/TCP 服务应使用端口直连。

## 隔离与对外验证

Docker bridge 本身不能替代完整的宿主防火墙。按仓库部署脚本配置题目网络与管理网络隔离，检查规则是否适合目标主机的网络和地址池，再开放比赛。

从选手实际使用的网络分别测试平台页面、一个 HTTP 题、一个 nc 题以及 WebSocket。只在服务器本机 curl 成功，不能证明公网 DNS、证书和防火墙配置正确。
