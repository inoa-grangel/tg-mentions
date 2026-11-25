import {
  HIDE_MENU_OPTIONS,
  SNOOZE_PRESETS,
  parseDateOrDurationInput,
} from "#domain/value-objects/SnoozeSchedule.js";
import { formatTimestamp, padOrTruncate, term } from "./TerminalHelpers.js";
import { sanitizeText } from "./TextSanitizer.js";

export function runVimTui({
  initialItems,
  initialShowAll,
  onReload,
  onHide,
  onUnhide,
  onOpenUri,
  onCopyLink,
}) {
  if (!process.stdin.isTTY) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let allItems = [...initialItems];
    let showHidden = initialShowAll;
    let isReloading = false;
    let mode = "NORMAL";
    let commandBuffer = "";
    let searchQuery = "";
    let pendingG = false;
    let cursor = 0;
    let scrollOffset = 0;
    let hideMenuCursor = 0;
    let snoozeCursor = 0;
    let statusMsg =
      "j/k: move • Enter: open • h: hide options • r: reload • a: show hidden";
    let statusIsError = false;

    const getVisibleItems = () => {
      const q = searchQuery.trim().toLowerCase();
      return allItems.filter((item) => {
        if (!showHidden && item.hideMode !== null) return false;
        if (!q) return true;
        return (
          item.topicName.toLowerCase().includes(q) ||
          item.groupTitle.toLowerCase().includes(q)
        );
      });
    };

    const setStatus = (msg, isError = false) => {
      statusMsg = sanitizeText(msg);
      statusIsError = isError;
    };

    const onAuditError = (err) => {
      setStatus(`Audit log write error: ${err?.message || err}`, true);
      render();
    };

    const copyAndShowLink = (item, useWeb = false) => {
      if (!item) {
        setStatus("No topic selected", true);
        return;
      }
      const targetUrl = useWeb ? item.webLink : item.link;
      try {
        if (typeof onCopyLink === "function") {
          onCopyLink(targetUrl);
        }
        setStatus(`Copied: ${targetUrl}`);
      } catch (err) {
        setStatus(
          `Link (${err?.message || "no clipboard"}): ${targetUrl}`,
          true,
        );
      }
    };

    const render = () => {
      const cols = Math.max(40, term.width || 80);
      const rows = Math.max(12, term.height || 24);
      const visible = getVisibleItems();

      if (cursor >= visible.length) {
        cursor = Math.max(0, visible.length - 1);
      }

      const viewportHeight = Math.max(3, rows - 3);
      if (cursor < scrollOffset) scrollOffset = cursor;
      if (cursor >= scrollOffset + viewportHeight) {
        scrollOffset = cursor - viewportHeight + 1;
      }

      term.hideCursor(true);
      term.moveTo(1, 1);

      const filterBadge = searchQuery ? ` [/${searchQuery}]` : "";
      const hiddenBadge = showHidden ? " [+hidden]" : "";
      const reloadBadge = isReloading ? " [reloading...]" : "";
      const headerText = ` tg-mentions (${visible.length}/${allItems.length})${filterBadge}${hiddenBadge}${reloadBadge}`;
      term.bgWhite.black.bold(padOrTruncate(headerText, cols));
      term.styleReset();

      if (mode === "HIDE_MENU" && visible[cursor]) {
        const target = visible[cursor];
        const menuRows = [
          {
            type: "title",
            text: padOrTruncate(`  Hide: ${target.topicName}`, cols),
          },
          {
            type: "sub",
            text: padOrTruncate(`  Group: ${target.groupTitle}`, cols),
          },
          { type: "blank", text: "" },
          ...HIDE_MENU_OPTIONS.map((opt, i) => ({
            type: "option",
            active: i === hideMenuCursor,
            text: `[${opt.key}] ${opt.label}`,
          })),
          { type: "blank", text: "" },
          {
            type: "sub",
            text: padOrTruncate(
              "  Shortcuts: d = forever • m = until new message • s = until message or date",
              cols,
            ),
          },
        ];

        for (let r = 0; r < viewportHeight; r++) {
          term.moveTo(1, 2 + r).eraseLine();
          const row = menuRows[r];
          if (!row) {
            term.blue("~");
          } else if (row.type === "title") {
            term.yellow.bold(row.text);
          } else if (row.type === "sub") {
            term.dim(row.text);
          } else if (row.type === "option") {
            const caret = row.active ? "> " : "  ";
            const body = padOrTruncate(row.text, cols - 2);
            if (row.active) {
              term.yellow.bold(caret);
              term.bgYellow.black.bold(body);
            } else {
              term(caret);
              term(body);
            }
          }
          term.styleReset();
        }
      } else if (mode === "SNOOZE_DATE" && visible[cursor]) {
        const target = visible[cursor];
        const snoozeRows = [
          {
            type: "title",
            text: padOrTruncate(
              `  Hide until new message or date: ${target.topicName}`,
              cols,
            ),
          },
          {
            type: "sub",
            text: padOrTruncate(
              "  Wakes early if a new message arrives, or once the selected date/time passes",
              cols,
            ),
          },
          { type: "blank", text: "" },
          ...SNOOZE_PRESETS.map((p, i) => ({
            type: "preset",
            active: i === snoozeCursor,
            text: `[${p.key.padEnd(3)}] ${p.label}`,
          })),
          { type: "blank", text: "" },
          {
            type: "sub",
            text: padOrTruncate(
              "  Or type :snooze 2026-11-30 09:00 | :snooze 18:30 | :snooze 45m",
              cols,
            ),
          },
        ];

        for (let r = 0; r < viewportHeight; r++) {
          term.moveTo(1, 2 + r).eraseLine();
          const row = snoozeRows[r];
          if (!row) {
            term.blue("~");
          } else if (row.type === "title") {
            term.yellow.bold(row.text);
          } else if (row.type === "sub") {
            term.dim(row.text);
          } else if (row.type === "preset") {
            const caret = row.active ? "> " : "  ";
            const body = padOrTruncate(row.text, cols - 2);
            if (row.active) {
              term.yellow.bold(caret);
              term.bgYellow.black.bold(body);
            } else {
              term(caret);
              term(body);
            }
          }
          term.styleReset();
        }
      } else {
        for (let r = 0; r < viewportHeight; r++) {
          term.moveTo(1, 2 + r).eraseLine();
          const idx = scrollOffset + r;

          if (idx >= visible.length) {
            if (visible.length === 0 && r === 0) {
              term.dim(
                padOrTruncate(
                  "  No topics match current view. Press 'a' to show hidden, 'r' to reload, or Esc to clear filter.",
                  cols,
                ),
              );
            } else {
              term.blue("~");
            }
            term.styleReset();
            continue;
          }

          const item = visible[idx];
          const selected = idx === cursor;
          let stateTag = "";
          if (item.hideMode === "forever") stateTag = " [forever]";
          else if (item.hideMode === "until_message") stateTag = " [until-msg]";
          else if (item.hideMode === "snooze") stateTag = " [zzz]";

          const unreadTag =
            item.unreadCount > 0 ? ` (${item.unreadCount} unread)` : "";
          const rightMeta = ` ${item.groupTitle} │ ${item.lastMsgFormatted}${unreadTag}${stateTag}`;
          const maxTitleWidth = Math.max(12, cols - 2 - [...rightMeta].length);
          const leftTitle = padOrTruncate(item.topicName, maxTitleWidth);
          const paddedMeta = padOrTruncate(
            rightMeta,
            cols - 2 - [...leftTitle].length,
          );

          if (selected) {
            term.cyan.bold("> ");
            term.cyan.bold(leftTitle);
            term.cyan(paddedMeta);
          } else if (item.hideMode !== null) {
            term("  ");
            term.dim(leftTitle + paddedMeta);
          } else {
            term("  ");
            term(leftTitle);
            term.dim(paddedMeta);
          }
          term.styleReset();
        }
      }

      term.moveTo(1, rows - 1).eraseLine();
      const badgeText =
        mode === "HIDE_MENU"
          ? " HIDE "
          : mode === "SNOOZE_DATE"
            ? " SNOOZE "
            : ` ${mode} `;
      if (mode === "NORMAL") term.bgCyan.black.bold(badgeText);
      else if (mode === "SEARCH") term.bgMagenta.black.bold(badgeText);
      else term.bgYellow.black.bold(badgeText);
      term.styleReset();

      const posLabel =
        visible.length > 0 ? ` ${cursor + 1}/${visible.length} ` : " 0/0 ";
      const middleWidth = Math.max(
        0,
        cols - badgeText.length - posLabel.length,
      );
      const middleText = padOrTruncate(` ${statusMsg}`, middleWidth);

      if (statusIsError) {
        term.bgBlack.red(middleText);
      } else {
        term.bgBlack.white(middleText);
      }
      term.styleReset();
      term.bgWhite.black.bold(posLabel);
      term.styleReset();

      term.moveTo(1, rows).eraseLine();
      if (mode === "COMMAND") {
        term(`:${commandBuffer}`);
        term.moveTo(Math.min(cols, commandBuffer.length + 2), rows);
        term.hideCursor(false);
      } else if (mode === "SEARCH") {
        term(`/${commandBuffer}`);
        term.moveTo(Math.min(cols, commandBuffer.length + 2), rows);
        term.hideCursor(false);
      } else if (mode === "HIDE_MENU") {
        term.dim(
          "1-3 or ↑/↓: choose hide option • Enter: confirm • Esc: cancel",
        );
        term.styleReset();
      } else if (mode === "SNOOZE_DATE") {
        term.dim(
          "↑/↓ or j/k: select date/duration • Enter: confirm • Esc: cancel",
        );
        term.styleReset();
      } else {
        term.dim(
          "y/Y: copy app/web link • h: hide menu • d: forever • m: until msg • s: msg/date • u: unhide • r: reload",
        );
        term.styleReset();
      }
    };

    const cleanup = () => {
      term.removeListener("key", onKey);
      term.removeListener("resize", render);
      term.grabInput(false);
      term.hideCursor(false);
      term.alternateScreenBuffer(false);
      resolve();
    };

    const applyHide = (target, hideMode, hideUntil = null) => {
      onHide(target, hideMode, hideUntil, onAuditError);

      if (hideMode === "forever") {
        setStatus(`Hidden forever: "${target.topicName}"`);
      } else if (hideMode === "until_message") {
        setStatus(`Hidden until new message: "${target.topicName}"`);
      } else if (hideMode === "snooze" && hideUntil) {
        const untilStr = formatTimestamp(Math.floor(hideUntil / 1000));
        setStatus(
          `Hidden until new message or ${untilStr}: "${target.topicName}"`,
        );
      }
    };

    const triggerReload = async () => {
      if (isReloading) return;
      isReloading = true;
      const previousKey = getVisibleItems()[cursor]?.key;
      setStatus("Reloading topics from Telegram...");
      render();

      try {
        const refreshed = await onReload((progressText) => {
          setStatus(progressText);
          render();
        });
        allItems = refreshed;

        const nextVisible = getVisibleItems();
        if (previousKey) {
          const keptIdx = nextVisible.findIndex(
            (item) => item.key === previousKey,
          );
          cursor = keptIdx !== -1 ? keptIdx : 0;
        } else {
          cursor = 0;
        }
        scrollOffset = 0;

        const activeCount = allItems.filter((i) => i.hideMode === null).length;
        const timeStr = formatTimestamp(Math.floor(Date.now() / 1000)).split(
          " ",
        )[1];
        setStatus(`Reloaded at ${timeStr} (${activeCount} active)`);
      } catch (err) {
        setStatus(`Reload failed: ${err?.message || err}`, true);
      } finally {
        isReloading = false;
        render();
      }
    };

    const executeCommand = async (rawCmd) => {
      const trimmed = rawCmd.trim();
      const [cmd, ...args] = trimmed.split(/\s+/);
      const argStr = args.join(" ");
      const visible = getVisibleItems();
      const current = visible[cursor];

      switch (cmd) {
        case "":
          break;
        case "q":
        case "quit":
        case "exit":
          cleanup();
          return;
        case "r":
        case "reload":
        case "refresh":
          mode = "NORMAL";
          await triggerReload();
          return;
        case "o":
        case "open":
          if (!current) {
            setStatus("No topic selected", true);
          } else {
            try {
              onOpenUri(current.link, onAuditError);
              setStatus(`Opened: ${current.topicName}`);
            } catch (err) {
              setStatus(err?.message || String(err), true);
            }
          }
          break;
        case "h":
        case "hide":
          if (!current) {
            setStatus("No topic selected", true);
          } else if (!argStr) {
            hideMenuCursor = 0;
            mode = "HIDE_MENU";
            render();
            return;
          } else if (argStr === "forever" || argStr === "1") {
            applyHide(current, "forever");
          } else if (
            argStr === "msg" ||
            argStr === "message" ||
            argStr === "2"
          ) {
            applyHide(current, "until_message");
          } else {
            const until = parseDateOrDurationInput(argStr);
            if (!until) {
              setStatus(
                `Invalid option "${argStr}" (use forever, msg, 1h, 18:30, or 2026-11-30)`,
                true,
              );
            } else {
              applyHide(current, "snooze", until);
            }
          }
          break;
        case "d":
        case "archive":
          if (!current) {
            setStatus("No topic selected", true);
          } else {
            applyHide(current, "forever");
          }
          break;
        case "m":
          if (!current) {
            setStatus("No topic selected", true);
          } else {
            applyHide(current, "until_message");
          }
          break;
        case "s":
        case "snooze":
          if (!current) {
            setStatus("No topic selected", true);
          } else if (!argStr) {
            snoozeCursor = 0;
            mode = "SNOOZE_DATE";
            render();
            return;
          } else {
            const until = parseDateOrDurationInput(argStr);
            if (!until) {
              setStatus(
                `Invalid date/duration "${argStr}" (try 30m, 2h, 18:30, 2026-11-30 09:00)`,
                true,
              );
            } else {
              applyHide(current, "snooze", until);
            }
          }
          break;
        case "u":
        case "unhide":
        case "unsnooze":
        case "unarchive":
          if (!current || current.hideMode === null) {
            setStatus("Selected topic is not hidden", true);
          } else {
            onUnhide(current, onAuditError);
            setStatus(`Unhidden: ${current.topicName}`);
          }
          break;
        case "a":
        case "all":
          showHidden = !showHidden;
          setStatus(
            showHidden ? "Showing hidden topics" : "Hiding hidden topics",
          );
          break;
        case "chats":
        case "groups":
        case "allowlist":
          setStatus(
            "Run `tg-mentions --select-chats` anytime to update allowed groups",
          );
          break;
        case "clear":
          searchQuery = "";
          setStatus("Filter cleared");
          break;
        case "help":
          setStatus(
            ":hide [forever|msg|1h|2026-11-30] | :unhide | :all | :reload | :q",
          );
          break;
        case "y":
        case "copy":
        case "link":
          copyAndShowLink(current, argStr === "web");
          break;
        default:
          if (/^\d+$/.test(cmd)) {
            const targetIdx = Number(cmd) - 1;
            if (targetIdx >= 0 && targetIdx < visible.length) {
              cursor = targetIdx;
              setStatus(`Jumped to line ${cmd}`);
            } else {
              setStatus(`Line ${cmd} out of range`, true);
            }
          } else {
            setStatus(`Unknown command: :${cmd}`, true);
          }
      }

      mode = "NORMAL";
      render();
    };

    const onKey = async (name, matches, data) => {
      if (name === "CTRL_C") {
        cleanup();
        return;
      }

      if (isReloading) return;

      if (mode === "COMMAND" || mode === "SEARCH") {
        if (name === "ESCAPE") {
          if (mode === "SEARCH") searchQuery = "";
          commandBuffer = "";
          mode = "NORMAL";
          render();
          return;
        }
        if (name === "ENTER" || name === "KP_ENTER") {
          const entered = commandBuffer;
          commandBuffer = "";
          if (mode === "SEARCH") {
            searchQuery = entered;
            cursor = 0;
            scrollOffset = 0;
            mode = "NORMAL";
            setStatus(entered ? `Filter: /${entered}` : "Filter cleared");
            render();
          } else {
            await executeCommand(entered);
          }
          return;
        }
        if (name === "BACKSPACE") {
          if (commandBuffer.length === 0) {
            mode = "NORMAL";
          } else {
            commandBuffer = commandBuffer.slice(0, -1);
            if (mode === "SEARCH") {
              searchQuery = commandBuffer;
              cursor = 0;
              scrollOffset = 0;
            }
          }
          render();
          return;
        }
        if (data?.isCharacter && name.length === 1) {
          commandBuffer += name;
          if (mode === "SEARCH") {
            searchQuery = commandBuffer;
            cursor = 0;
            scrollOffset = 0;
          }
          render();
        }
        return;
      }

      if (mode === "HIDE_MENU") {
        const visible = getVisibleItems();
        const target = visible[cursor];

        const selectHideOption = (optionIndex) => {
          const opt = HIDE_MENU_OPTIONS[optionIndex];
          if (!opt || !target) {
            mode = "NORMAL";
            render();
            return;
          }

          if (opt.type === "forever") {
            applyHide(target, "forever");
            mode = "NORMAL";
            render();
          } else if (opt.type === "until_message") {
            applyHide(target, "until_message");
            mode = "NORMAL";
            render();
          } else if (opt.type === "snooze") {
            snoozeCursor = 0;
            mode = "SNOOZE_DATE";
            render();
          }
        };

        if (name === "UP" || name === "k") {
          hideMenuCursor =
            (hideMenuCursor - 1 + HIDE_MENU_OPTIONS.length) %
            HIDE_MENU_OPTIONS.length;
          render();
        } else if (name === "DOWN" || name === "j") {
          hideMenuCursor = (hideMenuCursor + 1) % HIDE_MENU_OPTIONS.length;
          render();
        } else if (name === "1" || name === "2" || name === "3") {
          selectHideOption(Number(name) - 1);
        } else if (name === "ENTER" || name === "KP_ENTER") {
          selectHideOption(hideMenuCursor);
        } else if (name === "ESCAPE" || name === "q") {
          mode = "NORMAL";
          setStatus("Cancelled");
          render();
        }
        return;
      }

      if (mode === "SNOOZE_DATE") {
        if (name === "UP" || name === "k") {
          snoozeCursor =
            (snoozeCursor - 1 + SNOOZE_PRESETS.length) % SNOOZE_PRESETS.length;
          render();
        } else if (name === "DOWN" || name === "j") {
          snoozeCursor = (snoozeCursor + 1) % SNOOZE_PRESETS.length;
          render();
        } else if (name === "ESCAPE" || name === "q") {
          mode = "NORMAL";
          setStatus("Cancelled");
          render();
        } else if (name === "ENTER" || name === "KP_ENTER") {
          const visible = getVisibleItems();
          const target = visible[cursor];
          const preset = SNOOZE_PRESETS[snoozeCursor];
          const until = preset.getUntil
            ? preset.getUntil()
            : Date.now() + preset.ms;
          if (target) {
            applyHide(target, "snooze", until);
          }
          mode = "NORMAL";
          render();
        }
        return;
      }

      const visible = getVisibleItems();

      if (name === "g") {
        if (pendingG) {
          cursor = 0;
          pendingG = false;
          render();
        } else {
          pendingG = true;
        }
        return;
      }
      pendingG = false;

      if (name === "G") {
        cursor = Math.max(0, visible.length - 1);
        render();
      } else if (name === "UP" || name === "k") {
        if (visible.length > 0) {
          cursor = (cursor - 1 + visible.length) % visible.length;
          render();
        }
      } else if (name === "DOWN" || name === "j") {
        if (visible.length > 0) {
          cursor = (cursor + 1) % visible.length;
          render();
        }
      } else if (
        name === "ENTER" ||
        name === "RETURN" ||
        name === "KP_ENTER" ||
        name === "o"
      ) {
        const chosen = visible[cursor];
        if (chosen) {
          try {
            onOpenUri(chosen.link, onAuditError);
            setStatus(
              `Opened (${chosen.link.startsWith("tg://") ? "app" : "web"}): ${chosen.topicName}`,
            );
          } catch (err) {
            setStatus(err?.message || String(err), true);
          }
          render();
        }
      } else if (name === "O") {
        const chosen = visible[cursor];
        if (chosen) {
          try {
            onOpenUri(chosen.webLink, onAuditError);
            setStatus(`Opened (web): ${chosen.topicName}`);
          } catch (err) {
            setStatus(err?.message || String(err), true);
          }
          render();
        }
      } else if (name === "r") {
        await triggerReload();
      } else if (name === "h") {
        if (visible[cursor]) {
          hideMenuCursor = 0;
          mode = "HIDE_MENU";
          render();
        }
      } else if (name === "d") {
        const target = visible[cursor];
        if (target) {
          applyHide(target, "forever");
          render();
        }
      } else if (name === "m") {
        const target = visible[cursor];
        if (target) {
          applyHide(target, "until_message");
          render();
        }
      } else if (name === "s") {
        if (visible[cursor]) {
          snoozeCursor = 0;
          mode = "SNOOZE_DATE";
          render();
        }
      } else if (name === "u") {
        const target = visible[cursor];
        if (target && target.hideMode !== null) {
          onUnhide(target, onAuditError);
          setStatus(`Unhidden: ${target.topicName}`);
          render();
        }
      } else if (name === "a") {
        showHidden = !showHidden;
        setStatus(
          showHidden ? "Showing hidden topics" : "Hiding hidden topics",
        );
        render();
      } else if (name === ":") {
        mode = "COMMAND";
        commandBuffer = "";
        render();
      } else if (name === "/") {
        mode = "SEARCH";
        commandBuffer = searchQuery;
        render();
      } else if (name === "ESCAPE") {
        if (searchQuery) {
          searchQuery = "";
          setStatus("Filter cleared");
          render();
        }
      } else if (name === "q") {
        cleanup();
      } else if (name === "y") {
        copyAndShowLink(visible[cursor], false);
        render();
      } else if (name === "Y") {
        copyAndShowLink(visible[cursor], true);
        render();
      }
    };

    term.alternateScreenBuffer(true);
    term.grabInput(true);
    term.on("key", onKey);
    term.on("resize", render);
    render();
  });
}
