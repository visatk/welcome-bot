import { TelegramClient, type TgUpdate } from "./telegram";
import { DEFAULT_WELCOME_TEMPLATES, buildWelcomeRichMessage, pickRandomTemplate, renderTemplate } from "./messages";

export interface Env {
  TELEGRAM_API_ROOT: string;
  WELCOME_AUTO_DELETE_SECONDS: string;
  BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  WELCOME_KV: KVNamespace;
  AUTO_DELETE_QUEUE: Queue<AutoDeleteJob>;
}

interface AutoDeleteJob {
  chatId: number;
  receiverUserId: number;
  ephemeralMessageId: number;
}

// -----------------------------------------------------------------------
// Constant-time webhook secret check (see security guidance: don't use a
// plain === on secrets, and don't short-circuit on length).
// -----------------------------------------------------------------------
async function verifyWebhookSecret(request: Request, expected: string): Promise<boolean> {
  const provided = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(provided)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

async function loadTemplates(env: Env): Promise<string[]> {
  try {
    const raw = await env.WELCOME_KV.get("templates");
    if (!raw) return DEFAULT_WELCOME_TEMPLATES;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_WELCOME_TEMPLATES;
  } catch {
    return DEFAULT_WELCOME_TEMPLATES;
  }
}

async function loadRulesUrl(env: Env, chatId: number): Promise<string | undefined> {
  const url = await env.WELCOME_KV.get(`rules_url:${chatId}`);
  return url ?? undefined;
}

/**
 * Sends one ephemeral, rich welcome message per new member and schedules
 * its deletion. Ephemeral messages are already only visible to the
 * receiving user (and are not part of chat history), but we additionally
 * queue an explicit deleteEphemeralMessage so the bot controls the exact
 * lifetime instead of relying on server-side expiry.
 */
async function handleNewChatMembers(
  tg: TelegramClient,
  env: Env,
  ctx: ExecutionContext,
  chatId: number,
  chatTitle: string,
  members: { id: number; is_bot: boolean; first_name: string }[]
): Promise<void> {
  const templates = await loadTemplates(env);
  const rulesUrl = await loadRulesUrl(env, chatId);
  const autoDeleteSeconds = Number(env.WELCOME_AUTO_DELETE_SECONDS || "0");

  for (const member of members) {
    if (member.is_bot) continue; // don't welcome bots (including ourselves)

    const template = pickRandomTemplate(templates);
    const greeting = renderTemplate(template, { name: member.first_name, chat: chatTitle });

    const richMessage = buildWelcomeRichMessage({
      greeting,
      chatTitle,
      rulesUrl,
      verifyCallbackData: `welcome:ack:${member.id}`,
    });

    const sent = await tg.sendRichMessage({
      chat_id: chatId,
      rich_message: richMessage,
      ephemeral_message_parameters: { receiver_user_id: member.id },
      disable_notification: false,
    });

    if (autoDeleteSeconds > 0 && sent.ephemeral_message_id) {
      const job: AutoDeleteJob = {
        chatId,
        receiverUserId: member.id,
        ephemeralMessageId: sent.ephemeral_message_id,
      };
      // Background enqueue — don't block the webhook response on it.
      ctx.waitUntil(env.AUTO_DELETE_QUEUE.send(job, { delaySeconds: autoDeleteSeconds }));
    }
  }
}

async function handleCallbackQuery(tg: TelegramClient, update: TgUpdate): Promise<void> {
  const query = update.callback_query;
  if (!query) return;

  if (query.data?.startsWith("welcome:ack:")) {
    // Acknowledge the tap immediately (required within Telegram's short
    // response window for callback queries).
    await tg.answerCallbackQuery({
      callback_query_id: query.id,
      text: "Thanks! Enjoy the chat 🎉",
    });

    // Replace the original ephemeral welcome message, in the tapper's
    // view only, with a short ephemeral confirmation — using
    // callback_query_id + replace_callback_query_message (Bot API 10.3).
    if (query.message) {
      await tg.sendMessage({
        chat_id: query.message.chat.id,
        text: "✅ You're all set. Welcome again!",
        ephemeral_message_parameters: {
          receiver_user_id: query.from.id,
          callback_query_id: query.id,
          replace_callback_query_message: true,
        },
      });
    }
    return;
  }

  // Unknown callback — acknowledge so the client stops showing a spinner.
  await tg.answerCallbackQuery({ callback_query_id: query.id });
}

async function handleUpdate(tg: TelegramClient, env: Env, ctx: ExecutionContext, update: TgUpdate): Promise<void> {
  const message = update.message;

  if (message?.new_chat_members?.length) {
    await handleNewChatMembers(
      tg,
      env,
      ctx,
      message.chat.id,
      message.chat.title ?? "the group",
      message.new_chat_members
    );
    return;
  }

  if (update.callback_query) {
    await handleCallbackQuery(tg, update);
    return;
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method !== "POST" || url.pathname !== "/webhook") {
      return new Response("Not found", { status: 404 });
    }

    if (!(await verifyWebhookSecret(request, env.WEBHOOK_SECRET))) {
      return new Response("Unauthorized", { status: 401 });
    }

    let update: TgUpdate;
    try {
      update = (await request.json()) as TgUpdate;
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    const tg = new TelegramClient(env.TELEGRAM_API_ROOT, env.BOT_TOKEN);

    // Acknowledge Telegram immediately; do the actual work in the
    // background so retries/timeouts on Telegram's side don't pile up.
    ctx.waitUntil(
      handleUpdate(tg, env, ctx, update).catch((err) => {
        console.error(
          JSON.stringify({ message: "update handling failed", error: err instanceof Error ? err.message : String(err) })
        );
      })
    );

    return new Response("OK", { status: 200 });
  },

  async queue(batch: MessageBatch<AutoDeleteJob>, env: Env): Promise<void> {
    const tg = new TelegramClient(env.TELEGRAM_API_ROOT, env.BOT_TOKEN);

    for (const msg of batch.messages) {
      try {
        await tg.deleteEphemeralMessage({
          chat_id: msg.body.chatId,
          receiver_user_id: msg.body.receiverUserId,
          ephemeral_message_id: msg.body.ephemeralMessageId,
        });
        msg.ack();
      } catch (err) {
        // Already expired/deleted messages are not an error worth retrying.
        const text = err instanceof Error ? err.message : String(err);
        if (/not found|message to delete not found/i.test(text)) {
          msg.ack();
        } else {
          console.error(JSON.stringify({ message: "auto-delete failed", error: text, job: msg.body }));
          msg.retry();
        }
      }
    }
  },
} satisfies ExportedHandler<Env>;
