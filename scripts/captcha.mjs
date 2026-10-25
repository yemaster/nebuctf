import { createHash } from "node:crypto";

const purposes = {
  "/auth/login": "login",
  "/auth/register": "register",
  "/teams": "team-create",
  "/team/join": "team-join",
};
export const captchaPurpose = (path) => purposes[path];

// CLI fixtures solve the same challenge as browsers; there is no bypass token.
export function solveCaptcha(challenge) {
  if (
    !/^[a-f0-9]{64}$/.test(challenge.salt) ||
    !Number.isInteger(challenge.difficulty) ||
    challenge.difficulty < 12 ||
    challenge.difficulty > 22
  )
    throw Error("Invalid captcha challenge");
  const input = Buffer.alloc(40);
  Buffer.from(challenge.salt, "hex").copy(input);
  const deadline = Date.now() + 60000;
  for (let nonce = 0; nonce <= 0xffffffff; nonce++) {
    if ((nonce & 1023) === 0 && Date.now() >= deadline)
      throw Error("Captcha computation timed out");
    input.writeUInt32BE(nonce, 36);
    const hash = createHash("sha256").update(input).digest();
    let valid = true;
    for (let bit = 0; bit < challenge.difficulty; bit++)
      if (hash[bit >> 3] & (0x80 >> (bit & 7))) {
        valid = false;
        break;
      }
    if (valid)
      return {
        token: challenge.token,
        nonce: nonce.toString(16).padStart(16, "0"),
      };
  }
  throw Error("Captcha computation exhausted");
}
