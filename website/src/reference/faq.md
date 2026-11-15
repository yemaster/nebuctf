# 常见问题

## 可以只用于练习吗？

可以。启用题目的「开放练习」，按个人记录进度和成绩。题单、教程和技能树可以独立使用，不必先创建比赛。

## 一场比赛只能使用一种题型吗？

不是。一场比赛可同时选择客观题、CTF、AWDP 和 AWD，时间、分值和轮次规则按实际内容配置。

## 已有战队报名，还能调整组别吗？

可以增删自定义组别。默认组别不能删除，删除其他组后，原报名队伍会回到默认组别。开赛后计分相关权限仍受锁定规则限制。

## 开启次数和环境数量有什么区别？

开启次数累计计算成功启动，停止后不退回；环境数量限制同时使用的资源，回收后释放名额。续期不消耗开启次数。详见[资源与次数限制](../organize/resources)。

## 多容器题可以给不同服务注入不同 Flag 吗？

可以。每个 Flag 选择一个或多个容器，兼容别名和 JSON 映射也按目标过滤。没有分配到答案的服务不会收到对应动态 Flag。

## 可以导入其他平台的题目包吗？

当前内容包使用 NebuCTF 自有格式，不兼容 GZCTF 或 CTFd 原生导出包。Docker 镜像可以按平台要求适配，题目配置和计分规则需要重新核对。

## 可以做 Docker in Docker 题目吗？

普通 `docker:dind` 不能直接使用，平台不开放题目特权或宿主 Docker Socket。Hackergame 2023 的 Docker for Everyone 在外层容器中运行 QEMU，再在虚拟机中运行 Docker，可以作为题目镜像的适配方向。当前没有预置的通用 DinD 运行模式，仍需验证启动、Flag 传入、终端和资源限制。

[官方启动脚本](https://github.com/USTC-Hackergame/hackergame2023-writeups/blob/master/official/Docker%20for%20Everyone/src/src/run.sh)

## 文档站能运行比赛吗？

不能。GitHub Pages 只发布项目介绍和静态使用文档。比赛平台、数据库和题目运行环境需要另行[部署](../deploy/quick-start)。
