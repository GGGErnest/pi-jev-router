import { createHash } from "node:crypto";
import { clampThinkingLevel, getSupportedThinkingLevels, type Api, type Model, type ModelThinkingLevel } from "@earendil-works/pi-ai";

import { ASTRA_MODEL, ASTRA_PROVIDER, THINKING_LEVELS, type RouteOption } from "./config";
import { isRecord } from "./util";

const AUTO_THINKING: Record<ModelThinkingLevel, string> = {
	off: "Mechanical transformations, rote answers, or trivial facts. No deliberation needed.",
	minimal: "Tiny, obvious changes that need only a quick check.",
	low: "Straightforward work with clear requirements and few steps.",
	medium: "Multi-step implementation or debugging with moderate ambiguity.",
	high: "Difficult debugging, architecture, or security-sensitive work requiring careful validation.",
	xhigh: "Very complex investigations with many interacting constraints.",
	max: "Exceptionally difficult problems requiring exhaustive reasoning. Avoid for routine work.",
};

function thinkingProfiles(model: Model<Api>, route: RouteOption, minimum: ModelThinkingLevel | undefined, inherited: ModelThinkingLevel = "off") {
	const choices = route.thinking === "auto" ? AUTO_THINKING : typeof route.thinking === "object" ? route.thinking : undefined;
	const floor = model.provider === ASTRA_PROVIDER && model.id === ASTRA_MODEL && route.minThinking !== undefined
		? THINKING_LEVELS.indexOf(route.minThinking)
		: Math.max(THINKING_LEVELS.indexOf(minimum ?? "off"), THINKING_LEVELS.indexOf(route.minThinking ?? "off"));
	const supported = getSupportedThinkingLevels(model).filter((level) => THINKING_LEVELS.indexOf(level) >= floor);
	const requested = clampThinkingLevel(model, typeof route.thinking === "string" && route.thinking !== "auto" ? route.thinking : inherited);
	const levels = choices ? supported.filter((level) => Object.hasOwn(choices, level))
		: supported.filter((level) => THINKING_LEVELS.indexOf(level) >= THINKING_LEVELS.indexOf(requested)).slice(0, 1);
	return levels.map((thinking) => ({ thinking, effort: choices?.[thinking] ?? "User-configured effort." }));
}

type EffortEntry = { sessionId: string; key: string; thinking: ModelThinkingLevel; update?: { index: number; prefix: string } };

export function effortPayload(payload: unknown, entries: EffortEntry[], thinking: ModelThinkingLevel, initial: ModelThinkingLevel, mapping: Model<Api>["thinkingLevelMap"] = {}) {
	if (!isRecord(payload) || !Array.isArray(payload.input) || !isRecord(payload.reasoning)) {
		throw new Error("Astra adaptive thinking requires a Responses input array and reasoning settings.");
	}
	if (payload.context_management !== undefined || (payload.truncation !== undefined && payload.truncation !== "disabled")) {
		throw new Error("Astra effort updates cannot be combined with provider-side automatic compaction or truncation.");
	}
	const raw = payload.input;
	const apiEffort = (level: ModelThinkingLevel) => level === "off" ? mapping?.off ?? "none" : mapping?.[level] ?? level;
	const updates = new Map<number, ModelThinkingLevel>();
	// Serialize each input item once, then reuse it for every stored prefix check instead of
	// re-stringifying the whole prefix once per update.
	const serialized = raw.map((item) => item === undefined ? "null" : JSON.stringify(item) ?? "null");
	const prefixHash = (end: number) => createHash("sha256").update(`[${serialized.slice(0, end).join(",")}]`).digest("hex");
	for (const entry of entries) {
		if (entry.update && entry.update.index <= raw.length && prefixHash(entry.update.index) === entry.update.prefix) {
			updates.set(entry.update.index, entry.thinking);
		}
	}
	const ordered = [...updates].sort(([a], [b]) => a - b);
	const previous = ordered.at(-1)?.[1] ?? initial;
	const update = previous !== thinking ? { index: raw.length, prefix: prefixHash(raw.length) } : undefined;
	if (update) updates.set(update.index, thinking);
	const input: unknown[] = [];
	for (let index = 0; index <= raw.length; index++) {
		const effort = updates.get(index);
		if (effort) input.push({ type: "configuration_update", reasoning: { effort: apiEffort(effort) } });
		if (index < raw.length) {
			if (isRecord(raw[index]) && raw[index].type === "configuration_update") throw new Error("Astra effort updates must be owned by Jev, not another payload hook.");
			input.push(raw[index]);
		}
	}
	return { payload: { ...payload, reasoning: { ...payload.reasoning, effort: apiEffort(initial) }, input }, update };
}

export { AUTO_THINKING, thinkingProfiles };
export type { EffortEntry };
