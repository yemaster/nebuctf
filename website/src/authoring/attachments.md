# 附件与专属附件

静态附件为所有用户提供相同文件；专属附件由生成器按用户或参赛战队生成，可包含各自的动态 Flag。

## 上传静态附件

先保存题目，再在「附件管理」上传文件。单个静态附件最大 20 MiB。上传成功后，在题面中引用实际的下载链接。

附件下载遵守题目、比赛和组别的访问权限。不要把尚未公开的题目材料放到不受权限控制的外部地址。

## 制作生成器

生成器通过环境变量读取 Flag，将最终 ZIP 写入 `/output/artifact.zip`。先写临时文件，再原子重命名，避免平台读到尚未完成的归档。

```python
import os
import time
import zipfile

with zipfile.ZipFile('/output/build.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    archive.writestr('challenge.txt', os.environ['FLAG'])
os.replace('/output/build.zip', '/output/artifact.zip')

while True:
    time.sleep(60)
```

这个示例直接写出答案，只用于测试生成链路。正式题目应将 Flag 融入需要分析的材料。

生成后保持进程存活，等待 Runtime 采集并回收容器。不要生成后立即退出，因为产物位于临时文件系统，进程退出后可能无法采集。

## 运行约束

生成器以非 root 身份运行，没有网络，只能写入允许的临时目录。镜像需要包含 `/bin/tar`。平台要求在 60 秒内生成完整产物，ZIP 最大 20 MiB。

只采集一个名为 `artifact.zip` 的普通文件，不支持任意路径输出或符号链接。多小题动态附件收到完整的 Flag 映射，参见 [Flag 与多个小题](./flags)。

## 在平台验证

将生成器镜像拉取或上传到 Runtime，填写动态附件配置并保存，点击测试生成。下载文件后验证内容，再用对应答案检查判题。

生成成功的附件在到期或删除前仍占动态附件名额。比赛的靶机开启次数不作用于附件，附件使用独立的数量配额。
