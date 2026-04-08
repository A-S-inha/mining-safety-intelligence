import { registerApiRoute } from '@mastra/core/server';

/**
 * Task-spec HTTP surface. Paths must NOT start with `/api` (reserved for Mastra).
 * Handlers run in-process against the same Mastra instance (agents, workflows, tools).
 */
export const miningIntelligenceApiRoutes = [
  registerApiRoute('/find-mues', {
    method: 'POST',
    openapi: {
      summary: 'MUE Finder (CCM Step 2)',
      description: 'Runs the Mastra mue-finder-workflow (planner + research agent + synthesis agent + grounding).',
      tags: ['mining-intelligence'],
    },
    handler: async (c) => {
      const mastra = c.get('mastra');
      const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
      const keyword = typeof body?.keyword === 'string' ? body.keyword.trim() : '';
      const mineType = typeof body?.mineType === 'string' ? body.mineType.trim() : '';

      if (!keyword) {
        return c.json({ error: 'keyword is required (hazard or equipment terms)' }, 400);
      }

      const workflow = mastra.getWorkflow('mueFinderWorkflow');

      try {
        const run = await workflow.createRun();
        const out = await run.start({ inputData: { keyword, mineType } });

        if (out.status === 'success') {
          return c.json(out.result);
        }

        if (out.status === 'failed') {
          return c.json(
            {
              error: out.error?.message ?? 'Workflow failed',
              status: out.status,
            },
            500,
          );
        }

        return c.json(
          {
            error: `Workflow finished with status: ${out.status}`,
            status: out.status,
          },
          500,
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return c.json({ error: message }, 500);
      }
    },
  }),

  registerApiRoute('/find-controls', {
    method: 'POST',
    openapi: {
      summary: 'Control Gap Finder (CCM Step 3)',
      description: 'Placeholder — OSHA branch not implemented yet.',
      tags: ['mining-intelligence'],
    },
    handler: async (c) => {
      return c.json(
        {
          error: 'Not implemented',
          message: 'Control Gap Finder (OSHA) will run a Mastra workflow here in Part 2.',
          preventativeControls: [],
          mitigatingControls: [],
        },
        501,
      );
    },
  }),
];
