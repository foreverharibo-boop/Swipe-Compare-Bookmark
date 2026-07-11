/**
 * Swipe Compare & Bookmark
 * ------------------------
 * 메시지에 스와이프(재생성된 응답)가 2개 이상 있을 때, 버튼 하나로
 * 모든 스와이프를 나란히 비교하고 즐겨찾기(라벨)를 붙이고,
 * 원하는 버전으로 바로 전환할 수 있게 해주는 확장입니다.
 *
 * v0.2 변경사항:
 * - 모달을 CSS 파일이 아니라 인라인 스타일(!important)로 강제 배치해서
 *   실리태번 자체 CSS나 모바일 브라우저 뷰포트 문제로 위치가 틀어지는 걸 방지.
 * - 각 스와이프에 번역 확장이 저장해둔 번역 텍스트가 있으면
 *   "원문 / 번역" 토글로 볼 수 있게 지원.
 *
 * 구현 방식 메모 (나중에 코드를 고칠 때 참고하세요):
 * - 스와이프 목록/현재 선택된 스와이프는 SillyTavern이 자체적으로
 *   chat[messageIndex].swipes / chat[messageIndex].swipe_id 에 저장합니다.
 * - "즐겨찾기/라벨" 데이터는 우리가 새로 추가하는 것이므로
 *   chat[messageIndex].extra.swipeCompare 안에 저장합니다.
 * - 번역 텍스트는 번역 확장이 보통 다음 위치 중 하나에 저장합니다
 *   (확장/버전마다 다를 수 있어 둘 다 확인합니다):
 *     - chat[i].swipe_info[해당 스와이프 인덱스].extra.display_text
 *     - chat[i].extra.display_text (현재 활성 스와이프에 한해)
 *   만약 사용 중인 번역 확장이 다른 위치에 저장한다면 아래 getTranslatedText()
 *   함수만 고치면 됩니다.
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
        mes: '.mes',
        mesIdAttr: 'mesid',
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

    // ---- 번역 텍스트 찾기 (번역 확장이 저장해둔 위치를 확인) ----
    function getTranslatedText(message, idx) {
        try {
            const info = message.swipe_info && message.swipe_info[idx];
            const t1 = info && info.extra && info.extra.display_text;
            if (typeof t1 === 'string' && t1.trim().length > 0) return t1;
        } catch (e) { /* 무시 */ }

        // 현재 활성 스와이프라면 message.extra.display_text 도 확인
        const currentIndex = message.swipe_id ?? 0;
        if (idx === currentIndex) {
            try {
                const t2 = message.extra && message.extra.display_text;
                if (typeof t2 === 'string' && t2.trim().length > 0) return t2;
            } catch (e) { /* 무시 */ }
        }
        return null;
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

            if (btn) return;

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

    // ---- 모달에 강제로 적용할 인라인 스타일 (CSS 파일이 씹혀도 항상 화면 중앙에 뜨게) ----
    const OVERLAY_STYLE = `
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        height: 100dvh !important;
        margin: 0 !important;
        padding: max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom)) !important;
        background: rgba(0, 0, 0, 0.65) !important;
        z-index: 2147483647 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        box-sizing: border-box !important;
        inset: 0 !important;
    `;

    const MODAL_STYLE = `
        position: relative !important;
        width: min(700px, 92vw) !important;
        max-width: 92vw !important;
        max-height: 85vh !important;
        max-height: 85dvh !important;
        margin: 0 auto !important;
        display: flex !important;
        flex-direction: column !important;
        background: var(--SmartThemeBlurTintColor, #1e1e1e) !important;
        color: var(--SmartThemeBodyColor, #eee) !important;
        border: 1px solid var(--SmartThemeBorderColor, #444) !important;
        border-radius: 10px !important;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5) !important;
        overflow: hidden !important;
    `;

    // ---- 비교 모달 ----
    function openCompareModal(mesId) {
        const message = getMessageByMesId(mesId);
        if (!message || !Array.isArray(message.swipes)) return;

        const data = ensureExtra(message);
        const currentIndex = message.swipe_id ?? 0;

        document.querySelectorAll('.swipe-compare-overlay').forEach((el) => el.remove());

        // 스와이프 중 하나라도 번역 텍스트가 있으면 기본값을 "번역"으로, 없으면 "원문"으로 시작
        const anyTranslation = message.swipes.some((_, idx) => getTranslatedText(message, idx) !== null);
        let viewMode = anyTranslation ? 'translated' : 'original';

        const overlay = document.createElement('div');
        overlay.className = 'swipe-compare-overlay';
        overlay.style.cssText = OVERLAY_STYLE;

        const modal = document.createElement('div');
        modal.className = 'swipe-compare-modal';
        modal.style.cssText = MODAL_STYLE;

        const header = document.createElement('div');
        header.className = 'swipe-compare-header';
        header.style.cssText = `
            display:flex !important; justify-content:space-between !important;
            align-items:center !important; gap:10px !important;
            padding:12px 16px !important; border-bottom:1px solid var(--SmartThemeBorderColor,#444) !important;
            flex-shrink:0 !important;
        `;

        const titleWrap = document.createElement('div');
        titleWrap.style.cssText = 'display:flex !important; align-items:center !important; gap:10px !important; flex-wrap:wrap !important;';
        const title = document.createElement('h3');
        title.style.cssText = 'margin:0 !important; font-size:1.05em !important;';
        title.textContent = `스와이프 비교 (${message.swipes.length}개)`;
        titleWrap.appendChild(title);

        // 원문/번역 토글 (번역이 하나라도 있을 때만 표시)
        let toggleWrap = null;
        if (anyTranslation) {
            toggleWrap = document.createElement('div');
            toggleWrap.style.cssText = 'display:flex !important; border:1px solid var(--SmartThemeBorderColor,#555) !important; border-radius:6px !important; overflow:hidden !important; font-size:0.8em !important;';
            const btnOriginal = document.createElement('button');
            const btnTranslated = document.createElement('button');
            [btnOriginal, btnTranslated].forEach((b) => {
                b.style.cssText = 'border:none !important; padding:4px 10px !important; cursor:pointer !important; background:transparent !important; color:inherit !important;';
            });
            btnOriginal.textContent = '원문';
            btnTranslated.textContent = '번역';

            const refreshToggleUI = () => {
                btnOriginal.style.background = viewMode === 'original' ? 'rgba(255,255,255,0.15)' : 'transparent';
                btnTranslated.style.background = viewMode === 'translated' ? 'rgba(255,255,255,0.15)' : 'transparent';
            };
            btnOriginal.addEventListener('click', () => { viewMode = 'original'; refreshToggleUI(); renderList(); });
            btnTranslated.addEventListener('click', () => { viewMode = 'translated'; refreshToggleUI(); renderList(); });
            refreshToggleUI();

            toggleWrap.appendChild(btnOriginal);
            toggleWrap.appendChild(btnTranslated);
            titleWrap.appendChild(toggleWrap);
        }

        const closeBtn = document.createElement('span');
        closeBtn.className = 'fa-solid fa-xmark';
        closeBtn.style.cssText = 'cursor:pointer !important; opacity:0.75 !important; font-size:1.25em !important; flex-shrink:0 !important;';
        closeBtn.addEventListener('click', () => closeModal());

        header.appendChild(titleWrap);
        header.appendChild(closeBtn);

        const list = document.createElement('div');
        list.className = 'swipe-compare-list';
        list.style.cssText = 'overflow-y:auto !important; padding:10px 16px 16px !important; flex:1 1 auto !important;';

        function closeModal() {
            document.body.style.overflow = '';
            overlay.remove();
        }

        function renderList() {
            list.innerHTML = '';
            message.swipes.forEach((rawText, idx) => {
                const fav = data.favorites[idx];
                const translated = getTranslatedText(message, idx);
                const showText = (viewMode === 'translated' && translated) ? translated : rawText;
                const isShowingTranslationButMissing = viewMode === 'translated' && !translated;

                const item = document.createElement('div');
                item.style.cssText = `
                    border:1px solid var(--SmartThemeBorderColor,#3a3a3a) !important;
                    border-radius:8px !important; padding:10px 12px !important; margin-bottom:10px !important;
                    ${idx === currentIndex ? 'border-color:var(--SmartThemeQuoteColor,#6ea8fe) !important;' : ''}
                    ${fav && fav.favorite ? 'background:rgba(255,215,0,0.08) !important; border-color:rgba(255,215,0,0.5) !important;' : ''}
                `;

                const top = document.createElement('div');
                top.style.cssText = 'display:flex !important; align-items:center !important; justify-content:space-between !important; gap:8px !important; margin-bottom:6px !important; flex-wrap:wrap !important;';

                const label = document.createElement('div');
                label.style.cssText = 'font-size:0.85em !important; opacity:0.8 !important; display:flex !important; align-items:center !important; gap:6px !important;';
                const badge = idx === currentIndex ? '현재 사용 중 · ' : '';
                const transBadge = translated ? (viewMode === 'translated' ? '(번역) ' : '(번역 있음) ') : '';
                label.innerHTML = `<span>#${idx + 1} ${badge}${transBadge}</span>`;

                const labelInput = document.createElement('input');
                labelInput.type = 'text';
                labelInput.placeholder = '라벨 (예: 해피엔딩)';
                labelInput.value = (fav && fav.label) || '';
                labelInput.style.cssText = 'background:transparent !important; border:none !important; border-bottom:1px dashed var(--SmartThemeBorderColor,#555) !important; color:inherit !important; font-size:0.85em !important; width:140px !important;';
                labelInput.addEventListener('change', () => {
                    const f = data.favorites[idx] || {};
                    f.label = labelInput.value.trim();
                    data.favorites[idx] = f;
                    saveChatSafely();
                });
                label.appendChild(labelInput);

                const actions = document.createElement('div');
                actions.style.cssText = 'display:flex !important; gap:6px !important; flex-shrink:0 !important;';

                const favBtn = document.createElement('button');
                const setFavBtnUI = () => {
                    const on = !!(data.favorites[idx] && data.favorites[idx].favorite);
                    favBtn.textContent = on ? '★ 즐겨찾기' : '☆ 즐겨찾기';
                    favBtn.style.background = on ? 'rgba(255,215,0,0.25)' : 'transparent';
                };
                favBtn.style.cssText = 'border:1px solid var(--SmartThemeBorderColor,#444) !important; color:inherit !important; border-radius:6px !important; padding:3px 8px !important; font-size:0.8em !important; cursor:pointer !important;';
                setFavBtnUI();
                favBtn.addEventListener('click', () => {
                    const f = data.favorites[idx] || {};
                    f.favorite = !f.favorite;
                    data.favorites[idx] = f;
                    saveChatSafely();
                    setFavBtnUI();
                    renderList();
                });

                const useBtn = document.createElement('button');
                useBtn.textContent = idx === currentIndex ? '사용 중' : '이 버전 사용';
                useBtn.disabled = idx === currentIndex;
                useBtn.style.cssText = 'border:1px solid var(--SmartThemeBorderColor,#444) !important; background:transparent !important; color:inherit !important; border-radius:6px !important; padding:3px 8px !important; font-size:0.8em !important; cursor:pointer !important;';
                useBtn.addEventListener('click', async () => {
                    useBtn.textContent = '전환 중...';
                    await switchToSwipe(mesId, idx);
                    closeModal();
                });

                actions.appendChild(favBtn);
                actions.appendChild(useBtn);
                top.appendChild(label);
                top.appendChild(actions);

                const textEl = document.createElement('div');
                textEl.style.cssText = 'font-size:0.92em !important; line-height:1.4 !important; max-height:6.5em !important; overflow-y:auto !important; white-space:pre-wrap !important; opacity:0.95 !important;';
                textEl.textContent = isShowingTranslationButMissing ? `(이 스와이프는 번역본이 없습니다)\n\n${rawText}` : showText;

                item.appendChild(top);
                item.appendChild(textEl);
                list.appendChild(item);
            });
        }

        renderList();

        modal.appendChild(header);
        modal.appendChild(list);
        overlay.appendChild(modal);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal();
        });

        document.body.style.overflow = 'hidden'; // 배경 스크롤 방지
        document.body.appendChild(overlay);
    }

    // ---- 초기화 ----
    function init() {
        const chatContainer = document.getElementById('chat') || document.body;

        const observer = new MutationObserver(() => {
            injectButtonsForAllMessages();
        });
        observer.observe(chatContainer, { childList: true, subtree: true });

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

        setTimeout(injectButtonsForAllMessages, 500);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
