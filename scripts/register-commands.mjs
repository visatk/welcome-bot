// Usage: BOT_TOKEN=... node scripts/register-commands.mjs
//
// Demonstrates BotCommand.is_ephemeral (Bot API 10.2): when true, the
// command's own /command message and the bot's reply to it are treated
// as ephemeral-eligible in group chats — handy for a "/rules" or
// "/verify" command that shouldn't clutter the group's history.
const { BOT_TOKEN } = process.env;

if (!BOT_TOKEN) {
  console.error("Missing BOT_TOKEN environment variable.");
  process.exit(1);
}

const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setMyCommands`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    commands: [
      { command: "rules", description: "Show the group rules (only visible to you)", is_ephemeral: true },
      { command: "verify", description: "Confirm you've read the welcome message", is_ephemeral: true },
    ],
  }),
});

const data = await res.json();
console.log(JSON.stringify(data, null, 2));
if (!data.ok) process.exit(1);
