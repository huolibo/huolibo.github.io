import { defineConfig } from 'vitepress'

// 用户主页站点（huolibo.github.io），部署在根路径，因此 base = '/'
export default defineConfig({
  lang: 'zh-Hans',
  title: 'huolibo 的知识库',
  description: '个人知识仓库 —— 笔记、有趣的链接与收藏',

  base: '/',
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ['README.md', 'board-games/**', 'tests/**'],

  head: [
    ['meta', { name: 'theme-color', content: '#3c8772' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'huolibo 的知识库' }],
    ['meta', { property: 'og:description', content: '个人知识仓库 —— 笔记、有趣的链接与收藏' }],
  ],

  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '笔记', link: '/notes/' },
      { text: '有趣的链接', link: '/links/' },
      { text: '棋室', link: '/games' },
      { text: '关于', link: '/about' },
    ],

    sidebar: {
      '/notes/': [
        {
          text: '笔记',
          items: [{ text: '总览', link: '/notes/' }],
        },
        {
          text: '技术',
          collapsed: false,
          items: [
            { text: '分类说明', link: '/notes/tech/' },
            { text: 'Git 实用技巧', link: '/notes/tech/git-tips' },
          ],
        },
        {
          text: '阅读 / 摘录',
          collapsed: false,
          items: [{ text: '分类说明', link: '/notes/reading/' }],
        },
      ],
      '/links/': [
        {
          text: '有趣的链接',
          items: [{ text: '总览', link: '/links/' }],
        },
      ],
    },

    outline: { level: [2, 3], label: '本页目录' },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/huolibo' },
    ],

    search: {
      provider: 'local',
      options: {
        locales: {
          root: {
            translations: {
              button: { buttonText: '搜索', buttonAriaLabel: '搜索' },
              modal: {
                noResultsText: '没有找到结果',
                resetButtonTitle: '清除查询',
                footer: {
                  selectText: '选择',
                  navigateText: '切换',
                  closeText: '关闭',
                },
              },
            },
          },
        },
      },
    },

    docFooter: { prev: '上一篇', next: '下一篇' },
    lastUpdatedText: '最后更新',
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '主题',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式',

    editLink: {
      pattern: 'https://github.com/huolibo/huolibo.github.io/edit/main/:path',
      text: '在 GitHub 上编辑此页',
    },

    footer: {
      message: '基于 VitePress 构建',
      copyright: 'Copyright © 2026 huolibo',
    },
  },
})
