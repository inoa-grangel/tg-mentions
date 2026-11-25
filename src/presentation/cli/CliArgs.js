import { Command } from "commander";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../../../package.json");

export function parseCliArgs(argv = process.argv) {
  const program = new Command();

  program
    .name("tg-mentions")
    .description("View and manage unread Telegram forum topic mentions")
    .version(pkg.version || "1.0.0", "-v, --version", "Output the current version")
    .option("-a, --all", "Show all mentioned topics including hidden ones", false)
    .option("-o, --open", "Automatically open the first active mentioned topic", false)
    .option("-w, --web", "Force opening links in Telegram Web instead of Desktop", false)
    .option("-s, --select-chats", "Launch interactive selector to configure allowed chat IDs", false)
    .option("--purge", "Purge all local TDLib session data, caches, logs, and credentials", false);

  program.parse(argv);
  const opts = program.opts();

  return {
    all: Boolean(opts.all),
    open: Boolean(opts.open),
    web: Boolean(opts.web),
    selectChats: Boolean(opts.selectChats),
    purge: Boolean(opts.purge),
  };
}
