import { MongoDBSaver } from '@langchain/langgraph-checkpoint-mongodb';
import { MongoClient } from 'mongodb';
import { errorMessage } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

// The checkpointer package needs the v6 driver while Mongoose bundles v7, so it holds its own
// connection to the same database instead of sharing Mongoose's client.
let client: MongoClient | undefined;
let saver: MongoDBSaver | undefined;

export async function initCheckpointer(uri: string): Promise<void> {
  client = new MongoClient(uri);
  await client.connect();
  saver = new MongoDBSaver({ client });
  const problems = await saver.setup();
  for (const problem of problems) {
    logger.warn({ error: problem.message }, 'Checkpoint index setup problem');
  }
}

export function getCheckpointer(): MongoDBSaver {
  if (!saver) throw new Error('Checkpointer is not initialized');
  return saver;
}

export async function closeCheckpointer(): Promise<void> {
  await client?.close();
  client = undefined;
  saver = undefined;
}

/** Removes a conversation's graph state. Failure is logged because the data is unreachable anyway. */
export async function deleteThreadCheckpoints(threadId: string): Promise<void> {
  if (!saver) return;
  try {
    await saver.deleteThread(threadId);
  } catch (error) {
    logger.warn({ error: errorMessage(error) }, 'Could not delete thread checkpoints');
  }
}
