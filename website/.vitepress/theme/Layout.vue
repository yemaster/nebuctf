<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import { withBase } from 'vitepress'
</script>

<template>
  <DefaultTheme.Layout>
    <template #home-hero-image>
      <div class="hero-brand">
        <div class="hero-logo-motion">
          <img
            class="hero-logo"
            :src="withBase('/logo.png')"
            width="768"
            height="768"
            alt="NebuCTF 星球旗帜标识"
            fetchpriority="high"
          />
        </div>
      </div>
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
