import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { ContextEvent } from "@earendil-works/pi-coding-agent";

import { textOf } from "./evidence";
import { isRecord } from "./util";

type LoadedSkill = { name: string; path: string; content: string };

function isLoadedSkill(value: unknown): value is LoadedSkill {
	return isRecord(value) && typeof value.name === "string" && typeof value.path === "string" && typeof value.content === "string";
}

function skillPath(path: string, cwd: string) {
	const expanded = path.replace(/^@/, "").replace(/^~\//, `${homedir()}/`);
	const absolute = resolve(cwd, expanded);
	try { return realpathSync(absolute); } catch { return absolute; }
}

function loadedSkillPaths(messages: ContextEvent["messages"], systemPrompt: string, cwd: string) {
	const loaded = new Set<string>();
	const reads = new Map<string, string>();
	const scan = (text: string) => {
		for (const match of text.matchAll(/<skill\s+name="[^"]*"\s+location="([^"]+)">[\s\S]*?<\/skill>/g)) {
			const path = match[1].replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
			loaded.add(skillPath(path, cwd));
		}
	};
	scan(systemPrompt);
	for (const message of messages) {
		if ("content" in message) scan(textOf(message));
		if (message.role === "assistant") {
			for (const part of message.content) {
				if (part.type === "toolCall" && part.name === "read" && typeof part.arguments.path === "string" &&
					(part.arguments.offset === undefined || part.arguments.offset === 1) && part.arguments.limit === undefined) {
					reads.set(part.id, skillPath(part.arguments.path, cwd));
				}
			}
		}
		if (message.role === "toolResult" && message.toolName === "read" && !message.isError) {
			const path = reads.get(message.toolCallId);
			const details: unknown = message.details;
			const truncated = isRecord(details) && isRecord(details.truncation) && details.truncation.truncated;
			if (path && !truncated && !/\[(?:Output truncated|Showing lines )/.test(textOf(message))) loaded.add(path);
		}
	}
	return loaded;
}

function skillMessage(loaded: LoadedSkill[]): ContextEvent["messages"][number] {
	return { role: "custom", customType: "jev-skills", content: `<jev-router-skills>\n${loaded.map((skill) => skill.content).join("\n\n")}\n</jev-router-skills>`, display: false, timestamp: 0 };
}

export { isLoadedSkill, skillPath, loadedSkillPaths, skillMessage };
export type { LoadedSkill };
