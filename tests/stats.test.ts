import assert from "node:assert/strict";
import { test } from "node:test";
import { stats } from "../src/lib/stats.ts";

test("stats of an empty text has no read time", () => {
  assert.equal(stats(""), "0 characters · — read");
  assert.equal(stats("  \n "), "4 characters · — read");
});

test("stats groups characters and rounds the reading time up", () => {
  assert.equal(stats("word ".repeat(1500)), "7,500 characters · 8 min read");
});

test("stats counts what reads as one character once", () => {
  assert.equal(stats("ä"), "1 character · 1 min read");
  assert.equal(stats("😀"), "1 character · 1 min read");
  assert.equal(stats("🇩🇪"), "1 character · 1 min read");
  assert.equal(stats("é"), "1 character · 1 min read");
});
