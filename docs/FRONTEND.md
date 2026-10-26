# 前端设计与组件

2026-10-23 更新。当前版本结合 Ret2Shell 的题目导航、Hackergame 的连续题面和 GeekGame 的资源与解题状态组织方式。题目直接展开，保持全屏应用布局。

2026-10-26 设计约定：后续页面布局与交互优先参考 GZCTF 的实际页面、官方截图和对应源码，再用本项目的 shadcn/ui 组件和主题实现。先核对参考页面中的信息顺序、密度、对齐和状态反馈，再调整对应部分；已有明确要求的多 Flag、技能树等功能保留其适配。局部问题在现有结构内修复，避免借修复重新设计整个页面。

## 参考依据

- [GZCTF 赛题界面](https://gzctf.gzti.me/images/game.challenges.webp)：实际查看官方截图，参考分类侧栏、紧凑题目区、解题状态和右侧动态的信息结构。
- [GZCTF 榜单界面](https://raw.githubusercontent.com/GZTimeWalker/GZCTF/develop/assets/images/game.scoreboard.webp)：实际查看官方截图，参考上方积分走势、分类题目矩阵、固定排名列与三血标记；数据来自真实解题记录，详见文末的排行榜改版。
- [CTFd 演示榜单](https://demo.ctfd.io/scoreboard)：读取公开页面，参考排名、队伍和分数的直接呈现；本次没有取得其真实浏览器截图。
- [Ret2Shell 官方训练界面](https://raw.githubusercontent.com/ret2shell/ret2shell/main/arts/training-dark-en-us.webp)：实际查看官方截图，并读取官方仓库中 training、challenge 和 scoreboard 页面结构。保留全屏应用布局、左侧目录和已打开题目切换，当前版本不再沿用底部操作面板。
- [MoeCTF 2024 实际答题截图](https://www.cnblogs.com/resea/p/18683288)：查看文章中的平台截图，交叉核对上述布局。参考截图保存在 `artifacts/ui-reference`，未作为产品资产打包，也未复制第三方业务代码。

- [Hackergame 官方题目页模板](https://github.com/ustclug/hackergame/blob/HEAD/frontend/templates/hub.html)：读取实际模板，参考目录中的分值和通过情况，以及正文、资源入口和提交的连续阅读顺序。
- [GeekGame 官方题目页](https://github.com/PKU-GeekGame/gs-frontend/blob/HEAD/src/page/Game.jsx)：读取实际源码，参考题头分值与通过状态、题面附近的资源入口和提交反馈。本轮没有取得这两套平台的浏览器截图；不将源码检查描述成视觉验收，也没有搬用它们的业务代码。

当前答题页采用全屏布局。题目目录常驻左侧，移动端通过 Sheet 打开。目录展示题名、分值与实际解出人数。题目标签保留多题切换和 Flag 草稿；正文、附件、环境、提示、提交按顺序排列，共用一个 Scroll Area。静态附件和环境入口直接显示，提示由 Accordion 展开，没有资源时不显示空操作栏。正文使用已有安全 Markdown 组件，支持代码、表格和链接，禁用原始 HTML。练习场默认展示每页 24 题的完整目录，支持搜索、筛选和页码跳转；点击后进入工作区，URL 保留筛选和页码，challenge 参数支持直接进入指定题目。比赛赛题直接打开工作区并选择首题，无独立列表中转。左侧目录逐项展示小题名称、分值与通过状态。全部小题通过后隐藏提交框，显示已解答状态；部分通过继续保留输入框。

登录和注册参考 [shadcn Login Blocks](https://ui.shadcn.com/blocks/login) 的双栏结构，采用品牌与访客入口、表单两个区域。小屏保留完整表单。使用 Field、Label、Input Group、Alert，支持密码显隐、提交状态和内联错误。

登录使用单一「用户名或邮箱」文本输入框，自动填充类型为 username，不触发浏览器仅接受邮箱的格式限制；注册仍使用独立用户名与邮箱字段。输入不自动大写，关闭拼写检查；服务端统一处理账号大小写和两端空白，密码保持原值。失败提示统一为「账号或密码错误」。

登录和注册共用持久布局，切换时保留左侧品牌与访客入口，只对右侧表单进行短淡入过渡；表单独立滚动，注册字段增多不会推移左侧内容。四处安全验证共用 shadcn Button 和 Lucide 状态图标，沿用明暗主题，不新增装饰样式。点击后由独立 Worker 计算 HashPow；未完成验证时禁止提交，网络异常、计算失败与过期提供原位重试。提交失败保留字段并重置证明；切换或离开表单取消旧请求和 Worker，旧结果不能写入新表单。减少动态效果偏好下取消表单位移和循环旋转。

验证文字在计算期间以 60 ms 间隔同时变换全部随机字符，取得真实证明后每 120 ms 从左到右定格为「验证通过」，尚未定格的字符继续一起变化。动画只呈现状态，不表示计算完成百分比，不参与证明生成，也不延迟提交按钮启用。字符使用原有字体与固定字宽，定格后采用成功色；辅助技术只读取真实状态，不播报随机字符。页面隐藏时停止刷新，失败、过期、重试与卸载时清理动画；减少动态效果时直接显示状态文字。登录、注册、创建与加入战队共用这一实现。

错误页使用 Empty 组合组件，覆盖未知路由、未登录、无权限、限流、连接异常和服务错误。API 错误保留 HTTP 状态，非 JSON 网关响应也能显示可恢复的错误。数据页重试重新执行原查询；路由渲染异常由边界捕获，可重新加载，导航仍可用。统一提供「返回上一页」，保留上一页的筛选、分页参数和 URL 锚点；直接打开错误链接、没有站内历史时返回首页或当前比赛概览。重试/登录为主按钮，返回上一页为次按钮，首页/概览为弱化入口，沿用 shadcn Button 和 Lucide 图标。路由变化立即清除已捕获的错误，正常切换不重挂页面，避免返回后台列表后仍停留在错误页或干扰现有表单草稿。

支持浅色与深灰两套主题，默认跟随系统，通过背景和间距区分区域，不加装饰线条或背景图案。字体继承 shadcn/Tailwind 默认 sans 字体栈，图标使用 Lucide。没有添加假终端；提交区调用原有 Flag 判题 API。

### 导航与主题设置

导航栏高度为 56 px，导航项、账户、主题设置及移动菜单按钮撑满整栏高度，保留 16 px 文字和原有水平内边距。沿用 [shadcn Navigation Menu](https://ui.shadcn.com/docs/components/radix/navigation-menu) 的状态分层，按当前要求去掉导航项的选中、悬停和展开底色，在亮暗模式下均通过文字与下沿短条表达当前项。24 × 2 px 的主题色短条贴齐导航栏下沿，不使用导航项阴影。当前项切换时短条在同组菜单间以 200 ms 平滑移动；首次加载直接定位，菜单尺寸改变时重新对齐，减少动态效果时取消过渡。主导航、比赛导航和登录注册入口保持一致；移动端展开后的 Sheet 列表保留 48 px 行高与短条。保留键盘焦点环，登录和注册只在对应路由选中。比赛仍为单层导航，账户操作保留在最右侧。学习与账户菜单继续点击展开，并共用 Dropdown Menu。

右上角「主题设置」参考 [shadcn Popover](https://ui.shadcn.com/docs/components/radix/popover)、[Toggle Group](https://ui.shadcn.com/docs/components/radix/toggle-group) 和 [Radix 主题配置](https://www.radix-ui.com/themes/docs/theme/overview)，用同一面板并列展示外观和主题色。外观提供亮色、暗色、跟随系统；色块使用单选语义、名称与选中勾，不用下拉选择。点击即时生效，切换后面板保持打开；支持 Escape、焦点恢复、刷新保留及跨标签页同步。外部启动脚本在首帧前同时应用外观和主题色；存储不可用时仍可切换。

主题色参考 CTF 平台的公开配置，页面使用自己的简洁色名。这里只映射主色、前景和选中底色，保留现有背景、字体、布局与成功/警告/错误状态色。2026-10-25 核对的来源及实际值：

| 名称 | 参考来源 | 浅色主色 | 深色主色 |
| --- | --- | --- | --- |
| 薄荷青 | [GZCTF brand 色阶](https://github.com/GZTimeWalker/GZCTF/blob/cc12f65fe9cd9eb2a94ccfcb3604a81e394e0296/src/GZCTF/ClientApp/src/utils/ThemeOverride.ts)，取 `brand[8]` 与 `brand[5]` | `#007F6E` | `#2AE5B5` |
| 冰川蓝 | [ret2shell Cyber 主色](https://github.com/ret2shell/ret2shell/blob/2d40f675a3735a8de46ebd66fe548eb4f74a94cf/web/src/lib/storage/theme.ts)，浅色采用原色 20% 黑色混合 | `#0774BE` | `#0991ED` |
| 深海蓝 | [CTFd core](https://github.com/CTFd/CTFd/blob/738f1de09ac4a8ccbd65bf74577acdc1dbecd08e/CTFd/themes/core/assets/scss/main.scss) 所用 [Bootstrap 蓝色色阶](https://github.com/twbs/bootstrap/blob/v5.3.8/scss/_variables.scss)，取 blue-600 与 blue-300 | `#0A58CA` | `#6EA8FE` |
| 青柠绿 | [Hack The Box 官网](https://www.hackthebox.com/) 实际使用的 `#9FEF00`，浅色采用原色 50% 黑色混合 | `#507800` | `#9FEF00` |

浅色适配仅降低同一原色的亮度，使主色文字在现有浅色背景上可读；未新增其他色相。选中底色由当前主色按浅色 12%、深色 14% 与卡片背景混合，避免整页染色。四组配色的按钮文字、主色文字及选中项正文均经过至少 4.5:1 对比度检查。来源名称不显示在主题面板。

## 基础设置的布局

系统配置、容器策略、邮件策略和 AI 路由编辑与题目、比赛编辑共用 `ConfigCard`，使用现有 shadcn Card / CardContent 的表面、圆角、阴影及内边距。卡片填满后台内容区，不再设置页面自己的 `max-w-4xl`；内容区仍由管理布局统一限制最大宽度。

表单用 FieldSet / FieldLegend 组织相关设置，区内间距 20 px，区间间距 24 px。短字段按内容需要限宽，同类字段按响应式网格排列；开关靠近标签，窄屏操作行可以换行。邮件配置和测试位于同一面板，测试仍使用独立表单；AI 接入地址、访问密钥及操作保持与编辑面板对齐。

参考实际读取的 [shadcn Field](https://ui.shadcn.com/docs/components/field) 分组和响应式组合，以及 [Ant Design Form](https://ant.design/components/form/) 的布局示例与窄屏重排规则。只采用布局原则，不引入新的组件库或主题。

## shadcn/ui 选型

先阅读官方文档和示例，再从官方 `new-york-v4` registry 引入 Radix 版本源码。组件位于 `apps/web/src/components/ui`，沿用项目现有 React、Tailwind 和 radix-ui 依赖，不另造组件交互。

| 场景 | 官方组件 |
| --- | --- |
| 主导航、学习与账户菜单 | Button、[Dropdown Menu](https://ui.shadcn.com/docs/components/radix/dropdown-menu)、Sheet |
| 外观与主题色 | [Popover](https://ui.shadcn.com/docs/components/radix/popover)、Toggle Group |
| 分类和内容类型 | [Toggle Group](https://ui.shadcn.com/docs/components/radix/toggle-group)，窄屏分类用 Native Select |
| 登录、注册 | [Field](https://ui.shadcn.com/docs/components/radix/field)、Label、Input Group、[Alert](https://ui.shadcn.com/docs/components/radix/alert) |
| 学习节点 | Card、Button、Badge |
| 题目目录、解题区 | Accordion、Scroll Area、Tabs、Sheet |
| 文档、解题动态 | [Item](https://ui.shadcn.com/docs/components/radix/item)、ItemGroup、ItemContent、ItemActions |
| 搜索、Flag、连接地址 | [Input Group](https://ui.shadcn.com/docs/components/radix/input-group) |
| 题目切换 | [Tabs](https://ui.shadcn.com/docs/components/radix/tabs) 的 `line` 变体及 TabsContent |
| 提示、小题目录 | Accordion、Collapsible |
| 榜单和管理列表 | Table、TableHead、TableRow、TableCell |
| 比赛报名、内容选择和操作确认 | Dialog |
| 后台导航和编辑页 | Sidebar、Breadcrumb、Field、Card、Button |
| 列表分页 | Pagination |
| 比赛日期、选择题目 | Calendar、Checkbox |
| 学习进度、加载、空结果 | Progress、Skeleton、Empty |
| 下拉选项与分隔 | Native Select、Separator |

后台按 shadcn Sidebar 的标准结构组织分组导航，支持折叠与移动端 Sheet；编辑表单直接放在路由内容区。

源码来源：`https://ui.shadcn.com/r/styles/new-york-v4/{component}.json`。来源记录日期为 2026-10-22。导入后只调整本项目路径和以下兼容项：Dialog 限制最大高度并允许滚动、关闭文案中文化；Badge 默认使用 secondary；Input 保留原有 Textarea 重导出。统一样式通过主题变量配置。`index.css` 只保留主题、基础无障碍/减少动态设置和 Markdown 排版；页面布局使用 Tailwind 工具类。

页面动效按操作场景选择，取消统一的弹簧横移。普通导航使用短淡入淡出；作答和表单不位移；阅读详情使用 4 px 显示位移；未知路由不添加入场动效。比赛、技能树、题单及文档卡片采用原生 View Transitions：点击后立即将整张卡片扩展到完整内容区。快照更新回调只同步切换路由和不透明背景，页面模块、详情请求与真实内容挂载在回调外等待，不阻塞展开。内容在展开及停留结束、数据就绪后显示；仍未就绪时先在展开后的页面中央显示加载动画。原生 API 不可用或失败时回退正常导航；系统减少动态效果时跳过展开。

桌面练习列表进入题目时，当前列表以 480 ms 收拢为左侧目录；右侧题面等待收拢与数据加载结束，再用 280 ms 动效显示。慢请求在收拢后显示做题区居中加载状态。返回题库时采用反向过渡，将侧栏展开回完整列表，保留分类、搜索和页码。窄屏沿用 Sheet 目录并直接导航。比赛「返回大厅」恢复普通页面切换，移除缩小和空白停留。任一等待期间离开页面都会取消当前过渡，迟到请求不会恢复原页面。

切题、分页和筛选不重建整个页面。题目切换和后台路由保留 150 ms 局部淡入，Dialog、Sheet、Accordion 使用 shadcn 官方组件动效，判题及资源操作保留各自的状态反馈。页头与页脚不参与普通页面入退场。实现依据：[AnimatePresence](https://motion.dev/docs/react-animate-presence)、[View Transitions](https://developer.mozilla.org/en-US/docs/Web/API/Document/startViewTransition)。原生快照伪元素需要少量 CSS 设置时长与裁切，其余布局仍使用 shadcn 和 Tailwind。

文档和管理页仍按路由懒加载，Markdown 和 Radix 分包缓存。

## 文案与密度

题目目录只展示标题、分数、解题状态。难度放在题面标题旁。学习路线列表不重复显示描述，实际教程、题面和比赛规则完整保留。界面文案不使用间隔点分隔字段。

## 验证范围

- Web TypeScript 与 Vite 生产构建通过。
- 当前 45 项前端测试通过，包括权限导航、比赛阶段、共享快照衔接、浏览器回退、减少动态效果、慢请求取消导航及未报名深链接。
- 使用本地实际 API 数据执行 React 服务端渲染检查：题库首页、题库路由、比赛列表、比赛详情、排行榜、文档、技能树、登录、注册共 9 个页面通过；核对题目数量、组件结构和页面标题。
- 全屏解题版追加 25 项服务端渲染检查：8 道实际题目分别覆盖未登录、选手、管理员的显示状态，共 24 项，另检查公告页。角色上下文是渲染夹具。
- 连续题面版本追加 35 项服务端渲染检查：8 道实际题目分别覆盖未登录、选手、管理员，共 24 项；登录、注册、未知路由、未登录页 4 项；7 类错误状态页。检查资源可见性、提交区、表单标签与自动填充、错误操作入口。
- 此检查不是浏览器验收。按用户要求没有打开本地浏览器，桌面/移动端截图、菜单点击、键盘切换和弹窗交互仍需本地浏览器复核。

本轮按用户要求不打开本地浏览器，通过构建和代码渲染检查验证。

本地入口与账号见 [本地测试](LOCAL_TEST.md)。

## 多小题与比赛更新

参考 [Hackergame 小题模型](https://github.com/ustclug/hackergame/blob/HEAD/server/challenge/interface.py) 的独立计分与自动匹配方式，在单一提交区域展示小题名称、分数和通过状态，部分完成不会把整题标成已通过。

参考 [GZCTF GameCard](https://github.com/GZTimeWalker/GZCTF/blob/HEAD/src/GZCTF/ClientApp/src/components/GameCard.tsx) 的海报、赛事时间与状态层级，比赛列表采用大图卡片，配合 [shadcn Calendar](https://ui.shadcn.com/docs/components/radix/calendar)。比赛详情负责报名、规则与公告，赛题和榜单各自有独立路由。比赛模块和日历依赖按路由拆包，练习场不载入日历代码。

默认海报为本项目生成的实验台照片，路径 `apps/web/public/images/contest-lab.jpg`；管理员上传后替换，无第三方品牌素材。没有为装饰增加自定义 CSS。

正确提交使用绿色状态区、弹性缩放与图标弹出，错误只显示简短提示并让原输入框横向抖动，保留内容与焦点，遵循减少动态效果设置。缺少战队、报名和配额错误在 Toast、页面错误状态或内联 Alert 中提供统一的 shadcn Button 导航。比赛内的配额引导保留比赛上下文。


## 首页与比赛导航

首页 `/` 展示公告栏、近期比赛海报、比赛日历和实际解题动态。近期比赛默认查询过去 7 天至未来 35 天的交叠赛事，最多展示 4 场，进行中优先；点选日历日期后切换该日赛事。数据均来自现有 API，不添加演示计数。

主导航收敛为练习、比赛、题单、排行与学习，战队和靶机归入账户菜单，移动端使用 Sheet。页脚采用下述紧凑状态栏。比赛顶部保持一行，左侧是「返回大厅」和比赛名称，中间依次为概览、公告、可用赛题、排行榜和可用靶机入口，最右侧始终是账户菜单或登录注册。窄屏将导航收进点击打开的 Sheet，账户入口始终可见。「返回大厅」仅跳回比赛列表，不取消报名。比赛内切回赛题会保留最近打开题目的地址与筛选。

详情使用单个 shadcn Card。上半部按标题与状态、赛程、参赛规模排列，右侧海报列宽 320 px；起止时间连续显示并包含年份，封榜时间沿同一标签列对齐。底部 CardFooter 集中显示报名状态、战队、组别与操作。窄屏海报在上，时间自然换行，操作在底部展开。下方规则和组别沿用 320 px 侧栏，保持对齐。公告通过比赛菜单访问，首页和大厅继续共用比赛卡片。

参考了 [GZCTF 比赛详情源码](https://github.com/GZTimeWalker/GZCTF/blob/HEAD/src/GZCTF/ClientApp/src/pages/games/%5Bid%5D/Index.tsx)、[比赛导航](https://github.com/GZTimeWalker/GZCTF/blob/HEAD/src/GZCTF/ClientApp/src/components/WithGameTab.tsx)、[Ret2Shell 比赛布局](https://github.com/ret2shell/ret2shell/blob/HEAD/web/src/routes/games/%5Bgame%5D/layout.tsx) 及 CTFd 演示站页脚。未复制其业务代码。

页脚参考 [CTFy](https://ctfy.tsinghua.edu.cn/) 的状态栏信息组织。2026-10-25 实际读取其公开前端实现，确认平台、资源、比赛、倒计时按组展开及窄屏收纳的结构；没有复制其业务代码、字体或装饰样式。NebuCTF 使用 36 px 状态栏和现有 shadcn Popover、Dropdown Menu：大厅显示平台数据，登录后提供个人环境概况；比赛内改为本场信息、参赛状态、报名数、当前战队与组别。个人环境只统计当前范围的专属靶机和动态附件，公共靶机不计入。未报名时不显示环境入口，也不发起资源请求。

状态栏复用已有页面缓存，平台和个人环境面板打开后才请求数据；展开期间分别每 60 秒和 10 秒刷新，关闭即停止额外轮询，刷新失败时替换旧明细并保留管理入口。比赛信息观察页头已有查询，公告及赛题入口均保持当前比赛范围。右侧显示本地时间或赛程倒计时；赛程倒计时指比赛整体结束窗口，不替代自由计时队伍的作答时长。隐藏页面暂停时钟渲染。小屏收起文字并将常用链接放入点击菜单，保持单行，不增加整块链接页脚。

## 资源卡片与操作反馈

靶机与附件采用 shadcn Item，统一间距、图标和操作区。靶机集中显示状态、剩余时长、地址、复制、新标签页访问、续期及销毁；专属附件生成完成后在卡片内提供下载。HTTP(S) 地址可直接打开，裸 host:port 转为 HTTP 地址，浏览器访问适用于 HTTP 服务。

启动、生成、续期和销毁使用持续推进的活动进度条，不显示估算百分比，无障碍状态为不确定进度。只有接口或轮询确认成功后才到达终点，随后动画退场；失败时保留错误入口而不展示成功。销毁时保留短暂完成状态，配额仍以服务端真实清理为准。附件下载仅显示按钮加载状态、取消和完成反馈，不展示进度条。整页加载状态居中显示。

自动释放由服务端 Worker 按到期时间执行，与浏览器是否打开无关。前端用真实剩余时间进度条和倒计时显示，到期后停止提供访问入口，等待真实回收结果。资源生命周期参考 [Ret2Shell 架构说明](https://www.woooo.tech/zh-cn/ret2shell/devops/2-structures/) 中过期环境清理的设计。

本次补充 18 项服务端渲染检查，覆盖首页、比赛详情和导航、比赛公告、比赛资源页、登录注册返回路径、裸端口跳转及无下载进度条。页面内容采用实际 API 数据，角色、空资源列表及资源卡片使用明确的渲染夹具；未进行浏览器视觉验收。


## 导航权限与逐页动效检查

| 场景 | 入口和过渡 |
| --- | --- |
| 未报名、未登录 | 显示概览、公开排行榜、公告；隐藏赛题和靶机，报名入口在概览 |
| 已报名，未开赛 | 隐藏赛题，显示等待开赛、取消报名及已有资源入口 |
| 已报名，进行中 | 显示赛题与靶机，概览主按钮为进入赛场 |
| 已结束 | 隐藏赛题，保留公开信息和已报名用户资源管理 |
| 管理员 | 进行中的比赛允许预览赛题；个人比赛靶机仍遵循 API 的报名要求 |
| 手动访问无权进入的赛题/靶机地址 | 先判断详情中的参赛状态，回到概览，不发起受限查询；后端鉴权保持不变 |

已逐项检查 App 中的全部路由，以及答题、管理、学习、登录注册、资源页中的局部切换。普通菜单 160 ms 入场/70 ms 退场；作答 120 ms、表单 140 ms，只改变透明度；知识库/技能树/题单详情 180 ms 小幅显示；卡片展开 560 ms，海报与文字从展开起线性渐隐（280 ms），全屏表面停留至少 500 ms，数据就绪后内容显示 360 ms，无弹簧回弹。查询参数变化不重建整页动画，练习列表首次选题单独收拢目录；轮询数据更新不重播入场。用户离开页面后，迟到的卡片预取不会把用户拉回比赛。

布局依据来自实际查看的 GZCTF 赛题截图、Ret2Shell 比赛截图，以及两者详情/导航/赛题源码：采用身份与内容分层、统一对齐、权限过滤和固定工作区，保留本项目的 shadcn 组件。单元测试中的原生快照 API 为模拟实现，验证 DOM 衔接与降级逻辑；未打开本地浏览器，不将这些测试描述成动画观感验收。


## 主题、战队与资源细节

- 亮色、暗色、跟随系统使用统一主题变量；偏好保存在本机并同步同源标签页。首屏由同源 `theme.js` 提前应用主题，保持现有 CSP。学习和账户菜单都使用点击打开的 Dropdown Menu。
- 我的战队先显示全部所属战队，点击进入详情。无战队时显示 Empty 引导。`/team/new` 提供创建/加入表单，桌面左右分栏、窄屏上下排列，中间使用 Separator 与 OR；保留返回比赛路径。
- 靶机按状态、地址、时长和操作组织；地址栏里的复制与打开均为图标按钮。我的靶机查询 `owned=true`，公共实例仍在对应题面显示。
- 排队和启动仅显示活动进度，容器健康就绪或专属附件生成后才开始 TTL。运行时用 Progress 显示真实剩余比例；失败状态保留原因和重试入口，错误提示有短暂显示动画。
- 同一主体、题目、赛场的创建和销毁共用 60 秒冷却。按钮显示等待秒数，服务端事务锁保证战队成员、多个标签页和并发请求不能绕过。续期和自动回收不占用此冷却。
- 公告列表采用独立内容表面和明确间距；首页整条公告可点击，并定位到完整公告。

补充参考：[CTFd 战队流程](https://docs.ctfd.io/docs/accounts/teams/)、[Portainer 容器状态及操作](https://docs.portainer.io/user/docker/containers/view)（实际查看官方状态截图）、shadcn 的 [Collapsible](https://ui.shadcn.com/docs/components/radix/collapsible)、[Empty](https://ui.shadcn.com/docs/components/radix/empty)、[登录表单布局](https://ui.shadcn.com/blocks/login)。提取列表到详情、状态与动作分区及表单对齐方式，保持本项目组件与品牌。


## 比赛卡片与悬浮动态

比赛卡片参考 [GZCTF GameCard](https://github.com/GZTimeWalker/GZCTF/blob/develop/src/GZCTF/ClientApp/src/components/GameCard.tsx) 的固定海报高度、角落状态标签及紧凑信息区。当前海报高 176 px，正文内边距 16 px，标题最多两行；比赛列表和首页近期比赛使用最小 256 px 的自适应网格，日历侧栏保留。此次实际读取了官方组件源码，官方比赛列表图片请求未成功，不声称完成截图对照。

展开时由 image-pair 提供持续不透明的背景，圆角与尺寸同步展开；旧快照按原始宽高比缩放，并在线性 280 ms 内渐隐，不再使用 cover 裁切。展开耗时 560 ms，随后保持纯色表面 500 ms。详情内容在快照和数据等待期间通过 visibility 与 inert 隐藏并禁止交互。主内容区使用独立背景层，首次懒加载也能立即得到目标快照。加载图标只在展开及停留结束后仍需等待时居中出现，不在原卡片上先显示图标。主题、减少动态效果和不支持原生过渡时的回退逻辑保留。

比赛内右下角的动态面板采用 Card、Collapsible、ScrollArea、Button 与 Badge，参考 [GZCTF GameNoticePanel](https://github.com/GZTimeWalker/GZCTF/blob/develop/src/GZCTF/ClientApp/src/components/GameNoticePanel.tsx) 的事件类型、时间与三血信息组织方式。可点击收起，按用户/比赛记住状态；桌面默认展开，窄屏默认收起，新事件在收起时累积提示数量。每 5 秒读取最近 40 条记录，后台标签页不持续轮询；不将轮询描述成 WebSocket 实时推送。仅已报名成员或管理员、开赛后显示。比赛结束后保留历史，赛题链接随入口权限关闭。

比赛公告只查询本场公告；大厅公告只查询全站公告。动态中的上线记录不混入公告列表。封榜期间不展示封榜后的解题动态，题目上线信息仍可显示；管理员查看动态同样遵守此规则。


## 日历宽度与内容层次

日历容器使用 shadcn Card，保留单层 16 px 内边距；Calendar 去掉内部重复 padding，使用组件默认的 32 px 日期格最小尺寸。7 列至少需要 224 px，在比赛页 288 px 侧栏扣除容器内边距后的 256 px 空间内完整显示。首页与比赛侧栏都明确设置 min-w-0，避免内容的固有宽度撑开网格；没有用裁切或横向滚动掩盖溢出。

比赛卡片、比赛概览、日历及首页公告增加轻量 shadow-sm，比赛卡片悬停时提升到 shadow-md；动态悬浮框继续使用 shadow-lg。采用现有 Tailwind 阴影层级，暗色使用中性黑色阴影，不增加装饰边框或自定义 CSS。


## 题目整行入口与状态区分

练习场和题单详情共用 shadcn [Item asChild](https://ui.shadcn.com/docs/components/radix/item) 整行链接，状态、标题、分类、难度、分值和解出数均在同一链接内。点击任意区域可打开题目，支持键盘聚焦、右键与修饰键打开新标签页；练习链接保留当前分页、分类和搜索。比赛侧栏原有整行选择与独立小题折叠按钮保持一致。

比赛状态统一使用 Badge：即将开始为蓝色，进行中为绿色，已结束为中性灰。首页、比赛大厅和概览共用同一组件，亮暗主题分别使用对应的背景和文字色，标签底色不受海报干扰。

卡片内容渐隐采用 280 ms 线性过渡；背景与圆角独立用 560 ms 展开，再保留 500 ms，最后用现有 360 ms 动效显示内部内容。通过原生快照的持续时间控制停留，[ViewTransition.finished](https://developer.mozilla.org/en-US/docs/Web/API/ViewTransition/finished) 与模块、数据、页面挂载均完成后解除内容隐藏，停留仍由原生过渡控制。加载图标另设 120 ms 出现缓冲，短请求不闪现图标；一旦出现至少保留 240 ms，再以 180 ms 淡出，同时逐渐显示内容。背景层在退场期间保留，取消导航会清理等待计时器。失败时解除遮挡，显示现有错误页；等待页面挂载的观察器具有取消和超时清理，避免错误路由永久空白。比赛、技能树、题单、文档共用此行为；减少动态效果与不支持原生过渡的浏览器继续直接导航。

原生过渡在更新回调完成后才开始动画，因此禁止在该回调中等待网络和模块导入；参见 [Chrome 同文档过渡说明](https://developer.chrome.com/docs/web-platform/view-transitions/same-document)。自动测试使用模拟原生 API 检查同步快照、慢请求、加载错误、返回大厅、练习目录收拢及中途离开的时序，不替代实际浏览器的视觉验收。


比赛详情信息收拢时，实际读取了 [GZCTF GameDetail](https://github.com/GZTimeWalker/GZCTF/blob/develop/src/GZCTF/ClientApp/src/pages/games/%5Bid%5D/Index.tsx) 与 [Ret2Shell 比赛概览](https://github.com/ret2shell/ret2shell/blob/HEAD/web/src/routes/games/%5Bgame%5D/index.tsx) 的布局源码，并查看 GZCTF 官方比赛列表截图。参考前者集中排列标题、时间和操作，以及后者将参赛战队与进入赛题放在相邻区域的组织方式。实现复用本项目的 [shadcn Card 结构](https://ui.shadcn.com/docs/components/radix/card)、Badge 和 Button，没有复制平台组件代码或新增自定义 CSS。


## 管理中心与技能树编辑

后台参考已查看的 GZCTF 管理题目列表/题目设置截图，以及 [shadcn Sidebar](https://ui.shadcn.com/docs/components/radix/sidebar) 和 [Sidebar Blocks](https://ui.shadcn.com/blocks/sidebar) 的成熟结构：固定分组侧栏、紧凑路径栏、搜索筛选区、表格和独立编辑页。管理员仍使用原来的账户菜单与主题切换。新增/编辑使用 `/admin/{栏目}/new` 与 `/admin/{栏目}/:id/edit`，不再用表单弹窗。题目、比赛、题单、文档、技能树、公告均适用。

列表的关键属性直接显示，题目启用状态使用可操作的 Switch；保存期间禁用该开关，失败恢复原状态。其他只读状态使用 Badge。列表行可进入详情，行内上传、启停等操作保留独立点击区域。筛选和页码写入 URL，编辑页返回原列表；进入详情直接读取 ID 接口，不依赖列表缓存。分页采用官方 Pagination；题目列表、远程题目选择器与赛题设置每页 10 项，已选项跨页保留，最后一页删除后自动退回有效页。比赛赛题目录不拆分页。

技能树使用 [React Flow](https://reactflow.dev/learn) 的画布、节点拖动、连接点、缩放、平移与视图适配。参考官方 [保存与恢复](https://reactflow.dev/examples/interaction/save-and-restore) 和 [禁止循环连接](https://reactflow.dev/examples/interaction/prevent-cycles) 示例；节点仍使用 shadcn Card、Button、Badge，设置区使用 Field、Checkbox。没有手绘 SVG 连线或自制拖动逻辑。

拖动坐标与依赖一起保存，前后端均验证依赖合法性。旧节点按依赖层级初始化坐标；公开技能树默认紧凑树形浏览，也可选择「作者布局」展示保存坐标，并保留已完成/锁定状态与原有学习入口。React Flow 按需独立分包，画布跟随明暗主题；库的必要样式从主入口引入。


## 技能树的树形布局

参考 [React Flow Dagre Tree](https://reactflow.dev/examples/layout/dagre) 的上下树形结构和 [Dynamic Layouting](https://reactflow.dev/examples/layout/dynamic-layouting) 的子节点添加方式，使用 Dagre 的 TB 分层布局：前置技能在上，子节点在下，同级节点留出间距，父节点位于分支中间。多个根与多前置技能的汇合继续支持，不删除原有依赖。未使用 Pro 示例的收费源码。

编辑器与公开页统一使用顶部输入、底部输出的连接点，移除流程箭头。公开页节点只保留名称、学习状态和分支展开按钮；内容入口与前置技能集中到选中节点的详情区。新数据自动树形排布；已有手动坐标照常加载。编辑器「树形排列」按当前连线重新计算位置并适配视图，保存后公开页的「作者布局」同步使用；「添加子节点」建立依赖并放在父节点下方，避开已有卡片。重排为显式操作，不在拖动或内容更新时抢占手动布局。

Dagre 与 React Flow 放在按需加载的同一包，首页不预加载该包；已有完整坐标时跳过布局计算。没有新增页面 CSS、字体或手绘图标。


## CTFy 参考范围

用户指定 [清华 CTFy](https://ctfy.tsinghua.edu.cn/) 作为功能实现与布局参考，并明确要求视觉细节保持 NebuCTF 当前 UI 风格。该约束优先于参考站外观：继续使用现有 shadcn/ui 组件、Lucide、默认字体、明暗主题、精简文案与当前留白密度。主站、沉浸式比赛区和管理中心的既有导航要求继续适用。

2026-10-23 实际读取了站点 HTML 与公开前端包，核对了导航、题目目录、题目详情、资源卡片的结构和状态分支。浏览工具无法打开首页，当前也没有可连接的浏览器，因此本次没有截图或真实渲染验证；没有登录后台，前端出现的管理路由不能作为后台权限与运行能力的验收依据。

可参考的工作流：

| 范围 | 公开前端结构中观察到的做法 | NebuCTF 的采用边界 |
| --- | --- | --- |
| 导航 | 站点、个人、当前比赛与管理功能分组，并根据身份和赛事条件显示入口 | 保留当前单行比赛菜单和后台分组侧栏，优先核对入口是否可用 |
| 大量题目 | 筛选状态放入 URL，远程分页，支持清除单个或全部条件 | 后续题库筛选改进沿用这一操作方式，保持当前列表样式；比赛仍直接进入作答区 |
| 题目操作 | 将登录、报名、启动中、已启动等条件转换为相应操作入口 | 状态和下一步操作放在一起，保持题面、附件、环境、提交的连续顺序 |
| 环境管理 | 根据当前状态、剩余时间和运行限制提供可用操作 | 继续使用现有资源卡片、图标入口、进度条与操作冷却，不凭参考站前端推断其后端隔离或安全能力 |

阅读依据为该站当前公开的 `index-BX5gh1US.js`、`Challenges-D2mCXRu4.js`、`ChallengeDetail-DmK-GCsM.js`、`InstanceCard-9EUeu3bV.js`。仅参考信息组织和操作条件，未复制其代码或产品素材；未确认该站具有与本项目相同的学习技能树功能。


## 动效衔接、资源失败与技能树浏览

卡片过渡参考 [Chrome View Transitions 的宽高比处理](https://developer.chrome.com/docs/web-platform/view-transitions/same-document#handle_changes_in_aspect_ratio)：把不透明背景与旧图像透明度拆开，保持旧图像比例，减少视觉跳变。比赛、技能树、题单和文档共用。悬浮比赛动态沿用 [shadcn Collapsible](https://ui.shadcn.com/docs/components/radix/collapsible) 和 [Radix forceMount](https://www.radix-ui.com/primitives/docs/components/collapsible)，通过现有 Motion 连续调整宽高；展开、收起和快速反向点击使用同一个内容节点，保留滚动位置。收起后内容 inert 且 aria-hidden，未读计数、状态记忆与权限检查不变。

靶机与专属附件的创建、失败、重试整合到资源卡片：标题旁保留主要操作，失败时显示「重试启动」或「重新生成」。错误说明为普通辅助文字；超过 140 字或多行的诊断放入默认收起的「错误详情」，展开区限制高度。资源上限等业务错误仍展示接口返回的处理入口。冷却和提交中状态仍禁用重复操作。进入历史已完成题目时，成功状态静态显示；仅当次首次正确提交播放成功反馈。

技能树参考 [CTFHub 技能树](https://www.ctfhub.com/#/skilltree)。实际读取该站公开 skilltree.53663c0a.js 和 skilltree.3ac88a41.css：使用组织树名称节点、学习状态图例、点击分支请求子树、返回上级、点击学习节点进入题目。源码也包含展开/收起处理，但当前配置的 collapsable 为 false，不能声称观察到线上已启用折叠。此次未登录该站或取得真实渲染截图。

本项目采用紧凑的上下树形结构，默认展开根节点及返回时选中节点的前置路径，支持逐支展开、收起、进入分支与返回上级；多前置技能不被强制改成单父关系。节点保留名称和状态，详情区统一提供教程、练习和前置技能入口；窄屏选中后平滑滚动到详情。后台拖动和连线编辑保留，公开页可切换「作者布局」。分支、节点和布局写入 URL，从教程与题目返回时恢复原分支和选中节点，登录往返同样保留上下文。外部或非技能树来源不作为返回链接。


## GZCTF 排行榜参考与实现

本次实际查看 GZCTF 官方榜单截图，并读取 [ScoreboardTable](https://github.com/GZTimeWalker/GZCTF/blob/develop/src/GZCTF/ClientApp/src/components/ScoreboardTable.tsx)、[ScoreTimeLine](https://github.com/GZTimeWalker/GZCTF/blob/develop/src/GZCTF/ClientApp/src/components/charts/ScoreTimeLine.tsx) 和比赛榜单页面源码。采用上方积分走势、下方按题目分类的解题矩阵、固定身份列、组别筛选与三血标记的组织方式，保持 NebuCTF 当前主题、字体与 Lucide 图标。未复制 GZCTF 业务组件或引入三血加分规则。

图表使用官方 [shadcn Chart](https://ui.shadcn.com/docs/components/radix/chart) 和 Recharts 3，Table、Tooltip、Sheet、Collapsible、InputGroup、NativeSelect、Pagination 复用现有组件。前五名以阶梯曲线显示累计分数，支持收起和时间范围拖动；动态计分使用当前分值回算历史，界面注明「按当前题目分值累计」。定时刷新不重播曲线动画。图表独立按需加载，首页不预加载 charts 或 graph-utils。

比赛矩阵显示分类、题目/小题、分值、通过状态和三血；桌面固定排名/队名和总分，窄屏缩小身份列并允许矩阵内部滚动。每页 30 支战队，大量小题每组展示 36 个计分单元，可按分类筛选或切换下一组，限制 DOM 规模。比赛作答目录保持完整。练习榜使用紧凑选手表格，不展开整座题库。

当前战队使用整行高亮，战队名、分数、解题数及全部题目格继承同一行的底色；固定列保持不透明，悬停不覆盖当前战队状态。普通行、队名和解题状态按钮在亮暗色下均不增加悬停背景，保留点击、提示及键盘焦点。已解答、未解答及三血图标统一为 24 px，沿用 Lucide 图标。此修复复核了 GZCTF 官方截图、ScoreboardTable 及其 [固定列样式](https://github.com/GZTimeWalker/GZCTF/blob/develop/src/GZCTF/ClientApp/src/styles/components/ScoreboardTable.module.css)，在现有矩阵结构上完善本项目的当前战队标识，使用已有亮暗色主题变量。

搜索、组别、页码与「我的排名」写入 URL；筛选期间保留已显示的榜单，搜索保留真实排名。查看队名或已解格可打开同一个解题详情侧栏，显示当前分数、三血和通过时间。「我的排名」使用本场报名的战队 ID。封榜时格子、曲线、分数和解出数同时截止，未开赛不泄露题目名称。

本次不打开本地浏览器。自动测试验证矩阵、筛选、分页、侧栏、图表曲线路径和收起交互；实际滚动、窄屏布局和图表拖动手感仍需在本地页面查看。


## 题单内作答

题单中的整行题目链接携带 problemset 和 page。作答区复用现有题目目录、多小题折叠及工作区，目录数据直接读取当前题单接口，按题单顺序排列，不再用题库目录或分类重排覆盖课程顺序。搜索与分类只作用于题单，继续每页 24 题；左侧显示题单名称和「返回题单」，窄屏目录使用相同数据。题单切换时清空已打开题目标签，避免其他目录的标签残留；普通练习和技能树往返不变。


## 排名范围、方向雷达与队员贡献

实际读取 GZCTF [ScoreboardItemModal](https://github.com/GZTimeWalker/GZCTF/blob/develop/src/GZCTF/ClientApp/src/components/ScoreboardItemModal.tsx) 的方向雷达、成员贡献和解题记录结构，以及官方 [shadcn Radar](https://ui.shadcn.com/charts/radar) 示例与 [Chart 文档](https://ui.shadcn.com/docs/components/radix/chart)。沿用现有 Sheet、Table、NativeSelect、Badge 和 Pagination，雷达使用 Recharts，未添加手绘 SVG、额外字体或页面 CSS。

比赛有组别时，排名选择器明确显示「全局排名」及各组「组内排名」，没有组别则隐藏。搜索与分页保留排名范围，详情同时显示全局和所在组名次。详情侧栏调整为最大 768 px：上方为名称与成绩，中间为方向雷达及精确数值，下方为队员贡献和得分记录。窄屏按同一顺序纵向排列。

雷达显示六个方向的实际得分，可切换全队或单个队员；各队员视图共用战队的轴上限，避免零分或小分数被自动缩放成满图。旁边保留可访问的数值列表。队员表显示总分、Flag 数和本场最高分方向，零分显示「暂无得分」，并列最高方向全部显示，不将其描述为跨赛事能力评价。

队员贡献表的表头与数据统一左对齐，使用相同的 12 px 水平内边距；得分和 Flag 列设置稳定宽度，姓名与方向可换行。行内垂直居中，得分使用 16 px 半粗等宽数字，方向与姓名保持相同字号，表头弱化。沿用 shadcn Table 和横向溢出容器，取消行悬停底色。

得分记录显示题目/小题、实际解答人、分数、时间和三血，每页 24 条。状态图标与右侧分数相对整条记录垂直居中；分数使用 20 px、半粗和等宽数字，保留至少 64 px 的右对齐区域，左侧长题名可换行。独立详情请求避免主榜每次刷新都返回全页队员数据；图表按需加载。封榜时详情所有统计统一截止。按用户要求未打开本地浏览器，雷达图路径及切换通过 DOM 测试验证，视觉和窄屏手感仍需页面复核。

## 镜像管理与题目测试入口

参考 GZCTF [题目配置页](https://github.com/GZTimeWalker/GZCTF/blob/develop/src/GZCTF/ClientApp/src/pages/admin/games/%5Bid%5D/challenges/%5BchalId%5D/Index.tsx) 与 [ChallengePreviewModal](https://github.com/GZTimeWalker/GZCTF/blob/develop/src/GZCTF/ClientApp/src/components/admin/ChallengePreviewModal.tsx) 中相邻的镜像配置、测试容器操作和访问入口；此次读取的源码未提供可确认的镜像拉取弹窗实现。拉取日志按本项目 Worker 任务接口实现，使用官方 [shadcn Dialog](https://ui.shadcn.com/docs/components/radix/dialog)、现有 Progress、Table、Badge、Button 和 Pagination，保持已有主题、字体及 Lucide 图标。

后台运维栏增加 Docker 镜像；题目环境配置内根据本地状态切换拉取和测试操作。真实分层字节进度用于拉取弹窗，不虚构总体下载百分比；Docker 暂未提供总量时保留阶段文字。任务每秒查询，库存/测试环境每 3 秒查询，后台镜像表每 5 秒查询。弹窗高度适应视口，分层与日志各自可滚动；关闭不终止任务，状态查询继续运行。测试靶机沿用操作进度组件、图标复制和新窗口访问。

解析依据为 [Docker Engine API](https://docs.docker.com/reference/api/engine/version/v1.45/) 的 images/create 流式响应，以及 [distribution/reference](https://github.com/distribution/reference/blob/main/regexp.go) 的镜像名称结构。后端限制为小写仓库路径和 SHA256 digest，不将 UI 中的状态轮询当成 Docker 直接连接。

## 题目编辑的分区与完整操作

2026-10-23：整理题目新建和编辑页，继续使用独立路由。基础信息在顶部并排，主区按题面与提示、Flag 与小题、环境、附件排列；右侧集中计分与发布，宽屏固定在可见区域，窄屏按自然顺序排列。采用现有 shadcn Card、FieldSet/FieldGroup、NativeSelect、Checkbox、Table、DropdownMenu 与 Button。沿用字体和 Lucide 图标；编辑器仅补充主题变量、工具栏间距和窄屏布局适配。

参考范围：

- [GZCTF 题目配置源码](https://github.com/GZTimeWalker/GZCTF/blob/develop/src/GZCTF/ClientApp/src/pages/admin/games/%5Bid%5D/challenges/%5BchalId%5D/Index.tsx)：基础字段并排，题面占较大区域，镜像、端口、测试入口与资源限额相邻。
- [ret2shell 表单](https://github.com/ret2shell/ret2shell/blob/main/web/src/lib/blocks/challenge/form.tsx)、[设置](https://github.com/ret2shell/ret2shell/blob/main/web/src/lib/blocks/challenge/settings.tsx)、[附件](https://github.com/ret2shell/ret2shell/blob/main/web/src/lib/blocks/challenge/files.tsx)：内容、计分、开放时间分别组织，附件行集中提供上传、下载与删除。实际读取公开源码，只借鉴功能分组和操作位置，没有复制其组件、样式或图形素材。
- [CTFd 出题教程](https://docs.ctfd.io/tutorials/challenges/creating-challenges/)：核对题面、Flag、文件、提示与可见性等出题步骤。采用本项目支持的功能，不把该平台的脚本判题、标签或依赖规则当成本次已实现功能。
- [shadcn Field](https://ui.shadcn.com/docs/components/radix/field) 与 [Dropdown Menu](https://ui.shadcn.com/docs/components/radix/dropdown-menu)：表单分组、标签关联及点击展开的标题工具。

题面预览使用已有安全 Markdown。提示回到题面区域；小题名称与分值按列对齐，说明与 Flag 相邻。切换单/多 Flag、静态/动态类型会保留当前输入，隐藏区域的表单控件停用，避免隐藏必填项阻止提交。动态附件不显示访问方式和服务端口；固定积分停用最低分和衰减配置。新建题目保存后进入其编辑页，直接继续上传附件和测试；已有题目保存仍返回原列表位置。

附件支持一次选择多个文件，单次最多 20 个，每个不超过 20 MiB；上传后刷新附件数据，保留其他未保存字段。删除使用行内确认和取消，避免误点；下载和删除走管理员专用接口，未发布题也可操作。所有附件动作继续在本页完成，编辑本身不改回弹窗。

### Markdown 编辑器

使用 [@uiw/react-md-editor](https://github.com/uiwjs/react-md-editor) 4.1.3，npm 发布于 2026-10-20，锁定精确版本。采用 common 入口的语法高亮和原生 Markdown 源码模型；工具栏使用现有 shadcn Button、DropdownMenu 和 Lucide 图标。支持 1–6 级标题、粗体、斜体、删除线、链接、图片链接、引用、行内代码、代码块、列表、任务列表和表格，以及编辑、分屏预览、预览、拖动高度和全屏模式。

预览复用选手页面的安全 React Markdown / GFM 渲染，不启用编辑器自带的原始 HTML 预览。亮暗主题跟随全站，窄屏分屏改为上下排列；全屏支持 Escape 返回并在离开页面时恢复滚动。Markdown 原文始终作为表单字段提交，切换预览和全屏不改写源码。字符限制沿用后端 20,000 上限，工具栏插入超长内容也会阻止保存并提示修改。

编辑器及高亮依赖按需加载，加载期间仍可用文本框输入。构建使用明确的共享包分组，避免编辑器专用解析器进入首页的静态依赖。测试仅忽略 CSS 文件加载，仍运行真实编辑器、工具栏命令和预览组件。

后台小题、提示、填空项、比赛分组和技能树节点统一使用 UUID 辅助函数。优先调用浏览器原生 `crypto.randomUUID()`；HTTP 环境缺少该接口时，使用 `crypto.getRandomValues()` 生成符合 UUID v4 格式的编号，不依赖 `Math.random()`，不覆盖全局浏览器接口。题目编辑测试显式模拟仅有 `getRandomValues` 的 HTTP 环境，避免 Node 的完整 Crypto 能力掩盖部署兼容问题。接口限制依据：[MDN randomUUID](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID)、[MDN getRandomValues](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues)。


## 混合题型与配置标签

题目和比赛继续使用独立编辑页，shadcn Tabs 分组配置。隐藏标签保留输入，保存时定位首个无效字段。动态分数图按实际二次公式计算，图表依赖懒加载。提示独立增删和排序，不使用逗号或换行拆分全部提示。

客观题单选使用 shadcn Radio Group，多选使用 Checkbox，填空使用 Field/Input；与 Flag 区分开。补丁校验、附件生成和靶机操作沿用统一的 OperationProgress、紧凑失败信息和重试入口。错误只让输入区抖动，已完成题重新进入不重复播放成功动画。

比赛动态使用真实 WebSocket，首次 HTTP 请求用于初始化；新的快照会取消尚未完成的旧初始化请求。上线、下线、提示和解出使用 Lucide 图标与语义状态色，收起时新增提示使用单独的提醒数量和铃铛反馈，展开后清除；保留宽高展开动画，遵守 prefers-reduced-motion。

本轮测试使用真实 Radix、React Query、Recharts 和 Motion 组件的 jsdom 交互，不代表真实浏览器视觉检查。继续遵循用户要求不打开本地浏览器。


## 编辑页标题与多小题设置

2026-10-24：题目编辑页标题显示「编辑题目：题目名称」。后台新建/编辑页取消内容顶部的额外 padding，统一标题栏 top-0 吸顶，与上方管理导航直接衔接。

动态分数预览放入每个小题所在行，与其名称、分值和说明对应；窄屏在该行下方显示，不使用小题预览选择框。靶机的 Flag 注入采用 shadcn Table/Input，逐行对应小题和变量名，调整顺序后保留映射。图表仍按标签懒加载；单 Flag 时保留单张曲线。

### 比赛编辑的连续操作

比赛配置依次为基本信息、WriteUp 提交、赛题设置、时间规则、报名分组。赛题设置将选题、排序、启停、上线安排和计分汇集到同一列表。使用现有 shadcn Item、Collapsible、RadioGroup、Switch 和 Pagination；选题区默认展开，可收起；左栏搜索完整题库并分页，右栏独立按分类汇总全部已选题目，提供数量和移除按钮，窄屏按上下顺序排列。已选元数据分批读取，覆盖 200 题上限，不受左栏筛选影响。赛题设置在该题下方全宽展开，可同时展开多题。列表直接显示分类、题型、小题数、分值、计分方式、上线安排和启用状态。窄屏摘要和操作纵向重排，表单及 fieldset 使用 min-w-0，避免原先窄栏挤压输入框。

计分模式直接列出，多个小题依次显示输入与曲线，不用下拉选择某一个小题。配置状态由比赛表单持有，折叠、搜索及分页不会丢失编辑。全状态校验会定位到错误所在页并展开对应题目。比赛保存成功后保留编辑位置，新建成功进入独立编辑页。沿用当前明暗主题与字体，没有新增全局 CSS。


## 比赛组别权限

参考 [GZCTF Division](https://github.com/GZTimeWalker/GZCTF/blob/develop/src/GZCTF/Models/Data/Division.cs) 的组别默认权限和逐题覆盖模型，继续使用现有 shadcn Switch、Collapsible、Table、Pagination。报名分组页直接显示八项访问与计分权限及报名审核开关，不用下拉框隐藏配置；单题权限原位展开，继承开关与六项权限同一行，支持搜索和每页 10 题。沿用当前字号、主题和图标，不添加自定义 CSS。

组别首次保存后原位接收服务端 ID，草稿和当前配置页保留；保存期间等待重新读取，避免重复创建组别。已有报名时禁用增删；开赛后锁定计分相关控件。只读题目保留题面及小题进度，隐藏 Flag 表单、禁用客观题编辑；无资源权限时不挂载资源和 AWD 环境组件。关闭报名的组别在报名选择中禁用，全部关闭时直接显示不可用状态。不参与全局排名的战队从「我的排名」进入本组榜单。

交互验证通过 jsdom 与渲染测试完成；按用户要求未打开本地浏览器，仍需用户检查实际窄屏和亮暗主题观感。

## 报名管理、监控与资源区域

比赛导航保持单层。管理员通过点击「管理」菜单进入报名战队、比赛动态、作弊线索与比赛设置；移动端使用同一组导航入口。报名与核实编辑采用独立路由，选手不渲染管理菜单，也不发起管理员查询。列表每页 10 条，报名列表提供批量通过，详细状态与组别修改在详情页完成。

布尔设置统一使用 shadcn Switch。题目勾选、多选答案、批量选择继续使用 Checkbox。Flag 与计分页顶部为紧凑字段网格，多小题设置与各自曲线保持对应。表单区内优先 gap-4，区间优先 gap-5 / gap-6，避免大空隙拆散关联字段。

题目资源采用一个连续表面：靶机在前，附件在后，普通附件使用资源行。标题、状态、主要操作位置固定，连接地址的复制与打开图标并排，剩余时间和进度条一起展示。创建失败保留重试按钮和折叠诊断。普通下载不显示估算进度，生成、续期和销毁继续显示持续推进的操作进度。

页面主查询失败时，主内容区完整替换为居中的错误页和重试操作，不同时显示旧表格、筛选栏或分页；资源操作失败仍在资源区域内反馈。沿用现有亮暗色 token，不新增字体、图标系统或全局样式。

参考：[ret2shell 靶机操作结构](https://github.com/ret2shell/ret2shell/blob/main/web/src/lib/blocks/challenge/instances.tsx)、[shadcn Item](https://ui.shadcn.com/docs/components/item)。结构借鉴状态与操作的对齐关系，细节保持本项目 UI。

## 海报编辑与 WriteUp

比赛基本信息将标题、说明、发布开关放在同一列，右侧为有限宽度的海报预览及上传/移除操作，窄屏顺序排列。海报独立保存，保留其他未保存字段。WriteUp 配置单独使用标签页；开关、格式多选、时间和限制使用现有 Switch、Checkbox、Field、Input，未启用时隐藏并禁用相关字段。跨标签保存会定位无效时间字段。

比赛单层菜单按权限增加 WriteUp，概览提供截止时间与提交入口。选手页把当前文件、提交人、版本、状态、反馈和上传区合在连续区域；使用 XHR 实际传输字节驱动 Progress，上传结束后移除，下载继续使用统一 DownloadButton。未开放、已截止、禁止替换时隐藏上传控件，保留当前文件和反馈。查询失败时显示完整错误状态。

管理员入口位于「管理 → WriteUp 管理」。桌面左侧为 PDF 预览及审核操作，右侧为可滚动的战队列表，支持搜索、组别/状态筛选、每页 10 条和批量导出。点击战队原位切换预览，筛选、页码、导出勾选及按文件版本保存的审核意见草稿保持不变。移动端改为上下排列。历史详情链接自动进入同屏管理并选中对应战队，处理记录通过 Accordion 展开且继续分页。状态有文字，确认与退回意见对应文件版本。沿用现有 shadcn/ui、Lucide、亮暗主题，不新增全局主题 CSS 或字体。


## WriteUp 权限、管理返回与报名展开

WriteUp 标签移到基本信息之后；提交权限使用两项直接可见的 RadioGroup，布尔开关仍用 Switch。每队一份报告，队员没有提交权限时保留文件、下载与反馈，隐藏上传操作并提示联系队长。权限刷新后原位更新。

比赛设置链接携带原页面 return 路径，返回校验仅接受后台路径或同场比赛路径，拒绝外部地址及反斜杠路径。独立后台的比赛设置、报名和监控页在已有顶部栏提供「返回比赛」，不额外叠加菜单条。

审核列表参考 [GZCTF Review](https://github.com/GZTimeWalker/GZCTF/blob/develop/src/GZCTF/ClientApp/src/pages/admin/games/[id]/Review.tsx) 的队伍摘要与成员展开结构，使用已有 [shadcn Collapsible](https://ui.shadcn.com/docs/components/radix/collapsible) 组合 TableBody、触发按钮及详情行。每次展开一队，点击队名、键盘 Enter/Space 均可操作；批量选择和审核按钮独立，不触发展开。详情按需加载，显示平台已有的成员资料，未添加不存在的实名、学号或电话字段。审核详情页共用同一成员表格。


## WriteUp PDF 预览

实际读取 [GZCTF Writeups](https://github.com/GZTimeWalker/GZCTF/blob/develop/src/GZCTF/ClientApp/src/pages/admin/games/%5Bid%5D/Writeups.tsx)、[TeamWriteupCard](https://github.com/GZTimeWalker/GZCTF/blob/develop/src/GZCTF/ClientApp/src/components/admin/TeamWriteupCard.tsx) 与 [PDFViewer](https://github.com/GZTimeWalker/GZCTF/blob/develop/src/GZCTF/ClientApp/src/components/admin/PDFViewer.tsx) 源码，参考左侧阅读、右侧选择战队的交互。预览采用 React-PDF 11 和 PDF.js 6.3，按官方方式配置同版本 Worker，兼容构建提供必要的浏览器能力补齐；仅打开 PDF 时加载解析模块，分页渲染单页并支持缩放、适应宽度和文字选择。字体、CMap 与解码资源随 Docker 静态包部署，不依赖第三方 CDN。实现依据：[React-PDF](https://github.com/wojtekmaj/react-pdf)、[PDF.js 示例](https://mozilla.github.io/pdf.js/examples/)。

PDF 通过现有管理员文件接口鉴权读取，预览携带版本号；文件更新后旧版本预览返回 409，重新加载会刷新元数据。ZIP 保留下载及审核，不尝试渲染。切换战队中止旧文件请求并释放文档与 Canvas，不执行 PDF 附带操作或脚本，不开放文件 iframe 权限。文件接口继续私有、不缓存；原站点 CSP 与禁止嵌入策略保留。


## 观战大屏与比赛访问

设计依据和身份操作见 [观战与赛后练习](CONTEST-SPECTATING.md)。大屏在单层比赛导航下占满剩余高度，隐藏页脚和重复悬浮动态；左侧排行/事件、右侧 Three.js 赛场。保持现有字体、Lucide、shadcn 按钮/提示/选择控件和明暗主题，不额外加载字体或第三方统计服务。

`ContestAccessSettings` 集中访问权限、报名范围、审核和练习开关；`contestCapabilities` 决定各身份菜单，服务端独立鉴权。`useSpectatorRealtime` 负责初始快照、重连、页面隐藏时断开及 1008 撤权；错误时整个大屏由错误视图替换。排行等待下一页时保留旧页，不切换为空白加载块。

三维渲染最多 30 FPS、像素比 1.5、60 个战队节点与 12 个事件；离开时销毁 WebGL 资源。首个快照不播放历史攻击，已处理事件不会因重复推送重播，减少动态效果设置关闭非必要动效。按需加载独立 `spectator-3d` chunk，普通比赛/管理页面不下载 Three.js。


## 比赛管理侧栏与观战场景调整

参考实际查看的 [i春秋未来世界赛况图](https://www.integritytech.com.cn/html/News/News_525_1.html)、[永信至诚赛事展示](https://www.integritytech.com.cn/html/News/News_150_1.html)、[shadcn Sidebar](https://ui.shadcn.com/docs/components/radix/sidebar) 和 [Three.js 泛光示例](https://threejs.org/examples/webgl_postprocessing_unreal_bloom.html)。科技感效果集中在观战 3D 场景，普通页面继续使用现有 shadcn/ui、字体、图标与主题，没有新增全局 CSS。

顶部观战项移除，概览保留观战入口；管理从下拉改为直接链接。比赛管理使用 12rem 常驻侧栏，支持收缩和移动端 Sheet。共享路由外壳在切换时保留，设置按需加载，局部加载和错误不替换侧栏。旧后台管理链接重定向到本场管理页，保留查询条件；WriteUp 提交设置也在同一外壳中打开。

观战场景分离为渲染控制、共享场景模型和短时事件特效三个模块。中心全息球体与分类悬浮区域建立层次，外围战队节点对应真实队伍，轨迹连接正确目标。详细性能界限与行为见 [比赛观战与赛后练习](CONTEST-SPECTATING.md)。未报名预览在作答区直接显示报名入口，不让用户先提交再得知限制；客观题与防守补丁同样受控。通用 ActionError 的图标与整块内容垂直居中。

## 比赛可见性与资源配额

参考 [GZCTF Game 数据模型](https://github.com/GZTimeWalker/GZCTF/blob/develop/src/GZCTF/Models/Data/Game.cs) 中将隐藏、邀请码、队伍人数与队伍容器上限分开配置的方式，沿用已有表单系统扩展本平台的私密访问和资源规则。比赛的「访问与报名」按可见性、观战页面、参赛范围、报名与练习排列；选择私密时直接进入指定战队配置。「资源限制」单独一页，用两行、两列输入并列设置靶机/动态附件的每队/全场上限。

管理员比赛列表展示可见性和参赛范围；有权看到私密比赛的用户会在卡片和概览看到私密标记。未报名预览提示简化为「报名比赛后即可作答」。资源操作区读取实时名额，到限先显示对应说明和管理入口，按钮禁用；释放名额后恢复。全部复用 RadioGroup、Switch、Table、Input、Badge 和现有 ResourceError，不新增 CSS、字体或图标系统。
