# 维护文档站

文档站位于 `website`，使用 VitePress 默认主题。它有独立的依赖和 lockfile，构建文档不需要启动平台或数据库。

## 本地编辑

```sh
npm ci --prefix website
npm run dev --prefix website
```

首页使用 VitePress 的产品首页布局，项目介绍位于 `guide/introduction.md`。所有文档共用完整的左侧章节目录，按开始、使用平台、组织比赛、制作题目、部署与维护、参考和参与开发分组。

页面位于 `website/src`。修改 Markdown 即可预览，导航与章节在 `website/.vitepress/config.ts` 配置。

文案以操作和实际结果为主：说明入口、需要填写的内容、保存后的影响和必要限制。不要复制开发日志、生产地址、账号或历史验收记录到公开页面。

## 检查构建

```sh
npm run build --prefix website
npm run preview --prefix website
```

构建时检查站内页面、资源和锚点链接。预览路径默认包含 `/nebuctf/`，与 GitHub 项目 Pages 一致。修改导航、搜索或主题后，检查桌面和窄屏，确认中文搜索和直接访问深层页面正常。

## GitHub Actions 发布

仓库的「Settings → Pages → Build and deployment → Source」应选择 **GitHub Actions**。随后，推送 main 分支中的文档或工作流修改会触发 `Documentation`；也可在 Actions 页面手动运行。

拉取请求只构建和检查，不部署。主分支构建完成后上传 Pages artifact，再由独立部署任务发布，不需要把生成文件提交到源码分支。

默认地址为 `https://yemaster.github.io/nebuctf/`。工作流使用 Pages 的实际路径构建；配置自定义域名时，以 GitHub Pages 设置为准。`DOCS_BASE` 和 `DOCS_ORIGIN` 可用于本地验证其他路径。

## 设计与参考

文档组织参考 [GZCTF 指南](https://gzctf.gzti.me/zh/guide/start/introduction)的上手与部署入口，以及 [Ret2Shell 用户手册](https://www.woooo.tech/zh-cn/ret2shell/manual/)和[运维指南](https://www.woooo.tech/zh-cn/ret2shell/devops/)的读者分工。内容按 NebuCTF 的实际行为编写，不沿用其他平台的配置或接口。

主题、搜索、代码高亮、移动目录和明暗切换复用 [VitePress](https://vitepress.dev/)；发布流程使用 [GitHub Pages 官方 Actions](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。
