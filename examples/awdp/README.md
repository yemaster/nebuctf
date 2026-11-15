# AWDP：泄露接口攻防

`challenge.json` 是原始题目配置；导入包为 `examples/dist/awdp.zip`。复用 `../attack-defense/service`、`checker` 和 `patch`，不维护第二套实现。镜像故意存在漏洞，仅在隔离环境使用。

从仓库根目录构建共享镜像（不覆盖旧标签）：

```sh
docker build -t nebuctf/example-ad:example-v1 examples/attack-defense/service
docker build -t nebuctf/example-checker:example-v1 examples/attack-defense/checker
```

启动靶机，访问 `/leak`，将动态 Flag 提交到攻击小题。防守上传 `examples/dist/fix.tar.gz`：它复用共享 `patch/update.sh` 和 `patch/files/settings.py`，包根目录必须直接包含 `update.sh` 与 `files/`。

平台在 `/app` 离线以 `/bin/sh` 执行 `update.sh`，通过 `PATCH_DIR` 定位包目录；脚本只复制修复文件，不联网、不启动或重启服务。更新时限 30 秒；随后平台启动服务，检查器在 15 秒预算内验证 `/health`、`/checksum` 和 `/leak` 返回 403。主服务为 250m / 96MiB，补丁校验为 250m / 128MiB。

攻击、防守各固定 100 分。Flag 由平台动态生成，不在配置或补丁中写入秘密。防守校验使用独立环境，通过后只完成防守小题，**不会替换原攻击实例**。本题允许练习，也可加入比赛。

保留攻击实例并运行一次补丁校验，需要至少 3 个容器配额（攻击实例，加校验目标与 checker）。容量紧张时可先完成攻击并停止攻击实例，再提交补丁；示例不会修改平台资源限制。
