import { createHash } from "node:crypto";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function digest(value: unknown) {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

// Bounded context fingerprint for adaptive-effort dedup. Hashing the full transcript on every
// request is O(context); the effort decision only inspects recent messages, so bind the digest
// to the message count plus a recent tail. Retries of the same request still match.
const CONTEXT_DIGEST_TAIL = 16;
function contextDigest(messages: unknown[], tail = CONTEXT_DIGEST_TAIL) {
	return digest([messages.length, messages.slice(-tail)]);
}

async function abortable<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
	signal?.throwIfAborted();
	if (!signal) return work();
	let onAbort: () => void = () => {};
	const cancelled = new Promise<never>((_, reject) => {
		onAbort = () => reject(signal.reason);
		signal.addEventListener("abort", onAbort, { once: true });
	});
	try {
		return await Promise.race([work(), cancelled]);
	} finally {
		signal.removeEventListener("abort", onAbort);
	}
}

function xmlAttribute(value: string) {
	return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export { isRecord, digest, contextDigest, abortable, xmlAttribute };
