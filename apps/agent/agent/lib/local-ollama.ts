const OLLAMA_URL = "http://127.0.0.1:11434/api/generate";
const DEFAULT_TIMEOUT_MS = 120_000;

export type OllamaGeneration = {
	text: string;
	latencyMs: number;
};

export type OllamaClient = {
	generate(input: {
		model: string;
		prompt: string;
		timeoutMs?: number;
	}): Promise<OllamaGeneration>;
};

export function createLocalOllamaClient(
	fetchImpl: typeof fetch = fetch,
	endpoint = OLLAMA_URL,
): OllamaClient {
	return {
		async generate({ model, prompt, timeoutMs = DEFAULT_TIMEOUT_MS }) {
			const startedAt = performance.now();
			const response = await fetchImpl(endpoint, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					model,
					prompt,
					format: "json",
					stream: false,
					options: { temperature: 0 },
				}),
				signal: AbortSignal.timeout(timeoutMs),
			});

			if (!response.ok) {
				throw new Error(`Ollama returned HTTP ${response.status}.`);
			}

			const body = (await response.json()) as { response?: unknown };
			if (typeof body.response !== "string") {
				throw new Error("Ollama returned no text response.");
			}

			return {
				text: body.response,
				latencyMs: Math.round(performance.now() - startedAt),
			};
		},
	};
}
