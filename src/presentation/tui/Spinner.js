import { term } from "./TerminalHelpers.js";
import { sanitizeText } from "./TextSanitizer.js";

export function createNpmSpinner() {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let frameIndex = 0;
  let text = "Initializing...";
  let timer = null;

  const draw = () => {
    const cols = term.width || 80;
    const line = `${frames[frameIndex]} ${text}`.slice(0, cols - 1);
    term.column(1).eraseLine();
    term.cyan(line);
    frameIndex = (frameIndex + 1) % frames.length;
  };

  return {
    start(initialText) {
      if (initialText) text = initialText;
      term.clear();
      term.hideCursor(true);
      draw();
      timer = setInterval(draw, 80);
    },
    update(nextText) {
      text = sanitizeText(nextText);
    },
    stop() {
      if (timer) clearInterval(timer);
      term.column(1).eraseLine();
      term.hideCursor(false);
    },
  };
}
