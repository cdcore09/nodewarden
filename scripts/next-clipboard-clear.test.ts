import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copySensitive, CLIPBOARD_CLEAR_SECONDS, type ClipboardPort } from '../webapp/src/lib/next/clipboard-clear';

function fakePort(opts: { readFails?: boolean } = {}) {
  let clip = '';
  const port: ClipboardPort = {
    async write(text: string) { clip = text; },
    async read() {
      if (opts.readFails) throw new Error('denied');
      return clip;
    },
  };
  return { port, get: () => clip, set: (v: string) => { clip = v; } };
}

function fakeScheduler() {
  const pending: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
  const schedule = (fn: () => void, ms: number) => {
    const item = { fn, ms, cancelled: false };
    pending.push(item);
    return () => { item.cancelled = true; };
  };
  const fire = async () => {
    for (const item of pending.splice(0)) {
      if (!item.cancelled) item.fn();
    }
    // allow the async clear body to settle
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  };
  return { schedule, fire, pending };
}

test('clears the clipboard after the delay when content is unchanged', async () => {
  const { port, get } = fakePort();
  const { schedule, fire, pending } = fakeScheduler();
  const copy = await copySensitive(port, 'hunter2', schedule);
  assert.equal(copy.canClear, true);
  assert.equal(get(), 'hunter2');
  assert.equal(pending[0].ms, CLIPBOARD_CLEAR_SECONDS * 1000);
  await fire();
  assert.equal(get(), '');
});

test('leaves the clipboard alone if the user copied something newer', async () => {
  const { port, get, set } = fakePort();
  const { schedule, fire } = fakeScheduler();
  await copySensitive(port, 'hunter2', schedule);
  set('user copied this later');
  await fire();
  assert.equal(get(), 'user copied this later');
});

test('reports canClear=false and schedules nothing when reading is denied', async () => {
  const { port, get } = fakePort({ readFails: true });
  const { schedule, pending } = fakeScheduler();
  const copy = await copySensitive(port, 'hunter2', schedule);
  assert.equal(copy.canClear, false);
  assert.equal(get(), 'hunter2');
  assert.equal(pending.length, 0);
});

test('a newer sensitive copy cancels the previous clear timer', async () => {
  const { port, get } = fakePort();
  const { schedule, fire, pending } = fakeScheduler();
  await copySensitive(port, 'first', schedule);
  await copySensitive(port, 'second', schedule);
  assert.equal(pending.filter((p) => !p.cancelled).length, 1);
  await fire();
  assert.equal(get(), '');
});

test('cancel() unschedules the clear', async () => {
  const { port, get } = fakePort();
  const { schedule, fire } = fakeScheduler();
  const copy = await copySensitive(port, 'keepme', schedule);
  copy.cancel();
  await fire();
  assert.equal(get(), 'keepme');
});
