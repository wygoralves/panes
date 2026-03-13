import type { ChatInputItem, CodexApp, CodexSkill } from "../../types";

const TOKEN_PATTERN = /\$([A-Za-z0-9._-]+)/g;

function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\$+/, "")
    .replace(/\s+/g, "-");
}

function buildSkillLookup(skills: CodexSkill[]): Map<string, CodexSkill> {
  const lookup = new Map<string, CodexSkill>();
  for (const skill of skills) {
    if (!skill.enabled) {
      continue;
    }
    lookup.set(normalizeToken(skill.name), skill);
  }
  return lookup;
}

function buildAppLookup(apps: CodexApp[]): Map<string, CodexApp> {
  const lookup = new Map<string, CodexApp>();
  for (const app of apps) {
    if (!app.isEnabled || !app.isAccessible) {
      continue;
    }
    lookup.set(normalizeToken(app.id), app);
    lookup.set(normalizeToken(app.name), app);
  }
  return lookup;
}

function pushTextItem(items: ChatInputItem[], text: string) {
  if (!text) {
    return;
  }
  const previous = items.at(-1);
  if (previous?.type === "text") {
    previous.text += text;
    return;
  }
  items.push({ type: "text", text });
}

export function buildCodexInputItems(
  message: string,
  skills: CodexSkill[],
  apps: CodexApp[],
): ChatInputItem[] {
  const skillLookup = buildSkillLookup(skills);
  const appLookup = buildAppLookup(apps);
  const items: ChatInputItem[] = [];
  let lastIndex = 0;

  for (const match of message.matchAll(TOKEN_PATTERN)) {
    const rawToken = match[0];
    const tokenName = match[1] ?? "";
    const matchIndex = match.index ?? 0;
    const skill = skillLookup.get(normalizeToken(tokenName));
    const app = skill ? null : appLookup.get(normalizeToken(tokenName));

    if (!skill && !app) {
      continue;
    }

    pushTextItem(items, message.slice(lastIndex, matchIndex));
    if (skill) {
      items.push({
        type: "skill",
        name: skill.name,
        path: skill.path,
      });
    } else if (app) {
      items.push({
        type: "mention",
        name: app.name,
        path: `app://${app.id}`,
      });
    }
    lastIndex = matchIndex + rawToken.length;
  }

  pushTextItem(items, message.slice(lastIndex));
  if (items.length === 0) {
    return [{ type: "text", text: message }];
  }

  return items;
}
