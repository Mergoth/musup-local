import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "musup-test-"));
const { getPromptTemplate } = await import("./promptTemplates.js");

test("an unedited pre-media default prompt is upgraded to the new default", () => {
  const previous = JSON.parse(execFileSync("git", ["show", "8f32a0f:musup/prompts/summary.json"], { encoding: "utf8" }));
  const dir = path.join(process.env.DATA_DIR!, "prompts");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify({ ...previous, version: 3 }));

  const template = getPromptTemplate();
  assert.equal(template.version, 4);
  assert.match(template.sections.instructions, /Voice notes arrive as transcripts/);
});

test("an unedited Discussed/Conclusions default prompt is upgraded to the reader-focused one", () => {
  const previous = JSON.parse(execFileSync("git", ["show", "176945b:musup/prompts/summary.json"], { encoding: "utf8" }));
  const dir = path.join(process.env.DATA_DIR!, "prompts");
  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify({ ...previous, version: 7 }));

  const template = getPromptTemplate();
  assert.equal(template.version, 8);
  assert.match(template.sections.instructions, /most probably meant for them/);
});

test("an edited prompt is left alone", () => {
  const dir = path.join(process.env.DATA_DIR!, "prompts");
  const edited = { version: 9, sections: { instructions: "mine", outputFormat: "", perChatTemplate: "", transcriptIntro: "" } };
  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(edited));

  assert.equal(getPromptTemplate().sections.instructions, "mine");
});
