import { fail } from "./security.js";
export type Protocol = "openai" | "anthropic";
type ObjectValue = Record<string, any>;
const unsupported = () =>
  fail(400, "跨协议转发仅支持文本、工具调用及常用采样参数");
function textContent(value: any): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (
    Array.isArray(value) &&
    value.every((v) => v.type === "text" && typeof v.text === "string")
  )
    return value.map((v) => v.text).join("\n");
  return unsupported();
}
export function translateRequest(
  body: ObjectValue,
  from: Protocol,
  to: Protocol,
): ObjectValue {
  if (from === to) return { ...body };
  const allowed = new Set([
    "model",
    "messages",
    "stream",
    "max_tokens",
    "max_completion_tokens",
    "temperature",
    "top_p",
    "stop",
    "stop_sequences",
    "system",
    "tools",
    "tool_choice",
    "stream_options",
    "n",
    "parallel_tool_calls",
  ]);
  if (
    Object.keys(body).some((k) => !allowed.has(k)) ||
    (body.n && body.n !== 1)
  )
    unsupported();
  const common = {
    model: body.model,
    stream: body.stream ?? false,
    ...(body.temperature !== undefined
      ? { temperature: body.temperature }
      : {}),
    ...(body.top_p !== undefined ? { top_p: body.top_p } : {}),
  };
  if (to === "anthropic") {
    const system: string[] = [],
      messages: ObjectValue[] = [];
    for (const m of body.messages) {
      if (["system", "developer"].includes(m.role)) {
        system.push(textContent(m.content));
        continue;
      }
      if (m.role === "tool") {
        messages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: m.tool_call_id,
              content: textContent(m.content),
            },
          ],
        });
        continue;
      }
      if (!["user", "assistant"].includes(m.role)) unsupported();
      const content: ObjectValue[] = [];
      const text = textContent(m.content);
      if (text) content.push({ type: "text", text });
      for (const tool of m.tool_calls ?? []) {
        if (tool.type !== "function") unsupported();
        let input;
        try {
          input = JSON.parse(tool.function.arguments);
        } catch {
          return fail(400, "工具参数必须为 JSON");
        }
        content.push({
          type: "tool_use",
          id: tool.id,
          name: tool.function.name,
          input,
        });
      }
      messages.push({ role: m.role, content });
    }
    let tool_choice;
    if (body.tool_choice)
      tool_choice =
        typeof body.tool_choice === "string"
          ? { type: body.tool_choice === "required" ? "any" : body.tool_choice }
          : { type: "tool", name: body.tool_choice.function?.name };
    return {
      ...common,
      messages,
      max_tokens: body.max_completion_tokens ?? body.max_tokens,
      ...(system.length ? { system: system.join("\n\n") } : {}),
      ...(body.stop
        ? {
            stop_sequences:
              typeof body.stop === "string" ? [body.stop] : body.stop,
          }
        : {}),
      ...(body.tools
        ? {
            tools: body.tools.map((t: any) => {
              if (t.type !== "function" || t.function.strict) unsupported();
              return {
                name: t.function.name,
                description: t.function.description,
                input_schema: t.function.parameters ?? {
                  type: "object",
                  properties: {},
                },
              };
            }),
          }
        : {}),
      ...(tool_choice
        ? {
            tool_choice: {
              ...tool_choice,
              ...(body.parallel_tool_calls === false
                ? { disable_parallel_tool_use: true }
                : {}),
            },
          }
        : {}),
    };
  }
  const messages: ObjectValue[] = [];
  if (body.system)
    messages.push({ role: "system", content: textContent(body.system) });
  for (const m of body.messages) {
    if (!["user", "assistant"].includes(m.role)) unsupported();
    if (typeof m.content === "string") {
      messages.push({ role: m.role, content: m.content });
      continue;
    }
    if (!Array.isArray(m.content)) unsupported();
    const text: string[] = [],
      tool_calls: ObjectValue[] = [],
      results: ObjectValue[] = [];
    for (const part of m.content) {
      if (part.type === "text") text.push(part.text);
      else if (part.type === "tool_use" && m.role === "assistant")
        tool_calls.push({
          id: part.id,
          type: "function",
          function: { name: part.name, arguments: JSON.stringify(part.input) },
        });
      else if (part.type === "tool_result" && m.role === "user")
        results.push({
          role: "tool",
          tool_call_id: part.tool_use_id,
          content: textContent(part.content),
        });
      else unsupported();
    }
    messages.push(...results);
    if (text.length || tool_calls.length)
      messages.push({
        role: m.role,
        content: text.join("\n") || null,
        ...(tool_calls.length ? { tool_calls } : {}),
      });
  }
  const choice = body.tool_choice;
  return {
    ...common,
    messages,
    max_tokens: body.max_tokens,
    ...(body.stop_sequences ? { stop: body.stop_sequences } : {}),
    ...(body.tools
      ? {
          tools: body.tools.map((t: any) => {
            if (t.type || t.cache_control) unsupported();
            return {
              type: "function",
              function: {
                name: t.name,
                description: t.description,
                parameters: t.input_schema,
              },
            };
          }),
        }
      : {}),
    ...(choice
      ? {
          tool_choice:
            choice.type === "tool"
              ? { type: "function", function: { name: choice.name } }
              : choice.type === "any"
                ? "required"
                : choice.type,
          parallel_tool_calls: !choice.disable_parallel_tool_use,
        }
      : {}),
    ...(body.stream ? { stream_options: { include_usage: true } } : {}),
  };
}
export function translateResponse(
  value: ObjectValue,
  from: Protocol,
  to: Protocol,
  model: string,
) {
  if (from === to) return { ...value, model };
  if (
    from === "anthropic" &&
    (!Array.isArray(value.content) ||
      value.content.some(
        (part: any) => !["text", "tool_use"].includes(part.type),
      ))
  )
    throw Error("Unsupported upstream response content");
  if (to === "openai")
    return {
      id: value.id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content:
              value.content
                .filter((c: any) => c.type === "text")
                .map((c: any) => c.text)
                .join("") || null,
            ...(value.content.some((c: any) => c.type === "tool_use")
              ? {
                  tool_calls: value.content
                    .filter((c: any) => c.type === "tool_use")
                    .map((c: any) => ({
                      id: c.id,
                      type: "function",
                      function: {
                        name: c.name,
                        arguments: JSON.stringify(c.input),
                      },
                    })),
                }
              : {}),
          },
          finish_reason:
            value.stop_reason === "tool_use"
              ? "tool_calls"
              : value.stop_reason === "max_tokens"
                ? "length"
                : "stop",
        },
      ],
      usage: {
        prompt_tokens: value.usage?.input_tokens ?? 0,
        completion_tokens: value.usage?.output_tokens ?? 0,
        total_tokens:
          (value.usage?.input_tokens ?? 0) + (value.usage?.output_tokens ?? 0),
      },
    };
  const choice = value.choices?.[0];
  if (!choice) throw Error("Invalid upstream response");
  const content: ObjectValue[] = [];
  if (choice.message.content)
    content.push({ type: "text", text: textContent(choice.message.content) });
  for (const tool of choice.message.tool_calls ?? [])
    content.push({
      type: "tool_use",
      id: tool.id,
      name: tool.function.name,
      input: JSON.parse(tool.function.arguments),
    });
  return {
    id: value.id,
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason:
      choice.finish_reason === "tool_calls"
        ? "tool_use"
        : choice.finish_reason === "length"
          ? "max_tokens"
          : "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: value.usage?.prompt_tokens ?? 0,
      output_tokens: value.usage?.completion_tokens ?? 0,
    },
  };
}
export const sse = (value: any, event?: string) =>
  `${event ? `event: ${event}\n` : ""}data: ${typeof value === "string" ? value : JSON.stringify(value)}\n\n`;
// Bounded incremental parser, including CRLF, multiline data and split UTF-8 sequences.
export async function* parseSSE(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16 * 1024 * 1024) throw Error("Upstream response too large");
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 1024 * 1024) throw Error("Upstream event too large");
      for (;;) {
        const match = /\r?\n\r?\n/.exec(buffer);
        if (!match) break;
        const frame = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const data = frame
          .split(/\r?\n/)
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (data) yield data === "[DONE]" ? data : JSON.parse(data);
      }
    }
    if (buffer.trim()) throw Error("Truncated upstream stream");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export class StreamTranslator {
  private started = false;
  private blocks = new Map<string, number>();
  private open = new Set<number>();
  private next = 0;
  private reason = "end_turn";
  private id = `msg_${crypto.randomUUID().replaceAll("-", "")}`;
  input = 0;
  output = 0;
  ended = false;
  constructor(
    private from: Protocol,
    private to: Protocol,
    private model: string,
  ) {}
  feed(v: any): string[] {
    if (v === "[DONE]") {
      this.ended = true;
      return this.from === this.to
        ? [sse(v)]
        : this.to === "anthropic"
          ? this.finish()
          : [];
    }
    if (v.type === "error" || v.error) throw Error("Upstream stream failed");
    const usage = v.usage ?? v.message?.usage;
    if (usage) {
      this.input = usage.input_tokens ?? usage.prompt_tokens ?? this.input;
      this.output =
        usage.output_tokens ?? usage.completion_tokens ?? this.output;
    }
    if (this.from === this.to) {
      if (v.model) v.model = this.model;
      if (v.message?.model) v.message.model = this.model;
      if (v.type === "message_stop") this.ended = true;
      return [sse(v, this.to === "anthropic" ? v.type : undefined)];
    }
    if (this.to === "openai") {
      const chunk = (delta: any, reason: string | null = null) =>
        sse({
          id: this.id,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: this.model,
          choices: [{ index: 0, delta, finish_reason: reason }],
        });
      if (v.type === "message_start") {
        this.id = v.message.id;
        return [chunk({ role: "assistant", content: "" })];
      }
      if (
        v.type === "content_block_start" &&
        v.content_block.type === "text" &&
        v.content_block.text
      )
        return [chunk({ content: v.content_block.text })];
      if (
        v.type === "content_block_start" &&
        v.content_block.type === "tool_use"
      ) {
        const index = this.next++;
        this.blocks.set(String(v.index), index);
        return [
          chunk({
            tool_calls: [
              {
                index,
                id: v.content_block.id,
                type: "function",
                function: { name: v.content_block.name, arguments: "" },
              },
            ],
          }),
        ];
      }
      if (v.type === "content_block_delta") {
        if (v.delta.type === "text_delta")
          return [chunk({ content: v.delta.text })];
        if (v.delta.type === "input_json_delta")
          return [
            chunk({
              tool_calls: [
                {
                  index: this.blocks.get(String(v.index)),
                  function: { arguments: v.delta.partial_json },
                },
              ],
            }),
          ];
        throw Error("Unsupported upstream stream content");
      }
      if (
        v.type === "content_block_start" &&
        v.content_block.type !== "text" &&
        v.content_block.type !== "tool_use"
      )
        throw Error("Unsupported upstream stream content");
      if (v.type === "message_delta")
        return [
          chunk(
            {},
            v.delta.stop_reason === "tool_use"
              ? "tool_calls"
              : v.delta.stop_reason === "max_tokens"
                ? "length"
                : "stop",
          ),
        ];
      if (v.type === "message_stop") {
        this.ended = true;
        return [
          sse({
            id: this.id,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: this.model,
            choices: [],
            usage: {
              prompt_tokens: this.input,
              completion_tokens: this.output,
              total_tokens: this.input + this.output,
            },
          }),
          sse("[DONE]"),
        ];
      }
      return [];
    }
    const frames: string[] = [];
    const emit = (type: string, rest: any) =>
      frames.push(sse({ type, ...rest }, type));
    if (!this.started) {
      this.started = true;
      emit("message_start", {
        message: {
          id: this.id,
          type: "message",
          role: "assistant",
          model: this.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: this.input, output_tokens: 0 },
        },
      });
    }
    const block = (key: string, content: any) => {
      let index = this.blocks.get(key);
      if (index === undefined) {
        for (const previous of this.open)
          emit("content_block_stop", { index: previous });
        this.open.clear();
        index = this.next++;
        this.blocks.set(key, index);
        this.open.add(index);
        emit("content_block_start", { index, content_block: content });
      } else if (!this.open.has(index))
        throw Error("Interleaved upstream blocks are unsupported");
      return index;
    };
    for (const choice of v.choices ?? []) {
      if (choice.index !== 0)
        throw Error("Multiple upstream choices are unsupported");
      if (choice.delta?.content)
        emit("content_block_delta", {
          index: block("text", { type: "text", text: "" }),
          delta: { type: "text_delta", text: choice.delta.content },
        });
      for (const tool of choice.delta?.tool_calls ?? []) {
        const key = `tool:${tool.index}`;
        if (!this.blocks.has(key) && (!tool.id || !tool.function?.name))
          throw Error("Malformed upstream tool stream");
        const index = block(key, {
          type: "tool_use",
          id: tool.id,
          name: tool.function?.name,
          input: {},
        });
        if (tool.function?.arguments)
          emit("content_block_delta", {
            index,
            delta: {
              type: "input_json_delta",
              partial_json: tool.function.arguments,
            },
          });
      }
      if (choice.finish_reason)
        this.reason =
          choice.finish_reason === "tool_calls"
            ? "tool_use"
            : choice.finish_reason === "length"
              ? "max_tokens"
              : "end_turn";
    }
    return frames;
  }
  private finish() {
    return [...this.open]
      .map((index) =>
        sse({ type: "content_block_stop", index }, "content_block_stop"),
      )
      .concat([
        sse(
          {
            type: "message_delta",
            delta: { stop_reason: this.reason, stop_sequence: null },
            usage: { input_tokens: this.input, output_tokens: this.output },
          },
          "message_delta",
        ),
        sse({ type: "message_stop" }, "message_stop"),
      ]);
  }
}
