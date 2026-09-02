import type { ExtractedTechnicalTask } from '@brotomap/shared';
import { loadEnv, modelFor } from '../config/env.js';
import { createGroqProvider } from '../ai/providers/groq.js';
import { runDiscover } from '../ai/stages/discover.js';
import { runUnderstand } from '../ai/stages/understand.js';

/**
 * Runs stage 1 against a real extracted task, from the terminal.
 *
 * Being able to exercise one stage without the browser, the extension or the
 * rest of the pipeline is what keeps "was it extraction, reasoning or
 * planning?" answerable in one command.
 */

const SAMPLE: ExtractedTechnicalTask = {
  source: 'brototype',
  extractedAt: new Date().toISOString(),
  pageUrl: 'https://student.brototype.com/tasks/module/details',
  module: { title: 'Module 26', isCurrent: true },
  task: { category: 'technical', title: 'Basics of JavaScript', declaredTopicCount: 5 },
  topics: [
    {
      index: 1,
      title: 'JavaScript Basics',
      content:
        'a). Understand JavaScript syntax, variables (var, let, const), and basic data types (string, number, boolean, etc.).\nb). Learn operators (arithmetic, logical, comparison).\nc). Practice input and output operations using prompt(), alert(), and console.log().\nWrite a short description about this task.',
      sections: [],
      links: [],
      attachments: [],
      expansion: 'already-visible',
      complete: true,
    },
    {
      index: 2,
      title: 'Control Flow & Loops',
      content:
        'a). Learn if-else statements, switch cases, and ternary operators.\nb). Explore loops: for, while, do-while.\nc). Understand the concept of scope and hoisting.',
      sections: [],
      links: [],
      attachments: [],
      expansion: 'expanded-by-us',
      complete: true,
    },
    {
      index: 3,
      title: 'Working with Data Types',
      content:
        'a). Explore inbuilt data types: strings, arrays, and objects.\nb). Learn string methods (e.g., slice(), toUpperCase()), array methods (e.g., push(), filter()), and basic object properties.\nc). Understand object methods, constructors, and traversing objects.',
      sections: [],
      links: [],
      attachments: [],
      expansion: 'expanded-by-us',
      complete: true,
    },
    {
      index: 4,
      title: 'Functions, Error Handling, and OOP Basics',
      content:
        'a). Understand arrow functions and their syntax.\nb). Learn about error handling using try-catch.\nc). Get an introduction to Object-Oriented Programming (OOP) in JavaScript, covering basic concepts like classes, objects, and methods.',
      sections: [],
      links: [],
      attachments: [],
      expansion: 'expanded-by-us',
      complete: true,
    },
    {
      index: 5,
      title: 'Asynchronous Programming & Node Modules',
      content:
        'a). Learn about asynchronous programming with async/await and promises.\nb). Understand Node.js modules and how to use NPM (Node Package Manager).\nc). Install and use basic Node.js modules.',
      sections: [],
      links: [],
      attachments: [],
      expansion: 'expanded-by-us',
      complete: true,
    },
  ],
  links: [],
  attachments: [],
  detection: {
    confidence: 'medium',
    score: 0.6,
    matchedSignals: ['category-label'],
    candidates: [],
    warnings: [],
    interactionCount: 8,
  },
  stats: { topicCount: 5, totalChars: 1324, truncated: false },
};

async function main(): Promise<void> {
  const env = loadEnv();
  console.log(`\nModel: ${modelFor(env, 'fast')}\nTask:  ${SAMPLE.task.title} (${SAMPLE.topics.length} topics)\n`);

  const provider = createGroqProvider(env);
  const result = await runUnderstand(provider, SAMPLE);
  const u = result.value;

  console.log(`Took ${(result.ms / 1000).toFixed(1)}s, ${result.calls} call(s)${result.repaired ? ', repaired once' : ''}\n`);
  console.log(`SUMMARY\n  ${u.summary}\n`);
  console.log(`DOMAIN\n  ${u.domain}  [${u.stack.join(', ')}]\n`);
  console.log('LEARNING OBJECTIVES');
  for (const objective of u.learningObjectives) {
    console.log(`  - ${objective}`);
  }
  console.log(`\nREQUIREMENTS (${u.requirements.length})`);
  for (const requirement of u.requirements) {
    const mark = requirement.source === 'implicit' ? ' [implicit]' : '';
    console.log(`  ${requirement.id} (${requirement.kind})${mark} ${requirement.text}`);
    if (requirement.reason !== undefined) {
      console.log(`       why: ${requirement.reason}`);
    }
  }
  console.log(`\nPROJECT\n  ${u.project.present ? (u.project.summary ?? 'present') : 'none in this task'}`);
  console.log(`\nAMBIGUITIES\n  ${u.ambiguities.length === 0 ? 'none' : u.ambiguities.join('\n  ')}`);

  if (process.argv.includes('--map')) {
    await showKnowledgeMap(provider, u);
  }
}

/**
 * The knowledge map, printed as a tree.
 *
 * The number worth watching is how many nodes are "supporting". Those are the
 * things the task never mentioned, and they are the entire reason this stage
 * exists: a map made only of what the task already said has restated it.
 */
async function showKnowledgeMap(
  provider: ReturnType<typeof createGroqProvider>,
  understanding: Parameters<typeof runDiscover>[1],
): Promise<void> {
  console.log('\n--- building the knowledge map ---\n');

  const result = await runDiscover(provider, understanding);
  const map = result.value;
  const totals = map.totals;

  console.log(
    `${totals.nodeCount} nodes in ${(result.ms / 1000).toFixed(1)}s (${result.gapsFound} added by the gap pass)`,
  );
  console.log(
    `  explicit ${totals.byCategory.explicit} | supporting ${totals.byCategory.supporting} | optional ${totals.byCategory.optional}`,
  );
  console.log(
    `  basic ${totals.byDifficulty.basic} | medium ${totals.byDifficulty.medium} | advanced ${totals.byDifficulty.advanced}  =  ${(totals.effortMinutes / 60).toFixed(1)} hours\n`,
  );

  for (const repair of result.repairs) {
    console.log(`  ! ${repair}`);
  }

  console.log('\nLEARNING ORDER');
  const byId = new Map(map.nodes.map((current) => [current.id, current]));

  for (const [position, id] of map.sequence.entries()) {
    const current = byId.get(id);

    if (current === undefined) {
      continue;
    }

    const mark = current.category === 'supporting' ? '+' : current.category === 'optional' ? '~' : ' ';
    const indent = '  '.repeat(current.depth ?? 0);
    console.log(
      `${String(position + 1).padStart(3)}. ${mark} ${indent}${current.title}  [${current.difficulty}, ${current.effortMinutes}m]`,
    );
  }

  console.log('\n  + = the task never mentioned this   ~ = optional depth\n');

  const supporting = map.nodes.filter((current) => current.category === 'supporting');
  console.log(`WHAT THE TASK DID NOT SAY (${supporting.length})`);

  for (const current of supporting.slice(0, 12)) {
    console.log(`  - ${current.title}: ${current.whyItMatters}`);
  }

  console.log('');
}

main().catch((error: unknown) => {
  console.error(`\nFAILED: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
