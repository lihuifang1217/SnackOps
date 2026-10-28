import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const projectRoot = process.cwd();
const tempRoot = await mkdtemp(path.join(tmpdir(), 'snackops-reset-'));
const dataDir = path.join(tempRoot, 'data');
const skillsDir = path.join(tempRoot, 'skills');

async function hash(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

async function snapshot() {
  const files = {};
  for (const name of ['eval_cases.json', 'eval_batches.json', 'eval-config.json', 'annotations.json', 'improvements.json', 'skills.json', 'skill-versions.json', 'skill-tests.json']) {
    files[name] = await hash(path.join(dataDir, name));
  }
  for (const entry of await readdir(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    files[`skills/${entry.name}/SKILL.md`] = await hash(path.join(skillsDir, entry.name, 'SKILL.md'));
  }
  return files;
}

try {
  await cp(path.join(projectRoot, 'data'), dataDir, { recursive: true });
  await cp(path.join(projectRoot, 'skills'), skillsDir, { recursive: true });
  const businessBefore = {
    products: await hash(path.join(dataDir, 'products.json')),
    orders: await hash(path.join(dataDir, 'orders.json')),
  };

  const runReset = () => spawnSync(process.execPath, ['scripts/classroom-reset.mjs'], {
    cwd: projectRoot,
    env: { ...process.env, SNACKOPS_DATA_DIR: dataDir, SNACKOPS_SKILLS_DIR: skillsDir },
    encoding: 'utf8',
  });

  const first = runReset();
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const firstSnapshot = await snapshot();
  const second = runReset();
  assert.equal(second.status, 0, second.stderr || second.stdout);
  const secondSnapshot = await snapshot();
  assert.deepEqual(secondSnapshot, firstSnapshot, '重复 reset 必须产生一致结果');

  const evalCases = JSON.parse(await readFile(path.join(dataDir, 'eval_cases.json'), 'utf8'));
  const batches = JSON.parse(await readFile(path.join(dataDir, 'eval_batches.json'), 'utf8'));
  const annotations = JSON.parse(await readFile(path.join(dataDir, 'annotations.json'), 'utf8'));
  const improvements = JSON.parse(await readFile(path.join(dataDir, 'improvements.json'), 'utf8'));
  const skills = JSON.parse(await readFile(path.join(dataDir, 'skills.json'), 'utf8'));
  const versions = JSON.parse(await readFile(path.join(dataDir, 'skill-versions.json'), 'utf8'));
  assert.equal(evalCases.length, 8);
  assert.equal(batches.length, 0);
  assert.equal(annotations.length, 0);
  assert.equal(improvements.length, 0);
  assert.equal(skills.length, 14);
  assert.equal(versions.length, 14);
  assert.equal(await hash(path.join(dataDir, 'products.json')), businessBefore.products);
  assert.equal(await hash(path.join(dataDir, 'orders.json')), businessBefore.orders);

  console.log(JSON.stringify({
    result: 'PASS',
    resetRuns: 2,
    deterministic: true,
    evalCases: evalCases.length,
    batches: batches.length,
    annotations: annotations.length,
    improvements: improvements.length,
    skills: skills.length,
    versions: versions.length,
    businessProductsUntouched: true,
    businessOrdersUntouched: true,
    filesStable: Object.keys(firstSnapshot).length,
  }, null, 2));
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
