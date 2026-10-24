# 单容器多个 Flag

构建示例镜像：

```sh
docker build -t nebuctf/example-multi-flag:local examples/multi-flag
```

在题目编辑页选择 CTF 题、动态 Flag、多个小题，添加两个小题。每个小题的动态分数图直接显示在它的设置旁边；计分方式与衰减人数仍由整题共享。

「靶机配置」启用私有靶机，镜像填写 `nebuctf/example-multi-flag:local`，端口 8080，CPU 250 毫核，内存 64 MiB。在 Flag 注入表中设置：

| 小题 | 环境变量 |
| --- | --- |
| 入口 | ENTRY_FLAG |
| 深入 | ROOT_FLAG |

保存后启动测试靶机，或在练习/比赛中启动专属靶机。服务从 `os.environ['ENTRY_FLAG']`、`os.environ['ROOT_FLAG']` 读取分别注入的值。访问 `/entry`、`/root` 即可取得两个答案；示例故意直接返回答案，只用于验证平台功能。

正式比赛中，镜像应自行把不同变量的值放到各个解题步骤。平台直接使用 Docker Env 数组注入，不把变量名或答案拼成 shell 命令。Flag 只在 Worker 内生成，不存入镜像、不写入实例快照或普通 API。

默认变量为 FLAG_1、FLAG_2 等。名字保存到小题，调整小题顺序时一起移动；自定义后不再额外注入对应的默认序号变量。FLAG 仍是当前首个攻击/Flag 小题的兼容别名，FLAG_COUNT 为数量，FLAGS_JSON 按小题 UUID 映射。防守校验单元不产生或注入答案。

单 Flag 也可自定义变量名，例如 GZCTF_FLAG，同时保留 FLAG 别名。静态 Flag 继续由镜像提供，平台不能从已有的答案摘要恢复明文；本配置用于动态 Flag。AWD 的轮换 Flag 使用 `/run/nebuctf/flag`，不是创建容器后固定不变的环境变量。

配置改动先保存，再创建新实例；运行中实例保留启动快照。已有解题或正式活跃环境时，平台禁止更改注入映射。测试环境与正式环境使用不同作用域，测试值不能用于正式答题。

测试命令：

```sh
TEST_DOCKER=1 npx tsx --test apps/api/test/flag-environment.test.ts
```

参考了 [GZCTF 动态 Flag](https://gzctf.gzti.me/guide/features/dynamic-flag) 的启动时环境变量注入；对照 [GeekGame 容器管理器](https://github.com/PKU-GeekGame/geekgame-challenge-docker/blob/master/docker/_web_docker_manager/main.py) 按配置生成多份 Flag 并放到对应位置的实现。本项目按用户要求采用环境变量映射，未复制其文件挂载或 shell 命令实现。
