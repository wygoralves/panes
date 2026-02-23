import { create } from "zustand";
import type { Skill, LLMProvider } from "../types";

const SKILLS_STORAGE_KEY = "panes:skills";

function loadSkills(): Skill[] {
  try {
    const raw = localStorage.getItem(SKILLS_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Skill[];
  } catch {
    return [];
  }
}

function persistSkills(skills: Skill[]) {
  localStorage.setItem(SKILLS_STORAGE_KEY, JSON.stringify(skills));
}

interface SkillState {
  skills: Skill[];
  /** Currently selected skill for editing */
  activeSkillId: string | null;
  /** Whether the skills manager panel is open */
  panelOpen: boolean;

  openPanel: () => void;
  closePanel: () => void;
  setActiveSkill: (skillId: string | null) => void;
  createSkill: (params: {
    name: string;
    description: string;
    content: string;
    provider?: LLMProvider;
    global?: boolean;
    workspaceIds?: string[];
  }) => Skill;
  updateSkill: (
    skillId: string,
    updates: Partial<
      Pick<Skill, "name" | "description" | "content" | "provider" | "global" | "workspaceIds">
    >,
  ) => void;
  deleteSkill: (skillId: string) => void;
  toggleWorkspace: (skillId: string, workspaceId: string) => void;
  setSkillGlobal: (skillId: string, global: boolean) => void;
  getSkillsForWorkspace: (workspaceId: string) => Skill[];
  duplicateSkill: (skillId: string) => Skill | null;
}

export const useSkillStore = create<SkillState>((set, get) => ({
  skills: loadSkills(),
  activeSkillId: null,
  panelOpen: false,

  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false, activeSkillId: null }),

  setActiveSkill: (skillId) => set({ activeSkillId: skillId }),

  createSkill: (params) => {
    const now = new Date().toISOString();
    const skill: Skill = {
      id: crypto.randomUUID(),
      name: params.name,
      description: params.description,
      content: params.content,
      provider: params.provider,
      global: params.global ?? true,
      workspaceIds: params.workspaceIds ?? [],
      createdAt: now,
      updatedAt: now,
    };
    const next = [...get().skills, skill];
    persistSkills(next);
    set({ skills: next, activeSkillId: skill.id });
    return skill;
  },

  updateSkill: (skillId, updates) => {
    const next = get().skills.map((s) =>
      s.id === skillId
        ? { ...s, ...updates, updatedAt: new Date().toISOString() }
        : s,
    );
    persistSkills(next);
    set({ skills: next });
  },

  deleteSkill: (skillId) => {
    const next = get().skills.filter((s) => s.id !== skillId);
    persistSkills(next);
    set((state) => ({
      skills: next,
      activeSkillId: state.activeSkillId === skillId ? null : state.activeSkillId,
    }));
  },

  toggleWorkspace: (skillId, workspaceId) => {
    const skill = get().skills.find((s) => s.id === skillId);
    if (!skill) return;

    const has = skill.workspaceIds.includes(workspaceId);
    const nextWorkspaceIds = has
      ? skill.workspaceIds.filter((id) => id !== workspaceId)
      : [...skill.workspaceIds, workspaceId];

    get().updateSkill(skillId, { workspaceIds: nextWorkspaceIds });
  },

  setSkillGlobal: (skillId, global) => {
    get().updateSkill(skillId, {
      global,
      workspaceIds: global ? [] : get().skills.find((s) => s.id === skillId)?.workspaceIds ?? [],
    });
  },

  getSkillsForWorkspace: (workspaceId) => {
    return get().skills.filter(
      (s) => s.global || s.workspaceIds.includes(workspaceId),
    );
  },

  duplicateSkill: (skillId) => {
    const source = get().skills.find((s) => s.id === skillId);
    if (!source) return null;
    return get().createSkill({
      name: `${source.name} (copy)`,
      description: source.description,
      content: source.content,
      provider: source.provider,
      global: source.global,
      workspaceIds: [...source.workspaceIds],
    });
  },
}));
