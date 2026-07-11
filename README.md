# Swipe Compare & Bookmark

메시지에 재생성된 응답(스와이프)이 2개 이상 있을 때, 모든 버전을 한 화면에서
비교하고, 마음에 드는 버전에 ⭐ 즐겨찾기와 라벨을 붙이고, 원하는 버전으로
바로 전환할 수 있게 해주는 SillyTavern 확장입니다.

## 설치 방법

### 방법 A — 로컬 확장으로 설치 (권장, 가장 간단)

1. SillyTavern이 설치된 폴더를 찾습니다. 보통 이런 구조입니다:
   ```
   SillyTavern/
     public/
       scripts/
         extensions/
           third-party/      <- 여기에 폴더를 넣습니다
   ```
2. 이 `swipe-compare` 폴더 전체를
   `SillyTavern/public/scripts/extensions/third-party/swipe-compare`
   경로로 복사합니다.
3. SillyTavern을 껐다가 다시 켭니다 (재시작).
4. 상단 메뉴 → Extensions(퍼즐 조각 아이콘) → 목록에서
   "Swipe Compare & Bookmark"가 보이면 활성화(체크)합니다.

### 방법 B — Git 저장소로 설치

이 폴더를 GitHub 같은 곳에 올린 뒤, SillyTavern 안에서
`Extensions → Install Extension`에 저장소 URL을 붙여넣어도 됩니다.
(로컬 테스트 단계에서는 방법 A가 훨씬 편합니다.)

## 사용법

1. 아무 메시지든 스와이프(재생성)를 2번 이상 해서 후보 응답을 여러 개 만듭니다.
2. 메시지 하단 버튼 줄에 새로 생긴 "비교" 아이콘(⇄ 모양)을 클릭합니다.
3. 뜨는 창에서:
   - 각 스와이프의 전체 텍스트를 확인
   - `☆ 즐겨찾기` 버튼으로 마음에 드는 버전 표시
   - 입력창에 라벨(예: "해피엔딩", "더 매콤한 버전") 적어두기
   - `이 버전 사용` 버튼으로 바로 그 스와이프로 전환
4. 즐겨찾기/라벨은 채팅 파일에 함께 저장되므로, 나중에 다시 열어도 남아있습니다.

## 코드 구조

```
swipe-compare/
  manifest.json   확장 정보 (이름, 버전, 진입 파일)
  index.js        핵심 로직
  style.css       모달/버튼 스타일
  README.md       이 문서
```

## 동작 원리 (수정하고 싶을 때 참고)

- 스와이프 목록/현재 선택 인덱스는 SillyTavern이 이미
  `chat[메시지번호].swipes`, `chat[메시지번호].swipe_id`에 저장해둡니다.
  이 확장은 그 값을 읽기만 합니다.
- 즐겨찾기/라벨 데이터는 새로 추가하는 정보라
  `chat[메시지번호].extra.swipeCompare.favorites`에 저장합니다.
  `extra` 필드는 채팅 저장 시 함께 저장되는 공간이라 별도 DB 없이도 유지됩니다.
- "이 버전 사용"을 누르면, 내부 로직을 새로 만들지 않고 화면에 원래 있는
  좌/우 스와이프 화살표 버튼을 필요한 횟수만큼 자동으로 클릭해서
  SillyTavern 자체 기능이 전환을 처리하도록 맡깁니다. 가장 안전한 방식입니다.
- 새 메시지가 그려질 때마다 버튼을 다시 붙여줘야 하므로,
  채팅 영역을 `MutationObserver`로 감시하고 있습니다.

## 문제 해결 (트러블슈팅)

SillyTavern은 버전이 올라가면서 CSS 클래스 이름이 가끔 바뀝니다.
버튼이 안 보이거나 전환이 안 되면 `index.js` 맨 위쪽의 `SELECTORS` 객체를
아래 순서로 고쳐보세요.

1. 브라우저 개발자 도구(F12) → Elements 탭 열기
2. 메시지 하나를 우클릭 → "검사(Inspect)"
3. 메시지를 감싸는 태그에 `mesid="..."` 같은 속성이 있는지 확인
   → 이름이 다르면 `SELECTORS.mesIdAttr` 값을 그 이름으로 변경
4. 메시지 하단 버튼들이 들어있는 div의 class 이름을 확인
   → `SELECTORS.buttonsHolder`에 그 class를 콤마로 추가
5. 스와이프 좌/우 화살표 버튼의 class 이름을 확인
   → `SELECTORS.swipeRightBtn`, `SELECTORS.swipeLeftBtn`에 반영

콘솔(Console 탭)에 `[swipe-compare]`로 시작하는 로그가 있는지도 같이 확인하면
어디서 막혔는지 파악하기 쉽습니다.

## 참고

이 코드는 SillyTavern 확장 공개 API(`SillyTavern.getContext()`, 채팅 DOM
구조)를 기준으로 작성되었습니다. 실제 실행 환경에서 한 번도 테스트해보지
못한 상태로 전달드리는 코드이니, 설치 후 위 "문제 해결" 항목을 참고해서
셀렉터를 미세 조정해야 할 수 있습니다. 구조 자체(전체 로직 흐름)는
그대로 두고 선택자 값만 바꾸면 대부분 해결됩니다.
