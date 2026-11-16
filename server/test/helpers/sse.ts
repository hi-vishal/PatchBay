export interface ParsedEvent {
  event: string;
  data: Record<string, unknown>;
}

/** Parses a complete SSE response body. */
export function parseSse(body: string): ParsedEvent[] {
  return body
    .split('\n\n')
    .filter((block) => block.startsWith('event:'))
    .map((block) => {
      const [eventLine, dataLine] = block.split('\n') as [string, string];
      return {
        event: eventLine.slice('event: '.length),
        data: JSON.parse(dataLine.slice('data: '.length)) as Record<string, unknown>,
      };
    });
}

export function tokensOf(events: ParsedEvent[]): string {
  return events
    .filter((item) => item.event === 'token')
    .map((item) => item.data.text)
    .join('');
}
