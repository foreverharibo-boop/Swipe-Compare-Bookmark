/**
 * Swipe Compare & Bookmark
 * ------------------------
 * 1) 스와이프 비교: 메시지에 재생성된 응답이 2개 이상 있을 때, 모두 나란히
 *    비교하고 즐겨찾기(⭐)/라벨을 붙이고 원하는 버전으로 전환.
 * 2) 리롤 갤러리: 상단 "마법봉"(확장 메뉴) 아이콘에 메뉴 항목을 추가해서,
 *    지금 열려있는 채팅 안에서 즐겨찾기해둔 스와이프들을 화자(캐릭터)별로
 *    모아 한번에 볼 수 있음. 원문/번역 토글도 지원.
 *
 * v0.4 변경사항:
 * - "즐겨찾기 갤러리" → "리롤 갤러리"로 이름 변경 (메뉴 항목 + 모달 제목)
 * - 팝업 크기 대폭 확대
 * - 리롤 갤러리에도 원문/번역 토글 추가
 * - 스와이프 전환 방식을 "화면의 좌/우 화살표를 자동 클릭"에서
 *   "메시지 데이터를 직접 바꾸고 다시 그리기"로 변경.
 *   → 이미 지나간(마지막 메시지가 아닌) 메시지에서도 "이 버전 사용"이
 *     정상 동작합니다. 예: 리롤 → 다음 입력 → 새 응답이 진행된 뒤에도,
 *     그 전전 메시지로 가서 다른 스와이프를 선택하면 그 메시지만 바뀌고
 *     그 뒤의 대화는 그대로 유지됩니다.
 *
 * 알려진 범위 제한:
 * - 갤러리는 "현재 열려 있는 채팅" 안의 즐겨찾기만 모읍니다. 같은 캐릭터의
 *   다른(과거) 채팅 파일까지 자동으로 훑어오는 기능은 아직 없습니다.
 *
 * 구현 방식 메모:
 * - 스와이프 목록/현재 선택된 스와이프: chat[i].swipes / chat[i].swipe_id
 * - 즐겨찾기/라벨 저장 위치: chat[i].extra.swipeCompare.favorites[스와이프번호]
 * - 번역 텍스트 조회 위치(확장마다 다를 수 있어 getTranslatedText()에서 조정):
 *     - chat[i].swipe_info[스와이프번호].extra.display_text
 *     - chat[i].extra.display_text (현재 활성 스와이프에 한함)
 * - 스와이프 전환(forceSwitchSwipe): message.swipe_id / message.mes 를 직접
 *   바꾸고 SillyTavern이 제공하는 getContext().updateMessageBlock(mesId, message)
 *   로 해당 메시지만 다시 그립니다. (메시지가 몇 번째 위치에 있든 동작)
 *
 * 주의: SillyTavern 버전에 따라 DOM 클래스 이름이나 updateMessageBlock 유무가
 * 다를 수 있습니다. 아래 SELECTORS 객체와 forceSwitchSwipe()를 참고해주세요.
 */

(function () {
    const MODULE_KEY = 'swipeCompare';

    const SELECTORS = {
        mes: '.mes',
        mesIdAttr: 'mesid',
        buttonsHolder: '.mes_buttons, .extraMesButtons, .mes_button_holder',
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

    // 메시지가 채팅의 몇 번째 위치에 있든 동작하는 스와이프 전환 함수.
    // 기존 좌/우 화살표 클릭에 의존하지 않고 데이터 + 렌더링을 직접 처리합니다.
    function forceSwitchSwipe(mesId, idx) {
        const ctx = getCtx();
        const message = getMessageByMesId(mesId);
        if (!ctx || !message || !Array.isArray(message.swipes)) return false;
        if (idx < 0 || idx >= message.swipes.length) return false;

        message.swipe_id = idx;
        message.mes = message.swipes[idx];

        try {
            const info = message.swipe_info && message.swipe_info[idx];
            if (info) {
                if (info.send_date) message.send_date = info.send_date;
                if (info.gen_started) message.gen_started = info.gen_started;
                if (info.gen_finished) message.gen_finished = info.gen_finished;
                if (info.extra) message.extra = Object.assign({}, message.extra, info.extra);
            }
        } catch (e) { /* 무시 */ }

        try {
            if (typeof ctx.updateMessageBlock === 'function') {
                ctx.updateMessageBlock(Number(mesId), message);
            } else {
                console.warn('[swipe-compare] updateMessageBlock을 찾을 수 없어 화면이 자동으로 갱신되지 않을 수 있습니다. 채팅을 다시 열면 반영됩니다.');
            }
        } catch (e) {
            console.warn('[swipe-compare] updateMessageBlock 호출 중 오류:', e);
        }

        saveChatSafely();
        return true;
    }

    // ---------------------------------------------------------------------
    // 공통 스타일
    // ---------------------------------------------------------------------
    const OVERLAY_STYLE = `
        position: fixed !important;
        top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important;
        width: 100vw !important; height: 100vh !important; height: 100dvh !important;
        margin: 0 !important;
        padding: max(10px, env(safe-area-inset-top)) 10px max(10px, env(safe-area-inset-bottom)) !important;
        background: rgba(0, 0, 0, 0.7) !important;
        z-index: 2147483647 !important;
        display: flex !important; align-items: center !important; justify-content: center !important;
        box-sizing: border-box !important;
        inset: 0 !important;
    `;

    // 팝업을 훨씬 크게: 데스크톱에서는 거의 화면 전체, 모바일에서도 여백 최소화
    const MODAL_STYLE = `
        position: relative !important;
        width: min(1400px, 98vw) !important;
        max-width: 98vw !important;
        height: min(1000px, 96vh) !important;
        max-height: 96vh !important;
        max-height: 96dvh !important;
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
        padding:14px 18px !important; border-bottom:1px solid var(--SmartThemeBorderColor,#444) !important;
        flex-shrink:0 !important;
    `;

    const BODY_STYLE = 'overflow-y:auto !important; padding:12px 18px 20px !important; flex:1 1 auto !important;';

    const SMALL_BTN_STYLE = 'border:1px solid var(--SmartThemeBorderColor,#444) !important; background:transparent !important; color:inherit !important; border-radius:6px !important; padding:4px 10px !important; font-size:0.8em !important; cursor:pointer !important;';

    function createToggleGroup(labelA, labelB, onChangeA, onChangeB, initialIsA) {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex !important; border:1px solid var(--SmartThemeBorderColor,#555) !important; border-radius:6px !important; overflow:hidden !important; font-size:0.8em !important;';
        const btnA = document.createElement('button');
        const btnB = document.createElement('button');
        [btnA, btnB].forEach((b) => {
            b.style.cssText = 'border:none !important; padding:5px 12px !important; cursor:pointer !important; background:transparent !important; color:inherit !important;';
        });
        btnA.textContent = labelA;
        btnB.textContent = labelB;

        function refresh(isA) {
            btnA.style.background = isA ? 'rgba(255,255,255,0.15)' : 'transparent';
            btnB.style.background = !isA ? 'rgba(255,255,255,0.15)' : 'transparent';
        }
        btnA.addEventListener('click', () => { refresh(true); onChangeA(); });
        btnB.addEventListener('click', () => { refresh(false); onChangeB(); });
        refresh(initialIsA);

        wrap.appendChild(btnA);
        wrap.appendChild(btnB);
        return wrap;
    }

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
        titleWrap.style.cssText = 'display:flex !important; align-items:center !important; gap:12px !important; flex-wrap:wrap !important;';
        const title = document.createElement('h3');
        title.style.cssText = 'margin:0 !important; font-size:1.15em !important;';
        title.textContent = titleText;
        titleWrap.appendChild(title);

        const closeBtn = document.createElement('span');
        closeBtn.className = 'fa-solid fa-xmark';
        closeBtn.style.cssText = 'cursor:pointer !important; opacity:0.75 !important; font-size:1.4em !important; flex-shrink:0 !important;';

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
        const anyTranslation = message.swipes.some((_, idx) => getTranslatedText(message, idx) !== null);
        let viewMode = anyTranslation ? 'translated' : 'original';

        const shell = createModalShell(`스와이프 비교 (${message.swipes.length}개)`);

        if (anyTranslation) {
            const toggle = createToggleGroup(
                '원문', '번역',
                () => { viewMode = 'original'; renderList(); },
                () => { viewMode = 'translated'; renderList(); },
                viewMode === 'original',
            );
            shell.titleWrap.appendChild(toggle);
        }

        function renderList() {
            const currentIndex = message.swipe_id ?? 0;
            shell.body.innerHTML = '';
            message.swipes.forEach((rawText, idx) => {
                const fav = data.favorites[idx];
                const translated = getTranslatedText(message, idx);
                const showText = (viewMode === 'translated' && translated) ? translated : rawText;
                const isShowingTranslationButMissing = viewMode === 'translated' && !translated;

                const item = document.createElement('div');
                item.style.cssText = `
                    border:1px solid var(--SmartThemeBorderColor,#3a3a3a) !important;
                    border-radius:8px !important; padding:12px 14px !important; margin-bottom:12px !important;
                    ${idx === currentIndex ? 'border-color:var(--SmartThemeQuoteColor,#6ea8fe) !important;' : ''}
                    ${fav && fav.favorite ? 'background:rgba(255,215,0,0.08) !important; border-color:rgba(255,215,0,0.5) !important;' : ''}
                `;

                const top = document.createElement('div');
                top.style.cssText = 'display:flex !important; align-items:center !important; justify-content:space-between !important; gap:8px !important; margin-bottom:8px !important; flex-wrap:wrap !important;';

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
                useBtn.addEventListener('click', () => {
                    forceSwitchSwipe(mesId, idx);
                    shell.closeModal();
                });

                actions.appendChild(favBtn);
                actions.appendChild(useBtn);
                top.appendChild(label);
                top.appendChild(actions);

                const textEl = document.createElement('div');
                textEl.style.cssText = 'font-size:1.02em !important; line-height:1.6 !important; max-height:none !important; overflow-y:visible !important; white-space:pre-wrap !important; opacity:0.95 !important;';
                textEl.textContent = isShowingTranslationButMissing ? `(이 스와이프는 번역본이 없습니다)\n\n${rawText}` : showText;

                item.appendChild(top);
                item.appendChild(textEl);
                shell.body.appendChild(item);
            });
        }

        renderList();
    }

    // ---------------------------------------------------------------------
    // 리롤 갤러리 (현재 열려 있는 채팅 안의 즐겨찾기를 화자별로 모아 보기)
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
                    message,
                    mesId,
                    swipeIdx: idx,
                    speaker,
                    label: fav.label || '',
                    text: rawText,
                    translated: getTranslatedText(message, idx),
                    isActive: idx === (message.swipe_id ?? 0),
                });
            });
        });

        return results;
    }

    function openRerollGallery() {
        const items = collectFavorites();
        const anyTranslation = items.some((it) => it.translated !== null);
        let viewMode = anyTranslation ? 'translated' : 'original';

        const shell = createModalShell(`리롤 갤러리 (${items.length}개)`);

        if (anyTranslation) {
            const toggle = createToggleGroup(
                '원문', '번역',
                () => { viewMode = 'original'; render(); },
                () => { viewMode = 'translated'; render(); },
                viewMode === 'original',
            );
            shell.titleWrap.appendChild(toggle);
        }

        function render() {
            shell.body.innerHTML = '';

            if (items.length === 0) {
                const empty = document.createElement('div');
                empty.style.cssText = 'opacity:0.7 !important; padding:24px 4px !important; text-align:center !important; line-height:1.6 !important;';
                empty.textContent = '아직 즐겨찾기한 스와이프가 없어요. 메시지의 "비교" 버튼에서 ☆ 즐겨찾기를 눌러보세요.\n(리롤 갤러리는 지금 열려 있는 채팅 안의 즐겨찾기만 모읍니다.)';
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
                groupTitle.style.cssText = 'font-weight:600 !important; margin:16px 0 10px !important; opacity:0.85 !important; font-size:1em !important;';
                groupTitle.textContent = `${speaker} (${groups[speaker].length})`;
                shell.body.appendChild(groupTitle);

                groups[speaker].forEach((it) => {
                    const showText = (viewMode === 'translated' && it.translated) ? it.translated : it.text;
                    const isShowingTranslationButMissing = viewMode === 'translated' && !it.translated;

                    const card = document.createElement('div');
                    card.style.cssText = 'border:1px solid rgba(255,215,0,0.4) !important; background:rgba(255,215,0,0.06) !important; border-radius:8px !important; padding:12px 14px !important; margin-bottom:12px !important;';

                    const top = document.createElement('div');
                    top.style.cssText = 'display:flex !important; justify-content:space-between !important; align-items:center !important; gap:8px !important; margin-bottom:8px !important; flex-wrap:wrap !important;';

                    const meta = document.createElement('div');
                    meta.style.cssText = 'font-size:0.85em !important; opacity:0.8 !important;';
                    const metaParts = [`#${it.mesId} · 스와이프 ${it.swipeIdx + 1}`];
                    if (it.isActive) metaParts.push('현재 사용 중');
                    if (it.label) metaParts.push(it.label);
                    if (it.translated) metaParts.push(viewMode === 'translated' ? '번역' : '번역 있음');
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

                    const useBtn = document.createElement('button');
                    useBtn.textContent = it.isActive ? '사용 중' : '이 메시지 사용';
                    useBtn.disabled = it.isActive;
                    useBtn.style.cssText = SMALL_BTN_STYLE;
                    useBtn.addEventListener('click', () => {
                        useBtn.textContent = '전환 중...';
                        forceSwitchSwipe(it.mesId, it.swipeIdx);
                        shell.closeModal();
                        setTimeout(() => scrollToMessage(it.mesId), 150);
                    });

                    actions.appendChild(gotoBtn);
                    actions.appendChild(compareBtn);
                    actions.appendChild(useBtn);
                    top.appendChild(meta);
                    top.appendChild(actions);

                    const textEl = document.createElement('div');
                    textEl.style.cssText = 'font-size:0.98em !important; line-height:1.55 !important; max-height:14em !important; overflow-y:auto !important; white-space:pre-wrap !important; opacity:0.92 !important;';
                    textEl.textContent = isShowingTranslationButMissing ? `(번역본이 없습니다)\n\n${it.text}` : showText;

                    card.appendChild(top);
                    card.appendChild(textEl);
                    shell.body.appendChild(card);
                });
            });
        }

        render();
    }

    // ---------------------------------------------------------------------
    // 마법봉(확장 메뉴)에 "리롤 갤러리" 항목 추가
    // ---------------------------------------------------------------------
    function injectExtensionMenuButton() {
        if (document.getElementById('swipe-compare-gallery-btn')) return true;
        const menu = document.querySelector(SELECTORS.extensionsMenu);
        if (!menu) return false;

        const item = document.createElement('div');
        item.id = 'swipe-compare-gallery-btn';
        item.className = 'list-group-item flex-container flexGap5 interactable';
        item.tabIndex = 0;
        item.innerHTML = `<div class="fa-solid fa-shuffle extensionsMenuExtensionButton"></div><span>리롤 갤러리</span>`;
        item.addEventListener('click', () => {
            openRerollGallery();
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
