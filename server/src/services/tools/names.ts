/** Kept apart from the tool implementations so validation does not load LangChain. */
export const BUILTIN_TOOL_NAMES = [
  'http_request',
  'web_fetch',
  'calculator',
  'current_time',
] as const;
export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number];
