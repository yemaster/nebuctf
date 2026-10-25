import { solveProof } from "../lib/captcha-proof";

self.onmessage = (
  event: MessageEvent<{ salt: string; difficulty: number; budget: number }>,
) => {
  try {
    const { salt, difficulty, budget } = event.data;
    self.postMessage({ nonce: solveProof(salt, difficulty, budget) });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : "验证失败，请重试",
    });
  }
};
