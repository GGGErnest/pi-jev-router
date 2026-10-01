import { createGateway } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

import { EVALUATION_CREDENTIALS, EVALUATION_MODEL, type EvaluationProvider } from "./config";
import { EvaluationAuthError, RoutingBudgetError } from "./errors";
import { abortable, isRecord } from "./util";

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
function retryableEvaluationError(error: unknown) {
	const status = isRecord(error) && typeof error.statusCode === "number" ? error.statusCode : undefined;
	return status !== undefined && RETRYABLE_STATUS.has(status);
}

// Safe to surface in notifications and saved diagnostics: never includes SDK error
// bodies, which may quote conversation text.
function safeErrorLabel(error: unknown): string {
	if (error instanceof RoutingBudgetError || error instanceof EvaluationAuthError) return error.message;
	if (error instanceof Error && error.name === "TimeoutError") return "timed out";
	const status = isRecord(error) && typeof error.statusCode === "number" ? error.statusCode : undefined;
	if (status !== undefined) return `HTTP ${status}`;
	if (error instanceof Error && error.name) return error.name;
	return "unknown failure";
}

// Shared Jev evaluation setup: resolve the configured provider's key through Pi's
// model-registry auth (never through settings.json) and build its evaluation model.
async function evaluationModel(registry: { getProviderAuth(provider: string): Promise<{ auth?: { apiKey?: string } } | undefined> }, provider: EvaluationProvider, signal?: AbortSignal) {
	const auth = await abortable(() => registry.getProviderAuth(provider), signal);
	if (!auth?.auth?.apiKey) {
		const { login, env } = EVALUATION_CREDENTIALS[provider];
		throw new EvaluationAuthError(`Jev evaluation provider "${provider}" is not authenticated. Configure ${login} or set ${env}.`);
	}
	return provider === "openrouter"
		? createOpenRouter({ apiKey: auth.auth.apiKey }).evaluationModel(EVALUATION_MODEL[provider])
		: createGateway({ apiKey: auth.auth.apiKey }).evaluationModel(EVALUATION_MODEL[provider]);
}

export { retryableEvaluationError, safeErrorLabel, evaluationModel };
