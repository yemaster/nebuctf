import { solveProof } from "../lib/captcha-proof";

self.onmessage = (
  event: MessageEvent<{
    salt: string;
    target: string;
    max_nonce: number;
    budget: number;
  }>,
) => {
  try {
    const { salt, target, max_nonce, budget } = event.data;
    self.postMessage({ nonce: solveProof(salt, target, max_nonce, budget) });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : "验证失败，请重试",
    });
  }
};
