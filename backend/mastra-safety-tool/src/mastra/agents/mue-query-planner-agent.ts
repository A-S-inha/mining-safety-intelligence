import { Agent } from '@mastra/core/agent';
import { mueNimModel } from '../lib/mue-model';
import { mueQueryPlannerInstructions } from '../prompts/mue-prompts';

export const mueQueryPlannerAgent = new Agent({
  id: 'mue-query-planner',
  name: 'MUE Query Planner',
  description: 'Turns user hazard / mine context into MSHA search parameters.',
  instructions: mueQueryPlannerInstructions,
  model: mueNimModel,
});
