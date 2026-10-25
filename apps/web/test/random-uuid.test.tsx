import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "../src/lib/random-uuid";

test("editor UUIDs use the native secure-context implementation when available", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto")!;
  const native = "01ad679b-0415-4d14-86d7-efaa7a46101a";
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      randomUUID() {
        return native;
      },
      getRandomValues() {
        assert.fail("native UUID support should be used");
      },
    },
  });
  try {
    assert.equal(randomUUID(), native);
  } finally {
    Object.defineProperty(globalThis, "crypto", original);
  }
});

test("editor UUIDs remain valid v4 identifiers with HTTP browser capabilities", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto")!;
  const getRandomValues = globalThis.crypto.getRandomValues.bind(
    globalThis.crypto,
  );
  let calls = 0;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      getRandomValues(bytes: Uint8Array) {
        calls++;
        assert.equal(bytes.byteLength, 16);
        return getRandomValues(bytes);
      },
    },
  });
  try {
    const values = Array.from({ length: 32 }, randomUUID);
    for (const value of values)
      assert.match(
        value,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    assert.equal(new Set(values).size, values.length);
    assert.equal(calls, values.length);
  } finally {
    Object.defineProperty(globalThis, "crypto", original);
  }
});
