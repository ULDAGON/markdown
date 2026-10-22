import assert from "node:assert/strict";
import { test } from "node:test";
import { stats } from "../src/lib/stats.ts";

test("stats of an empty text has no read time", () => {
  assert.equal(stats(""), "0 characters · 0 b · — read");
  assert.equal(stats("  \n "), "4 characters · 4 b · — read");
});

test("stats groups characters and rounds the reading time up", () => {
  const text = "word ".repeat(1500);
  assert.equal(stats(text), "7,500 characters · 7.3 kb · 8 min read");
});

test("stats counts bytes, not characters", () => {
  assert.equal(stats("ä"), "1 characters · 2 b · 1 min read");
});

test("stats shows megabytes", () => {
  assert.match(stats("x ".repeat(1024 * 1024)), /2\.0 mb/);
});
