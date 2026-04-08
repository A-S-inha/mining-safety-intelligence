import type { MastraModelConfig } from '@mastra/core/llm';

/**
 * NVIDIA NIM — OpenAI-compatible chat completions.
 * @see https://docs.api.nvidia.com/nim/reference/llm-apis
 *
 * Hosted `integrate.api.nvidia.com/v1` expects `"model": "meta/llama-3.3-70b-instruct"` in the JSON body
 * (see meta-llama-3_3-70b-instruct-infer). A catalog id like `nvidia/meta/llama-3.3-70b-instruct` returns 404 there.
 * Self-hosted or other bases may differ — override with NVIDIA_NIM_MODEL.
 */
function trimEnv(value: string | undefined): string | undefined {
  const t = value?.trim();
  return t === '' ? undefined : t;
}

/** API key sent as `Authorization: Bearer …`. Empty → NIM returns 401 Unauthorized. */
export function getNimApiKey(): string {
  return trimEnv(process.env.NVIDIA_API_KEY) ?? trimEnv(process.env.NIM_API_KEY) ?? '';
}

const nimBaseUrl =
  trimEnv(process.env.NVIDIA_NIM_BASE_URL) ?? 'https://integrate.api.nvidia.com/v1';
const nimModelId =
  trimEnv(process.env.NVIDIA_NIM_MODEL) ?? 'meta/llama-3.3-70b-instruct';

export const mueNimModel: MastraModelConfig = {
  providerId: 'nvidia-nim',
  modelId: nimModelId,
  url: nimBaseUrl,
  apiKey: getNimApiKey(),
};
