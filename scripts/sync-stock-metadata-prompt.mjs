#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const promptPath = path.join(root, "docs", "STOCK_METADATA_SYSTEM_PROMPT.md");
const serverPath = path.join(root, "server", "mplus-mcp.mjs");
const prompt = (await readFile(promptPath, "utf8")).replace(/\r\n/g, "\n").trim();
if (prompt.includes("`")) throw new Error("Canonical prompt cannot contain backticks because it is embedded in a raw template literal.");

const start = "// STOCK_METADATA_SYSTEM_PROMPT_BEGIN\n";
const end = "\n// STOCK_METADATA_SYSTEM_PROMPT_END";
const server = await readFile(serverPath, "utf8");
const startIndex = server.indexOf(start);
const endIndex = server.indexOf(end, startIndex + start.length);
if (startIndex < 0 || endIndex < 0) throw new Error("Prompt markers are missing from server/mplus-mcp.mjs.");
const replacement = `${start}const STOCK_METADATA_SYSTEM_PROMPT = String.raw\`${prompt}\`;${end}`;
const next = server.slice(0, startIndex) + replacement + server.slice(endIndex + end.length);
await writeFile(serverPath, next, "utf8");
console.log(`Synced ${prompt.length} prompt characters into server/mplus-mcp.mjs.`);
