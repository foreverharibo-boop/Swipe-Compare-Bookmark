const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
    ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');

test('message buttons update locally, batch changes and preserve swipe/bookmark actions', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setContent('<div id="extensionsMenu"></div><div id="chat"></div>');
        await page.evaluate(() => {
            window.reads = []; window.saves = 0; window.handlers = {};
            window.messages = Array.from({ length: 100 }, (_, i) => ({
                name: 'Character', mes: 'first ' + i, swipes: ['first ' + i, 'second ' + i], swipe_id: 0,
                swipe_info: [{ extra: { display_text: '번역 첫째 ' + i } }, { extra: { display_text: '번역 둘째 ' + i } }],
            }));
            const chat = new Proxy(messages, { get(target, key) {
                if (/^\d+$/.test(String(key))) reads.push(Number(key));
                return Reflect.get(target, key);
            } });
            const names = ['MESSAGE_SWIPED', 'MESSAGE_RECEIVED', 'CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED', 'CHAT_CHANGED'];
            window.ctx = { chat, event_types: Object.fromEntries(names.map(n => [n, n])),
                eventSource: { on: (name, fn) => (handlers[name] ||= []).push(fn) },
                saveChatDebounced: () => saves++, updateMessageBlock: (id, message) => {
                    document.querySelector(`.mes[mesid="${id}"] .mes_text`).textContent = message.mes;
                },
            };
            window.emit = (name, ...args) => handlers[name]?.forEach(fn => fn(...args));
            window.SillyTavern = { getContext: () => ctx };
            document.querySelector('#chat').innerHTML = messages.map((m, i) =>
                `<div class="mes" mesid="${i}"><div class="mes_text">${m.mes}</div><div class="mes_buttons"></div></div>`).join('');
            window.background = false;
            Object.defineProperty(document, 'hidden', { get: () => background });
        });
        await page.addScriptTag({ path: path.join(__dirname, '..', 'index.js') });
        await page.waitForTimeout(180);
        assert.equal(await page.locator('.swipe-compare-btn').count(), 100);
        await page.evaluate(() => { reads.length = 0; });
        await page.waitForTimeout(200);
        assert.equal(await page.evaluate(() => reads.length), 0, 'idle page must not rescan messages');

        await page.evaluate(() => {
            const text = document.querySelector('.mes[mesid="42"] .mes_text');
            for (let i = 0; i < 30; i++) text.textContent = 'stream ' + i;
            emit('MESSAGE_SWIPED', 42); emit('CHARACTER_MESSAGE_RENDERED', 42);
        });
        await page.waitForTimeout(130);
        assert.deepEqual(await page.evaluate(() => reads), [42], 'stream burst and host events should be one local check');
        await page.evaluate(() => {
            reads.length = 0; messages[42].swipes = ['only']; emit('MESSAGE_SWIPED', 42);
        });
        await page.waitForTimeout(130);
        assert.equal(await page.locator('.mes[mesid="42"] .swipe-compare-btn').count(), 0);
        assert.deepEqual(await page.evaluate(() => reads), [42], 'own removal must not retrigger observer');
        await page.evaluate(() => {
            reads.length = 0; messages[42].swipes.push('again');
            document.querySelector('.mes[mesid="42"] .mes_buttons').outerHTML = '<div class="mes_buttons"></div>';
        });
        await page.waitForTimeout(130);
        assert.equal(await page.locator('.mes[mesid="42"] .swipe-compare-btn').count(), 1);
        assert.deepEqual(await page.evaluate(() => reads), [42]);

        await page.evaluate(() => {
            background = true; document.dispatchEvent(new Event('visibilitychange')); reads.length = 0;
            for (let i = 0; i < 20; i++) document.querySelector('.mes[mesid="9"] .mes_text').textContent = 'hidden ' + i;
            messages[9].swipes = ['only']; emit('MESSAGE_SWIPED', 9);
        });
        await page.waitForTimeout(150);
        assert.equal(await page.evaluate(() => reads.length), 0);
        await page.evaluate(() => { background = false; document.dispatchEvent(new Event('visibilitychange')); });
        await page.waitForTimeout(150);
        assert.equal(await page.locator('.mes[mesid="9"] .swipe-compare-btn').count(), 0);

        // Real controls still save favorites/labels, show translations and switch an old message.
        await page.locator('.mes[mesid="5"] .swipe-compare-btn').click();
        assert.match(await page.locator('.swipe-compare-overlay').innerText(), /번역 첫째 5/);
        await page.getByRole('button', { name: '원문', exact: true }).click();
        assert.match(await page.locator('.swipe-compare-overlay').innerText(), /first 5/);
        await page.getByRole('button', { name: '☆ 즐겨찾기', exact: true }).nth(1).click();
        await page.getByPlaceholder('라벨 (예: 해피엔딩)').nth(1).fill('keep this');
        await page.getByPlaceholder('라벨 (예: 해피엔딩)').nth(1).dispatchEvent('change');
        await page.getByRole('button', { name: '이 버전 사용', exact: true }).click();
        assert.deepEqual(await page.evaluate(() => ({ swipe: messages[5].swipe_id, mes: messages[5].mes,
            favorite: messages[5].extra.swipeCompare.favorites[1], next: messages[6].mes })),
            { swipe: 1, mes: 'second 5', favorite: { favorite: true, label: 'keep this' }, next: 'first 6' });
        await page.locator('#swipe-compare-gallery-btn').click();
        assert.match(await page.locator('.swipe-compare-overlay').innerText(), /keep this/);
        await page.locator('.swipe-compare-overlay .fa-xmark').click();

        // Renumbered existing DOM buttons must read the current ID on click.
        await page.evaluate(() => {
            document.querySelector('.mes[mesid="5"]').remove();
            document.querySelector('.mes[mesid="6"]').setAttribute('mesid', '5');
        });
        await page.waitForTimeout(130);
        await page.locator('.mes[mesid="5"] .swipe-compare-btn').click();
        assert.match(await page.locator('.swipe-compare-overlay').innerText(), /keep this/);
        await page.locator('.swipe-compare-overlay .fa-xmark').click();

        await page.evaluate(() => {
            document.querySelector('#chat').outerHTML = '<div id="chat"><div class="mes" mesid="0"><div class="mes_buttons"></div></div></div>';
            emit('CHAT_CHANGED');
        });
        await page.waitForTimeout(130);
        assert.equal(await page.locator('#chat .swipe-compare-btn').count(), 1);
        await page.evaluate(() => { messages[0].swipes = ['only']; emit('MESSAGE_SWIPED', 0); });
        await page.waitForTimeout(130);
        assert.equal(await page.locator('#chat .swipe-compare-btn').count(), 0);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});
