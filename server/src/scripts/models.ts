import { loadEnv, modelFor } from '../config/env.js';
import { listModels } from '../ai/providers/groq.js';

/**
 * Prints the models this key can actually use.
 *
 * Providers rename and decommission models constantly, so the id in .env is a
 * guess until it has been checked once. Better to find out here than three
 * stages into a pipeline run.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const configured = modelFor(env, 'fast');
  const models = await listModels(env);

  console.log(`\nModels available to this key (${models.length}):\n`);

  for (const model of models) {
    console.log(`  ${model === configured ? '*' : ' '} ${model}`);
  }

  console.log(
    models.includes(configured)
      ? `\nAI_MODEL="${configured}" is available.\n`
      : `\nAI_MODEL="${configured}" is NOT in this list. Set AI_MODEL in server/.env to one above.\n`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
