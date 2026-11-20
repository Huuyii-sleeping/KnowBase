const test = require("node:test");
const assert = require("node:assert/strict");
const { useLongWindow } = require("./rerank-window-cascade.cjs");

test("cascade reruns only when every short-window score is negative", () => {
  assert.equal(useLongWindow([-3, -1]), true);
  assert.equal(useLongWindow([-3, 0]), false);
  assert.equal(useLongWindow([-3, 1]), false);
});
test("cascade rejects empty and nonfinite model output", () => {
  for (const scores of [[], [NaN], [1, Infinity]])
    assert.throws(() => useLongWindow(scores));
});
