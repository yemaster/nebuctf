# 攻防题示例

这是平台验收用的教学靶机，故意提供 `/leak`。只部署到隔离测试环境。

从项目根目录构建：

```sh
docker build -t nebuctf/example-ad:local examples/attack-defense/service
docker build -t nebuctf/example-checker:local examples/attack-defense/checker
COPYFILE_DISABLE=1 tar --format=ustar -czf /tmp/nebuctf-example-patch.tar.gz -C examples/attack-defense/patch update.sh files
```

使用 `ustar` 避免 macOS 自动写入扩展头。包根目录包含 `update.sh` 与 `files/settings.py`，不要多套一层 `patch` 目录。只接受 `tar.gz`，不接受未压缩 tar；`update.sh` 无需可执行位。

新建 AWDP 题，配置私有靶机：镜像 `nebuctf/example-ad:local`，端口 8080，CPU 250 毫核，内存 64 MiB。补丁校验镜像为 `nebuctf/example-checker:local`，执行工作目录 `/app`，更新脚本时限 30 秒，检查器超时 15 秒，CPU 250 毫核，内存 128 MiB。配置攻击和防守两个小题的分值，保存并启用。

选手启动靶机后，访问 `/leak` 取得该队攻击 Flag，提交后只完成攻击小题。在「防守」上传修复包；也可先下载示例包，再替换其中的示意文件。平台先用 `/bin/sh` 执行 `update.sh`：当前目录为 `/app`，`PATCH_DIR` 指向包目录，本示例脚本复制 `files/` 的修复文件。退出 0 后平台自动启动原服务，再检查 `/health`、`/checksum` 与 `/leak` 返回 403，通过后完成防守小题。不要在脚本内启动/重启服务或后台运行；原攻击靶机不因此替换。

更新器以 uid 0 离线运行，丢弃 capabilities、禁止提权，无网络、宿主挂载、Docker Socket 或 Flag，受资源及时间限制；基础镜像须预装 `/bin/sh` 和离线工具。正式服务仍以 uid 65534、只读根文件系统运行。

测试 AWD 时新建 AWD 题，使用相同基础与补丁配置，服务巡检镜像同样使用 `nebuctf/example-checker:local`。将题目加入比赛，选择轮次计分，例如每轮 60 秒、Flag 有效 1 轮、攻击 100 分、防守 100 分、可用性 100 分。实操阶段使用固定时间，至少注册两支战队。

开赛后平台自动部署各队服务。选手在对抗区访问对手地址的 `/leak` 并提交所得 Flag；自己的 Flag 不计分。提交修复包并通过后，本队服务替换为修复版本，`/leak` 变为 403，`/health` 和 `/checksum` 仍正常。可在轮次结束后核对攻击、防守和可用性明细。

独立验收命令（使用内存数据库，不写正式赛题或积分）：

```sh
TEST_DOCKER=1 npx tsx --test apps/api/test/attack-defense-docker.test.ts
```

此测试会运行临时容器、网络和补丁镜像，需访问 Docker Socket，结束时自动回收。完整协议与限制见 [比赛规则](../../docs/COMPETITION-RULES.md)。


结果包括更新中/Check 中、更新失败、服务异常、EXP 利用成功、防御成功和校验异常。更新脚本非零退出或超时会停止后续检查；平台不公开原始日志。检查器返回 0 表示通过，functional 返回 1 表示服务异常，defense 返回 1 表示确实读到预期 Flag；其他非零码表示检查器异常。本示例在超时、未知响应或非预期 Flag 时返回 2，不误报为漏洞利用成功。
