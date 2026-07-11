/**
 * Swipe Compare & Bookmark
 * ------------------------
 * 1) 스와이프 비교: 메시지에 재생성된 응답이 2개 이상 있을 때, 모두 나란히
 *    비교하고 즐겨찾기(⭐)/라벨을 붙이고 원하는 버전으로 전환.
 * 2) 즐겨찾기 갤러리: 상단 "마법봉"(확장 메뉴) 아이콘에 메뉴 항목을 추가해서,
 *    지금 열려있는 채팅 안에서 즐겨찾기해둔 스와이프들을 화자(캐릭터)별로
 *    모아 한번에 볼 수 있음.
 *
 * v0.3 변경사항:
 * - 비교 모달 크기 확대 (더 넓고, 텍스트 영역도 더 크게)
 * - "즐겨찾기 갤러리" 추가: 마법봉 아이콘 → 확장 메뉴 목록에 항목 생성
 *
 * 알려진 범위 제한 (중요):
 * - 갤러리는 "현재 열려 있는 채팅" 안의 즐겨찾기만 모읍니다.
 *   같은 캐릭터의 다른(과거) 채팅 파일까지 자동으로 훑어오는 기능은
 *   아직 없습니다 (SillyTavern 서버 API로 다른 채팅 파일을 불러와야 해서
 *   구현이 더 복잡하고, 실제 환경에서 검증이 필요합니다).
 *   필요하면 다음 버전에서 추가할 수 있어요.
 *
 * 구현 방식 메모:
 * - 스와이프 목록/현재 선택된 스와이프: chat[i].swipes / chat[i].swipe_id
 * - 즐겨찾기/라벨 저장 위치: chat[i].extra.swipeCompare.favorites[스와이프번호]
 * - 번역 텍스트 조회 위치(확장마다 다를 수 있어 getTranslatedText()에서 조정):
 *     - chat[i].swipe_info[스와이프번호].extra.display_text
 *     - chat[i].extra.display_text (현재 활성 스와이프에 한함)
 * - 스와이프 전환은 화면의 기존 좌/우 화살표 버튼을 자동 클릭해서 처리
 *   (SillyTavern 자체 로직을 그대로 활용하는 가장 안전한 방법)
 *
 * 주의: SillyTavern 버전에 따라 DOM 클래스 이름이 조금씩 다를 수 있습니다.
 * 아래 SELECTORS 객체만 확인해서 필요하면 값을 바꿔주세요.
 */

(function () {
    const MODULE_KEY = 'swipeCompare';

    const SELECTORS = {
        mes: '.mes',
        mesIdAttr: 'mesid',
        buttonsHolder: '.mes_buttons, .extraMesButtons, .mes_button_holder',
        swipeRightBtn: '.swipe_right, .swipeRightBlock .swipe_right',
        swipeLeftBtn: '.swipe_left, .swipeLeftBlock .swipe_left',
        extensionsMenu: '#extensionsMenu',
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

    function getTranslatedText(message, idx) {
        try {
            const info = message.swipe_info && message.swipe_info[idx];
            const t1 = info && info.extra && info.extra.display_text;
            if (typeof t1 === 'string' && t1.trim().length > 0) return t1;
        } catch (e) { /* 무시 */ }

        const currentIndex = message.swipe_id ?? 0;
        if (idx === currentIndex) {
            try {
                const t2 = message.extra && message.extra.display_text;
                if (typeof t2 === 'string' && t2.trim().length > 0) return t2;
            } catch (e) { /* 무시 */ }
        }
        return null;
    }

    // ---------------------------------------------------------------------
    // 공통 스타일
    // ---------------------------------------------------------------------
    const OVERLAY_STYLE = `
        position: fixed !important;
        top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important;
        width: 100vw !important; height: 100vh !important; height: 100dvh !important;
        margin: 0 !important;
        padding: max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom)) !important;
        background: rgba(0, 0, 0, 0.65) !important;
        z-index: 2147483647 !important;
        display: flex !important; align-items: center !important; justify-content: center !important;
        box-sizing: border-box !important;
        inset: 0 !important;
    `;

    const MODAL_STYLE = `
        position: relative !important;
        width: min(1000px, 96vw) !important;
        max-width: 96vw !important;
        max-height: 92vh !important;
        max-height: 92dvh !important;
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

    const HEADER_STYLE = `
        display:flex !important; justify-content:space-between !important;
        align-items:center !important; gap:10px !important;
        padding:12px 16px !important; border-bottom:1px solid var(--SmartThemeBorderColor,#444) !important;
        flex-shrink:0 !important;
    `;

    const BODY_STYLE = 'overflow-y:auto !important; padding:10px 16px 16px !important; flex:1 1 auto !important;';

    const SMALL_BTN_STYLE = 'border:1px solid var(--SmartThemeBorderColor,#444) !important; background:transparent !important; color:inherit !important; border-radius:6px !important; padding:4px 10px !important; font-size:0.8em !important; cursor:pointer !important;';

    // 모달 뼈대를 만들어주는 공통 함수 (비교 모달/갤러리 둘 다 사용)
    function createModalShell(titleText) {
        document.querySelectorAll('.swipe-compare-overlay').forEach((el) => el.remove());

        const overlay = document.createElement('div');
        overlay.className = 'swipe-compare-overlay';
        overlay.style.cssText = OVERLAY_STYLE;

        const modal = document.createElement('div');
        modal.style.cssText = MODAL_STYLE;

        const header = document.createElement('div');
        header.style.cssText = HEADER_STYLE;

        const titleWrap = document.createElement('div');
        titleWrap.style.cssText = 'display:flex !important; align-items:center !important; gap:10px !important; flex-wrap:wrap !important;';
        const title = document.createElement('h3');
        title.style.cssText = 'margin:0 !important; font-size:1.05em !important;';
        title.textContent = titleText;
        titleWrap.appendChild(title);

        const closeBtn = document.createElement('span');
        closeBtn.className = 'fa-solid fa-xmark';
        closeBtn.style.cssText = 'cursor:pointer !important; opacity:0.75 !important; font-size:1.25em !important; flex-shrink:0 !important;';

        function closeModal() {
            document.body.style.overflow = '';
            overlay.remove();
        }
        closeBtn.addEventListener('click', closeModal);

        header.appendChild(titleWrap);
        header.appendChild(closeBtn);

        const body = document.createElement('div');
        body.style.cssText = BODY_STYLE;

        modal.appendChild(header);
        modal.appendChild(body);
        overlay.appendChild(modal);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal();
        });

        document.body.style.overflow = 'hidden';
        document.body.appendChild(overlay);

        return { overlay, modal, header, titleWrap, body, closeModal };
    }

    // ---------------------------------------------------------------------
    // 메시지 하단 "비교" 버튼 주입
    // ---------------------------------------------------------------------
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

    function scrollToMessage(mesId) {
        const mesEl = document.querySelector(`${SELECTORS.mes}[${SELECTORS.mesIdAttr}="${mesId}"]`);
        if (!mesEl) return;
        mesEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        mesEl.style.transition = 'outline 0.3s ease';
        mesEl.style.outline = '2px solid rgba(255,215,0,0.85)';
        mesEl.style.outlineOffset = '2px';
        setTimeout(() => { mesEl.style.outline = ''; }, 1600);
    }

    // ---------------------------------------------------------------------
    // 비교 모달
    // ---------------------------------------------------------------------
    function openCompareModal(mesId) {
        const message = getMessageByMesId(mesId);
        if (!message || !Array.isArray(message.swipes)) return;

        const data = ensureExtra(message);
        const currentIndex = message.swipe_id ?? 0;
        const anyTranslation = message.swipes.some((_, idx) => getTranslatedText(message, idx) !== null);
        let viewMode = anyTranslation ? 'translated' : 'original';

        const shell = createModalShell(`스와이프 비교 (${message.swipes.length}개)`);

        if (anyTranslation) {
            const toggleWrap = document.createElement('div');
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
            shell.titleWrap.appendChild(toggleWrap);
        }

        function renderList() {
            shell.body.innerHTML = '';
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
                favBtn.style.cssText = SMALL_BTN_STYLE;
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
                useBtn.style.cssText = SMALL_BTN_STYLE;
                useBtn.addEventListener('click', async () => {
                    useBtn.textContent = '전환 중...';
                    await switchToSwipe(mesId, idx);
                    shell.closeModal();
                });

                actions.appendChild(favBtn);
                actions.appendChild(useBtn);
                top.appendChild(label);
                top.appendChild(actions);

                const textEl = document.createElement('div');
                textEl.style.cssText = 'font-size:1em !important; line-height:1.5 !important; max-height:16em !important; overflow-y:auto !important; white-space:pre-wrap !important; opacity:0.95 !important;';
                textEl.textContent = isShowingTranslationButMissing ? `(이 스와이프는 번역본이 없습니다)\n\n${rawText}` : showText;

                item.appendChild(top);
                item.appendChild(textEl);
                shell.body.appendChild(item);
            });
        }

        renderList();
    }

    // ---------------------------------------------------------------------
    // 즐겨찾기 갤러리 (현재 열려 있는 채팅 안의 즐겨찾기를 화자별로 모아 보기)
    // ---------------------------------------------------------------------
    function collectFavorites() {
        const ctx = getCtx();
        if (!ctx || !ctx.chat) return [];
        const results = [];

        ctx.chat.forEach((message, mesId) => {
            const favData = message.extra && message.extra[MODULE_KEY] && message.extra[MODULE_KEY].favorites;
            if (!favData) return;

            Object.keys(favData).forEach((idxStr) => {
                const fav = favData[idxStr];
                if (!fav || !fav.favorite) return;
                const idx = Number(idxStr);
                const rawText = Array.isArray(message.swipes) ? message.swipes[idx] : message.mes;
                if (rawText === undefined) return;

                const speaker = message.name
                    || (message.is_user ? (ctx.name1 || '나') : (ctx.name2 || '캐릭터'));

                results.push({
                    mesId,
                    swipeIdx: idx,
                    speaker,
                    label: fav.label || '',
                    text: rawText,
                    isActive: idx === (message.swipe_id ?? 0),
                });
            });
        });

        return results;
    }

    function openFavoritesGallery() {
        const items = collectFavorites();
        const shell = createModalShell(`즐겨찾기 갤러리 (${items.length}개)`);

        if (items.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = 'opacity:0.7 !important; padding:24px 4px !important; text-align:center !important; line-height:1.6 !important;';
            empty.textContent = '아직 즐겨찾기한 스와이프가 없어요. 메시지의 "비교" 버튼에서 ☆ 즐겨찾기를 눌러보세요.\n(이 갤러리는 지금 열려 있는 채팅 안의 즐겨찾기만 모읍니다.)';
            shell.body.appendChild(empty);
            return;
        }

        const groups = {};
        items.forEach((it) => {
            if (!groups[it.speaker]) groups[it.speaker] = [];
            groups[it.speaker].push(it);
        });

        Object.keys(groups).forEach((speaker) => {
            const groupTitle = document.createElement('div');
            groupTitle.style.cssText = 'font-weight:600 !important; margin:14px 0 8px !important; opacity:0.85 !important; font-size:0.95em !important;';
            groupTitle.textContent = `${speaker} (${groups[speaker].length})`;
            shell.body.appendChild(groupTitle);

            groups[speaker].forEach((it) => {
                const card = document.createElement('div');
                card.style.cssText = 'border:1px solid rgba(255,215,0,0.4) !important; background:rgba(255,215,0,0.06) !important; border-radius:8px !important; padding:10px 12px !important; margin-bottom:10px !important;';

                const top = document.createElement('div');
                top.style.cssText = 'display:flex !important; justify-content:space-between !important; align-items:center !important; gap:8px !important; margin-bottom:6px !important; flex-wrap:wrap !important;';

                const meta = document.createElement('div');
                meta.style.cssText = 'font-size:0.85em !important; opacity:0.8 !important;';
                const metaParts = [`#${it.mesId} · 스와이프 ${it.swipeIdx + 1}`];
                if (it.isActive) metaParts.push('현재 사용 중');
                if (it.label) metaParts.push(it.label);
                meta.textContent = metaParts.join(' · ');

                const actions = document.createElement('div');
                actions.style.cssText = 'display:flex !important; gap:6px !important; flex-shrink:0 !important;';

                const gotoBtn = document.createElement('button');
                gotoBtn.textContent = '메시지로 이동';
                gotoBtn.style.cssText = SMALL_BTN_STYLE;
                gotoBtn.addEventListener('click', () => {
                    shell.closeModal();
                    scrollToMessage(it.mesId);
                });

                const compareBtn = document.createElement('button');
                compareBtn.textContent = '비교창 열기';
                compareBtn.style.cssText = SMALL_BTN_STYLE;
                compareBtn.addEventListener('click', () => {
                    shell.closeModal();
                    openCompareModal(it.mesId);
                });

                actions.appendChild(gotoBtn);
                actions.appendChild(compareBtn);
                top.appendChild(meta);
                top.appendChild(actions);

                const textEl = document.createElement('div');
                textEl.style.cssText = 'font-size:0.92em !important; line-height:1.45 !important; max-height:8em !important; overflow-y:auto !important; white-space:pre-wrap !important; opacity:0.92 !important;';
                textEl.textContent = it.text;

                card.appendChild(top);
                card.appendChild(textEl);
                shell.body.appendChild(card);
            });
        });
    }

    // ---------------------------------------------------------------------
    // 마법봉(확장 메뉴)에 "즐겨찾기 갤러리" 항목 추가
    // ---------------------------------------------------------------------
    function injectExtensionMenuButton() {
        if (document.getElementById('swipe-compare-gallery-btn')) return true;
        const menu = document.querySelector(SELECTORS.extensionsMenu);
        if (!menu) return false;

        const item = document.createElement('div');
        item.id = 'swipe-compare-gallery-btn';
        item.className = 'list-group-item flex-container flexGap5 interactable';
        item.tabIndex = 0;
        item.innerHTML = `<div class="fa-solid fa-star extensionsMenuExtensionButton"></div><span>즐겨찾기 갤러리</span>`;
        item.addEventListener('click', () => {
            openFavoritesGallery();
        });

        menu.appendChild(item);
        return true;
    }

    function startMenuButtonWatcher() {
        if (injectExtensionMenuButton()) return;
        let tries = 0;
        const timer = setInterval(() => {
            tries += 1;
            if (injectExtensionMenuButton() || tries > 40) {
                clearInterval(timer);
                if (tries > 40) {
                    console.warn('[swipe-compare] #extensionsMenu 요소를 찾지 못해 메뉴 버튼을 추가하지 못했습니다. SELECTORS.extensionsMenu 값을 확인해주세요.');
                }
            }
        }, 500);
    }

    // ---------------------------------------------------------------------
    // 초기화
    // ---------------------------------------------------------------------
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
        startMenuButtonWatcher();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
