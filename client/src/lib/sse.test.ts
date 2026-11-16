import { describe, expect, it } from 'vitest';
import { parseSseBuffer } from './sse';

describe('parseSseBuffer', () => {
  it('parses complete events', () => {
    const { events, rest } = parseSseBuffer(
      'event: token\ndata: {"text":"Hi"}\n\nevent: done\ndata: {}\n\n',
    );
    expect(events).toEqual([
      { event: 'token', data: { text: 'Hi' } },
      { event: 'done', data: {} },
    ]);
    expect(rest).toBe('');
  });

  it('keeps an incomplete event for the next chunk', () => {
    const first = parseSseBuffer('event: token\ndata: {"text":"He');
    expect(first.events).toEqual([]);
    const second = parseSseBuffer(`${first.rest}llo"}\n\n`);
    expect(second.events).toEqual([{ event: 'token', data: { text: 'Hello' } }]);
  });

  it('handles a boundary split across chunks', () => {
    const first = parseSseBuffer('event: token\ndata: {"text":"a"}\n');
    expect(first.events).toEqual([]);
    const second = parseSseBuffer(`${first.rest}\n`);
    expect(second.events).toHaveLength(1);
  });

  it('ignores heartbeats', () => {
    const { events } = parseSseBuffer(': ping\n\nevent: token\ndata: {"text":"x"}\n\n');
    expect(events).toEqual([{ event: 'token', data: { text: 'x' } }]);
  });

  it('drops malformed JSON and continues', () => {
    const { events } = parseSseBuffer('event: token\ndata: {oops\n\nevent: done\ndata: {}\n\n');
    expect(events).toEqual([{ event: 'done', data: {} }]);
  });

  it('handles CRLF line endings', () => {
    const { events } = parseSseBuffer('event: done\r\ndata: {}\r\n\r\n');
    expect(events).toEqual([{ event: 'done', data: {} }]);
  });
});
