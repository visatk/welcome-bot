/**
 * Minimal typed client for the Telegram Bot API surface this bot needs,
 * built against Bot API 10.3 (2026-08-24):
 *   https://core.telegram.org/bots/api#ephemeralmessageparameters
 *   https://core.telegram.org/bots/api#deleteephemeralmessage
 *   https://core.telegram.org/bots/api#inputrichmessage
 *   https://core.telegram.org/bots/api#richmessagebutton
 *
 * Only the fields this bot actually sends/reads are typed. Extend as needed.
 */

// ---------------------------------------------------------------------------
// Core / shared types
// ---------------------------------------------------------------------------

export interface TgUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TgChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
}

export interface TgMessage {
  message_id: number;
  chat: TgChat;
  from?: TgUser;
  date: number;
  /** Present only on ephemeral messages (message_id is 0 for those). */
  ephemeral_message_id?: number;
  /** Present only on ephemeral messages: who can see it. */
  receiver_user?: TgUser;
  new_chat_members?: TgUser[];
  text?: string;
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

// ---------------------------------------------------------------------------
// Ephemeral messages — Bot API 10.2 / 10.3
// EphemeralMessageParameters (10.3) replaced the older receiver_user_id /
// callback_query_id top-level params on send* methods with a single
// structured object passed as `ephemeral_message_parameters`.
// ---------------------------------------------------------------------------

export interface EphemeralMessageParameters {
  /**
   * The user who should be the only one (besides the bot) able to see the
   * message. Required when sending a fresh ephemeral message in a group.
   */
  receiver_user_id?: number;
  /**
   * Set when replying to a button tap: the callback_query.id from the
   * update that triggered this send. Must be used within Telegram's
   * short response window for callback queries.
   */
  callback_query_id?: string;
  /**
   * If true and callback_query_id is set, the ephemeral message replaces
   * the message the button was attached to (in the tapping user's view)
   * instead of appearing as a new message.
   */
  replace_callback_query_message?: boolean;
}

export interface ReplyParameters {
  /** Optional if ephemeral_message_id is supplied instead. */
  message_id?: number;
  ephemeral_message_id?: number;
  chat_id?: number | string;
}

// ---------------------------------------------------------------------------
// Rich messages — Bot API 10.1 / 10.2 / 10.3
// A RichMessage is built from RichText (inline formatting) and RichBlocks
// (structural pieces: paragraphs, headings, lists, buttons, ...). We only
// model the pieces this bot uses: paragraphs, a section heading, and the
// new RichBlockButtons / RichMessageButton (10.3).
// ---------------------------------------------------------------------------

export type RichText =
  | string
  | RichTextNode
  | RichText[];

export type RichTextNode =
  | { bold: RichText }
  | { italic: RichText }
  | { underline: RichText }
  | { spoiler: RichText }
  | { custom_emoji: RichText; custom_emoji_id: string }
  | { url: RichText; href: string }
  | { text_mention: RichText; user_id: number };

export type RichMessageButtonStyle = "primary" | "success" | "danger" | "link";

/** Exactly one of the union members' distinguishing field must be set. */
export type RichMessageButtonType =
  | { url: string }
  | { callback_data: string }
  | { switch_inline_query: string }
  | { switch_inline_query_current_chat: string }
  | { web_app: { url: string } }
  | { pay: true };

export type InputRichMessageButtonType = RichMessageButtonType;

export interface InputRichMessageButton {
  text: RichText;
  style?: RichMessageButtonStyle;
  // Exactly one of the following, matching RichMessageButtonType:
  url?: string;
  callback_data?: string;
  switch_inline_query?: string;
  switch_inline_query_current_chat?: string;
  web_app?: { url: string };
  pay?: true;
}

export type InputRichBlock =
  | { type: "paragraph"; text: RichText }
  | { type: "section_heading"; text: RichText }
  | { type: "divider" }
  | {
      type: "buttons";
      /** Rows of buttons, top-to-bottom, left-to-right within a row. */
      rows: InputRichMessageButton[][];
    };

export interface InputRichMessage {
  /**
   * Convenience path: markdown/html source instead of explicit `blocks`.
   * We use the structured `blocks` form for full control over buttons.
   */
  blocks?: InputRichBlock[];
}

// ---------------------------------------------------------------------------
// Method parameter shapes
// ---------------------------------------------------------------------------

export interface SendMessageParams {
  chat_id: number | string;
  text?: string;
  rich_message?: InputRichMessage;
  reply_markup?: unknown;
  reply_parameters?: ReplyParameters;
  ephemeral_message_parameters?: EphemeralMessageParameters;
  disable_notification?: boolean;
}

export interface SendRichMessageParams {
  chat_id: number | string;
  rich_message: InputRichMessage;
  reply_parameters?: ReplyParameters;
  ephemeral_message_parameters?: EphemeralMessageParameters;
  disable_notification?: boolean;
}

export interface DeleteEphemeralMessageParams {
  chat_id: number | string;
  receiver_user_id: number;
  ephemeral_message_id: number;
}

export interface AnswerCallbackQueryParams {
  callback_query_id: string;
  text?: string;
  show_alert?: boolean;
}

export interface SetMyCommandsParams {
  commands: { command: string; description: string; is_ephemeral?: boolean }[];
}

export interface PromoteChatMemberParams {
  chat_id: number | string;
  user_id: number;
  can_send_welcome_messages?: boolean;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

interface TgApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export class TelegramClient {
  private readonly base: string;

  constructor(apiRoot: string, botToken: string) {
    this.base = `${apiRoot}/bot${botToken}`;
  }

  private async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.base}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const data = (await res.json()) as TgApiResponse<T>;
    if (!data.ok) {
      throw new Error(
        `Telegram API ${method} failed (${data.error_code ?? res.status}): ${data.description ?? "unknown error"}`
      );
    }
    return data.result as T;
  }

  /** Plain (non-ephemeral) or ephemeral text message, depending on params. */
  sendMessage(params: SendMessageParams) {
    return this.call<TgMessage>("sendMessage", params as Record<string, unknown>);
  }

  /** Structured rich message (headings, paragraphs, button blocks, ...). */
  sendRichMessage(params: SendRichMessageParams) {
    return this.call<TgMessage>("sendRichMessage", params as Record<string, unknown>);
  }

  /**
   * Explicitly deletes an ephemeral message before its natural expiry.
   * https://core.telegram.org/bots/api#deleteephemeralmessage
   */
  deleteEphemeralMessage(params: DeleteEphemeralMessageParams) {
    return this.call<true>("deleteEphemeralMessage", params as Record<string, unknown>);
  }

  answerCallbackQuery(params: AnswerCallbackQueryParams) {
    return this.call<true>("answerCallbackQuery", params as Record<string, unknown>);
  }

  setMyCommands(params: SetMyCommandsParams) {
    return this.call<true>("setMyCommands", params as Record<string, unknown>);
  }

  promoteChatMember(params: PromoteChatMemberParams) {
    return this.call<true>("promoteChatMember", params as Record<string, unknown>);
  }

  setWebhook(url: string, secretToken: string) {
    return this.call<true>("setWebhook", {
      url,
      secret_token: secretToken,
      allowed_updates: ["message", "callback_query"],
    });
  }

  deleteMessage(chat_id: number | string, message_id: number) {
    return this.call<true>("deleteMessage", { chat_id, message_id });
  }
}
