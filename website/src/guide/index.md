# 阅读路线

这份文档按使用场景组织。参赛选手可以直接从组队报名开始；部署者先完成服务安装，再用一场测试比赛检查报名、答题和环境回收。

## 参加比赛

先[注册账号并加入战队](./participate)，由队长完成比赛报名。进入赛场后，[提交答案和使用靶机](./solve)，有报告要求的比赛还需要在规定时间内[提交 WriteUp](./writeup)。

## 组织比赛

先准备题目，再[创建比赛](../organize/create)。依次配置[报名与组别](../organize/registration)、[时间和计分](../organize/scoring)、[资源限制](../organize/resources)，发布前用普通选手账号走一遍完整流程。[比赛期间与赛后](../organize/operations)介绍审核、监控、报告收集和赛后练习。

## 制作题目

从[创建与发布](../authoring/)了解题型和配置顺序。容器题继续阅读[镜像要求](../authoring/containers)；有多个服务时，阅读[多容器与网络](../authoring/multi-container)。Flag 的模板、变量名和注入位置集中在 [Flag 与多个小题](../authoring/flags)。

## 部署和维护

首次部署使用 [Docker Compose](../deploy/quick-start)。对外开放前设置[域名、端口和 HTTPS](../deploy/network)，并安排[数据库与文件备份](../deploy/maintenance)。运行异常时按[故障排查](../reference/troubleshooting)定位具体服务。
