# API 概览

接口统一 `/api` 前缀，同源 Cookie 会话。写请求需要 `Origin` 精确匹配 `APP_ORIGIN`，并提供 `X-CSRF-Protection: 1`；JSON 写请求使用 `Content-Type: application/json`。上传附件用 multipart。错误响应为 `{ "error": "原因", "action": { "label": "管理环境", "href": "/instances?scope=practice" } }`，其中 action 可选，只使用站内操作入口，不会返回 SQL、密码哈希、Flag 摘要或 Docker 内部错误给参赛者。

| 模块 | 主要接口 |
| --- | --- |
| 身份 | `GET /me`；`POST /auth/register`、`/auth/login`、`/auth/logout`、`/auth/password` |
| 安全验证 | `POST /captcha/challenge`；登录、注册、创建战队和加入战队必须提交一次性 HashPow 结果 |
| 战队 | `GET /teams/mine`、`/team?team=UUID`；`POST /teams`、`/team/join`、`/team/leave`、`/team/invite`、`/team/captain` |
| 题库 | `GET /challenges?scope=practice&category=Web&q=&page=1`；`GET /challenges/:id`；`POST /challenges/:id/submit` |
| 题单 | `GET /problemsets?q=&page=1`、`/problemsets/:id?page=1`；`GET/POST /admin/problemsets`、`GET/PUT /admin/problemsets/:id` |
| 比赛 | `GET /contests`、`/contests/:id`；`POST /contests/:id/register`、`/unregister` |
| 榜单 | `GET /scoreboard?scope=practice&page=1`，scope 可使用比赛 UUID |
| 资源 | `GET /instances?scope=practice`；`POST /challenges/:id/instances`、`/instances/:id/renew`、`/instances/:id/stop` |
| 附件 | `GET /attachments/:id?scope=practice`、`/instances/:id/artifact` |
| 内容 | `GET /articles`、`/articles/categories`、`/articles/:slug`；`POST /articles/:id/complete` |
| 技能树 | `GET /learning/trees`、`/learning/trees/:id` |
| 管理 | `GET/POST /admin/challenges`、`/admin/contests`、`/admin/articles`、`/admin/learning/trees`；`GET/PUT` 对应 `/:id` |
| Docker 镜像 | `GET /admin/images`、`/admin/images/status`、`/admin/images/pulls/:id`；`POST /admin/images/pull`；`GET/POST /admin/challenges/:id/test-instance` |
| 管理运维 | `GET /admin/resources`、`/admin/audit`、`/admin/submissions`、`/admin/users`；`POST /admin/users/:id/status` |
| 公告 | `GET /announcements?scope=practice`；`GET/POST /admin/announcements`、`GET/PUT /admin/announcements/:id` |

Flag 提交请求：`{ "flag": "flag{...}", "scope": "practice" }`，返回 `correct`、`already_solved`、`completed`、`solved_parts`、`total_parts`，匹配小题时还返回 `part_id`、`part_title`。不需要客户端指定小题；重复正确提交不会重复计分，完整解题后提交错误 Flag 仍返回错误。选手创建环境只接受 `scope`，所有镜像、资源参数由管理端题目配置决定。

资源状态：queued → starting → running（容器）/ready（附件）；停止、到期、创建错误进入 stopping，清理成功后变为 stopped/failed。资源界面每 5 秒轮询，榜单每 15 秒轮询。

分页：题库、文档、比赛、题单、题单内题目以及管理题目/资源/比赛/题单/文档/技能树/公告默认每页 24 条；个人提交与榜单 30，审计/用户/管理提交 50。管理列表接受 page 与 q，返回 items、total、page；资源没有搜索，用户/审计/管理提交沿用原接口。题目与比赛管理另接受 page_size（1–100），榜单接受 page_size（10–100）。比赛内题目目录保持完整。

## 登录

`POST /auth/login` 接受 `{ identifier, password, captcha }`，`identifier` 可以是用户名或邮箱，忽略大小写和两端空白；密码保持原值。为兼容旧客户端，仍接受 `{ email, password, captcha }`，但 `identifier` 和 `email` 不能同时传入。注册仍要求独立的合法邮箱。

用户名与邮箱共用同一账户的登录限流（每 15 分钟 10 次），并保留每 IP 每 15 分钟 30 次的限制及计算验证码。不存在、停用的账户或错误密码均返回 401「账号或密码错误」。查询复用用户名、邮箱的现有不区分大小写唯一索引，无需数据库迁移。

## 计算验证码

四个写接口 `/auth/login`、`/auth/register`、`/teams`、`/team/join` 默认都必须携带 `captcha: { token, nonce }`。开启注册邮箱验证时，注册用途证明在 `/auth/email-code` 消费，`/auth/register` 改用一次性邮箱证明。先向 `POST /captcha/challenge` 提交 `{ purpose }`，purpose 分别为 `login`、`register`、`team-create`、`team-join`；战队用途要求已登录。

返回 `{ token, salt, difficulty, expires_at, expires_in }`。salt 是 32 字节的十六进制串，nonce 是 8 字节的小写十六进制串；求解条件为 `SHA256(hexDecode(salt) || hexDecode(nonce))` 的前 difficulty 位为零。token 为服务端签名的不透明字符串，原样提交。有效期 300 秒；前端按返回的有效秒数扣除请求与计算耗时，不依赖设备时钟与服务器时钟一致。

服务端验证签名、用途、来源 IP、登录身份、时效和计算结果，再以数据库唯一键原子消费证明。一次证明只允许一次业务尝试；密码错误、名称重复或邀请码无效之后都需重新验证，不能重复使用。缺失或无效返回 400，签发限流为每 IP 每分钟 30 次，证明校验每分钟 60 次；原有登录、注册及战队业务限流仍然生效。过期的消费记录由 API 定期清理。接口不提供关闭校验的请求参数。

浏览器使用独立 Worker 和本地 SHA-256 实现，支持 HTTP 开发部署，不调用外部验证平台。CLI 演示脚本通过 `scripts/captcha.mjs` 计算相同证明，没有测试专用绕过令牌。

## 多小题

管理题目请求可传 `parts: [{id?, title, description, flag?, initial_points, minimum_points}]`，配置 2–20 小题；`parts: []` 为传统单 Flag。编辑已有小题必须保留其 id，省略 flag 保留原摘要。动态类型不传静态 flag。已有任意小题解出或正式活跃环境后，禁止修改小题结构、答案和计分参数。

公开题目包含 `parts`（名称、说明、当前分值、通过人数、个人/战队通过状态）、`total_parts`、`solved_parts`、`earned_points`，不包含答案或摘要。父题 `points` 为小题当前分值之和；`solves`/`solved` 仅指全部小题通过。题单和技能树的完成条件也是整题通过。

## 战队与分组报名

用户最多加入 20 支战队。`GET /teams/mine` 返回已加入战队列表；成员、邀请码、转让和退出操作通过 `team_id` 指定战队。未指定时保持原接口的默认战队行为。

`POST /contests/:id/register` 接受 `{team_id, group_id?, invite_code?}`。仅队长可以报名；配置了组别的比赛必须选择组别。一个用户不能通过不同战队重复参加同一比赛。报名锁定成员直到比赛结束，开赛前队长可以取消。管理员比赛请求包含 `groups: [{id?, name, description, permissions?, challenge_permissions?}]`，首次报名后不允许增删组别。未传 groups 保留原配置。

比赛详情返回数字 `teams`，按报名战队记录计数（含 0），与成员人数无关。还包含 `groups` 和当前用户所属的 `registration`（队名、组名、对应 id），榜单接受 `group=组别UUID` 筛选。榜单 `solves` 为完成整题数，`flags` 为通过计分项数；各组共享同一动态分值，仅将拥有 dynamic 权限的解出计入衰减。

## 排行榜数据

`GET /scoreboard` 接受 scope、page、page_size，以及 group（比赛组别 UUID）、q（最多 100 字的名称子串）、participant（选手/战队 UUID）。先计算全场排名，再按组别排名，最后搜索和分页；搜索不会把原第 20 名改成第 1 名。组别必须属于当前比赛。练习列出全部启用账户（包括管理员），比赛全局榜列出拥有 rank_overall 权限的已报名战队，组内榜包含该组全部已报名战队。

- `items` 包含 id、rank、overall_rank、group_rank、name、group_id、group_name、score、solves、flags、last_solve，以及稀疏的 `cells`。每个已解单元返回 unit_id、score、solved_at、blood_rank（1/2/3/null）。三血仅展示，不增加分数。
- `columns` 包含计分单元 id、challenge_id、title、part_title、category、points、solves。多小题各占一列，完成整题不重复计分。练习不返回完整题库矩阵，只提供当前页已解单元的元数据供详情使用。
- `timeline` 为当前组别前五名有分数战队的累计通过记录，不随名称搜索缩小。点包含 time 和 score，使用当前题目分值回算历史，不是当时分数的快照；大量记录采样为每队约 302 点以内，保留首尾。
- 返回 total（筛选后总数）、participants（组内参赛人数）、challenge_count、flag_count、page、page_size、started、frozen、cutoff、starts_at、ends_at。名次、计分格、解出数和曲线使用同一条 SQL 的数据快照，封榜时统一使用 freeze_at 截止，比赛结束后恢复完整成绩。前端曲线显示到比赛结束时间。

未开赛时不返回题目/小题元数据和解题成绩；未发布比赛仍受原有访问权限控制。定时题目在实际发布前不进入榜单。接口不返回 Flag、摘要、邮箱或 owner_key。比赛榜单每 15 秒更新，结束后停止自动轮询，仍可手动刷新。

## 比赛展示

- `GET /contests?page=1&from=ISO时间&to=ISO时间` 按时间重叠筛选，范围不超过 42 天。
- `GET /contests/calendar?from=2026-10-01&to=2026-10-31&zone=Asia/Shanghai` 返回当地日期与比赛数量，起止日期均包含在内。使用完整查询范围聚合，不受比赛列表分页影响。
- `POST /admin/contests/:id/poster` 上传 multipart 海报，支持 PNG/JPEG/WebP，最大 5 MiB；校验文件签名，不接受 SVG。
- `DELETE /admin/contests/:id/poster` 移除自定义海报并恢复默认图，需管理员与 CSRF。
- `GET /contests/:id/poster` 返回当前海报；未发布比赛仅管理员可读取。

静态附件与动态产物提供 Content-Length；前端下载仅显示按钮状态，不显示进度条。实例准备、续期和销毁提供持续推进的活动提示而非可测量的百分比，最终完成以 API 或轮询结果为准。


## 环境时长与操作冷却

- `GET /instances?scope=practice&owned=true` 只返回当前个人/战队环境；省略 owned 则包括题目公共环境。返回 `ttl`（秒）、`scope`、`created_at`、`expires_at` 和 `next_operation_at`。
- `GET /challenges/:id/instance-policy?scope=practice` 返回 `{ next_operation_at: 时间或null }`，受题目可见性和比赛权限约束。
- 同一 owner、scope、challenge、resource_type 的启动/生成与停止/删除共用 60 秒冷却；靶机、生成器、补丁分别计时。成功入队就占用冷却，Worker 后续失败不会取消冷却；请求鉴权或资源配额失败不会占用。重复启动返回当前实例，重复停止已在停止/终态的实例为幂等成功，不延长冷却。续期、系统回收不受此冷却影响。
- 冷却返回 429、`Retry-After` 响应头及 JSON `retry_after` 秒数，前端禁用相应按钮并显示等待时间。限制存在数据库并在事务锁内检查，不依赖前端。
- 排队/启动有最多 5 分钟准备期限，仍受比赛结束与绝对期限限制。容器健康就绪后、附件生成成功后，才设置完整单次 TTL。公共实例就绪后使用其绝对期限。排队/启动超时先清理再进入 failed；运行中自然到期先清理再进入 stopped。


## 比赛动态与公告范围

`GET /contests/:id/activity` 需要登录并已报名该比赛，管理员可以预览。返回 `{ items, frozen, hint_updates }`，最新在前，最多 40 条。事件包含 `id`、`type`（release / withdraw / hint / solve）、`challenge_id`、`challenge_title`、`part_id`、`part_title`、`team_name`、`blood_rank`（1/2/3 或 null）及 `created_at`。

- 解题从真实 solves/part_solves 读取，错误和重复提交不产生事件。多小题按独立计分单元展示，不再重复显示整题完成事件。三血在全场按该计分单元的通过时间及稳定 ID 次序确定，仅作提醒，不增加分数。
- 发布事件在管理员发布关联赛题、发布比赛或加入已发布题目时与管理变更在同一事务中记录；普通标题修改不会重复记录。开赛前不返回动态，预先发布的题目在开赛时展示上线时间。迁移前没有可靠上线时间的旧题目不编造历史事件，历史解题仍可读取。
- 未上线的题目不产生提示或解题动态；已下线题目可保留下线通知。封榜中的解题查询使用封榜时间，结束后展示截至比赛结束的历史；上线信息不受成绩封榜影响。
- 为列表时间序读取新增索引；先截取各类最近记录，再计算最多 40 条的前三次解出标记，查询不返回错误提交、答案或个人身份标识。
- `GET /announcements?scope=比赛UUID` 只返回该比赛公告；省略 scope 或使用 practice 时只返回全站公告。

数据库迁移 8 新增 contest_releases 及动态查询索引，更新前建议按部署文档备份数据库。


## 管理详情、筛选与定时发布

新建/编辑页直接通过 `GET /admin/{资源}/:id` 加载详情，不依赖列表第一页。支持 challenges、contests、problemsets、articles、learning/trees、announcements。所有管理读取和写入都需要管理员身份，题目详情不返回 Flag 摘要，小题也不返回旧答案。

`GET /admin/challenges` 支持 q、category、challenge_type（ctf/objective/awdp/awd）、practice（true/false）、state（enabled/disabled/scheduled）、ids（最多 500 个逗号分隔 UUID），先过滤再分页；传入 ids 时按 ids 的顺序返回，未传时按创建时间倒序。返回题目的比赛归属、附件数量与发布状态。大量已选 ID 使用 `POST /admin/challenges/search`，参数放 JSON 请求体，避免超过代理请求地址长度；此接口只检索，需要同样的管理员身份和写请求 CSRF 头。前端题目管理列表、关联题目选择器与比赛赛题设置每页 10 项，跨页选择保留；比赛最多 200 题，题单最多 500 题。

兼容旧客户端仍接受题库级 `publish_at: ISO时间 | null`，当前管理界面不再使用。新配置应使用比赛的 `challenge_settings[].release_at`，避免影响同题在其他比赛中的安排。旧接口行为：立即启用使用 `published: true, publish_at: null`；定时发布使用 `published: false` 和未来的 publish_at；停用使用两者 false/null。两种发布方式互斥，过去时间返回 400。也可以通过 `POST /admin/challenges/:id/publication` 仅更新发布状态。

API 进程每 2 秒检查到期题目，在事务内启用、清除计划时间、记录审计及关联比赛的题目上线事件。并发执行不重复发布；关闭 API 时暂停检查，重启后补发已到期任务。可见性、下载和环境权限仍统一以 published 判断，计划时间未到不会提前开放。受检查间隔与系统负载影响，不承诺毫秒级发布。

## 技能树布局

技能节点新增可选 `position: {x, y}`，坐标有限且范围为 -100000 至 100000。管理员保存节点位置和 prerequisites；服务端在同一事务内保存，拒绝重复 ID、缺失依赖、自依赖及循环依赖。节点必须关联文档或练习；发布时检查关联内容可用。

管理详情与公开详情均返回 position；公开详情继续隐藏尚未公开的关联内容标题和链接。旧节点没有坐标时，前端按依赖层级初始化布局。数据库迁移 9 新增 challenges.publish_at 及待发布索引、learning_nodes.position_x/position_y。


## 题单作答目录

`GET /problemsets/:id?page=1&q=&category=` 在题单内搜索、筛选后按管理端保存的 position 排序，每页 24 题。total 和 completed 始终表示整个题单的可用题目及完成数；filtered_total 表示筛选后的题目数，空页仍保留总数。未发布或非练习题不返回，未公开题单保持 404（管理员可预览）。名称搜索按字面子串匹配，百分号不作为通配符。

从题单进入练习使用 `/challenges?problemset=题单UUID&challenge=题目UUID&page=2`。目录、搜索和分页读取该题单接口，仍按 practice 身份计分，不创建独立题单积分。切题、登录往返、刷新保留题单上下文；返回题单恢复当前页。普通练习、技能树与比赛入口沿用各自的目录范围。


## 管理员参赛

管理员可提交 Flag，练习成绩按个人记入榜单，比赛成绩按已报名战队记入榜单。角色提升或降级不删除已有成绩，练习榜不再按 role 排除管理员。管理员未报名时可以预览赛题，提交仍需加入并报名战队；已报名管理员的题目列表、题目详情和多小题状态使用战队进度。比赛时间、重复提交去重、封榜及禁用账户规则继续适用。


## 排行榜详情与队员贡献

`GET /scoreboard/:participant?scope=比赛UUID&group=组别UUID` 按需读取单个战队详情；练习 scope 为 practice，participant 为用户 UUID。沿用榜单的可见性、组别检查和封榜截止，不存在或不在所选组内返回 404。普通榜单的 cells 保持精简，不批量附带队员统计。

详情直接返回排名记录，包含 overall_rank（全局排名，不参与时为 null）、group_rank（本组排名，无组别时 null）、columns、cells、categories、members、scope、started、frozen、cutoff。rank 为当前选择的榜单内名次；搜索不会重排原名次。比赛配置组别时，前端可在「全局排名」和各组「组内排名」间切换，详情同时列出两种名次。

- cells 追加 solver_id 和 solver_name，来自该计分单元首次有效解答保存的 user_id。多小题分别归属解出该小题的人，整题完成不重复给最后提交者分数。展示名为账户当前用户名，未伪造历史姓名快照。
- categories 为六个题目方向的 `{category, score, flags}`，未得分方向为 0。成员与战队得分均使用当前题目分值及同一截止时间；动态衰减后仍满足成员得分之和等于战队总分。
- members 包含 id、name、current_member、score、flags、categories。当前队员包括零分队员，历史贡献者离队后仍保留归属并标记 current_member=false，避免总分无法对账。练习详情只有本人。
- 封榜后的解答人、方向得分与队员贡献不会泄露；未开赛返回零分、空解题记录和空题目信息。接口只公开参赛名称及计分数据，不返回邮箱、Flag、摘要或内部 owner_key。

新功能使用已有 solves/part_solves.user_id，无需迁移或重写历史数据。详情打开时才请求，进行中每 15 秒刷新，关闭后停止，比赛结束后停止自动刷新。

## Docker 镜像与测试环境

以下接口均仅限管理员，写请求沿用 CSRF 与 Origin 校验。API 不连接 Docker Socket；Worker 同步本地镜像并执行持久化拉取任务。

| 接口 | 用途 |
| --- | --- |
| `GET /admin/images?page=1&q=&state=all` | 每页 24 条，按镜像名或关联题目搜索；state 为 all/present/missing/pulling。返回 items、total、page、worker |
| `GET /admin/images/status?image=仓库:标签` | 查询单个镜像本地状态、最近拉取任务与 Worker 状态 |
| `POST /admin/images/pull` | 请求体 `{image}`，返回 `{id,status}`；同一镜像正在拉取时返回已有任务 |
| `GET /admin/images/pulls/:id` | 任务状态、分层进度、最近 200 条日志和错误原因 |
| `GET /admin/challenges/:id/test-instance` | 当前管理员在该题的最近测试环境及 next_operation_at |
| `POST /admin/challenges/:id/test-instance` | 创建测试环境；可覆盖 image、access_mode、port、cpu、memory，省略时使用已保存配置 |

镜像支持仓库、标签及 SHA256 digest，校验 `IMAGE_PREFIXES`；Docker Hub 简写、完整地址及隐式 latest 统一识别。列表包含允许仓库下的本地镜像、题目引用和历史跟踪项，不枚举其他无关仓库。Worker 约每 10 秒同步本地状态，超过 60 秒未成功同步即视为离线。拉取任务为 queued → pulling → succeeded/failed，单次最多 15 分钟、连接空闲最多 120 秒；每位管理员每分钟最多 10 次请求，最多 16 个排队或运行任务，同一时刻执行一个拉取。

进度每秒写入数据库，保留最多 256 个分层状态和 200 条状态变更日志，每条最多 1000 字符。HTTP 200 响应中的 Docker error 也会使任务失败；日志移除控制字符及 URL 中的认证和查询参数。关闭前端窗口不取消任务。Worker 重启或任务中断后，未完成的 pulling 任务标记失败，queued 继续排队，可重新发起拉取。

测试使用独立 `scope=test` 和管理员个人主体，不进入练习/比赛环境列表、不参与计分，动态 Flag 也与正式环境隔离。可测试未发布、未开放练习的题目；静态附件无需测试环境。新建题目须先保存，切换题目类型后也须先保存；其余环境字段使用提交时的表单值快照，不自动修改正式配置。

测试环境遵守相同 CPU/内存/数量配额、非特权隔离和 60 秒启停冷却。就绪后运行 600 秒，创建后最长 15 分钟，不支持续期；使用现有 `/instances/:id/stop` 停止、`/instances/:id/artifact` 下载测试附件，这两个操作对测试作用域仍要求管理员身份。仅活跃测试环境不锁定正式题目配置，既有解题或正式活跃环境的锁定规则保留。

迁移 10 增加 docker_images、docker_worker_status、docker_image_pulls 及任务索引；升级时同步更新 API 和 Worker。

## 管理员附件操作

- `GET /admin/attachments/:id`：管理员下载静态附件，适用于未发布、未开放练习的题目。返回 attachment 下载响应，不暴露存储路径；普通 `/attachments/:id?scope=` 继续执行原来的公开题目、练习与比赛权限检查。
- `DELETE /admin/attachments/:id`：管理员删除附件记录及对应文件，写入 `attachment.delete` 审计，返回 `{ok:true}`。需要同源 Origin 和 CSRF 头；不合法 ID 返回 400，已删除/不存在返回 404。前端在附件行内确认后执行。

上传仍使用 `POST /admin/challenges/:id/attachments` 的 multipart 单文件接口；多选文件由前端逐个上传，单文件最大 20 MiB。未增加数据库迁移。


## 混合题型、阶段时间与轮次（迁移 11）

完整字段语义与计分公式见 [比赛规则](COMPETITION-RULES.md)。管理员题目字段增加 challenge_type、flag_mode、resources、objective、patch_config、awd_config；小题增加 role。普通题目接口不会返回客观题答案或检查器配置。

比赛写入包含 timing、round_duration 和 challenge_settings，后者按 challenge_id 保存 published、release_at、scoring；scoring.mode 为 inherit/fixed/dynamic/round，points 保存题目分值，parts 保存各小题覆盖，round 保存 carry、dynamic、flag_lifetime、defense_points、availability_points；round_duration 是全场统一轮次时长（秒），不再接受题目独立时钟。开赛后选题集合、计分和时间锁定。

| 接口 | 行为 |
| --- | --- |
| `GET /contests/:id/timing` | 当前战队各阶段状态、开始/截止时间、server_time 及比赛 clock |
| `POST /contests/:id/start/:section` | section 为 objective/practical；战队共享、幂等开始 |
| `GET /contests/:id/objective-paper` | 本队整张客观题答卷；安全题面、分值、逐题权限、草稿及版本、阶段、服务端时间；未开始的阶段不返回题面 |
| `POST /contests/:id/objective-paper` | `{finalize,answers:[{id,answer:{choices,blanks},revision}]}`；保存草稿可传变更子集，交卷须包含全部可提交题目 |
| `GET /challenges/:id/answer?scope=` | 本队客观题草稿与最终提交状态 |
| `POST /challenges/:id/answer` | `{scope,answer:{choices,blanks},finalize}`；最终提交后不可修改 |
| `POST /challenges/:id/patches?scope=` | multipart 补丁包，返回持久化任务 ID |
| `GET /challenges/:id/patches?scope=` | 只返回本人的/本队最近 10 个校验任务，不返回路径或私有结果 |
| `GET /challenges/:id/rounds?scope=` | 当前轮次、自己的累计积分与最近轮次明细 |
| `GET /challenges/:id/arena?scope=` | AWD 对抗地址、服务检查与轮次信息 |
| `POST /challenges/:id/attack` | `{scope,flag}`，AWD 攻击提交 |
| `POST /challenges/:id/restart` | `{scope}`，重启本队 AWD 环境 |
| `GET /admin/judges` | 管理员最近 100 个补丁任务与校验结果 |

实例创建/策略/测试支持 resource_type=container/attachment，分别选择独立配置。`GET /instances` 会隐藏未开始阶段的共享环境，并在作答阶段外隐藏个人环境地址。

`GET /contests/:id/activity/ws` 为 WebSocket 升级接口。必须提供精确 APP_ORIGIN 和有效会话，普通用户需报名。只读连接，发送应用消息将关闭。帧为 `{type:"activity",data:{items,frozen,hint_updates}}`；恢复中可收到 `{type:"retry"}`。每用户最多 4 个连接，每分钟最多 20 次握手。HTTP 动态接口保留作初始化及诊断，前端后续使用 WebSocket 更新。

轮次成绩保存在独立账本，不和普通解题成绩重复累计。榜单详情的 round_number、round_details 和 team_points 区分选手贡献及系统防守/可用性分。零分轮次不计解题数。


## Flag 环境变量映射（迁移 12）

管理员题目读写增加 `flag_env`（单 Flag，默认 FLAG），各小题增加 `flag_env`（默认 FLAG_1、FLAG_2 等）。省略字段保留已有名称，名字绑定小题 ID；重排不会改变该小题的派生值。变量名为 1–64 个大写字母、数字或下划线且不以数字开头，禁止重复、FLAG_COUNT、FLAGS_JSON、PATH 等系统变量；多小题中的 FLAG 由平台保留为首个小题别名。

创建靶机、生成器和管理端测试环境时，实例 spec 只保存小题 ID 与变量名，不保存答案；Worker 在容器启动时生成 Env。AWDP 校验任务也保存并使用同一映射，防守单元始终不注入。已有解答、正式活跃环境或补丁任务时禁止改变映射。普通题目 API 不公开变量配置和注入值。

静态 Flag 仍由镜像提供，本配置只影响动态 Flag。旧实例没有映射快照时继续使用原 FLAG_n 规则，迁移不会修改现有答案、得分或运行中实例。

比赛选题允许复用练习题，不更改题库的练习可见性、默认分值或其他比赛设置。已开放练习的题目可以正常编辑；尚未开放练习的题目若关联未结束的比赛，仍不允许切换为公开练习。启用比赛赛题仍需题库本身启用。


## 分组权限字段

管理员读取比赛时，groups 包含 permissions 和 challenge_permissions。写入时，两者均可省略以保留旧配置；新组省略权限默认全部允许。删除单题覆盖要提交不包含该题键的完整 challenge_permissions 对象。键只能是本场选用的题目 UUID，不能跨比赛配置。

```json
{
  "name": "体验组",
  "description": "",
  "permissions": {
    "join": true,
    "rank_overall": false,
    "view": true,
    "submit": true,
    "resources": true,
    "score": false,
    "blood": false,
    "dynamic": false
  },
  "challenge_permissions": {
    "00000000-0000-4000-8000-000000000001": { "view": false }
  }
}
```

单题覆盖仅接受 view、submit、resources、score、blood、dynamic；缺省项继承组别默认值。开赛后拒绝修改计分、全局排名、三血和动态衰减权限（409）。查看权限拒绝返回 404，作答或资源权限拒绝返回 403；服务端统一执行，不能通过直接调用接口绕过。

公开比赛详情的 groups 仅新增 joinable 和 rank_overall，不公开权限矩阵。题目列表和详情返回当前战队的有效 permissions，供客户端显示只读状态；静态附件下载、专属附件、靶机策略/启动/续期、客观题、补丁及 AWD 接口分别执行对应权限。已有私有资源收回权限后进入 stopping。

全局榜排除 rank_overall=false 的组，组内榜仍可查看，其 overall_rank 为 null。三血序号仅对 blood=true 的解出排序；普通及轮次动态计分仅统计 dynamic=true 的队伍。score=false 仍保留正确答案，积分为 0。排行榜列、明细、实时事件和 hint_updates 均按访问者可见题目过滤；details_limited=true 表示部分赛题明细被隐藏，总分仍完整计算。未报名访客只看到各组共同可见的题目元数据。

WebSocket 按组复用快照，每次发布重新验证会话、报名与题目权限。初次连接、并发连接和重连不会复用其他组的历史快照。

权限变更也会更新 WebSocket 的 permissions_version，客户端据此刷新赛题、资源和排行榜；即使没有新解题或提示事件，已打开的作答界面也会更新权限状态。

## 报名审核与管理员比赛监控

比赛字段 `require_review` 默认 `false`。组别 `permissions.require_review` 默认 `false`；比赛或组别任一要求审核，新报名即为 `pending`。既有报名保持 `accepted`，调整开关不追溯修改状态。

- `GET /admin/contests/:id/registrations`：`page`、`q`、`status`、`group` 筛选，每页 10 条，返回 `total`、`page_size`、状态计数。
- `GET /admin/contests/:id/registrations/:team`：报名详情和成员，仅管理员可查看成员邮箱。
- `PUT /admin/contests/:id/registrations`：`team_ids`（1–100）、可选 `status` / `group_id`、`review_note`。整批在事务中校验并提交。未通过和暂停必须填写原因。曾通过的队伍不能退回待审或拒绝，使用暂停参赛；开赛后不能调整组别。
- 公开比赛详情的 `registered` 仅表示报名已通过；`registration` 另含 `status`、`review_note`、`reviewed_at`、`is_captain`。待审、未通过队伍可由队长撤回；已通过队伍仅开赛前可撤回；暂停期间不能撤回。
- `GET /admin/contests/:id/activity`：比赛范围内的 Flag 提交、题目上下线、提示更新、报名审核与补丁判题。`type`、`correct`、`q`、`page` 筛选，每页 10 条。
- `GET /admin/contests/:id/activity/ws`：管理员专用 WebSocket。消息 `{ "type": "monitor", "data": { "revision": "..." } }` 通知客户端刷新当前比赛查询。要求有效管理员会话与同源 Origin，沿用每用户最多 4 个动态连接、连接限流、心跳和慢消费者限制；角色降级或会话撤销会关闭连接。
- `GET /admin/contests/:id/integrity`：`status=open|confirmed|dismissed`、`q`、`page`，每页 10 条。
- `GET /admin/contests/:id/integrity/:event`：线索详情。
- `PUT /admin/contests/:id/integrity/:event`：`status` 和必填 `note`（最多 1000 字），保存人工核实结果，不自动处罚。
- `GET /admin/contests/:id/integrity/:event/reviews`：分页核实历史。

普通选手不能访问以上管理接口。线索返回提交人、提交队伍、Flag 所属队伍、题目、小题与提交编号，不返回 Flag 明文或指纹。只有成功分发的专属动态 CTF / AWDP 攻击 Flag 会建立指纹；静态 Flag、公共环境、练习场和 AWD 正常夺旗不作为此类异常。旧资源仅回填仍在运行或可下载的资源，无法追溯升级前已经销毁的资源。

暂停参赛后保留原始解题和提交记录，排行榜排除该队，停止专属资源并撤销参赛动态连接；重新通过后恢复已有成绩。审核和核实操作写入审计。全站 `/admin/submissions`、`/admin/audit` 也统一每页 10 条，并返回 `total` 和 `page_size`。

## WriteUp 提交与管理（迁移 16）

比赛创建/编辑支持 `writeup` 对象：`enabled`、`required`、`submitter`（captain/members，默认 members）、`opens_at`（null 表示比赛结束）、`deadline`、`max_size_mb`（1–20）、`formats`（pdf/zip 的非空集合）、`allow_resubmit`、`note`（最多 5000 字符）。旧客户端省略时保留原设置；新比赛默认关闭、PDF、20 MiB、允许替换。启用时截止时间必填，开始时间不得早于开赛，截止时间须晚于提交开始且不早于完赛。公开详情的 `writeup_access` 决定选手菜单入口。

| 接口 | 行为 |
| --- | --- |
| `GET /contests/:id/writeup` | 本队配置、提交元数据、提交人权限 can_submit 与 disabled/upcoming/open/submitted/closed 窗口状态 |
| `POST /contests/:id/writeup?version=N` | 单个 multipart 文件；首次 N=0，再次使用已读版本；成功返回递增版本 |
| `GET /contests/:id/writeup/file` | 下载本队当前文件；关闭提交或过期后仍可下载 |
| `GET /admin/contests/:id/writeups` | q/group/status/page 筛选，10 条/页，状态为 missing/submitted/accepted/changes_requested；统计随搜索及组别更新 |
| `GET /admin/contests/:id/writeups/archive` | 同样的筛选及可选 teams（逗号分隔 UUID）；流式 ZIP，最多 100 份、合计 250 MiB |
| `GET /admin/contests/:id/writeups/:team` | 当前提交与处理历史，历史 10 条/页 |
| `GET /admin/contests/:id/writeups/:team/file` | 管理员下载指定比赛战队的当前文件 |
| `PUT /admin/contests/:id/writeups/:team` | `{version,status,note}`，status 为 accepted 或 changes_requested；退回时 note 必填 |

选手权限依据报名通过时的队员快照，并且当前报名必须已通过。提交限每用户 5 分钟 10 次；导出限每管理员每分钟 6 次。服务端限制流大小、扩展名与 PDF/ZIP 基础签名，文件存放在私有目录，不解压、执行或公开预览。版本冲突返回 409，窗口关闭或参赛资格暂停返回 403；上传结束后在事务内再次检查报名、当前队长/成员提交权限、时间、格式、大小和版本。can_submit 仅表示提交人身份权限，仍需满足时间窗口；管理员参赛也不能绕过仅队长限制。

替换成功后清理旧文件，失败清理本次文件；数据库保留提交人、版本、文件名和处理历史，不保留旧版文件内容。ZIP 使用队伍 UUID 子目录，并附带包含队名、组别、文件名、版本及时间的 manifest.json。配置/上传/处理均由现有会话、CSRF 和权限保护；处理与提交会刷新管理员监控。

管理员报名详情的 members 额外返回 created_at（账号注册时间），仍只返回明确列出的 ID、用户名、邮箱、身份和账户状态。列表不预载成员详情，展开后请求已有的比赛/战队作用域接口；普通用户无权读取。


## 观战权限、报名范围与赛后练习

管理员比赛配置新增：

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `spectator_scoreboard` | `true` | 未报名者能访问排行榜及队伍得分详情；已通过报名的参赛者和管理员仍可查看 |
| `spectator_enabled` | `true` | 公开 3D 大屏及其轮播排行；关闭时只允许管理员预览 |
| `registration_mode` | `public` | `public` 公开报名、`invite` 邀请码、`teams` 指定战队 |
| `registration_code` | 不返回 | 只写，6–128 字符；编辑留空保留已有邀请码 |
| `registration_team_ids` | `[]` | 指定战队 ID，最多 500 项，仅管理员读取 |
| `practice_mode` | `false` | 结束后开放报名、赛题和练习作答 |

邀请码使用 HMAC-SHA256 摘要保存，任何 API 均不返回摘要或明文。管理员读取返回 `registration_code_set`；公开详情只返回当前用户所属且允许报名的 `eligible_team_ids`。新报名同时受范围、队长、人数、组别、审核和成员重复参赛限制。改变报名范围不撤销已有报名，撤销资格使用报名管理。

`GET /admin/teams?page=&q=` 每页 10 条，返回战队 ID、名称、队长用户名及人数；`ids=UUID,UUID` 用于选中项回显，客户端每 100 个 ID 分批请求。

公开详情新增 `viewer_role`（spectator/participant/staff）、`practice_active` 和 `registration.practice_only`。角色是展示信息，接口继续单独验证权限。赛后新报名标记 `practice_only`，不加入正式榜单或 WriteUp 收集；正式选手可继续提交原有 WriteUp。

| 接口 | 用途 |
| --- | --- |
| `GET /contests/:id/spectate` | 公开观战快照，包含安全的比赛信息、统计、前 100 队、可见题目元数据及最近 40 条动态 |
| `GET /contests/:id/spectate/ranking?page=&group=` | 大屏轮播排行，每页 10 队，组别可选 |
| `GET /contests/:id/spectate/ws` | 匿名可连接的只读 WebSocket，同源 Origin 必须匹配 |

实时消息为 `{type:"spectator",data:快照}`，暂时读取失败为 `{type:"retry"}`。事件包含解题/三血、上线、下线、提示以及真实 AWD 攻击，攻击仅公开双方战队 ID/名称，不公开 Flag、靶机端点、邮箱或管理员线索。封榜使用同一截止时间过滤排行、统计和动态。关闭大屏/隐藏比赛使已有普通连接以 1008 关闭。每 IP 每分钟最多 30 次连接、8 个同时连接，单进程最多 512 个；慢连接缓冲超过 256 KiB 时关闭。按比赛共享 2 秒快照与分页缓存，通知合并窗口 250 ms，5 秒补充刷新，20 秒心跳。

赛后练习保留题目自身计分配置供展示，提交及解出记录标记 `contest_practice`，不改变正式积分、动态分值、三血或轮次。客观题练习答案与正式答卷分开，可以修正；已完成 CTF 小题保留完成状态。练习资源遵守原有配额、冷却和 TTL，不再受已结束的比赛时间截断。AWDP 补丁保留提交时的练习身份；AWD 结束后只读题面及历史轮次，不重新启动对抗。关闭练习阻止新的访问/操作，已有环境仍按原 TTL 回收。

## 比赛可见性与资源数量

比赛新增 `visibility: "public" | "private"`，默认 `public`。`published` 仍控制是否启用。私密比赛必须使用 `registration_mode: "teams"` 并选择至少一支真实战队；仅管理员、指定战队的当前成员，以及已有 pending/accepted/suspended 报名战队的当前成员可见。被拒绝且不在指定范围内的成员没有访问权。可见性不代替报名审核、组别及题目权限。

无权用户读取详情、海报、公告、榜单和观战接口时返回 404；列表、日历和平台统计按同一规则过滤。私密海报不缓存。私密观战要求有效登录会话，每次推送重新检查会话和战队范围；切为私密、移除指定战队或会话失效时关闭不再有权的连接。公开比赛依旧允许匿名观战。

创建/更新比赛可携带 `resource_limits`：

| 字段 | 含义 |
| --- | --- |
| `containers_per_team` | 本场每队同时占用的靶机数 |
| `attachments_per_team` | 本场每队同时保有的动态附件数 |
| `containers_total` | 本场靶机总数，含公共靶机 |
| `attachments_total` | 本场动态附件总数 |

各值为 0–10000 的整数或 null。null 不附加比赛限制，0 禁止新建；省略整个对象保留旧配置，发送空对象清空四项附加限制。平台数量、每所有者合计数量、CPU/内存配额和操作冷却始终生效。

queued/starting/running/ready/stopping 均占名额，failed/stopped 不占；已经生成的附件在删除或到期清理前占名额，普通静态附件下载不计数。公共靶机不占每队名额，AWD 自动分配的每队环境按一台靶机计数，判题/巡检临时容器只计入平台资源池。限制仅阻止新建，已有环境的幂等创建、续期、释放和附件下载保持原有规则。AWD 重启先按替换一台的数量核对配额，限额不足时拒绝并保留原环境，不会先销毁后失败。

创建和比赛配置修改使用同一事务锁，按比赛、资源类型和所有者核对后预占排队名额，防止并发超额。到限返回 409 与资源管理 action；`GET /challenges/:id/instance-policy` 新增 `quota`（team_limit/total_limit/team_used/total_used/blocked），练习场为 null。blocked 包含 message 和 action；前端据此在操作前提示，并在名额释放后恢复按钮。AWD arena 的 resource_blocked 表示本队环境尚未分配时的数量限制。

## 基础管理与邮件验证

- `GET /site` 仅返回系统名称、页脚文本/链接与 `email_verification`，不返回邮件服务器或密钥。
- `GET /admin/overview?days=7|30` 返回用户、战队、题目、当前比赛、待审核报名、UTC 日提交趋势、资源配额占用、Worker 心跳、最近环境异常、AI 调用统计。
- `GET|PUT /admin/settings/site`：`name,footer_text,footer_link_label,footer_link_url`。
- `GET|PUT /admin/settings/containers`：`default_ttl,renew_limit,renew_seconds,auto_destroy`，时间单位秒，限制为 60–86400 秒、续期次数 0–100。
- `GET|PUT /admin/settings/mail`：`require_verification,allowed_emails,host,port,security,username,from_address,from_name`。写入可附 `password` 或 `clear_password`，读取只有 `password_set`。security 为 `tls|starttls|none`。
- `POST /admin/settings/mail/test`：空对象仅测试连接，指定 `{recipient}` 才发送邮件。必须显式管理员请求与 CSRF。
- `POST /auth/email-code`：`{email,captcha}`，返回 `{id,expires_in:600,resend_after:60}`。
- 验证开启时 `POST /auth/register` 使用 `{username,email,password,email_verification:{id,code}}`。验证码绑定邮箱、有效期和最多 5 次尝试，注册事务原子消费；密码不在邮件任务中保存。既有注册限流仍生效。

普通靶机创建可能返回 `{requires_confirmation:true,replacements:[{id,title}]}`，此时不修改任何实例。确认后重新发送原创建参数及 `replace_ids`；服务端在资源锁中重新计算替换名单，名单改变则再次要求确认。只允许同一所有者、同一范围、冷却已结束的普通独立靶机。Worker 等旧实例终态后才能启动新实例，物理清理失败时保持等待。实例列表增加 `renew_count,renew_limit,max_expires_at`；续期按快照累加，并在到达次数或截止时间时返回 409。

## AI 路由

管理员接口：

- `GET /admin/ai-routes?page=1`，每页 10 条，包含 24 小时调用与失败次数。
- `POST /admin/ai-routes`、`GET|PUT|DELETE /admin/ai-routes/:id`。
- `PATCH /admin/ai-routes/:id` 使用 `{enabled}`。
- `POST /admin/ai-routes/:id/rotate` 返回新的 `access_key`，旧密钥立即不可用于新请求。
- `POST /admin/ai-routes/:id/test` 以已保存的凭据查询上游 `/models`。

创建/编辑字段为 `name,enabled,protocol,base_url,api_key?,models:[{alias,upstream}],rpm,daily_limit,concurrency,max_tokens,timeout_seconds`。协议为 `openai|anthropic`，timeout_seconds 为 5–300。编辑时 api_key 留空保留原值。创建时必须设置上游密钥，响应 `{id,access_key}`；上游密钥不回显，访问密钥仅创建/轮换时返回。请求日志与审计不记录凭据、提示词或回复。

对外 `GET /ai/:route/v1/models`、`POST /ai/:route/v1/chat/completions`、`POST /ai/:route/v1/messages`。仅这些路由不使用会话/CSRF，独立验证 `Authorization: Bearer ...` 或 `x-api-key`；管理员会话不能替代密钥。请求正文上限 1 MiB，响应/流累计上限 16 MiB、单事件缓冲上限 1 MiB；不跟随上游重定向。模型别名必须存在于路由配置，输出 tokens 不能超过上限。并发通过数据库行锁和请求租约跨进程约束，断开连接取消上游。

两种协议的非流式与 SSE 转换、SDK 基础地址、功能边界及接入示例见 [基础管理教程](SYSTEM-SETTINGS.md)。AI 转发只执行上游模型调用，不执行模型返回的工具操作。


## 比赛时钟与选手信息（迁移 21）

比赛详情、比赛题目列表、`/timing`、`/rounds`、`/arena` 与观战快照返回 `clock`：`server_time`、`starts_at`、`ends_at`、`freeze_at`、`practice`，以及有轮次计分时的 `rounds:{opens_at,closes_at,interval,total,active_from}`。`interval` 来自比赛 `round_duration`，`active_from` 仅用于旧轮次迁移切换。题目 `/rounds` 和 `/arena` 的 `round` 均为比赛当前轮，题目历史结算单独返回。`/rounds` 历史带 `legacy` 标记。

比赛题目列表一次返回全部可见赛题（最多 200 题），练习题库继续每页 24 题。题目和小题增加 `bloods:[{team_id,name,created_at,rank}]`，按封榜截止、正式参赛资格和组别三血权限计算，不包含赛后练习。

观战快照增加 `engagements:[{challenge_id,challenge_title,last_seen,teams:[{id,name,last_seen}]}]`。只使用最近 90 秒的实际提交或 AWD 攻击，最多 12 道题、每题 3 队，排除已全部解出的题目、不可共同查看的赛题、非正式队伍和练习数据；封榜或结束后为空。不返回提交内容、失败原因、邮箱或环境地址。

### 客观题整卷提交

`objective-paper` 的每题 `saved` 包含 `answer`、`correct`、`finalized_at`、`revision`；新答案 `revision:null`，后续原样回传读取的版本。GET 仅返回有查看权限的已上线客观题，答案定义中的正确选项和允许填空值始终剔除；正式阶段尚未开始时 `items:[]`，可先通过阶段开始接口开始计时。`can_submit` 表示阶段可作答，仍须结合逐题 `permissions.submit`。未报名管理员只有预览权限。

POST 最多 200 题，单填空 500 字符、每题最多 10 个空位，总请求体上限 4 MiB，每用户每分钟最多 30 次。重复题目返回 400，题目集合改变或草稿版本冲突返回 409，权限或截止时间不满足返回 403。整卷提交采用单一数据库事务，任意题校验失败不保存其他题；已正式交卷的题目幂等返回原结果。赛后练习答案与正式答案分开，允许重复练习，不改变原赛成绩。旧单题接口保留供练习场及兼容调用。

比赛 `/challenges` 额外返回 `objective_count`，按当前组别可见和已上线客观题统计，不受搜索、分类或客观题阶段状态影响，用于保留整卷入口。
