import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import { AIMessage, AIMessageChunk } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import { ChatGenerationChunk } from '@langchain/core/outputs';

export interface ScriptedReply {
  text?: string;
  toolCalls?: { id: string; name: string; args: Record<string, unknown> }[];
  /** Throws instead of answering, to simulate a provider failure. */
  error?: Error;
  /** Throws after streaming `text`, to simulate a provider failing partway through a reply. */
  errorAfterText?: Error;
  /** Pauses before each word, so a test has time to disconnect mid-reply. */
  delayMs?: number;
  stopReason?: string;
}

/** Message ids must be unique, because LangGraph merges messages that share one. */
let nextMessageId = 0;

/** A chat model that plays back fixed replies and records the messages it was sent. */
export class ScriptedChatModel extends BaseChatModel {
  readonly seen: BaseMessage[][] = [];
  private turn = 0;

  constructor(private readonly replies: ScriptedReply[]) {
    super({});
  }

  _llmType(): string {
    return 'scripted';
  }

  override bindTools(): this {
    return this;
  }

  private next(messages: BaseMessage[]): { reply: ScriptedReply; id: string } {
    this.seen.push(messages);
    const reply = this.replies[this.turn];
    this.turn += 1;
    if (!reply) throw new Error('ScriptedChatModel ran out of replies');
    if (reply.error) throw reply.error;
    nextMessageId += 1;
    return { reply, id: `scripted-${nextMessageId}` };
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const { reply, id } = this.next(messages);
    const message = new AIMessage({
      id,
      content: reply.text ?? '',
      tool_calls: reply.toolCalls?.map((call) => ({ ...call, type: 'tool_call' as const })),
    });
    return { generations: [{ text: reply.text ?? '', message }] };
  }

  override async *_streamResponseChunks(
    messages: BaseMessage[],
    _options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    const { reply, id } = this.next(messages);

    for (const word of (reply.text ?? '').match(/\S+\s*/g) ?? []) {
      if (reply.delayMs) await new Promise((resolve) => setTimeout(resolve, reply.delayMs));
      const chunk = new ChatGenerationChunk({
        text: word,
        message: new AIMessageChunk({ id, content: word }),
      });
      yield chunk;
      await runManager?.handleLLMNewToken(word, undefined, undefined, undefined, undefined, {
        chunk,
      });
    }
    if (reply.errorAfterText) throw reply.errorAfterText;

    // Real providers report the last chunk to the callback too, which carries usage and stop reason.
    const last = new ChatGenerationChunk({
      text: '',
      message: new AIMessageChunk({
        id,
        content: '',
        tool_call_chunks: reply.toolCalls?.map((call, index) => ({
          type: 'tool_call_chunk' as const,
          id: call.id,
          name: call.name,
          args: JSON.stringify(call.args),
          index,
        })),
        usage_metadata: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        response_metadata: reply.stopReason ? { stop_reason: reply.stopReason } : {},
      }),
    });
    yield last;
    await runManager?.handleLLMNewToken('', undefined, undefined, undefined, undefined, {
      chunk: last,
    });
  }
}
