/**
 * Parse the text output of wechat MCP `get_contacts`.
 *
 * Real format observed:
 *   找到 N 个联系人:
 *
 *   wxid_xxxxxx  备注: foo bar  昵称: baz
 *   wxid_yyyyyy  昵称: only nickname
 *   wxid_zzzzzz  备注: only remark
 *   sean12345  备注: pangu yangxu  昵称: 杨旭
 *
 * Fields are separated by **two or more spaces**; values themselves can contain
 * single spaces. The wxid is the first whitespace-separated token on the line.
 */
export interface ParsedContact {
  wxid: string;
  remark?: string;
  nickname?: string;
}

export interface ContactsParseResult {
  total_reported: number | null;
  contacts: ParsedContact[];
}

const HEADER_REGEX = /^找到\s*(\d+)\s*个联系人/;
const REMARK_REGEX = /备注:\s*(.+?)(?=\s{2,}昵称:|$)/;
const NICK_REGEX = /昵称:\s*(.+?)(?=\s{2,}备注:|$)/;

export function parseContactsText(text: string): ContactsParseResult {
  let total_reported: number | null = null;
  const contacts: ParsedContact[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    const trimmed = line.trim();
    if (!trimmed) continue;

    const headerMatch = HEADER_REGEX.exec(trimmed);
    if (headerMatch) {
      total_reported = Number.parseInt(headerMatch[1], 10);
      continue;
    }

    const firstSpace = trimmed.search(/\s/);
    if (firstSpace < 0) {
      contacts.push({ wxid: trimmed });
      continue;
    }
    const wxid = trimmed.slice(0, firstSpace);
    const rest = trimmed.slice(firstSpace).trim();
    let remark: string | undefined;
    let nickname: string | undefined;
    const remarkMatch = REMARK_REGEX.exec(rest);
    if (remarkMatch) remark = remarkMatch[1].trim();
    const nickMatch = NICK_REGEX.exec(rest);
    if (nickMatch) nickname = nickMatch[1].trim();
    contacts.push({ wxid, remark, nickname });
  }
  return { total_reported, contacts };
}

/**
 * Build a compact "best display name" for the agent / TUI. Prefer remark,
 * fall back to nickname, then wxid itself.
 */
export function bestDisplayName(c: ParsedContact): string {
  if (c.remark && c.remark.trim()) return c.remark.trim();
  if (c.nickname && c.nickname.trim()) return c.nickname.trim();
  return c.wxid;
}
