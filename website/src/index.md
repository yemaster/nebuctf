---
title: 项目介绍
description: 自托管的 CTF 竞赛与学习平台，支持混合题型、战队比赛、Docker 靶机与日常练习。
sidebar: false
aside: false
outline: false
editLink: false
lastUpdated: false
prev: false
next: false
---

# NebuCTF

NebuCTF 是一个自托管的 CTF 竞赛与学习平台。你可以组织战队比赛，为题目分配 Docker 靶机和专属附件，也可以将题库、题单、教程与技能树用于日常训练。

一场比赛可以同时包含客观题、CTF、AWDP 和 AWD。报名、分组权限、作答时间、积分、环境配额和 WriteUp 收集都在平台内配置。选手使用同一个赛场完成答题、环境操作和报告提交。

## 从这里开始

| 你要做什么 | 阅读入口 |
| --- | --- |
| 部署自己的平台 | [Docker Compose 部署](./deploy/quick-start) |
| 组队参加比赛 | [账号、战队与报名](./guide/participate) |
| 组织一场比赛 | [创建一场比赛](./organize/create) |
| 制作和测试题目 | [创建与发布](./authoring/) |
| 修改平台或维护文档 | [本地开发](./contributing/development) |

## 比赛与训练

题库保存题目内容与默认分值，比赛单独管理选题、上线时间和计分规则。多小题分别判题和计分，动态分值随解题人数变化；自由开始模式允许各队在开放窗口内开始作答，队员共用本队的计时。

组别可以设置不同的作答、资源和计分权限。默认组别始终保留，删除自定义组别后，原报名队伍回到默认组别。比赛结束后，可以开放赛后练习，正式成绩保持不变。

## 题目与环境

题目可以使用静态附件、专属附件、公共靶机或独立靶机。一个靶机支持主服务与辅助服务组成的多容器环境，每个 FLAG 可指定注入容器。平台负责创建、排队、续期和回收，比赛可统一或逐题限制每队的开启次数。

AWDP 支持上传补丁并执行功能与防御校验；AWD 还包含按轮次分配 Flag、服务巡检与本队环境更新。具体规则见 [AWDP 与 AWD](./authoring/attack-defense)。

## 部署与项目

前端使用 React 和 shadcn/ui，后端使用 Fastify，生产数据存储在 PostgreSQL。可以通过 Docker Compose 部署，也可以将平台运行在 k3s 中、由独立 Docker Runtime 管理题目。两种方式的题目执行后端都是 Docker。

[查看源代码](https://github.com/yemaster/nebuctf) · [阅读使用指南](./guide/) · [查询常见问题](./reference/faq)
