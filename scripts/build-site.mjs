// Put the whole ttuk.pages.dev site together:
//   site/            ← portal (game list)
//   site/dokkaebi/   ← 도깨비 밤 (the Vite build)
// New games later get their own folder here.
import { cpSync, rmSync, mkdirSync } from 'node:fs';
rmSync('site', { recursive: true, force: true });
mkdirSync('site', { recursive: true });
cpSync('portal', 'site', { recursive: true });
cpSync('dist', 'site/dokkaebi', { recursive: true });
console.log('site ready: portal + /dokkaebi');
