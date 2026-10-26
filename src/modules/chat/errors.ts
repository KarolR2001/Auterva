/** Stable, content-free failure codes of the chat use cases. The message is never user text. */
export type ChatErrorCode =
  | "CHAT_INVALID_INPUT" | "CHAT_INVALID_CURSOR" | "CHAT_NOT_FOUND" | "CHAT_FORBIDDEN"
  | "CHAT_INVALID_MESSAGE" | "MESSAGE_TOO_LONG" | "CLIENT_MESSAGE_ID_CONFLICT"
  | "CHAT_ORGANIZATION_ARCHIVED" | "RATE_LIMITED";

export class ChatError extends Error {
  readonly code: ChatErrorCode;
  readonly retryAfter?: number;
  constructor(code: ChatErrorCode, retryAfter?: number) {
    super(code);
    this.code = code;
    this.retryAfter = retryAfter;
  }
}
