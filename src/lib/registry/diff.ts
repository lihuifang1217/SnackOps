import type { SkillDiffLine } from '@/lib/types';

type DiffOperation = {
  type: SkillDiffLine['type'];
  text: string;
  oldLine?: number;
  newLine?: number;
};

/**
 * 轻量逐行 LCS diff，适用于提示词这种中小型文本。
 * 超过 1,200 行时退化为分段对比，避免在请求线程里做过大的矩阵。
 */
export function diffLines(before: string, after: string): SkillDiffLine[] {
  const oldLines = before.split('\n');
  const newLines = after.split('\n');

  if (oldLines.length * newLines.length > 1_200_000) {
    return coarseDiff(oldLines, newLines);
  }

  const rows = oldLines.length + 1;
  const columns = newLines.length + 1;
  const table: Uint32Array[] = Array.from({ length: rows }, () => new Uint32Array(columns));

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < columns; j += 1) {
      table[i][j] =
        oldLines[i - 1] === newLines[j - 1]
          ? table[i - 1][j - 1] + 1
          : Math.max(table[i - 1][j], table[i][j - 1]);
    }
  }

  const reversed: DiffOperation[] = [];
  let i = oldLines.length;
  let j = newLines.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      reversed.push({
        type: 'context',
        text: oldLines[i - 1],
        oldLine: i,
        newLine: j,
      });
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || table[i][j - 1] >= table[i - 1][j])) {
      reversed.push({ type: 'added', text: newLines[j - 1], newLine: j });
      j -= 1;
    } else {
      reversed.push({ type: 'removed', text: oldLines[i - 1], oldLine: i });
      i -= 1;
    }
  }

  return reversed.reverse();
}

function coarseDiff(oldLines: string[], newLines: string[]): SkillDiffLine[] {
  const max = Math.max(oldLines.length, newLines.length);
  const result: SkillDiffLine[] = [];
  for (let index = 0; index < max; index += 1) {
    const oldLine = oldLines[index];
    const newLine = newLines[index];
    if (oldLine === newLine) {
      result.push({
        type: 'context',
        text: oldLine ?? '',
        oldLine: index + 1,
        newLine: index + 1,
      });
    } else {
      if (oldLine !== undefined) {
        result.push({ type: 'removed', text: oldLine, oldLine: index + 1 });
      }
      if (newLine !== undefined) {
        result.push({ type: 'added', text: newLine, newLine: index + 1 });
      }
    }
  }
  return result;
}
