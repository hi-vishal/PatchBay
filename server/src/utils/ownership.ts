import { notFound } from './errors.js';

/**
 * Turns a missing document into a 404. Pair it with a query that filters on ownerId, so a
 * resource owned by someone else looks exactly like one that does not exist.
 */
export function orNotFound<T>(doc: T, resource: string): NonNullable<T> {
  if (!doc) throw notFound(resource);
  return doc as NonNullable<T>;
}
