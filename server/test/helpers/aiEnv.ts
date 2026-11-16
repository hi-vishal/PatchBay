import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { closeCheckpointer, initCheckpointer } from '../../src/services/graphs/checkpointer.js';

/** In-memory MongoDB for both Mongoose and the LangGraph checkpointer. */
export function useAiTestEnvironment(): void {
  let mongo: MongoMemoryServer;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
    await initCheckpointer(mongo.getUri());
  });

  afterEach(async () => {
    await Promise.all(Object.values(mongoose.models).map((model) => model.deleteMany({})));
  });

  afterAll(async () => {
    await closeCheckpointer();
    await mongoose.disconnect();
    await mongo.stop();
  });
}
