# 示例题目

| 目录 | 题型 | 内容 |
| --- | --- | --- |
| [dynamic-container](dynamic-container/challenge.json) | 容器题 | 专属 HTTP 靶机、动态 Flag |
| [dynamic-attachment](dynamic-attachment/challenge.json) | 动态附件题 | 生成 ZIP，Base64 解码 |
| [multi-flag](multi-flag/README.md) | 多小题 | 同一容器注入不同 Flag |
| [multi-container](multi-container/README.md) | 多容器题 | 前后端编排、DNS、隔离网络 |
| [awdp](awdp/README.md) | AWDP | 攻击提交 Flag、防守上传修复包 |
| [awd](awd/README.md) | AWD | 队伍对抗、Flag 轮换、服务修复 |

`challenge.json` 是原始出题配置。AWDP/AWD 共用 [attack-defense](attack-defense/README.md) 的服务、检查器和补丁，不重复维护镜像实现。

## 生成导入包

从仓库根目录执行：

```sh
npm ci
npm run examples:pack
# 可选输出目录：npm run examples:pack -- /tmp/nebuctf-examples
```

输出在 `examples/dist/`：每个示例一个 ZIP，以及 AWDP/AWD 共用的 `fix.tar.gz`。命令复用平台的配置校验、ZIP 格式和补丁格式，不连接数据库或创建线上题目。重复运行只替换同名生成文件；生成目录已被 Git 忽略。

在「管理中心 → 题目 → 导入」选择生成的 ZIP，不要直接上传 JSON 或整个源码目录。导入会创建新题目，默认未启用；确认资源配置后再启用。全部示例使用动态 Flag，无需填写固定答案。

## 准备镜像

在 Docker Worker 宿主机从仓库根目录构建所需镜像：

```sh
docker build -t nebuctf/example-web:example-v1 examples/dynamic-container
docker build -t nebuctf/example-attachment:example-v1 examples/dynamic-attachment
docker build -t nebuctf/example-multi-flag:example-v1 examples/multi-flag
docker build -t nebuctf/example-multi-container:example-v1 examples/multi-container
docker build -t nebuctf/example-ad:example-v1 examples/attack-defense/service
docker build -t nebuctf/example-checker:example-v1 examples/attack-defense/checker
```

题目包只带镜像引用，不带镜像文件。`:example-v1` 不覆盖既有测试使用的 `:local` 标签；镜像仍须符合平台仓库前缀策略。多容器网络使用平台配置，不需自行创建网络或运行 Compose。

## 攻防与容量

- AWDP：`fix.tar.gz` 用于防守上传，通过后不替换攻击实例。容量有限时可先完成攻击并停止攻击实例，再校验补丁。
- AWD：将题目加入比赛，使用固定实操阶段和轮次计分，至少两支战队；巡检、Flag 轮换及修复替换均由平台执行，配置见 [AWD](awd/README.md)。
- CPU、内存和容器数沿用平台配额，靶机、辅助服务、检查器都占用容量；脚本不会调整配额、创建战队或发布比赛。

这些镜像故意公开答案或保留泄露接口，仅用于隔离练习/验收。不要写入正式秘密，也不要把示例服务当作安全应用部署。
