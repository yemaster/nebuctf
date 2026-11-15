# 动态附件

```sh
docker build -t nebuctf/example-attachment:example-v1 examples/dynamic-attachment
npm run examples:pack
```

在后台导入 `examples/dist/dynamic-attachment.zip`。生成并下载 `artifact.zip`，解压后 Base64 解码 `challenge.txt`，提交得到的 Flag。

生成器从 `FLAG` 读取平台动态答案，原子发布 `/output/artifact.zip`，保持存活供 Worker 采集。按无网络、非 root、只读根模型运行；仅 `/tmp` 和 `/output` 可写，不启动 HTTP 服务。
