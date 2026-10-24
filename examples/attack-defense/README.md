# 攻防题示例

这是平台验收用的教学靶机，故意提供 `/leak`。只部署到隔离测试环境。

从项目根目录构建：

```sh
docker build -t nebuctf/example-ad:local examples/attack-defense/service
docker build -t nebuctf/example-checker:local examples/attack-defense/checker
COPYFILE_DISABLE=1 tar --format=ustar -czf /tmp/nebuctf-example-patch.tar.gz -C examples/attack-defense/patch settings.py
```

使用 `ustar` 避免 macOS 自动写入扩展头。生成包里直接包含 `settings.py`，不要多套一层 `patch` 目录。

新建 AWDP 题，配置私有靶机：镜像 `nebuctf/example-ad:local`，端口 8080，CPU 250 毫核，内存 64 MiB。补丁校验镜像为 `nebuctf/example-checker:local`，覆盖目录 `/app`，超时 15 秒，CPU 250 毫核，内存 128 MiB。配置攻击和防守两个小题的分值，保存并启用。

选手启动靶机后，访问 `/leak` 取得该队攻击 Flag，提交后只完成攻击小题。上传刚生成的补丁包，平台构建后先检查 `/health` 和 `/checksum`，再确认 `/leak` 返回 403，通过后完成防守小题。原攻击靶机不因此替换。

测试 AWD 时新建 AWD 题，使用相同基础与补丁配置，服务巡检镜像同样使用 `nebuctf/example-checker:local`。将题目加入比赛，选择轮次计分，例如每轮 60 秒、Flag 有效 1 轮、攻击 100 分、防守 100 分、可用性 100 分。实操阶段使用固定时间，至少注册两支战队。

开赛后平台自动部署各队服务。选手在对抗区访问对手地址的 `/leak` 并提交所得 Flag；自己的 Flag 不计分。提交修复包并通过后，本队服务替换为修复版本，`/leak` 变为 403，`/health` 和 `/checksum` 仍正常。可在轮次结束后核对攻击、防守和可用性明细。

独立验收命令（使用内存数据库，不写正式赛题或积分）：

```sh
TEST_DOCKER=1 npx tsx --test apps/api/test/attack-defense-docker.test.ts
```

此测试会运行临时容器、网络和补丁镜像，需访问 Docker Socket，结束时自动回收。完整协议与限制见 [比赛规则](../../docs/COMPETITION-RULES.md)。
