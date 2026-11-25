import { padOrTruncate, term } from "./TerminalHelpers.js";

export function runAllowlistChecklistTui(forums, existingAllowedIds) {
  if (!process.stdin.isTTY) {
    return Promise.reject(
      new Error("Interactive allowlist selector requires a TTY terminal."),
    );
  }

  return new Promise((resolve) => {
    const selectedIds = new Set(
      forums.map((f) => f.chatId).filter((id) => existingAllowedIds?.has(id)),
    );
    let cursor = 0;
    let scrollOffset = 0;
    let statusMsg =
      "Space: toggle • a: check/uncheck all • Enter: save to .env • q/Esc: cancel";
    let statusIsError = false;

    const totalRows = forums.length + 1;

    const render = () => {
      const cols = Math.max(40, term.width || 80);
      const rows = Math.max(12, term.height || 24);
      const viewportHeight = Math.max(3, rows - 3);

      if (cursor < scrollOffset) scrollOffset = cursor;
      if (cursor >= scrollOffset + viewportHeight) {
        scrollOffset = cursor - viewportHeight + 1;
      }

      term.hideCursor(true);
      term.moveTo(1, 1);
      const header = ` Configure Corporate Groups (${selectedIds.size}/${forums.length} selected)`;
      term.bgWhite.black.bold(padOrTruncate(header, cols));
      term.styleReset();

      const allChecked =
        forums.length > 0 && selectedIds.size === forums.length;

      for (let r = 0; r < viewportHeight; r++) {
        term.moveTo(1, 2 + r).eraseLine();
        const rowIdx = scrollOffset + r;

        if (rowIdx >= totalRows) {
          term.blue("~");
          term.styleReset();
          continue;
        }

        const isFocused = rowIdx === cursor;
        const caret = isFocused ? "> " : "  ";

        if (rowIdx === 0) {
          const box = allChecked ? "[x]" : "[ ]";
          const label = `${box} Check All (${forums.length} forum supergroups)`;
          const body = padOrTruncate(label, cols - 2);
          if (isFocused) {
            term.yellow.bold(caret);
            term.bgYellow.black.bold(body);
          } else {
            term(caret);
            term.bold(body);
          }
          term.styleReset();
        } else {
          const forum = forums[rowIdx - 1];
          const checked = selectedIds.has(forum.chatId);
          const box = checked ? "[x]" : "[ ]";
          const idTag = ` (${forum.chatId})`;
          const maxNameWidth = Math.max(10, cols - 2 - 4 - idTag.length);
          const titlePart = padOrTruncate(forum.title, maxNameWidth);
          const line = `${box} ${titlePart}${idTag}`;
          const body = padOrTruncate(line, cols - 2);

          if (isFocused) {
            term.cyan.bold(caret);
            term.cyan.bold(body);
          } else if (checked) {
            term(caret);
            term.green(body);
          } else {
            term(caret);
            term(body);
          }
          term.styleReset();
        }
      }

      term.moveTo(1, rows - 1).eraseLine();
      term.bgCyan.black.bold(" ALLOWLIST ");
      term.styleReset();
      const posLabel = ` ${cursor + 1}/${totalRows} `;
      const middleWidth = Math.max(0, cols - 11 - posLabel.length);
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
      term.dim(
        "↑/↓ or j/k: move • Space: check/uncheck • a: check all • Enter: save • Esc: cancel",
      );
      term.styleReset();
    };

    const cleanup = (result) => {
      term.removeListener("key", onKey);
      term.removeListener("resize", render);
      term.grabInput(false);
      term.hideCursor(false);
      term.alternateScreenBuffer(false);
      resolve(result);
    };

    const toggleAll = () => {
      if (selectedIds.size === forums.length) {
        selectedIds.clear();
        statusMsg = "Unchecked all groups";
      } else {
        for (const f of forums) selectedIds.add(f.chatId);
        statusMsg = `Checked all ${forums.length} groups`;
      }
      statusIsError = false;
    };

    const onKey = (name) => {
      if (name === "CTRL_C" || name === "ESCAPE" || name === "q") {
        cleanup(null);
        return;
      }

      if (name === "UP" || name === "k") {
        cursor = (cursor - 1 + totalRows) % totalRows;
        render();
      } else if (name === "DOWN" || name === "j") {
        cursor = (cursor + 1) % totalRows;
        render();
      } else if (name === "a" || name === "A") {
        toggleAll();
        render();
      } else if (name === " ") {
        if (cursor === 0) {
          toggleAll();
        } else {
          const target = forums[cursor - 1];
          if (selectedIds.has(target.chatId)) {
            selectedIds.delete(target.chatId);
            statusMsg = `Unchecked: ${target.title}`;
          } else {
            selectedIds.add(target.chatId);
            statusMsg = `Checked: ${target.title}`;
          }
          statusIsError = false;
        }
        render();
      } else if (name === "ENTER" || name === "KP_ENTER") {
        if (selectedIds.size === 0) {
          statusMsg = "Select at least one corporate group before saving";
          statusIsError = true;
          render();
          return;
        }
        cleanup(new Set(selectedIds));
      }
    };

    term.alternateScreenBuffer(true);
    term.grabInput(true);
    term.on("key", onKey);
    term.on("resize", render);
    render();
  });
}
