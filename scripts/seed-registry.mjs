import { createHash, randomUUID } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const skillsPath = path.join(projectRoot, 'data', 'skills.json');
const versionsPath = path.join(projectRoot, 'data', 'skill-versions.json');
const force = process.argv.includes('--force');

const skills = JSON.parse(await readFile(skillsPath, 'utf8'));
try {
  const versions = JSON.parse(await readFile(versionsPath, 'utf8'));
  if (Array.isArray(versions) && versions.length > 0 && !force) {
    console.error('skill-versions.json 已包含数据；如需重新初始化，请显式传入 --force');
    process.exit(1);
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

function normalizePrompt(value) {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd();
}

function hashRevision(skill, systemPrompt) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        description: skill.description,
        model: skill.model,
        temperature: skill.temperature,
        maxTokens: skill.maxTokens,
        requiredTools: [...skill.requiredTools].sort(),
        systemPrompt: normalizePrompt(systemPrompt),
      }),
      'utf8',
    )
    .digest('hex');
}

const snapshots = [];
for (const [index, skill] of skills.entries()) {
  if (!/^[\p{L}\p{N}_-]{1,80}$/u.test(skill.id) || skill.id.includes('..')) {
    throw new Error(`不安全的 Skill id: ${skill.id}`);
  }
  const expectedPath = `skills/${skill.id}/SKILL.md`;
  if (skill.filePath !== expectedPath) {
    throw new Error(`${skill.id} 的 filePath 不是规范路径`);
  }
  const absolutePath = path.join(projectRoot, 'skills', skill.id, 'SKILL.md');
  const info = await stat(absolutePath);
  if (!info.isFile()) throw new Error(`${expectedPath} 不是普通文件`);
  const systemPrompt = normalizePrompt(await readFile(absolutePath, 'utf8'));
  if (!systemPrompt) throw new Error(`${expectedPath} 为空`);

  snapshots.push({
    id: `seed-${String(index + 1).padStart(2, '0')}-${randomUUID().slice(0, 8)}`,
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
    systemPrompt,
    hash: hashRevision(skill, systemPrompt),
    status: '当前',
    changeNote: '初始化当前版本',
    createdBy: '系统初始化',
    createdAt: skill.updatedAt,
  });
}

await writeFile(versionsPath, `${JSON.stringify(snapshots, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ initializedSnapshots: snapshots.length, versionsPath }, null, 2));
