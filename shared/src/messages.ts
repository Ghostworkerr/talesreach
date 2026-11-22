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

export const ClientMessageSchemas = {
  ping: PingMessage,
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
