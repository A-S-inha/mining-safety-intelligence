import "dotenv/config";
import express from "express";
import cors from "cors";
import { z } from "zod";
import { findMuesWithAgent } from "./mastra/services/findMuesService";

const app = express();

app.use(
  cors({
    origin: "http://localhost:5173",
  })
);

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const findMuesRequestSchema = z.object({
  mineType: z.string().default(""),
  keyword: z.string().default(""),
});

app.post("/find-mues", async (req, res) => {
  try {
    const { mineType, keyword } = findMuesRequestSchema.parse(req.body);

    if (!mineType.trim() && !keyword.trim()) {
      return res.status(400).json({
        error: "Please provide a mineType or keyword.",
      });
    }

    const result = await findMuesWithAgent({ mineType, keyword });

    return res.json({
      mues: result.candidates,
      meta: {
        noMatchingRecords: result.noMatchingRecords,
        totalRecordsAnalyzed: result.totalRecordsAnalyzed,
        recordsSentToModel: result.recordsSentToModel,
        message: result.message,
      },
    });
  } catch (error) {
    return res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Failed to generate MUE candidates.",
    });
  }
});

const PORT = 4000;

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});