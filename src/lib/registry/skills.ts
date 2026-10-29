import 'server-only';

import { z } from 'zod';
import { AppError } from '@/lib/errors';
import {
  readCollection,
  writeCollection,
} from '@/lib/store';
import type { Skill, SkillVersion } from '@/lib/schemas';
import type {
  SkillDetail,
  SkillDiffResponse,
  SkillDiffTarget,
  SkillSummary,
  SkillUpdatePayload,
  SkillVersionDetail,
  SkillVersionSummary,
} from '@/lib/types';
import { diffLines } from './diff';
import { computeRevisionHash } from './hash';
import { withRegistryLock } from './lock';
import {
  canonicalSkillFilePath,
  normalizePrompt,
  readSkillPrompt,
  validateSkillId,
  writeSkillPrompt,
} from './skill-files';
import { createVersionId, nextPatchVersion } from './version';

export const skillUpdatePayloadSchema = z
  .object({
    name: z.string().trim().min(1, 'Skill 名称不能为空').max(80).optional(),
    description: z.string().trim().min(1, '触发描述不能为空').max(500),
    model: z.string().trim().min(1, '模型不能为空').max(120),
    temperature: z.number().min(0).max(2),
    maxTokens: z.number().int().min(100).max(32000),
    requiredTools: z.array(z.string().min(1)).max(20),
    systemPrompt: z.string().min(20, '提示词至少需要 20 个字符').max(50000),
    changeNote: z.string().trim().min(1, '变更说明不能为空').max(500),
    expectedHash: z.string().min(16).max(128),
  })
  .strict();

function summaryFrom(skill: Skill, systemPrompt: string): SkillSummary {
  const prompt = normalizePrompt(systemPrompt);
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    category: skill.category,
    enabled: skill.enabled,
    model: skill.model,
    temperature: skill.temperature,
    maxTokens: skill.maxTokens,
    requiredTools: skill.requiredTools,
    version: skill.version,
    filePath: skill.filePath,
    updatedAt: skill.updatedAt,
    hash: computeRevisionHash(skill, prompt),
    promptLength: prompt.length,
  };
}

function detailFrom(skill: Skill, systemPrompt: string): SkillDetail {
  const prompt = normalizePrompt(systemPrompt);
  return {
    ...summaryFrom(skill, prompt),
    systemPrompt: prompt,
    nextVersion: nextPatchVersion(skill.version),
  };
}

function versionSummary(version: SkillVersion): SkillVersionSummary {
  return {
    id: version.id,
    skillId: version.skillId,
    version: version.version,
    status: version.status,
    hash: version.hash,
    changeNote: version.changeNote,
    createdBy: version.createdBy,
    createdAt: version.createdAt,
    promptLength: normalizePrompt(version.systemPrompt).length,
  };
}

function versionDetail(version: SkillVersion): SkillVersionDetail {
  return {
    ...versionSummary(version),
    name: version.name,
    description: version.description,
    category: version.category,
    enabled: version.enabled,
    model: version.model,
    temperature: version.temperature,
    maxTokens: version.maxTokens,
    requiredTools: version.requiredTools,
    filePath: version.filePath,
    systemPrompt: normalizePrompt(version.systemPrompt),
  };
}

async function requireSkill(skillId: string): Promise<Skill> {
  validateSkillId(skillId);
  const skills = await readCollection('skills');
  const skill = skills.find((item) => item.id === skillId);
  if (!skill) {
    throw new AppError(404, 'SKILL_NOT_FOUND', 'Skill 不存在');
  }
  return skill;
}

export async function listSkills(): Promise<SkillSummary[]> {
  const skills = await readCollection('skills');
  return Promise.all(
    skills.map(async (skill) => {
      const prompt = await readSkillPrompt(skill);
      return summaryFrom(skill, prompt);
    }),
  );
}

export async function listEnabledSkills(): Promise<SkillDetail[]> {
  const skills = await readCollection('skills');
  const enabled = skills.filter((skill) => skill.enabled);
  return Promise.all(
    enabled.map(async (skill) => {
      const prompt = await readSkillPrompt(skill);
      return detailFrom(skill, prompt);
    }),
  );
}

export async function getSkillDetail(skillId: string): Promise<SkillDetail> {
  const skill = await requireSkill(skillId);
  const prompt = await readSkillPrompt(skill);
  return detailFrom(skill, prompt);
}

export async function setSkillEnabled(
  skillId: string,
  enabled: boolean,
): Promise<SkillDetail> {
  validateSkillId(skillId);

  return withRegistryLock('skills-registry', async () => {
    const skills = await readCollection('skills');
    const current = skills.find((item) => item.id === skillId);
    if (!current) {
      throw new AppError(404, 'SKILL_NOT_FOUND', 'Skill 不存在');
    }

    const nextSkill: Skill = {
      ...current,
      enabled,
      updatedAt: new Date().toISOString(),
    };
    await writeCollection(
      'skills',
      skills.map((item) => (item.id === skillId ? nextSkill : item)),
    );
    const prompt = await readSkillPrompt(nextSkill);
    return detailFrom(nextSkill, prompt);
  });
}

function buildSnapshot(
  skill: Skill,
  systemPrompt: string,
  hash: string,
  input: {
    status: SkillVersion['status'];
    changeNote: string;
    createdBy: string;
    createdAt: string;
  },
): SkillVersion {
  return {
    id: createVersionId(),
    skillId: skill.id,
    name: skill.name,
    description: skill.description,
    category: skill.category,
    enabled: skill.enabled,
    model: skill.model,
    temperature: skill.temperature,
    maxTokens: skill.maxTokens,
    requiredTools: skill.requiredTools,
    version: skill.version,
    filePath: skill.filePath,
    systemPrompt: normalizePrompt(systemPrompt),
    hash,
    status: input.status,
    changeNote: input.changeNote,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
  };
}

export async function saveSkillVersion(
  skillId: string,
  rawInput: SkillUpdatePayload,
): Promise<SkillDetail> {
  validateSkillId(skillId);
  const input = skillUpdatePayloadSchema.parse(rawInput);

  return withRegistryLock('skills-registry', async () => {
    const [skills, versions, tools] = await Promise.all([
      readCollection('skills'),
      readCollection('skill-versions'),
      readCollection('tools'),
    ]);
    const current = skills.find((item) => item.id === skillId);
    if (!current) {
      throw new AppError(404, 'SKILL_NOT_FOUND', 'Skill 不存在');
    }

    const currentPrompt = await readSkillPrompt(current);
    const currentHash = computeRevisionHash(current, currentPrompt);
    const nextName = input.name ?? current.name;
    const duplicateName = skills.some(
      (skill) =>
        skill.id !== skillId &&
        skill.name.trim().toLocaleLowerCase('zh-CN') === nextName.toLocaleLowerCase('zh-CN'),
    );
    if (duplicateName) {
      throw new AppError(409, 'SKILL_NAME_EXISTS', `Skill 名称「${nextName}」已被使用`);
    }

    if (currentHash !== input.expectedHash) {
      throw new AppError(
        409,
        'REVISION_CONFLICT',
        'Skill 已被其他操作更新，请刷新后再保存',
        { expectedHash: input.expectedHash, currentHash },
      );
    }

    const knownToolIds = new Set(tools.map((tool) => tool.id));
    const unknownTools = [...new Set(input.requiredTools)].filter((toolId) => !knownToolIds.has(toolId));
    if (unknownTools.length > 0) {
      throw new AppError(400, 'UNKNOWN_REQUIRED_TOOL', `依赖的工具不存在：${unknownTools.join(', ')}`);
    }

    const newPrompt = normalizePrompt(input.systemPrompt);
    const newHash = computeRevisionHash(
      {
        description: input.description,
        model: input.model,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        requiredTools: [...new Set(input.requiredTools)],
      },
      newPrompt,
    );
    if (newHash === currentHash && nextName === current.name) {
      throw new AppError(400, 'NO_SKILL_CHANGES', '名称、提示词和可编辑配置均未变化');
    }

    const createdAt = new Date().toISOString();
    const newSkill: Skill = {
      ...current,
      name: nextName,
      description: input.description,
      model: input.model,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
      requiredTools: [...new Set(input.requiredTools)],
      version: nextPatchVersion(current.version),
      filePath: canonicalSkillFilePath(current.id),
      updatedAt: createdAt,
    };

    const preSnapshotExists = versions.some(
      (version) =>
        version.skillId === skillId &&
        version.status === '当前' &&
        version.hash === currentHash,
    );
    const historical = versions.map((version) =>
      version.skillId === skillId ? { ...version, status: '历史' as const } : version,
    );
    const preSnapshot = preSnapshotExists
      ? []
      : [
          buildSnapshot(current, currentPrompt, currentHash, {
            status: '历史',
            changeNote: '修改前自动快照',
            createdBy: '运营管理员',
            createdAt,
          }),
        ];
    const nextVersionSnapshot = buildSnapshot(newSkill, newPrompt, newHash, {
      status: '当前',
      changeNote: input.changeNote,
      createdBy: '运营管理员',
      createdAt,
    });
    const nextVersions = [...historical, ...preSnapshot, nextVersionSnapshot];

    try {
      await writeSkillPrompt(newSkill, newPrompt);
      await writeCollection(
        'skills',
        skills.map((skill) => (skill.id === skillId ? newSkill : skill)),
      );
      await writeCollection('skill-versions', nextVersions);
    } catch (error) {
      await writeSkillPrompt(current, currentPrompt).catch(() => undefined);
      await writeCollection('skills', skills).catch(() => undefined);
      throw error;
    }

    return detailFrom(newSkill, newPrompt);
  });
}

const skillDraftSchema = z.object({
  systemPrompt: z.string().min(20).max(50000),
  changeNote: z.string().trim().min(1).max(500),
  expectedHash: z.string().min(16).max(128),
});

/**
 * 创建“待确认”的版本快照：只写 skill-versions，不修改生产 Skill Prompt。
 * A/B 草稿的 B 版本由此产生，用户确认后再由 applyDraftSkillVersion 提升为当前版本。
 */
export async function createDraftSkillVersion(
  skillId: string,
  raw: unknown,
): Promise<SkillVersionDetail> {
  validateSkillId(skillId);
  const input = skillDraftSchema.parse(raw);

  return withRegistryLock('skills-registry', async () => {
    const [skills, versions] = await Promise.all([
      readCollection('skills'),
      readCollection('skill-versions'),
    ]);
    const current = skills.find((item) => item.id === skillId);
    if (!current) throw new AppError(404, 'SKILL_NOT_FOUND', 'Skill 不存在');
    const currentPrompt = await readSkillPrompt(current);
    const currentHash = computeRevisionHash(current, currentPrompt);
    if (currentHash !== input.expectedHash) {
      throw new AppError(409, 'REVISION_CONFLICT', 'Skill 已被其他操作更新，请重新生成草案', {
        expectedHash: input.expectedHash,
        currentHash,
      });
    }
    const prompt = normalizePrompt(input.systemPrompt);
    const hash = computeRevisionHash(current, prompt);
    if (hash === currentHash) {
      throw new AppError(400, 'NO_SKILL_CHANGES', 'Prompt 没有变化，无法创建版本');
    }
    const existing = versions.find(
      (version) => version.skillId === skillId && version.status === '草稿' && version.hash === hash,
    );
    if (existing) return versionDetail(existing);

    const draftSkill: Skill = { ...current, version: nextPatchVersion(current.version) };
    const draft = buildSnapshot(draftSkill, prompt, hash, {
      status: '草稿',
      changeNote: input.changeNote,
      createdBy: '运营管理员',
      createdAt: new Date().toISOString(),
    });
    await writeCollection('skill-versions', [draft, ...versions]);
    return versionDetail(draft);
  });
}

/** 将 A/B 草稿版本正式提升为当前版本，同时保留旧版本快照。 */
export async function applyDraftSkillVersion(
  skillId: string,
  versionId: string,
  input: { expectedHash?: string; changeNote?: string } = {},
): Promise<SkillDetail> {
  validateSkillId(skillId);
  return withRegistryLock('skills-registry', async () => {
    const [skills, versions] = await Promise.all([
      readCollection('skills'),
      readCollection('skill-versions'),
    ]);
    const current = skills.find((item) => item.id === skillId);
    if (!current) throw new AppError(404, 'SKILL_NOT_FOUND', 'Skill 不存在');
    const draft = versions.find(
      (version) => version.id === versionId && version.skillId === skillId && version.status === '草稿',
    );
    if (!draft) throw new AppError(404, 'SKILL_VERSION_NOT_FOUND', '可应用的 A/B 草稿版本不存在');
    const currentPrompt = await readSkillPrompt(current);
    const currentHash = computeRevisionHash(current, currentPrompt);
    if (input.expectedHash && input.expectedHash !== currentHash) {
      throw new AppError(409, 'REVISION_CONFLICT', 'Skill 已被其他操作更新，请重新确认 A/B 草稿', {
        expectedHash: input.expectedHash,
        currentHash,
      });
    }
    const now = new Date().toISOString();
    const newSkill: Skill = {
      ...current,
      name: draft.name,
      description: draft.description,
      enabled: draft.enabled,
      model: draft.model,
      temperature: draft.temperature,
      maxTokens: draft.maxTokens,
      requiredTools: draft.requiredTools,
      version: draft.version,
      filePath: draft.filePath,
      updatedAt: now,
    };
    const nextVersions = versions.map((version) => {
      if (version.skillId !== skillId) return version;
      if (version.id === draft.id) {
        return {
          ...version,
          status: '当前' as const,
          changeNote: input.changeNote?.trim() || version.changeNote,
        };
      }
      return { ...version, status: '历史' as const };
    });
    try {
      await writeSkillPrompt(newSkill, draft.systemPrompt);
      await writeCollection('skills', skills.map((item) => (item.id === skillId ? newSkill : item)));
      await writeCollection('skill-versions', nextVersions);
    } catch (error) {
      await writeSkillPrompt(current, currentPrompt).catch(() => undefined);
      await writeCollection('skills', skills).catch(() => undefined);
      throw error;
    }
    return detailFrom(newSkill, draft.systemPrompt);
  });
}

export async function applySkillVersion(skillId: string, versionId: string): Promise<SkillDetail> {
  validateSkillId(skillId);
  return withRegistryLock('skills-registry', async () => {
    const [skills, versions] = await Promise.all([
      readCollection('skills'),
      readCollection('skill-versions'),
    ]);
    const current = skills.find((item) => item.id === skillId);
    if (!current) throw new AppError(404, 'SKILL_NOT_FOUND', 'Skill 不存在');
    const selected = versions.find(
      (version) =>
        version.id === versionId &&
        version.skillId === skillId &&
        version.status !== '草稿',
    );
    if (!selected) {
      throw new AppError(404, 'SKILL_VERSION_NOT_FOUND', '可应用的 Skill 版本不存在');
    }
    if (selected.status === '当前') {
      const prompt = await readSkillPrompt(current);
      return detailFrom(current, prompt);
    }
    const currentPrompt = await readSkillPrompt(current);
    const now = new Date().toISOString();
    const nextSkill: Skill = {
      ...current,
      name: selected.name,
      description: selected.description,
      enabled: selected.enabled,
      model: selected.model,
      temperature: selected.temperature,
      maxTokens: selected.maxTokens,
      requiredTools: selected.requiredTools,
      version: selected.version,
      filePath: selected.filePath,
      updatedAt: now,
    };
    const nextVersions = versions.map((version) => {
      if (version.skillId !== skillId) return version;
      return { ...version, status: version.id === selected.id ? ('当前' as const) : ('历史' as const) };
    });
    try {
      await writeSkillPrompt(nextSkill, selected.systemPrompt);
      await writeCollection('skills', skills.map((item) => (item.id === skillId ? nextSkill : item)));
      await writeCollection('skill-versions', nextVersions);
    } catch (error) {
      await writeSkillPrompt(current, currentPrompt).catch(() => undefined);
      await writeCollection('skills', skills).catch(() => undefined);
      throw error;
    }
    return detailFrom(nextSkill, selected.systemPrompt);
  });
}

export async function listSkillVersions(skillId: string): Promise<SkillVersionSummary[]> {
  validateSkillId(skillId);
  await requireSkill(skillId);
  const versions = await readCollection('skill-versions');
  return versions
    .filter((version) => version.skillId === skillId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map(versionSummary);
}

export async function getSkillVersion(
  skillId: string,
  versionId: string,
): Promise<SkillVersionDetail> {
  validateSkillId(skillId);
  await requireSkill(skillId);
  const versions = await readCollection('skill-versions');
  const version = versions.find((item) => item.skillId === skillId && item.id === versionId);
  if (!version) {
    throw new AppError(404, 'SKILL_VERSION_NOT_FOUND', 'Skill 版本不存在');
  }
  return versionDetail(version);
}

function currentTarget(skill: Skill, prompt: string): SkillDiffTarget {
  return {
    id: 'current',
    version: skill.version,
    hash: computeRevisionHash(skill, prompt),
    createdAt: skill.updatedAt,
  };
}

export async function rollbackSkillVersion(
  skillId: string,
  versionId: string,
  changeNote?: string,
): Promise<SkillDetail> {
  validateSkillId(skillId);
  const [current, version] = await Promise.all([
    getSkillDetail(skillId),
    getSkillVersion(skillId, versionId),
  ]);
  return saveSkillVersion(skillId, {
    name: current.name,
    description: version.description,
    model: version.model,
    temperature: version.temperature,
    maxTokens: version.maxTokens,
    requiredTools: version.requiredTools,
    systemPrompt: version.systemPrompt,
    changeNote: changeNote?.trim() || `回滚到 v${version.version}，恢复该版本正文与模型参数`,
    expectedHash: current.hash,
  });
}

export async function diffSkillVersion(
  skillId: string,
  fromVersionId: string,
  toVersionId = 'current',
): Promise<SkillDiffResponse> {
  validateSkillId(skillId);
  const skill = await requireSkill(skillId);
  const [versions, currentPrompt] = await Promise.all([
    readCollection('skill-versions'),
    readSkillPrompt(skill),
  ]);

  const fromVersion = versions.find(
    (version) => version.skillId === skillId && version.id === fromVersionId,
  );
  if (!fromVersion) {
    throw new AppError(404, 'SKILL_VERSION_NOT_FOUND', '对比的源版本不存在');
  }

  let toPrompt: string;
  let to: SkillDiffTarget;
  if (toVersionId === 'current') {
    toPrompt = currentPrompt;
    to = currentTarget(skill, currentPrompt);
  } else {
    const toVersion = versions.find(
      (version) => version.skillId === skillId && version.id === toVersionId,
    );
    if (!toVersion) {
      throw new AppError(404, 'SKILL_VERSION_NOT_FOUND', '对比的目标版本不存在');
    }
    toPrompt = normalizePrompt(toVersion.systemPrompt);
    to = {
      id: toVersion.id,
      version: toVersion.version,
      hash: toVersion.hash,
      createdAt: toVersion.createdAt,
    };
  }

  const fromPrompt = normalizePrompt(fromVersion.systemPrompt);
  const lines = diffLines(fromPrompt, toPrompt);
  return {
    from: {
      id: fromVersion.id,
      version: fromVersion.version,
      hash: fromVersion.hash,
      createdAt: fromVersion.createdAt,
    },
    to,
    lines,
    stats: {
      added: lines.filter((line) => line.type === 'added').length,
      removed: lines.filter((line) => line.type === 'removed').length,
      unchanged: lines.filter((line) => line.type === 'context').length,
    },
  };
}
