import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, '.cache', 'site');
if (path.dirname(output) !== path.join(root, '.cache')) throw new Error('Invalid site output directory');
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(path.join(output, 'assets'), { recursive: true });

// An explicit allowlist keeps application data and reports out of the public site.
for (const file of ['index.html', 'styles.css', 'site.js', 'icons.svg', 'lucide-license.txt']) {
  await fs.copyFile(path.join(root, 'website', file), path.join(output, file));
}
for (const file of ['helmet.png', 'mascot-sheet.png']) {
  await fs.copyFile(path.join(root, 'public', file), path.join(output, 'assets', file));
}
await fs.copyFile(path.join(root, 'src', 'mascot-animations.json'), path.join(output, 'assets', 'mascot-animations.json'));
await fs.writeFile(path.join(output, '.nojekyll'), '');
console.log('Static site built in .cache/site');
