import type { ControlsResponse, FindMuesPayload, MUEItem } from "./types";

const API_BASE_URL = "http://localhost:4000";

export type FindMuesResult = {
  mues: MUEItem[];
  noMatchingRecords: boolean;
  message?: string;
};

export async function findMues(payload: FindMuesPayload): Promise<FindMuesResult> {
  const response = await fetch(`${API_BASE_URL}/find-mues`, {
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
    console.error("[find-mues] error response", response.status, rawText);
    throw new Error(errorBody?.error ?? "Failed to fetch MUE candidates.");
  }

  let data: unknown;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    console.error("[find-mues] invalid JSON body", rawText);
    throw new Error("Invalid JSON from find-mues.");
  }

  console.log("[find-mues] response body", data);

  if (Array.isArray(data)) {
    return { mues: data as MUEItem[], noMatchingRecords: false };
  }

  const body = data as {
    mues?: MUEItem[];
    meta?: { noMatchingRecords?: boolean; message?: string };
  };

  const mues = Array.isArray(body.mues) ? body.mues : [];
  const noMatchingRecords = Boolean(body.meta?.noMatchingRecords);
  const message =
    typeof body.meta?.message === "string" ? body.meta.message : undefined;

  return { mues, noMatchingRecords, message: noMatchingRecords ? message : undefined };
}

export async function findControls(_mueName: string): Promise<ControlsResponse> {
  throw new Error("Control Gap Finder is not implemented yet.");
}
