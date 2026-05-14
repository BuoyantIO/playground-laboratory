import { promises as fs } from 'fs';
import path from 'path';
import type { Lang } from './i18n';

export async function loadTutorialContent(
  slug: string,
): Promise<Record<Lang, string>> {
  const dir = path.join(process.cwd(), 'app', 'tutorials', 'content');
  const [en, kr] = await Promise.all([
    fs.readFile(path.join(dir, 'en', `${slug}.md`), 'utf8'),
    fs.readFile(path.join(dir, 'kr', `${slug}.md`), 'utf8'),
  ]);
  return { en, kr };
}
