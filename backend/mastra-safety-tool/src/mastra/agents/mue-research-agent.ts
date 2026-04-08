import { Agent } from '@mastra/core/agent';
import { mueNimModel } from '../lib/mue-model';
import { mueResearchAgentInstructions } from '../prompts/mue-prompts';
import { mshaAccidentsTool } from '../tools/msha-accidents-tool';

export const mueResearchAgent = new Agent({
  id: 'mue-research',
  name: 'MUE MSHA Research Agent',
  description: 'Calls searchMshaAccidents to pull serious/fatal rows for synthesis.',
  instructions: mueResearchAgentInstructions,
  model: mueNimModel,
  tools: { mshaAccidentsTool },
});
