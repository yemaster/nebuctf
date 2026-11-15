<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import { withBase } from 'vitepress'
</script>

<template>
  <DefaultTheme.Layout>
    <template #home-hero-image>
      <figure class="product-preview">
        <a :href="withBase('/guide/solve.html')" aria-label="了解答题工作区">
          <img class="preview-light" :src="withBase('/workspace-light.webp')" width="1200" height="720" alt="NebuCTF 答题工作区：左侧切换题目，右侧阅读题面与提交答案" fetchpriority="high" />
          <img class="preview-dark" :src="withBase('/workspace-dark.webp')" width="1200" height="720" alt="NebuCTF 答题工作区：左侧切换题目，右侧阅读题面与提交答案" fetchpriority="high" />
        </a>
        <figcaption>答题工作区 · 本地示例题库</figcaption>
      </figure>
    </template>
    <template #home-features-after>
      <section class="home-workflow" aria-labelledby="prepare-title">
        <div class="workflow-intro">
          <h2 id="prepare-title">准备一场比赛</h2>
          <p>题目可在多场比赛中复用，每场比赛独立设置时间、权限与计分规则。</p>
          <a :href="withBase('/organize/create.html')">查看办赛指南 <span aria-hidden="true">→</span></a>
        </div>
        <ol class="workflow-steps">
          <li>
            <span class="step-number" aria-hidden="true">01</span>
            <div><h3><a :href="withBase('/authoring/')">准备题目</a></h3><p>编写题面，配置 Flag、附件或靶机，测试环境后发布。</p></div>
          </li>
          <li>
            <span class="step-number" aria-hidden="true">02</span>
            <div><h3><a :href="withBase('/organize/registration.html')">配置赛事</a></h3><p>选题、安排作答时间，设置报名组别与战队资源额度。</p></div>
          </li>
          <li>
            <span class="step-number" aria-hidden="true">03</span>
            <div><h3><a :href="withBase('/organize/operations.html')">开赛与收尾</a></h3><p>管理公告、提示与榜单，赛后收集 WriteUp，开放练习。</p></div>
          </li>
        </ol>
      </section>
      <nav class="home-reference" aria-label="部署与开发">
        <a :href="withBase('/deploy/quick-start.html')">Docker Compose 部署 <span aria-hidden="true">→</span></a>
        <a :href="withBase('/contributing/development.html')">本地开发 <span aria-hidden="true">→</span></a>
        <a :href="withBase('/reference/api.html')">API 与个人密钥 <span aria-hidden="true">→</span></a>
      </nav>
    </template>
  </DefaultTheme.Layout>
</template>
