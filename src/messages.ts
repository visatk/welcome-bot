import type { InputRichMessage, InputRichMessageButton, RichText } from "./telegram";

/**
 * Pool of welcome message templates. `{name}` and `{chat}` are substituted
 * at send time. Pulled from KV at runtime if the operator has customized
 * them there (key: "templates"); this array is the built-in fallback.
 */
export const DEFAULT_WELCOME_TEMPLATES: string[] = [
  "👋 Hey {name}, welcome to {chat}! Glad you're here.",
  "🎉 {name} just landed in {chat}. Make yourself at home!",
  "✨ Welcome aboard, {name}! {chat} just got better.",
  "🚀 {name} has joined {chat}. Buckle up!",
  "🌟 A warm welcome to {name} — great to have you in {chat}.",
  "🤝 Welcome, {name}! Take a look around {chat} and say hi.",
  "🎈 {name} is here! Everyone welcome them to {chat}.",
  "🔥 Fresh face alert: {name} just joined {chat}. Welcome!",
];

export function pickRandomTemplate(pool: string[]): string {
  const i = Math.floor(Math.random() * pool.length);
  return pool[i] ?? pool[0];
}

export function renderTemplate(template: string, vars: { name: string; chat: string }): string {
  return template.replace(/\{name\}/g, vars.name).replace(/\{chat\}/g, vars.chat);
}

export interface WelcomeCopy {
  greeting: string;
  subtitle: string;
}

/**
 * Builds an InputRichMessage (blocks form) for the welcome message:
 * a section heading, the randomized greeting paragraph, a subtitle
 * paragraph, and a row of RichMessageButtons (rules / verify).
 *
 * https://core.telegram.org/bots/api#inputrichmessage
 * https://core.telegram.org/bots/api#richmessagebutton
 */
export function buildWelcomeRichMessage(opts: {
  greeting: string;
  chatTitle: string;
  rulesUrl?: string;
  verifyCallbackData?: string;
}): InputRichMessage {
  const heading: RichText = { bold: `Welcome to ${opts.chatTitle}` };

  const buttons: InputRichMessageButton[] = [];
  if (opts.rulesUrl) {
    buttons.push({ text: "📜 Rules", style: "primary", url: opts.rulesUrl });
  }
  if (opts.verifyCallbackData) {
    buttons.push({ text: "✅ I've read this", style: "success", callback_data: opts.verifyCallbackData });
  }

  return {
    blocks: [
      { type: "section_heading", text: heading },
      { type: "paragraph", text: opts.greeting },
      { type: "divider" },
      {
        type: "paragraph",
        text: [
          "This message is only visible to you and disappears automatically — ",
          { italic: "no need to clear the chat." },
        ],
      },
      ...(buttons.length ? [{ type: "buttons" as const, rows: [buttons] }] : []),
    ],
  };
}
