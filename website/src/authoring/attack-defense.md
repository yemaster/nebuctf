# AWDP 与 AWD

AWDP 同时考察攻击和修复，AWD 还维护战队的在线服务和轮换 Flag。两种题型都需要真实的功能检查，不能只判断端口是否开放。

## AWDP 流程

选手在攻击环境中获取 Flag，攻击与防御分别计分。防御时上传修复包，平台构建临时修复镜像，依次执行功能检查和防御检查。全部通过后记录防御结果，不替换原攻击环境。

## AWD 流程

每队获得自己的服务，平台按轮次写入 Flag 并执行可用性检查。修复包通过后替换本队服务，其他队伍不受影响；以后重启继续使用最后通过的修复镜像。

AWD Flag 文件位于所选容器的 `/run/nebuctf/flag`，服务需要在使用时读取当前值，不应只在启动时缓存。Flag 有效期、轮次时长与积分在比赛规则中设置。

## 修复包

上传格式是 tar.gz，根目录包含 `update.sh`，其他文件按脚本需要组织：

```text
patch.tar.gz
├── update.sh
└── files/
    └── settings.py
```

脚本示例：

```sh
#!/bin/sh
set -eu
cp "$PATCH_DIR/files/settings.py" ./settings.py
```

脚本在配置的工作目录运行，应修改文件后退出，不要重启服务、启动后台进程或联网安装依赖。平台通过 `PATCH_DIR` 提供解包目录，可运行示例见[攻防示例](https://github.com/yemaster/nebuctf/tree/main/examples/attack-defense)。

更新器无网络、无宿主挂载和 Docker Socket，并限制 CPU、内存、PID 与时长。更新器的文件写入权限与正式服务不同，正式服务仍以非 root、只读根方式运行。

## 检查器接口

| 环境变量 | 含义 |
| --- | --- |
| `TARGET_HOST`、`TARGET_PORT` | 待检查服务地址 |
| `EXPECTED_FLAG` | 当前校验的预期答案 |
| `CHECK_MODE` | functional、defense 或 availability |
| `CHECK_TIMEOUT` | 检查器应遵守的超时秒数 |

functional 返回 0 表示正常功能通过，返回 1 表示功能失败。defense 返回 0 表示防御通过，返回 1 表示仍能利用。availability 返回 0 表示服务正常，返回 1 表示不可用。其他非零退出码按检查器异常处理。

检查器需要验证真实业务行为，并区分「漏洞修复」与「服务关闭」。预期 Flag 只供可信检查器使用，不要将检查器或凭据复制到选手环境。

## 多容器与运行边界

校验使用题目的辅助服务和网络配置，补丁只更新主服务。逐 Flag 注入位置沿用题目设置，AWD 文件只写入选中的容器。

当前平台没有原生虚拟机靶机或特权 DinD 开关。需要 Docker 组提权等环境的题目，可以研究容器内运行 QEMU 的镜像方案，但仍需单独验证资源、启动和终端适配。
