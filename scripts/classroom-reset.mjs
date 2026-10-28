import { createHash } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const presetRoot = path.join(projectRoot, 'scripts', 'classroom-preset');
const dryRun = process.argv.includes('--dry-run');
const dataDirectory = process.env.SNACKOPS_DATA_DIR
  ? path.resolve(projectRoot, process.env.SNACKOPS_DATA_DIR)
  : path.join(projectRoot, 'data');
const skillsDirectory = process.env.SNACKOPS_SKILLS_DIR
  ? path.resolve(projectRoot, process.env.SNACKOPS_SKILLS_DIR)
  : path.join(projectRoot, 'skills');

const resetCollections = [
  'eval_cases.json',
  'eval_batches.json',
  'eval-config.json',
  'annotations.json',
  'improvements.json',
  'skills.json',
  'skill-versions.json',
  'skill-tests.json',
];

async function sha256File(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

async function atomicWrite(target, content) {
  const directory = path.dirname(target);
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeFile(temporary, content);
    const handle = await open(temporary, 'r');
    await handle.sync();
    await handle.close();
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function main() {
  const businessFiles = ['products.json', 'orders.json', 'users.json', 'activities.json', 'coupons.json'];
  const businessBefore = [];
  for (const name of businessFiles) {
    try { businessBefore.push({ name, hash: await sha256File(path.join(dataDirectory, name)) }); } catch { /* optional */ }
  }
  const manifest = [];
  for (const name of resetCollections) {
    const source = path.join(presetRoot, 'data', name);
    await stat(source);
    const content = await readFile(source);
    manifest.push({ target: path.join(dataDirectory, name), source, hash: createHash('sha256').update(content).digest('hex') });
    if (!dryRun) await atomicWrite(path.join(dataDirectory, name), content);
  }

  const skillsRoot = path.join(presetRoot, 'skills');
  for (const entry of await readdir(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const source = path.join(skillsRoot, entry.name, 'SKILL.md');
    await stat(source);
    const content = await readFile(source);
    manifest.push({ target: path.join(skillsDirectory, entry.name, 'SKILL.md'), source, hash: createHash('sha256').update(content).digest('hex') });
    if (!dryRun) await atomicWrite(path.join(skillsDirectory, entry.name, 'SKILL.md'), content);
  }

  const businessAfter = [];
  for (const name of businessFiles) {
    try { businessAfter.push({ name, hash: await sha256File(path.join(dataDirectory, name)) }); } catch { /* optional */ }
  }
  const businessFilesUntouched = businessBefore.every((item) =>
    businessAfter.some((after) => after.name === item.name && after.hash === item.hash),
  ) && businessBefore.length === businessAfter.length;
  if (!businessFilesUntouched) {
    throw new Error('重置检测到业务基础数据发生变化，已中止');
  }

  console.log(JSON.stringify({
    result: 'PASS',
    dryRun,
    dataDirectory,
    skillsDirectory,
    collections: resetCollections,
    skills: manifest.filter((item) => item.target.includes(`${path.sep}skills${path.sep}`)).length,
    written: dryRun ? 0 : manifest.length,
    businessFilesUntouched,
    businessHashesBefore: businessBefore,
  }, null, 2));
}

await main();
