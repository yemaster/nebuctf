import { defineConfig, type DefaultTheme } from 'vitepress'

const repository = 'https://github.com/yemaster/nebuctf'
const base = process.env.DOCS_BASE || '/nebuctf/'
const origin = process.env.DOCS_ORIGIN || 'https://yemaster.github.io'

const reading: DefaultTheme.SidebarItem[] = [
  { text: '开始', items: [
    { text: '项目介绍', link: '/guide/introduction' },
    { text: '阅读路线', link: '/guide/' },
    { text: '快速部署', link: '/deploy/quick-start' },
  ] },
  { text: '使用平台', items: [
    { text: '账号、战队与报名', link: '/guide/participate' },
    { text: '答题与靶机', link: '/guide/solve' },
    { text: '练习与学习', link: '/guide/learning' },
    { text: '提交 WriteUp', link: '/guide/writeup' },
  ] },
  { text: '组织比赛', items: [
    { text: '创建一场比赛', link: '/organize/create' },
    { text: '报名、分组与权限', link: '/organize/registration' },
    { text: '时间与计分', link: '/organize/scoring' },
    { text: '资源与次数限制', link: '/organize/resources' },
    { text: '比赛期间与赛后', link: '/organize/operations' },
  ] },
]
const authoring: DefaultTheme.SidebarItem[] = [
  { text: '制作题目', items: [
    { text: '创建与发布', link: '/authoring/' },
    { text: 'Flag 与多个小题', link: '/authoring/flags' },
    { text: '容器题目', link: '/authoring/containers' },
    { text: '多容器与网络', link: '/authoring/multi-container' },
    { text: '附件与专属附件', link: '/authoring/attachments' },
    { text: 'AWDP 与 AWD', link: '/authoring/attack-defense' },
    { text: 'Docker 镜像管理', link: '/authoring/images' },
    { text: '导入与导出', link: '/authoring/transfer' },
  ] },
]
const deployment: DefaultTheme.SidebarItem[] = [
  { text: '部署与维护', items: [
    { text: 'Docker Compose 部署', link: '/deploy/quick-start' },
    { text: '域名、端口与 HTTPS', link: '/deploy/network' },
    { text: '服务架构与 k3s', link: '/deploy/architecture' },
    { text: '备份、升级与恢复', link: '/deploy/maintenance' },
  ] },
]
const reference: DefaultTheme.SidebarItem[] = [
  { text: '参考', items: [
    { text: '系统设置与权限', link: '/reference/settings' },
    { text: 'API 与个人密钥', link: '/reference/api' },
    { text: '环境变量', link: '/reference/configuration' },
    { text: '常见问题', link: '/reference/faq' },
    { text: '故障排查', link: '/reference/troubleshooting' },
  ] },
  { text: '参与开发', items: [
    { text: '本地开发', link: '/contributing/development' },
    { text: '维护文档站', link: '/contributing/docs' },
  ] },
]

export default defineConfig({
  lang: 'zh-CN',
  title: 'NebuCTF',
  description: 'NebuCTF 项目介绍与使用文档：参赛、办赛、出题、部署和维护。',
  srcDir: './src',
  base,
  cleanUrls: false,
  lastUpdated: true,
  markdown: { codeCopyButtonTitle: '复制代码' },
  sitemap: { hostname: `${origin}${base}` },
  head: [
    ['link', { rel: 'icon', type: 'image/png', sizes: '64x64', href: `${base}favicon.png?v=2` }],
  ],
  themeConfig: {
    siteTitle: 'NebuCTF',
    logo: { src: '/mark.png', alt: '' },
    nav: [
      { text: '首页', link: '/', activeMatch: '^/$' },
      { text: '文档', link: '/guide/introduction', activeMatch: '^/(guide|organize)/' },
      { text: '出题', link: '/authoring/', activeMatch: '^/authoring/' },
      { text: '部署', link: '/deploy/quick-start', activeMatch: '^/deploy/' },
      { text: '参考', link: '/reference/faq', activeMatch: '^/(reference|contributing)/' },
    ],
    sidebar: [
      ...reading,
      ...authoring,
      ...deployment,
      ...reference,
    ].map((section) => ({ ...section, collapsed: false })),
    socialLinks: [{ icon: 'github', link: repository, ariaLabel: 'GitHub 仓库' }],
    outline: { level: [2, 3], label: '本页内容' },
    docFooter: { prev: '上一页', next: '下一页' },
    darkModeSwitchLabel: '外观',
    darkModeSwitchTitle: '切换到深色模式',
    lightModeSwitchTitle: '切换到浅色模式',
    sidebarMenuLabel: '章节目录',
    returnToTopLabel: '返回顶部',
    skipToContentLabel: '跳转到正文',
    editLink: { pattern: `${repository}/edit/main/website/src/:path`, text: '在 GitHub 上编辑此页' },
    lastUpdated: { text: '更新于', formatOptions: { dateStyle: 'medium' } },
    footer: { message: 'NebuCTF 项目文档' },
    notFound: { title: '页面不存在', quote: '这个地址可能已经变更，可以返回首页或搜索文档。', linkLabel: '返回首页', linkText: '返回首页' },
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
          modal: {
            noResultsText: '没有找到相关内容', resetButtonTitle: '清空搜索',
            displayDetails: '显示摘要', backButtonTitle: '关闭搜索',
            footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
          },
        },
        miniSearch: {
          options: {
            tokenize: (text: string) => Array.from(
              new Intl.Segmenter('zh-CN', { granularity: 'word' }).segment(text),
            ).filter((part) => part.isWordLike).map((part) => part.segment.toLowerCase()),
          },
        },
      },
    },
  },
})
