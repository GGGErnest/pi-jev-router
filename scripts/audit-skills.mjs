#!/usr/bin/env node
// Audit Jev Router automatic skill selection from Pi session transcripts.
//
// Every user turn with `"skills": true` appends a `jev-skills` session entry that records
// the injected skills (name, path, full content) or an empty selection. This script turns
// those entries into a reviewable report.
//
// Usage:
//   node scripts/audit-skills.mjs                  # newest session for the current project
//   node scripts/audit-skills.mjs <session.jsonl>  # one session
//   node scripts/audit-skills.mjs --all            # every session under ~/.pi/agent/sessions
//   node scripts/audit-skills.mjs --content        # also print the injected skill bodies
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const args = process.argv.slice(2);
const showContent = args.includes("--content");
const all = args.includes("--all");
const fileArg = args.find((arg) => !arg.startsWith("--"));
const root = join(homedir(), ".pi/agent/sessions");

function collect(dir) {
	const out = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...collect(path));
		else if (entry.name.endsWith(".jsonl")) out.push({ path, mtime: statSync(path).mtimeMs });
	}
	return out;
}

function skillEntries(file) {
	return readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((line) => {
		try {
			const data = JSON.parse(line);
			return data.type === "custom" && data.customType === "jev-skills" ? [data] : [];
		} catch {
			return [];
		}
	});
}

function report(file) {
	const rows = skillEntries(file);
	console.log(`\n${file}`);
	if (!rows.length) {
		console.log("  no jev-skills entries (skills disabled, or no user turn since enabling)");
		return;
	}
	for (const row of rows) {
		const loaded = row.data?.loaded ?? [];
		const names = loaded.map((skill) => `${skill.name} (${Buffer.byteLength(skill.content ?? "", "utf8")}B)`).join(", ");
		console.log(`  ${String(row.timestamp ?? "").slice(0, 19)}  key=${String(row.data?.key ?? "").slice(0, 12)}  ${loaded.length ? `loaded ${loaded.length}: ${names}` : "no skills"}`);
		const considered = row.data?.considered;
		if (considered?.length) {
			const threshold = row.data.threshold;
			const ranked = considered.map(({ name, probability }) => `${name} ${Number(probability).toFixed(2)}${threshold !== undefined && probability >= threshold ? "*" : ""}`).join(", ");
			console.log(`      considered (* met ${threshold ?? "?"} threshold): ${ranked}`);
		}
		if (showContent) {
			for (const skill of loaded) console.log(`      [${skill.name}] ${skill.path}\n${String(skill.content).split("\n").map((line) => `      ${line}`).join("\n")}`);
		}
	}
	const withSkills = rows.filter((row) => (row.data?.loaded ?? []).length).length;
	const distinct = [...new Set(rows.flatMap((row) => (row.data?.loaded ?? []).map((skill) => skill.name)))];
	console.log(`  summary: ${rows.length} checks, ${rows.length - withSkills} empty, ${withSkills} loaded  |  distinct: ${distinct.join(", ") || "none"}`);
}

if (all) {
	for (const file of collect(root).sort((a, b) => a.mtime - b.mtime)) report(file.path);
} else if (fileArg) {
	report(fileArg);
} else {
	const sessions = collect(root).filter((file) => {
		try { return JSON.parse(readFileSync(file.path, "utf8").split("\n")[0]).cwd === process.cwd(); } catch { return false; }
	});
	if (!sessions.length) {
		console.error(`No sessions found for ${process.cwd()}. Pass a session path or --all.`);
		process.exit(1);
	}
	report(sessions.sort((a, b) => a.mtime - b.mtime).at(-1).path);
}
