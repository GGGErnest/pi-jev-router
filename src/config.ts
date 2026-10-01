import type { ModelThinkingLevel } from "@earendil-works/pi-ai";

import { isRecord } from "./util";

const PROVIDER = "auto";
const MODEL = "jev";
type EvaluationProvider = "openrouter" | "vercel-ai-gateway";
// Jev evaluations run through exactly one configured provider. The provider is
// chosen only from jevRouter.evaluationProvider; a missing key fails closed and
// is never replaced by the other provider's credentials.
const EVALUATION_MODEL: Record<EvaluationProvider, string> = {
	openrouter: "typesafe/jev-1.13",
	"vercel-ai-gateway": "typesafe-ai/jev",
};
const EVALUATION_CREDENTIALS: Record<EvaluationProvider, { login: string; env: string }> = {
	openrouter: { login: "/login openrouter", env: "OPENROUTER_API_KEY" },
	"vercel-ai-gateway": { login: "/login vercel-ai-gateway", env: "AI_GATEWAY_API_KEY" },
};
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const EVALUATION_ATTEMPTS = 3;
// ponytail: Jev exposes no tokenizer. Count serialized UTF-8 bytes conservatively,
// leaving room below its documented ~32K-token budget; use its tokenizer if exposed.
const EVALUATION_BYTES = 28_000;
const ROUTING_BYTES = 192_000;
const MAX_CHUNKS = 8;
const CHUNK_OVERLAP = 128;
const CHUNK_CONCURRENCY = 2;
const MAX_ROUTING_FAILURES = 4;
const MAX_FAILURE_EXCERPT = 512;
const DEFAULT_POOR_FIT_THRESHOLD = 0.85;
const DEFAULT_SKILL_PROBABILITY = 0.8;
const DEFAULT_MAX_SKILLS = 3;
// Keep aligned with Pi's default compaction reserve (16,384 tokens).
const CONTEXT_RESERVE_TOKENS = 16_384;
// Codex Astra is the only route whose Responses requests are updated with append-only
// configuration_update items to preserve prompt-cache reuse, and the only route allowed to
// lower the global thinking floor through an explicit model minimum. Keep its identity in one
// place so these behaviors stay consistent if the model reference ever changes.
const ASTRA_REF = "openai-codex/gpt-6-astra";
const ASTRA_PROVIDER = "openai-codex";
const ASTRA_MODEL = "gpt-6-astra";
// TypeSafe Jev 1.13 bills $0.042 per 1M input tokens; output tokens are free.
const JEV_INPUT_COST_PER_MILLION = 0.042;

type ThinkingChoices = Partial<Record<ModelThinkingLevel, string>>;
type RouteCriteria = { role: string; use_when: string[]; not_for: string[]; boundary: string };
type RouteOption = { description: string | RouteCriteria; thinking?: ModelThinkingLevel | "auto" | ThinkingChoices; minThinking?: ModelThinkingLevel; adaptiveThinking?: boolean };
type RouteProfile = { target: string; thinking: ModelThinkingLevel; description: { model: string; task: string | RouteCriteria; thinking?: ModelThinkingLevel; effort: string; keepCurrentModel?: boolean } };
type EvaluationCost = { inputPerMillion: number; outputPerMillion: number };
type EvidenceScope = "recent" | "latest";
type Config = {
	options: Record<string, RouteOption>;
	fallback: string;
	timeoutMs: number;
	monitor: boolean;
	skills: boolean;
	evaluationProvider: EvaluationProvider;
	minThinking?: ModelThinkingLevel;
	pinFallback: boolean;
	poorFitThreshold: number;
	skillProbability: number;
	maxSkills: number;
	evidence: EvidenceScope;
	debug: boolean;
	evaluationCost: EvaluationCost;
};
const DEFAULT_CONFIG: Config = {
	options: {
		"openai-codex/gpt-5.6-luna": {
			description: "Cheap, fast, capable executor for clear goals and known approaches: bounded implementation, understood fixes, tests, translations, summaries, and routine configuration. Not for architecture, difficult debugging, uncertain root causes, or advisory judgment.",
			thinking: "max",
		},
		"openai-codex/gpt-5.6-sol": {
			description: "Middle tier for bounded implementation needing investigation, ordinary debugging, local correctness reviews, and integration within established architecture. Not for routine execution Luna can handle, architectural direction, difficult debugging, or high-stakes advice.",
			thinking: "auto",
		},
		[ASTRA_REF]: {
			description: "Highest-intelligence reasoning and advisor for critical thinking, recommendations, architecture, hard debugging, interacting failure modes, security-critical decisions, and complex ambiguity. Not for mechanical execution, simple summaries, or bounded implementation without substantive judgment.",
			thinking: "xhigh",
		},
	},
	fallback: ASTRA_REF,
	timeoutMs: 5000,
	monitor: true,
	skills: false,
	evaluationProvider: "vercel-ai-gateway",
	pinFallback: false,
	poorFitThreshold: DEFAULT_POOR_FIT_THRESHOLD,
	skillProbability: DEFAULT_SKILL_PROBABILITY,
	maxSkills: DEFAULT_MAX_SKILLS,
	evidence: "recent",
	debug: false,
	evaluationCost: { inputPerMillion: JEV_INPUT_COST_PER_MILLION, outputPerMillion: 0 },
};
type Selection = {
	target: string;
	thinking: ModelThinkingLevel;
	source: "jev" | "fallback" | "single" | "guarded";
	reason?: string;
	provisional?: boolean;
	inputTokens?: number;
	outputTokens?: number;
	evaluationRequests?: number;
	routingChunks?: number;
	usageIncomplete?: boolean;
};

type Pin = Pick<Selection, "target" | "thinking"> & { provisional?: boolean };

function confidentPoorFit(value: unknown, threshold: number) {
	return isRecord(value) && value.type === "boolean" && typeof value.probability === "number" &&
		Number.isFinite(value.probability) && value.probability >= threshold && value.probability <= 1;
}

function validDescription(value: unknown): value is string | RouteCriteria {
	if (typeof value === "string") return value.trim().length > 0;
	return isRecord(value) && [value.role, value.boundary].every((text) => typeof text === "string" && text.trim().length > 0)
		&& [value.use_when, value.not_for].every((items) => Array.isArray(items) && items.length > 0 && items.every((text) => typeof text === "string" && text.trim().length > 0));
}

function parseMinThinking(value: unknown, scope: string): ModelThinkingLevel | undefined {
	if (value === undefined) return undefined;
	const level = THINKING_LEVELS.find((level) => level === value);
	if (!level) throw new Error(`Invalid Jev minThinking for ${scope}.`);
	return level;
}

function parseBoolean(value: unknown, name: string, fallback: boolean) {
	if (value === undefined) return fallback;
	if (typeof value !== "boolean") throw new Error(`Jev ${name} must be a boolean.`);
	return value;
}

function parseProbability(value: unknown, name: string, fallback: number) {
	if (value === undefined) return fallback;
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(`Jev ${name} must be a number between 0 and 1.`);
	return value;
}

function parsePositiveInteger(value: unknown, name: string, fallback: number) {
	if (value === undefined) return fallback;
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error(`Jev ${name} must be a positive integer.`);
	return value;
}

function parseCostPerMillion(value: unknown, name: string, fallback: number) {
	if (value === undefined) return fallback;
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`Jev ${name} must be a non-negative number.`);
	return value;
}

function parseEvidence(value: unknown): EvidenceScope {
	if (value === undefined) return "recent";
	if (value !== "recent" && value !== "latest") throw new Error('Jev evidence must be "recent" or "latest".');
	return value;
}

export function parseConfig(value: unknown): Config {
	if (!isRecord(value) || !isRecord(value.options) || typeof value.fallback !== "string") {
		throw new Error("Jev configuration requires options and a fallback model.");
	}
	const options: Record<string, RouteOption> = {};
	for (const [ref, option] of Object.entries(value.options)) {
		if (!/^[^/]+\/.+/.test(ref) || ref.startsWith(`${PROVIDER}/`) ||
			!isRecord(option) || !validDescription(option.description)) {
			throw new Error(`Invalid Jev route: ${ref}`);
		}
		let thinking: RouteOption["thinking"];
		if (isRecord(option.thinking)) {
			const choices: ThinkingChoices = {};
			for (const [key, description] of Object.entries(option.thinking)) {
				const level = THINKING_LEVELS.find((level) => level === key);
				if (!level || typeof description !== "string" || !description.trim()) throw new Error(`Invalid Jev thinking choice for ${ref}: ${key}`);
				choices[level] = description;
			}
			if (!Object.keys(choices).length) throw new Error(`Jev thinking choices for ${ref} must not be empty.`);
			thinking = choices;
		} else {
			thinking = option.thinking === "auto" ? "auto" : THINKING_LEVELS.find((level) => level === option.thinking);
			if (option.thinking !== undefined && thinking === undefined) throw new Error(`Invalid Jev thinking level for ${ref}.`);
		}
		const adaptiveThinking = option.adaptiveThinking === undefined ? false : option.adaptiveThinking;
		if (typeof adaptiveThinking !== "boolean" || (adaptiveThinking &&
			(thinking !== "auto" && typeof thinking !== "object"))) {
			throw new Error(`Jev adaptiveThinking requires automatic or custom thinking choices: ${ref}`);
		}
		options[ref] = { description: option.description, thinking, minThinking: parseMinThinking(option.minThinking, ref), adaptiveThinking };
	}
	const timeoutMs = value.timeoutMs ?? 5000;
	if (!Object.hasOwn(options, value.fallback) || typeof timeoutMs !== "number" ||
		!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
		throw new Error("Jev fallback must be an allowed route; timeoutMs must be 1..60000.");
	}
	const monitor = value.monitor === undefined ? true : value.monitor;
	if (typeof monitor !== "boolean") throw new Error("Jev monitor must be a boolean.");
	const skills = value.skills === undefined ? false : value.skills;
	if (typeof skills !== "boolean") throw new Error("Jev skills must be a boolean.");
	const evaluationProvider = value.evaluationProvider === undefined ? "vercel-ai-gateway" : value.evaluationProvider;
	if (evaluationProvider !== "openrouter" && evaluationProvider !== "vercel-ai-gateway") {
		throw new Error("Jev evaluationProvider must be \"openrouter\" or \"vercel-ai-gateway\".");
	}
	if (value.evaluationCost !== undefined && !isRecord(value.evaluationCost)) throw new Error("Jev evaluationCost must be an object.");
	const evaluationCost = isRecord(value.evaluationCost) ? value.evaluationCost : {};
	return {
		options, fallback: value.fallback, timeoutMs, monitor, skills, evaluationProvider,
		minThinking: parseMinThinking(value.minThinking, "global floor"),
		pinFallback: parseBoolean(value.pinFallback, "pinFallback", false),
		poorFitThreshold: parseProbability(value.poorFitThreshold, "poorFitThreshold", DEFAULT_POOR_FIT_THRESHOLD),
		skillProbability: parseProbability(value.skillProbability, "skillProbability", DEFAULT_SKILL_PROBABILITY),
		maxSkills: parsePositiveInteger(value.maxSkills, "maxSkills", DEFAULT_MAX_SKILLS),
		evidence: parseEvidence(value.evidence),
		debug: parseBoolean(value.debug, "debug", false),
		evaluationCost: {
			inputPerMillion: parseCostPerMillion(evaluationCost.inputPerMillion, "evaluationCost.inputPerMillion", JEV_INPUT_COST_PER_MILLION),
			outputPerMillion: parseCostPerMillion(evaluationCost.outputPerMillion, "evaluationCost.outputPerMillion", 0),
		},
	};
}

export {
	PROVIDER, MODEL, EVALUATION_MODEL, EVALUATION_CREDENTIALS, ZERO_COST, THINKING_LEVELS, EVALUATION_ATTEMPTS,
	EVALUATION_BYTES, ROUTING_BYTES, MAX_CHUNKS, CHUNK_OVERLAP, CHUNK_CONCURRENCY, MAX_ROUTING_FAILURES,
	MAX_FAILURE_EXCERPT, DEFAULT_POOR_FIT_THRESHOLD, DEFAULT_SKILL_PROBABILITY, DEFAULT_MAX_SKILLS,
	CONTEXT_RESERVE_TOKENS, ASTRA_REF, ASTRA_PROVIDER, ASTRA_MODEL, JEV_INPUT_COST_PER_MILLION,
	DEFAULT_CONFIG, confidentPoorFit,
};
export type {
	EvaluationProvider, ThinkingChoices, RouteCriteria, RouteOption, RouteProfile, EvaluationCost,
	EvidenceScope, Config, Selection, Pin,
};
