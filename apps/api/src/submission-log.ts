import type { Row } from "./db.js";
import { unseal } from "./settings.js";

// Call only after authorizing access to the administrative submission log.
export function submissionLog(row: Row) {
  const { flag_cipher, ...safe } = row;
  return { ...safe, submitted_flag: flag_cipher ? unseal(flag_cipher) : null };
}
