const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function fixture() {
    let next = 0;
    const timers = new Map(), handlers = {}, listeners = {}, reads = [], scans = [];
    const messages = Array.from({ length: 100 }, () => ({ swipes: ['one', 'two'] }));
    const chat = new Proxy(messages, { get(target, key) {
        if (/^\d+$/.test(String(key))) reads.push(Number(key));
        return Reflect.get(target, key);
    } });
    const nodes = messages.map((_, id) => ({
        id, isConnected: true, nodeType: 1, button: null,
        getAttribute() { return String(this.id); },
        matches(selector) { return selector === '.mes'; },
        closest() { return this; },
        querySelector(selector) {
            if (selector === '.swipe-compare-btn') return this.button;
            return { appendChild: button => { this.button = button; button.remove = () => { this.button = null; }; } };
        },
    }));
    const root = { querySelectorAll(selector) {
        scans.push(selector);
        const id = selector.match(/mesid="(\d+)"/);
        return nodes.filter(n => n.isConnected && (!id || n.id === Number(id[1])));
    } };
    const doc = { hidden: false, readyState: 'loading', body: root,
        getElementById: id => id === 'chat' ? root : null,
        addEventListener: (name, fn) => { listeners[name] = fn; },
        createElement: () => ({ addEventListener(name, fn) { this[name] = fn; } }),
        querySelectorAll: selector => root.querySelectorAll(selector),
    };
    const observers = [];
    class Observer {
        constructor(fn) { this.fn = fn; observers.push(this); }
        observe(root, options) { this.root = root; this.options = options; }
        disconnect() {}
    }
    const context = vm.createContext({ document: doc, console, MutationObserver: Observer,
        SillyTavern: { getContext: () => ({ chat,
            event_types: Object.fromEntries(['MESSAGE_SWIPED', 'MESSAGE_RECEIVED', 'CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED', 'CHAT_CHANGED'].map(x => [x, x])),
            eventSource: { on: (name, fn) => { handlers[name] = fn; } },
        }) },
        setTimeout: fn => { const id = ++next; timers.set(id, fn); return id; },
        clearTimeout: id => timers.delete(id),
    });
    let source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
    source = source.replace(/\}\)\(\);\s*$/, `globalThis.api = {init, refreshAllButtons, queueMessageId, onChatMutations};
        startMenuButtonWatcher = () => {}; globalThis.opened = [];
        openCompareModal = id => opened.push(id); })();`);
    vm.runInContext(source, context);
    context.api.init();
    const flush = () => {
        const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn());
    };
    flush(); reads.length = 0; scans.length = 0;
    return { context, timers, handlers, listeners, reads, scans, messages, nodes, root, doc, observers, flush };
}

test('idle work stops; bursts and duplicate host events check one message once', () => {
    const f = fixture();
    assert.equal(f.nodes.filter(n => n.button).length, 100);
    assert.equal(f.timers.size, 0);
    const mutation = { type: 'childList', target: f.nodes[42], addedNodes: [{ nodeType: 3 }], removedNodes: [] };
    for (let i = 0; i < 50; i++) f.context.api.onChatMutations([mutation]);
    f.handlers.MESSAGE_SWIPED(42); f.handlers.CHARACTER_MESSAGE_RENDERED(42);
    assert.equal(f.timers.size, 1);
    f.flush();
    assert.deepEqual(f.reads, [42]);
    assert(!f.scans.includes('.mes'), 'mutation updates must not query all messages');
    assert.equal(f.timers.size, 0);
});

test('single/multiple swipe changes add/remove buttons without observing our own writes', () => {
    const f = fixture();
    f.messages[0].swipes = ['one']; f.handlers.MESSAGE_SWIPED(0); f.flush();
    assert.equal(f.nodes[0].button, null);
    f.context.api.onChatMutations([{ type: 'childList', target: f.nodes[0], addedNodes: [],
        removedNodes: [{ nodeType: 1, matches: selector => selector === '.swipe-compare-btn' }] }]);
    assert.equal(f.timers.size, 0);
    f.messages[0].swipes.push('two'); f.handlers.MESSAGE_RECEIVED(0); f.flush();
    assert(f.nodes[0].button);
    assert.deepEqual(f.reads, [0, 0]);
});

test('backgrounding cancels pending work, avoids scans and reconciles on return', () => {
    const f = fixture();
    f.handlers.MESSAGE_SWIPED(5);
    f.doc.hidden = true; f.listeners.visibilitychange(); f.scans.length = 0;
    f.messages[5].swipes = ['one']; f.handlers.MESSAGE_SWIPED(5);
    f.context.api.onChatMutations([{ type: 'childList', target: f.nodes[5], addedNodes: [], removedNodes: [] }]);
    assert.equal(f.timers.size, 0); assert.equal(f.reads.length, 0); assert.equal(f.scans.length, 0);
    f.doc.hidden = false; f.listeners.visibilitychange(); f.flush();
    assert.equal(f.nodes[5].button, null); assert.equal(f.reads.length, 100);
    assert.equal(f.timers.size, 0);
});

test('insertions, removed nodes, renumbering and unknown event IDs remain supported', () => {
    const f = fixture();
    const button = f.nodes[8].button;
    f.nodes[8].id = 3;
    f.context.api.onChatMutations([{ type: 'attributes', target: f.nodes[8], addedNodes: [], removedNodes: [] }]);
    f.flush(); button.click();
    assert.deepEqual([...f.context.opened], ['3']);
    f.reads.length = 0;
    f.nodes[9].button = null;
    f.context.api.onChatMutations([{ type: 'childList', target: { nodeType: 1, closest: () => null }, addedNodes: [f.nodes[9]], removedNodes: [] }]);
    f.nodes[9].isConnected = false; f.flush();
    assert.equal(f.reads.length, 0);
    f.nodes[9].isConnected = true; f.handlers.MESSAGE_SWIPED(); f.flush();
    assert(f.nodes[9].button);
    f.reads.length = 0; f.handlers.CHAT_CHANGED(); f.flush();
    assert.equal(f.reads.length, 100);
    assert.equal(f.observers[0].options.attributeFilter[0], 'mesid');
});
