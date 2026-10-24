import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Progress } from "../src/components/ui/progress";
test("measured learning progress and estimated activity have distinct accessibility states", () => {
  const measured = renderToStaticMarkup(
    <Progress value={35} aria-label="学习进度" />,
  );
  assert.ok(measured.includes('aria-valuenow="35"'));
  const waiting = renderToStaticMarkup(
    <Progress value={null} aria-label="靶机启动" />,
  );
  assert.ok(!waiting.includes("aria-valuenow="));
  assert.ok(waiting.includes('data-state="indeterminate"'));
  const activity = renderToStaticMarkup(
    <Progress value={68} activity aria-label="正在启动" />,
  );
  assert.ok(!activity.includes("aria-valuenow="));
  assert.ok(activity.includes("translateX(-32%)"));
});
