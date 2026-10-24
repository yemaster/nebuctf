import { ApiError } from "./api";
import { contextualActionPath } from "./utils";
export function uploadFile<T>(
  path: string,
  file: File,
  onProgress: (value: number) => void,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(),
      body = new FormData();
    body.set("file", file);
    xhr.open("POST", `/api${path}`);
    xhr.withCredentials = true;
    xhr.timeout = 120000;
    xhr.setRequestHeader("x-csrf-protection", "1");
    const abort = () => xhr.abort();
    const cleanup = () => signal.removeEventListener("abort", abort);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => {
      cleanup();
      reject(new ApiError("上传失败，请检查网络后重试", 0));
    };
    xhr.ontimeout = () => {
      cleanup();
      reject(new ApiError("上传超时，请重试", 408));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new DOMException("上传已取消", "AbortError"));
    };
    xhr.onload = () => {
      cleanup();
      let data: any;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        reject(new ApiError("服务器返回了无效数据", 502));
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(
          new ApiError(
            typeof data?.error === "string" ? data.error : "上传失败",
            xhr.status,
            data?.action &&
              typeof data.action.label === "string" &&
              /^\/(?![\/\\])/.test(data.action.href)
              ? {
                  label: data.action.label,
                  href: contextualActionPath(data.action.href),
                }
              : undefined,
            typeof data?.retry_after === "number" &&
              Number.isFinite(data.retry_after) &&
              data.retry_after > 0
              ? data.retry_after
              : undefined,
          ),
        );
        return;
      }
      resolve(data as T);
    };
    if (signal.aborted) {
      reject(new DOMException("上传已取消", "AbortError"));
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    xhr.send(body);
  });
}
