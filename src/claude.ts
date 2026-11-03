import Anthropic from '@anthropic-ai/sdk';
import { requestUrl } from 'obsidian';
import { makeRequestFetch } from './core/fetch-adapter';
import type { Effort } from './settings';

/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set([
	'claude-opus-5-5',
	'claude-opus-5',
	'claude-fable-5-1',
	'claude-sonnet-5-5',
]);

export interface CallResult {
	text: string;
	usage: string;
}

export interface CallOptions {
	apiKey: string;
	model: string;
	effort: Effort;
	system: string;
	user: string;
	/** JSON schema for structured output, or null for a free-text answer. */
	schema: Record<string, unknown> | null;
}

function describeUsage(u: Anthropic.Beta.BetaUsage): string {
	const cached = u.cache_read_input_tokens ?? 0;
	return `${u.input_tokens + cached + (u.cache_creation_input_tokens ?? 0)} in (${cached} cached) · ${u.output_tokens} out`;
}

function friendlyError(e: unknown): Error {
	if (e instanceof Anthropic.AuthenticationError)
		return new Error('The API key was rejected. Check the secret in settings.');
	if (e instanceof Anthropic.PermissionDeniedError)
		return new Error('This API key cannot use the selected model.');
	if (e instanceof Anthropic.NotFoundError)
		return new Error('Model not found. Check the model in settings.');
	if (e instanceof Anthropic.RateLimitError)
		return new Error('Rate limited by the API. Try again in a minute.');
	if (e instanceof Anthropic.BadRequestError)
		return new Error(`The API rejected the request: ${e.message}`);
	if (e instanceof Anthropic.APIError)
		return new Error(`API error ${String(e.status ?? '')}: ${e.message}`);
	return e instanceof Error ? e : new Error(String(e));
}

/** One Claude call over Obsidian's requestUrl (no CORS limits on mobile). */
export async function callClaude(opts: CallOptions): Promise<CallResult> {
	const client = new Anthropic({
		apiKey: opts.apiKey,
		dangerouslyAllowBrowser: true,
		fetch: makeRequestFetch(requestUrl),
	});
	const useFallback = FALLBACK_MODELS.has(opts.model);
	try {
		const message = await client.beta.messages
			.stream({
				model: opts.model,
				max_tokens: 32000,
				thinking: { type: 'adaptive' },
				output_config: {
					effort: opts.effort,
					...(opts.schema ? { format: { type: 'json_schema', schema: opts.schema } } : {}),
				},
				cache_control: { type: 'ephemeral' },
				system: [{ type: 'text', text: opts.system }],
				messages: [{ role: 'user', content: opts.user }],
				...(useFallback
					? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
					: {}),
			})
			.finalMessage();

		if (message.stop_reason === 'refusal') {
			const category = message.stop_details?.category ?? 'unspecified';
			throw new Error(`Claude declined this request (category: ${category}).`);
		}
		if (message.stop_reason === 'max_tokens') {
			throw new Error(
				'The response was cut off (output limit reached). Try a lower effort or a shorter note.',
			);
		}
		const text = message.content
			.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
			.map((b) => b.text)
			.join('');
		return { text, usage: describeUsage(message.usage) };
	} catch (e) {
		throw friendlyError(e);
	}
}
