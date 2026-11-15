# 动态容器

```sh
docker build -t nebuctf/example-web:example-v1 examples/dynamic-container
npm run examples:pack
```

在后台导入 `examples/dist/dynamic-container.zip`。启用题目后启动专属靶机，访问 `/flag`，提交平台动态注入的答案。服务监听 8080，非 root、只读根运行。

镜像同时保留供平台烟测使用的 HTTP/WebSocket 端点。旧 `:local` 标签和现有测试不变。题目故意直接返回答案，仅用于隔离练习。
