/**
 * Parse the text output of wechat MCP `get_chat_history`.
 *
 * Real format observed:
 *   <name> 的消息记录（返回 N 条，offset=X, limit=Y）:
 *
 *   [YYYY-MM-DD HH:MM] sender: content...
 *   [YYYY-MM-DD HH:MM] me: [链接] 标题
 *   [YYYY-MM-DD HH:MM] sender: content with multiple
 *   continuation lines until next [date] line
 */

export interface ParsedMessage {
  ts: string;        // "2026-04-12 19:01"
  sender: string;    // "me" | "<contact name>"
  text: string;      // raw content (may contain [链接]/[链接/文件] etc markers)
}

export interface ParsedHistory {
  header: string;             // first non-empty line
  messages: ParsedMessage[];
}

const MSG_LINE = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\]\s+([^:]+?):\s*(.*)$/;

export function parseChatHistoryText(text: string): ParsedHistory {
  const lines = text.split("\n");
  let header = "";
  const messages: ParsedMessage[] = [];
  let current: ParsedMessage | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "");
    if (!header && line.trim()) {
      header = line.trim();
      continue;
    }
    if (!line.trim()) {
      // blank line ends current message accumulation but doesn't push yet
      continue;
    }
    const m = MSG_LINE.exec(line);
    if (m) {
      if (current) messages.push(current);
      current = { ts: m[1], sender: m[2].trim(), text: m[3] };
    } else if (current) {
      // continuation line — append with newline
      current.text += "\n" + line;
    }
  }
  if (current) messages.push(current);
  return { header, messages };
}

const VERBOSE_MARKERS = [
  /\[链接\/文件\]\s*当前微信版本不支持展示该内容，请升级至最新版本。?/g,
  /\[链接\/文件\]/g,
  /\[链接\]/g,
];

export function summarizeMessage(m: ParsedMessage, maxChars: number): string {
  let text = m.text;
  for (const re of VERBOSE_MARKERS) text = text.replace(re, "🔗");
  text = text.replace(/\s+/g, " ").trim();
  if (text.length > maxChars) text = text.slice(0, maxChars - 1) + "…";
  return `[${m.ts}] ${m.sender}: ${text}`;
}

export function renderSummaryText(parsed: ParsedHistory, perMsgChars: number): string {
  const head = parsed.header ? parsed.header + "\n" : "";
  return head + parsed.messages.map((m) => summarizeMessage(m, perMsgChars)).join("\n");
}
