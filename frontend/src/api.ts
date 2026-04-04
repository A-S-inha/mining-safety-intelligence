import type { ControlsResponse, FindMuesPayload, MUEItem } from "./types";

const API_BASE_URL = "http://localhost:4000";

export type QueryInterpretation = {
  normalizedMineType: string;
  expandedKeywords: string[];
  interpretation: string;
};

export type FindMuesResult = {
  mues: MUEItem[];
  noMatchingRecords: boolean;
  message?: string;
};

export type FindMuesAgenticResult = {
  mues: MUEItem[];
  noMatchingRecords: boolean;
  message?: string;
  interpretation?: QueryInterpretation;
  /** Backend pipeline label when present (e.g. tool-agent). */
  flow?: string;
};

function parseFindMuesResponse(
  rawText: string,
  routeLabel: string
): {
  mues: MUEItem[];
  noMatchingRecords: boolean;
  message?: string;
  interpretation?: QueryInterpretation;
  flow?: string;
} {
  let data: unknown;

  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    console.error(`[${routeLabel}] invalid JSON body`, rawText);
    throw new Error(`Invalid JSON from ${routeLabel}.`);
  }

  console.log(`[${routeLabel}] response body`, data);

  if (Array.isArray(data)) {
    return {
      mues: data as MUEItem[],
      noMatchingRecords: false,
      flow: undefined,
    };
  }

  const body = data as {
    mues?: MUEItem[];
    meta?: {
      noMatchingRecords?: boolean;
      message?: string;
      flow?: string;
      interpretation?: {
        normalizedMineType?: string;
        expandedKeywords?: string[];
        interpretation?: string;
      };
    };
  };

  const mues = Array.isArray(body.mues) ? body.mues : [];
  const noMatchingRecords = Boolean(body.meta?.noMatchingRecords);
  const message =
    typeof body.meta?.message === "string" ? body.meta.message : undefined;

  const interpretation = body.meta?.interpretation
    ? {
        normalizedMineType:
          typeof body.meta.interpretation.normalizedMineType === "string"
            ? body.meta.interpretation.normalizedMineType
            : "",
        expandedKeywords: Array.isArray(body.meta.interpretation.expandedKeywords)
          ? body.meta.interpretation.expandedKeywords
          : [],
        interpretation:
          typeof body.meta.interpretation.interpretation === "string"
            ? body.meta.interpretation.interpretation
            : "",
      }
    : undefined;

  const flow = typeof body.meta?.flow === "string" ? body.meta.flow : undefined;

  return {
    mues,
    noMatchingRecords,
    message: noMatchingRecords ? message : undefined,
    interpretation,
    flow,
  };
}

async function postFindMues(
  path: string,
  payload: FindMuesPayload,
  routeLabel: string
) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const rawText = await response.text();

  if (!response.ok) {
    let errorBody: { error?: string } | null = null;
    try {
      errorBody = rawText ? JSON.parse(rawText) : null;
    } catch {
      errorBody = null;
    }

    console.error(`[${routeLabel}] error response`, response.status, rawText);
    throw new Error(errorBody?.error ?? `Failed to fetch from ${routeLabel}.`);
  }

  return parseFindMuesResponse(rawText, routeLabel);
}

export async function findMues(
  payload: FindMuesPayload
): Promise<FindMuesResult> {
  const result = await postFindMues("/find-mues", payload, "find-mues");

  return {
    mues: result.mues,
    noMatchingRecords: result.noMatchingRecords,
    message: result.message,
  };
}

export async function findMuesAgentic(
  payload: FindMuesPayload
): Promise<FindMuesAgenticResult> {
  const result = await postFindMues(
    "/find-mues-agentic",
    payload,
    "find-mues-agentic"
  );

  return {
    mues: result.mues,
    noMatchingRecords: result.noMatchingRecords,
    message: result.message,
    interpretation: result.interpretation,
    flow: result.flow,
  };
}

export async function findMuesToolAgent(
  payload: FindMuesPayload
): Promise<FindMuesAgenticResult> {
  const result = await postFindMues(
    "/find-mues-tool-agent",
    payload,
    "find-mues-tool-agent"
  );

  return {
    mues: result.mues,
    noMatchingRecords: result.noMatchingRecords,
    message: result.message,
    interpretation: result.interpretation,
    flow: result.flow,
  };
}

export async function findControls(_mueName: string): Promise<ControlsResponse> {
  throw new Error("Control Gap Finder is not implemented yet.");
}