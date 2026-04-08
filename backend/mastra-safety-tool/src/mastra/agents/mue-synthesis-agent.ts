import { Agent } from '@mastra/core/agent';
import { mueNimModel } from '../lib/mue-model';
import { mueSynthesisAgentInstructions } from '../prompts/mue-prompts';

export const mueSynthesisAgent = new Agent({
  id: 'mue-synthesis',
  name: 'MUE Synthesis Agent',
  description: 'Clusters MSHA records into ranked CCM Step 2 candidate MUEs (structured JSON).',
  instructions: mueSynthesisAgentInstructions,
  model: mueNimModel,
});
