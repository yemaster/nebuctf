# AWD：轮换 Flag 服务对抗

`challenge.json` 是原始题目配置；导入包为 `examples/dist/awd.zip`。复用 `../attack-defense/service`、`checker` 和 `patch`，不维护第二套实现。镜像故意存在漏洞，仅在隔离环境使用。

从仓库根目录构建共享镜像（与 AWDP 相同，无需重复构建）：

```sh
docker build -t nebuctf/example-ad:example-v1 examples/attack-defense/service
docker build -t nebuctf/example-checker:example-v1 examples/attack-defense/checker
```

AWD 不开放练习、没有攻击/防守小题。导入后必须加入比赛，至少两支已注册战队，实操阶段采用固定起止时间。题目配置不携带比赛设置；在比赛题目的 `scoring` 中选择 `mode: "round"`，将 `points` 设为 `{ "initial_points": 100, "minimum_points": 100, "decay": 20 }`，`round` 设为：

```json
{
  "dynamic": false,
  "carry": true,
  "flag_lifetime": 1,
  "defense_points": 100,
  "availability_points": 100
}
```

比赛的 `round_duration` 可设为 60 秒。以上设置表示固定攻击 100 分、每轮防守和可用性各 100 分、Flag 有效 1 轮、积分累计；这些是比赛字段，不能放进 `challenge.json`。本题默认攻击基础分已设为固定 100 分。

开赛后平台部署每队独立实例，并将每轮动态 Flag 写入 `/run/nebuctf/flag`。共享服务每次请求读取该文件，无需重启即可轮换；文件不存在时才回退到 `FLAG` 环境变量。配置不含固定秘密，也无需自行配置 Flag 文件字段。访问对手服务的 `/leak` 并提交有效 Flag，自己的 Flag 不计分。

修复包为 `examples/dist/fix.tar.gz`，复用共享 `patch/update.sh` 与 `patch/files/settings.py`，包根目录直接包含 `update.sh` 和 `files/`。平台在 `/app` 离线以 `/bin/sh` 执行更新（30 秒），随后检查 `/health`、`/checksum` 和 `/leak` 返回 403（15 秒）。脚本通过 `PATCH_DIR` 取文件，不联网、不启动或重启服务。**AWD 修复通过后会替换本队实例**，不同于 AWDP 只校验防守小题；替换后仍继续 Flag 轮换和可用性巡检。

主服务为 250m / 96MiB，补丁校验为 250m / 128MiB。`awd_config` 只接受巡检镜像和超时；轮次巡检复用相同 checker，平台为它预留 250m / 128MiB，不在该对象编造资源或轮次字段。

两队同时运行至少需要 4 个容器配额、1000m CPU、448MiB（每队服务及可用性 checker）。并发一次补丁校验还需额外 2 个配额、500m CPU、224MiB，总计至少 6 个配额、1500m CPU、672MiB，且未计其他负载。请使用容量充足的隔离验收环境，示例不会提高生产限制。
