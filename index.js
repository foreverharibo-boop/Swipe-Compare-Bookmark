/**
 * Swipe Compare & Bookmark
 * ------------------------
 * 메시지에 스와이프(재생성된 응답)가 2개 이상 있을 때, 버튼 하나로
 * 모든 스와이프를 나란히 비교하고 즐겨찾기(라벨)를 붙이고,
 * 원하는 버전으로 바로 전환할 수 있게 해주는 확장입니다.
 *
 * 구현 방식 메모 (나중에 코드를 고칠 때 참고하세요):
 * - 스와이프 목록/현재 선택된 스와이프는 SillyTavern이 자체적으로
 *   chat[messageIndex].swipes / chat[messageIndex].swipe_id 에 저장합니다.
 * - "즐겨찾기/라벨" 데이터는 우리가 새로 추가하는 것이므로
 *   chat[messageIndex].extra.swipeCompare 안에 저장합니다.
 *   extra 필드는 채팅 저장 시 함께 저장되는 표준 확장 공간입니다.
 * - 실제로 다른 스와이프로 "전환"할 때는, 내부 로직을 다시 구현하지 않고
 *   화면에 이미 있는 기본 스와이프 좌/우 버튼을 프로그램적으로 클릭해서
 *   SillyTavern 자체 로직이 처리하도록 맡깁니다. (가장 안전한 방법)
 *
 * 주의: SillyTavern 버전에 따라 DOM 클래스 이름이 조금씩 달라질 수 있습니다.
 * 아래 SELECTORS 객체만 확인해서 필요하면 값을 바꿔주세요.
 */

(function () {
    const MODULE_KEY = 'swipeCompare';

    // ---- 버전마다 달라질 수 있는 선택자들을 한곳에 모아둠 ----
    const SELECTORS = {
        mes: '.mes',                      // 메시지 하나를 감싸는 요소
        mesIdAttr: 'mesid',               // 메시지 인덱스를 담고 있는 data 속성 이름
        buttonsHolder: '.mes_buttons, .extraMesButtons, .mes_button_holder',
        swipeRightBtn: '.swipe_right, .swipeRightBlock .swipe_right',
        swipeLeftBtn: '.swipe_left, .swipeLeftBlock .swipe_left',
    };

    function getCtx() {
        if (typeof SillyTavern === 'undefined' || !SillyTavern.getContext) {
            console.error('[swipe-compare] SillyTavern.getContext()를 찾을 수 없습니다.');
            return null;
        }
        return SillyTavern.getContext();
    }

    function saveChatSafely() {
        const ctx = getCtx();
        if (!ctx) return;
        try {
            if (typeof ctx.saveChatDebounced === 'function') {
                ctx.saveChatDebounced();
            } else if (typeof ctx.saveChat === 'function') {
                ctx.saveChat();
            }
        } catch (e) {
            console.warn('[swipe-compare] 채팅 저장 중 오류(무시하고 계속 진행):', e);
        }
    }

    function getMessageByMesId(mesId) {
        const ctx = getCtx();
        if (!ctx || !ctx.chat) return null;
        const idx = Number(mesId);
        return ctx.chat[idx] || null;
    }

    function ensureExtra(message) {
        if (!message.extra) message.extra = {};
        if (!message.extra[MODULE_KEY]) {
            message.extra[MODULE_KEY] = { favorites: {} };
        }
        if (!message.extra[MODULE_KEY].favorites) {
            message.extra[MODULE_KEY].favorites = {};
        }
        return message.extra[MODULE_KEY];
    }

    // ---- 메시지 DOM에 "비교" 버튼 주입 ----
    function injectButtonsForAllMessages() {
        const mesElements = document.querySelectorAll(SELECTORS.mes);
        mesElements.forEach((mesEl) => {
            const mesId = mesEl.getAttribute(SELECTORS.mesIdAttr);
            if (mesId === null) return;

            const message = getMessageByMesId(mesId);
            if (!message) return;

            const hasMultipleSwipes = Array.isArray(message.swipes) && message.swipes.length > 1;
            let btn = mesEl.querySelector('.swipe-compare-btn');

            if (!hasMultipleSwipes) {
                if (btn) btn.remove();
                return;
            }

            if (btn) return; // 이미 버튼이 있으면 다시 추가하지 않음

            const holder = mesEl.querySelector(SELECTORS.buttonsHolder);
            if (!holder) return;

            btn = document.createElement('div');
            btn.className = 'mes_button swipe-compare-btn fa-solid fa-code-compare';
            btn.title = '스와이프 비교 / 즐겨찾기';
            btn.addEventListener('click', () => openCompareModal(mesId));
            holder.appendChild(btn);
        });
    }

    // ---- 특정 스와이프로 전환 (기존 좌/우 버튼을 클릭해서 전환) ----
    async function switchToSwipe(mesId, targetIndex) {
        const message = getMessageByMesId(mesId);
        if (!message) return;

        const mesEl = document.querySelector(`${SELECTORS.mes}[${SELECTORS.mesIdAttr}="${mesId}"]`);
        if (!mesEl) return;

        let current = message.swipe_id ?? 0;
        const clickAndWait = async (selector) => {
            const btnEl = mesEl.querySelector(selector);
            if (!btnEl) {
                console.warn('[swipe-compare] 스와이프 이동 버튼을 찾지 못했습니다:', selector);
                return false;
            }
            btnEl.click();
            await new Promise((r) => setTimeout(r, 60));
            return true;
        };

        if (targetIndex > current) {
            for (let i = current; i < targetIndex; i++) {
                const ok = await clickAndWait(SELECTORS.swipeRightBtn);
                if (!ok) break;
            }
        } else if (targetIndex < current) {
            for (let i = current; i > targetIndex; i--) {
                const ok = await clickAndWait(SELECTORS.swipeLeftBtn);
                if (!ok) break;
            }
        }
    }

    // ---- 비교 모달 ----
    function openCompareModal(mesId) {
        const message = getMessageByMesId(mesId);
        if (!message || !Array.isArray(message.swipes)) return;

        const data = ensureExtra(message);
        const currentIndex = message.swipe_id ?? 0;

        // 기존 모달 있으면 제거
        document.querySelectorAll('.swipe-compare-overlay').forEach((el) => el.remove());

        const overlay = document.createElement('div');
        overlay.className = 'swipe-compare-overlay';

        const modal = document.createElement('div');
        modal.className = 'swipe-compare-modal';

        const header = document.createElement('div');
        header.className = 'swipe-compare-header';
        header.innerHTML = `<h3>스와이프 비교 (${message.swipes.length}개)</h3>`;
        const closeBtn = document.createElement('span');
        closeBtn.className = 'swipe-compare-close fa-solid fa-xmark';
        closeBtn.addEventListener('click', () => overlay.remove());
        header.appendChild(closeBtn);

        const list = document.createElement('div');
        list.className = 'swipe-compare-list';

        message.swipes.forEach((text, idx) => {
            const fav = data.favorites[idx];
            const item = document.createElement('div');
            item.className = 'swipe-compare-item';
            if (idx === currentIndex) item.classList.add('is-active');
            if (fav && fav.favorite) item.classList.add('is-favorite');

            const top = document.createElement('div');
            top.className = 'swipe-compare-item-top';

            const label = document.createElement('div');
            label.className = 'swipe-compare-item-label';
            const badge = idx === currentIndex ? '현재 사용 중 · ' : '';
            label.innerHTML = `<span>#${idx + 1} ${badge}</span>`;

            const labelInput = document.createElement('input');
            labelInput.type = 'text';
            labelInput.className = 'swipe-compare-label-input';
            labelInput.placeholder = '라벨 (예: 해피엔딩)';
            labelInput.value = (fav && fav.label) || '';
            labelInput.addEventListener('change', () => {
                const f = data.favorites[idx] || {};
                f.label = labelInput.value.trim();
                data.favorites[idx] = f;
                saveChatSafely();
            });
            label.appendChild(labelInput);

            const actions = document.createElement('div');
            actions.className = 'swipe-compare-item-actions';

            const favBtn = document.createElement('button');
            favBtn.textContent = fav && fav.favorite ? '★ 즐겨찾기' : '☆ 즐겨찾기';
            if (fav && fav.favorite) favBtn.classList.add('is-on');
            favBtn.addEventListener('click', () => {
                const f = data.favorites[idx] || {};
                f.favorite = !f.favorite;
                data.favorites[idx] = f;
                saveChatSafely();
                item.classList.toggle('is-favorite', f.favorite);
                favBtn.classList.toggle('is-on', f.favorite);
                favBtn.textContent = f.favorite ? '★ 즐겨찾기' : '☆ 즐겨찾기';
            });

            const useBtn = document.createElement('button');
            useBtn.textContent = idx === currentIndex ? '사용 중' : '이 버전 사용';
            useBtn.disabled = idx === currentIndex;
            useBtn.addEventListener('click', async () => {
                useBtn.textContent = '전환 중...';
                await switchToSwipe(mesId, idx);
                overlay.remove();
            });

            actions.appendChild(favBtn);
            actions.appendChild(useBtn);

            top.appendChild(label);
            top.appendChild(actions);

            const textEl = document.createElement('div');
            textEl.className = 'swipe-compare-item-text';
            textEl.textContent = text;

            item.appendChild(top);
            item.appendChild(textEl);
            list.appendChild(item);
        });

        modal.appendChild(header);
        modal.appendChild(list);
        overlay.appendChild(modal);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        document.body.appendChild(overlay);
    }

    // ---- 초기화: DOM 변화를 감시해서 새 메시지가 그려질 때마다 버튼을 붙여줌 ----
    function init() {
        const chatContainer = document.getElementById('chat') || document.body;

        const observer = new MutationObserver(() => {
            injectButtonsForAllMessages();
        });
        observer.observe(chatContainer, { childList: true, subtree: true });

        // 이벤트 시스템이 있다면 보조적으로도 갱신 시도 (버전별로 이름이 다를 수 있어 전부 try/catch)
        try {
            const ctx = getCtx();
            if (ctx && ctx.eventSource && ctx.event_types) {
                const events = [
                    ctx.event_types.MESSAGE_SWIPED,
                    ctx.event_types.MESSAGE_RECEIVED,
                    ctx.event_types.CHARACTER_MESSAGE_RENDERED,
                    ctx.event_types.USER_MESSAGE_RENDERED,
                    ctx.event_types.CHAT_CHANGED,
                ].filter(Boolean);

                events.forEach((evt) => {
                    ctx.eventSource.on(evt, () => setTimeout(injectButtonsForAllMessages, 50));
                });
            }
        } catch (e) {
            console.warn('[swipe-compare] 이벤트 훅 등록 중 일부 실패(무시 가능):', e);
        }

        // 최초 1회 실행
        setTimeout(injectButtonsForAllMessages, 500);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
