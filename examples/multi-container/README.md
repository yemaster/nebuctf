# 多容器与隔离网络

```sh
docker build -t nebuctf/example-multi-container:example-v1 examples/multi-container
```

将 `challenge.json` 作为原始题目配置使用，或使用 examples 的统一打包入口生成导入包。启动专属靶机后，通过平台入口访问 `/flag`；`/health` 同时检查后端就绪状态。

同一镜像用 `ROLE=frontend` / `ROLE=backend` 区分角色。后端必须由平台注入非空 `FLAG`，缺失即启动失败。两容器合计 500m CPU、128 MiB 内存，非 root 运行，兼容只读根文件系统。`backend` 仅加入 internal 的 `data` 网络，无对外发布端口；主服务加入 `default` 和 `data`，通过 `backend:8080` 真实转发。

配置中的 `flag_targets: ["backend"]` 将答案仅注入后端，主服务不收到 FLAG。编辑界面在「Flag 注入」选择 backend，取消主服务即可；多小题可逐行选择不同目标。

安全提醒：这是有意公开答案的教学示例，不应作为正式赛题的漏洞设计。网络隔离不等于应用授权；前端提供的转发接口仍可访问后端数据。不要把正式 Flag 写入镜像或配置文件。
