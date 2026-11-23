import { z } from "zod";

/**
 * Every client→server message type has a Zod schema here.
 * The client sends intentions only; the server decides results.
 * Message types are added task by task (movement arrives in 0.2/0.3).
 */

/** "ping": the client asks the server to echo a small number back (connectivity check). */
export const PingMessage = z
  .object({
    n: z.number().int().min(0).max(1_000_000),
  })
  .strict();

/**
 * "input": which way the player wants to walk, as a direction (each axis -1..1).
 * Never a position — the server works out where the player ends up.
 * Each input moves the player for one server tick; `seq` counts up so the
 * client can tell which inputs the server has already applied.
 */
export const InputMessage = z
  .object({
    seq: z.number().int().min(1).max(2 ** 31 - 1),
    x: z.number().min(-1).max(1),
    y: z.number().min(-1).max(1),
  })
  .strict();

export const ClientMessageSchemas = {
  ping: PingMessage,
  input: InputMessage,
} as const;

export type ClientMessageType = keyof typeof ClientMessageSchemas;
export type ClientMessage<T extends ClientMessageType> = z.infer<(typeof ClientMessageSchemas)[T]>;

export function isClientMessageType(type: unknown): type is ClientMessageType {
  return typeof type === "string" && Object.hasOwn(ClientMessageSchemas, type);
}

export type ParseResult<T extends ClientMessageType> =
  | { ok: true; type: T; data: ClientMessage<T> }
  | { ok: false; reason: string };

/** Validate an incoming message. Unknown types and bad payloads are rejected. */
export function parseClientMessage(type: unknown, payload: unknown): ParseResult<ClientMessageType> {
  if (!isClientMessageType(type)) return { ok: false, reason: "unknown message type" };
  const result = ClientMessageSchemas[type].safeParse(payload);
  if (!result.success) return { ok: false, reason: "invalid payload" };
  return { ok: true, type, data: result.data };
}
