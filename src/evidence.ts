import { createHash } from "node:crypto";
import type { Context } from "@earendil-works/pi-ai";

import { CHUNK_OVERLAP, EVALUATION_BYTES, MAX_CHUNKS, MAX_FAILURE_EXCERPT, MAX_ROUTING_FAILURES, ROUTING_BYTES } from "./config";
import { RoutingBudgetError } from "./errors";
import { digest, isRecord } from "./util";

const serializedQuestions = new WeakMap<object, string>();
function fitsEvaluation(state: unknown, questions: unknown) {
	if (typeof questions !== "object" || questions === null) {
		return Buffer.byteLength(JSON.stringify({ state, questions, providerOptions: {} }), "utf8") <= EVALUATION_BYTES;
	}
	// Reuse the serialized questions across budget probes; the envelope below is byte-identical
	// to JSON.stringify({ state, questions, providerOptions: {} }) for this key order.
	let encoded = serializedQuestions.get(questions);
	if (encoded === undefined) {
		encoded = JSON.stringify(questions);
		serializedQuestions.set(questions, encoded);
	}
	return Buffer.byteLength(`{"state":${JSON.stringify(state)},"questions":${encoded},"providerOptions":{}}`, "utf8") <= EVALUATION_BYTES;
}

function textOf(message: { content: Context["messages"][number]["content"] }): string {
	return typeof message.content === "string" ? message.content :
		message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
}

type ToolFailureEvidence = { tool: string; isError: true; excerpt?: string };

function redactFailure(text: string) {
	return text
		.replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi, "[REDACTED PRIVATE KEY]")
		.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
		.replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|rk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|sentry_[A-Za-z0-9_-]{20,}|rnd[_-][A-Za-z0-9_-]{20,})\b/gi, "[REDACTED TOKEN]")
		.replace(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/gi, "[REDACTED AWS KEY]")
		.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s\/:@]+:[^\s\/@]+@/gi, "$1[REDACTED]@")
		.replace(/(\b(?:[A-Za-z0-9]+[_-])*(?:api[_-]?(?:key|token)|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|client[_-]?secret|secret[_-]?access[_-]?key|private[_-]?key|pass(?:word|phrase)|secret|token))\s*[:=]\s*(?:\"[^\"]*\"|'[^']*'|[^\s,;]+)/gi, "$1=[REDACTED]");
}

function toolFailureEvidence(context: Context) {
	const errors = context.messages.filter((message) => {
		const result = message as unknown as { role?: unknown; isError?: unknown };
		return result.role === "toolResult" && result.isError === true;
	}).slice(-MAX_ROUTING_FAILURES);
	const failures: ToolFailureEvidence[] = errors.map((message) => {
		const metadata = message as typeof message & { toolName?: unknown; timestamp?: unknown };
		const text = redactFailure(textOf(message));
		const marker = "\n[excerpt omitted]\n";
		const room = MAX_FAILURE_EXCERPT - marker.length;
		const head = Math.ceil(room / 2);
		const excerpt = text.length > MAX_FAILURE_EXCERPT ? `${text.slice(0, head)}${marker}${text.slice(-(room - head))}` : text;
		return { tool: typeof metadata.toolName === "string" ? metadata.toolName.slice(0, 80) : "tool", isError: true, ...(excerpt ? { excerpt } : {}) };
	});
	return {
		failures,
		key: digest(errors.map((message) => {
			const metadata = message as typeof message & { toolName?: unknown; timestamp?: unknown };
			return [metadata.timestamp, metadata.toolName, digest(textOf(message))];
		})),
	};
}

export function routingInput(context: Context, limit = 8) {
	// Pi converts custom context messages to user messages before provider dispatch.
	// Our injected instructions are not a new user turn or routing evidence.
	context = { ...context, messages: context.messages.filter((message) => {
		const text = textOf(message);
		return message.role !== "user" || !text.startsWith("<jev-router-skills>\n") || !text.endsWith("\n</jev-router-skills>");
	}) };
	const index = context.messages.findLastIndex((message) => message.role === "user");
	const user = context.messages[index];
	const text = user ? textOf(user) : "";
	const key = createHash("sha256").update(JSON.stringify([user?.timestamp, text])).digest("hex");
	if (!text.trim()) return { key, messages: undefined };
	if (Buffer.byteLength(text, "utf8") > ROUTING_BYTES) {
		return { key, messages: undefined, reason: `latest user text exceeds the ${ROUTING_BYTES}-byte routing limit` };
	}
	const messages: { role: string; text: string }[] = [];
	let bytes = 0;
	for (let i = index; i >= 0 && messages.length < limit; i--) {
		const message = context.messages[i];
		if (message.role !== "user" && message.role !== "assistant") continue;
		const content = textOf(message);
		if (!content.trim()) continue;
		const size = Buffer.byteLength(content, "utf8");
		if (bytes + size > ROUTING_BYTES) break;
		bytes += size;
		messages.unshift({ role: message.role, text: content });
	}
	return { key, messages };
}

function chunkRoutingText(text: string, questions: unknown, failures: ToolFailureEvidence[] = []) {
	// Code-point offsets keep Unicode intact across both boundaries and overlaps.
	const characters = Array.from(text);
	const requestExcerpts = { opening: characters.slice(0, 256).join(""), closing: characters.slice(-256).join("") };
	const makeChunk = (index: number, start: number, end: number) => ({
		stage: "chunk", requestExcerpts,
		...(failures.length ? { failures } : {}),
		chunk: { index, start, end, text: characters.slice(start, end).join("") },
	});
	const chunks: ReturnType<typeof makeChunk>[] = [];
	for (let start = 0; start < characters.length;) {
		if (chunks.length === MAX_CHUNKS) throw new RoutingBudgetError(`task requires more than ${MAX_CHUNKS} routing chunks; no partial assessment used`);
		let low = start + 1, high = characters.length, end = start;
		while (low <= high) {
			const middle = Math.floor((low + high) / 2);
			if (fitsEvaluation(makeChunk(chunks.length, start, middle), questions)) {
				end = middle;
				low = middle + 1;
			} else high = middle - 1;
		}
		// Prefer a nearby paragraph/line boundary without making tiny chunks.
		if (end < characters.length) {
			for (let boundary = end; boundary > start + (end - start) * 0.75; boundary--) {
				if (characters[boundary - 1] === "\n") { end = boundary; break; }
			}
		}
		if (end - start <= CHUNK_OVERLAP && end < characters.length) {
			throw new RoutingBudgetError("route descriptions leave insufficient room for chunk evaluation");
		}
		chunks.push(makeChunk(chunks.length, start, end));
		if (end === characters.length) break;
		start = end - CHUNK_OVERLAP;
	}
	return chunks;
}

export { fitsEvaluation, chunkRoutingText, textOf, toolFailureEvidence };
export type { ToolFailureEvidence };
