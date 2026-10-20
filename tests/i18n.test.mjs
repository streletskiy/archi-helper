import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { catalogs, translate, getLanguage, setLanguage, normalizeLanguage } from '../locales/index.mjs';
import { Store } from '../electron/store.mjs';
import { SYSTEM, systemMessage } from '../electron/instructions.mjs';
import { agentTools } from '../electron/agent.mjs';

test('catalogs have matching keys and placeholders; interpolation preserves data', () => {
  assert.deepEqual(Object.keys(catalogs.ru).sort(), Object.keys(catalogs.en).sort());
  const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
  for (const key of Object.keys(catalogs.en)) {
    assert.ok(catalogs.en[key].trim(), key);
    assert.ok(catalogs.ru[key].trim(), key);
    assert.deepEqual(placeholders(catalogs.ru[key]), placeholders(catalogs.en[key]), key);
  }
  assert.equal(translate('en', 'ui.modelCount', { count: 22 }), 'Models: 22');
  assert.equal(translate('ru', 'agent.overwrite', { value0: '$& {filename}' }),
    catalogs.ru['agent.overwrite'].replace('{value0}', () => '$& {filename}'));
  assert.equal(normalizeLanguage('ru-RU'), 'ru');
  assert.equal(normalizeLanguage('de-DE'), 'en');
  assert.throws(() => translate('en', 'missing.key'), /Missing translation/);
});

test('language persists across restarts and changes backend errors and new session titles', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'archi-i18n-'));
  try {
    const store = new Store(path.join(root, 'profile'), {});
    await store.init('ru-RU');
    assert.equal(getLanguage(), 'ru');
    const project = await store.addProject(path.join(root, 'project'));
    assert.equal((await store.newSession(project.id)).title, catalogs.ru['ui.newSession']);
    await store.setLanguage('en');
    assert.equal((await store.newSession(project.id)).title, 'New session');
    assert.throws(() => store.project('missing'), /Project not found/);
    const reopened = new Store(path.join(root, 'profile'), {});
    await reopened.init('ru-RU');
    assert.equal(reopened.publicState().language, 'en');
    await assert.rejects(reopened.setLanguage('de'), /Unsupported language/);
    assert.equal(getLanguage(), 'en');
    await reopened.setLanguage('ru');
    assert.throws(() => reopened.project('missing'), error =>
      error.message === catalogs.ru['errors.projectNotFound']);
  } finally {
    setLanguage('en');
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('agent instructions use English and follow the request language, not the UI language', () => {
  assert.doesNotMatch(SYSTEM + JSON.stringify(agentTools), /\p{Script=Cyrillic}/u);
  assert.match(SYSTEM, /Respond in the language of the user's latest request/);
  assert.match(SYSTEM, /interface language.*must not override the user's language/s);
  setLanguage('ru');
  const russianUI = systemMessage('C:/Project', false, 'full');
  setLanguage('en');
  assert.equal(systemMessage('C:/Project', false, 'full'), russianUI);
  assert.match(russianUI, /without confirmation prompts/);
  assert.match(russianUI, /text only/);
  assert.match(systemMessage('C:/Project', true, 'read'), /changes and Python execution are forbidden/);
});
