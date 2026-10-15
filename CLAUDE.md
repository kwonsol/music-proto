# music-proto — Claude 작업 안내 (모든 브랜치 공통)

이 파일은 모든 브랜치에 똑같이 두는 공통 안내다. 브랜치마다 다른 "지금 상태"는 `docs/HANDOFF.md`에 쓴다.

## 프로젝트
- 음악(장르·앨범 커버·가사·곡)을 시각 표현으로 바꾸는 인터랙티브 웹 프로토타입 모음. 최종 용도·마감은 확인 필요.
- 기술: React 19 + TypeScript + Vite + Canvas 2D (오디오 브랜치는 Web Audio). 테스트는 vitest.
- 주제별로 브랜치를 나눠 실험한다. 버전 비교(크리틱)가 목적이라 **서로 다른 실험 브랜치를 임의로 합치지 않는다.**

## 반드시 지킬 것
- 사용자가 구체적으로 지시하기 전에는 기능·디자인 코드를 바꾸지 않는다.
- main에 임의로 병합하지 않고, 브랜치를 삭제하지 않으며, 강제 push(`--force`)·`reset --hard`를 하지 않는다.
- 장르 앱: 장르 박스는 쪼개거나 칸으로 분할하지 않는다(사용자 요구). 박스 면적 = 비율 × 예산으로 고정.
- 오디오 브랜치: 프로젝트에 사람 목소리 샘플은 없다. 합창·환호는 합성음이며 보고할 때도 그렇게 말한다.
- 비밀번호·API 키·실제 `.env` 값은 문서나 GitHub에 올리지 않는다. `node_modules/`, `dist/`도 올리지 않는다.
- 문서에는 컴퓨터마다 다른 절대 경로 대신 프로젝트 기준 상대 경로를 쓴다.

## 사용자에게 설명하는 방법
- 사용자는 코딩 초보다. 쉬운 말로, 한 번에 한 단계씩, 왜 하는지 한 줄 덧붙여 설명한다.
- 명령어는 복사해서 바로 실행할 수 있게 한 블록에 하나씩 준다.
- 확인하지 못한 것은 추측하지 말고 "확인 필요"라고 말한다.

## 구조와 명령 (브랜치마다 페이지가 다름 — `docs/HANDOFF.md` 참고)
- `src/` 코드, `public/` 음악·이미지(오디오 브랜치), `index.html` 등 HTML 파일이 각 페이지 입구.
- 필요한 프로그램: Node.js 24 이상(확인된 버전 24.15.0), npm 11. 환경변수는 쓰지 않는다(`.env` 불필요).
- 처음 한 번 / package.json이 바뀌었을 때: `npm install`
- 개발 서버: `npm run dev` → 터미널에 나온 주소(보통 http://localhost:5173)
- 검증: `npm test` (단위 테스트), `npm run typecheck` (타입 검사), 큰 변경 후에만 `npm run build`

## 인수인계 문서
- `docs/HANDOFF.md` — 이 브랜치의 현재 작업 상태. 브랜치마다 내용이 다르다.
- `docs/BRANCHES.md` — 전체 브랜치 지도. **main 브랜치에만 둔다.** 다른 브랜치에서는 전환하지 말고
  `git show origin/main:docs/BRANCHES.md` 로 읽는다.
- `docs/HANDOFF.template.md` — 문서가 없는 브랜치에 HANDOFF.md를 새로 만들 때 쓰는 빈 양식.

## 세션 시작 (크레딧 절약)
1. 이 파일과 `docs/HANDOFF.md`만 먼저 읽는다.
2. `git status --short --branch` 와 `git log --oneline -3` 으로 브랜치·변경·최신 커밋이 HANDOFF 기록과 맞는지 본다.
3. 같으면 전체 탐색 없이 요청에 필요한 파일만 읽는다. 다르면 `git log --oneline <기록 커밋>..HEAD`, `git diff --stat <기록 커밋>` 로 차이만 본다.
4. 문서가 실제 코드와 다르면 실제 상태를 기준으로 문서를 고친다.
5. BRANCHES.md는 브랜치 선택·버전 비교가 필요할 때만 읽는다. 전체 브랜치 조사·전체 파일 읽기·반복 전체 테스트는 하지 않는다.
6. 사용자에게는 "현재 브랜치 / 현재 상태 / 다음 작업" 세 줄만 알린다.

## "작업시작"이라고 하면
1. 올바른 저장소(origin = github.com/kwonsol/music-proto)인지, 어느 브랜치인지 확인한다.
2. 커밋 안 한 변경이 있으면 그대로 두고 사용자에게 알린다(덮어쓰기·초기화 금지).
3. `git fetch origin` 후, 변경이 없고 빨리감기(fast-forward)로 받을 수 있을 때만 `git pull --ff-only`.
   갈라져 있으면 받지 말고 상황을 설명한 뒤 사용자에게 묻는다.
4. 위 "세션 시작" 순서로 맥락을 복원하고, 지시가 있기 전에는 코드를 바꾸지 않는다.
5. HANDOFF.md가 없는 브랜치라면 아래 "문서가 없는 브랜치" 방법을 제안한다(사용자 확인 후 진행).

## "작업종료" / "컴퓨터 바꿀게"라고 하면
1. 이번 변경에 필요한 검증만 한다(보통 `npm test`, `npm run typecheck`).
2. `docs/HANDOFF.md`를 현재 상태로 덮어써서 갱신한다(일지처럼 쌓지 않는다).
   브랜치 상황이 바뀌었으면 main의 `docs/BRANCHES.md`도 고친다(main 폴더에서 문서만 커밋).
3. 이번 작업 파일과 문서만 골라 `git add <파일>` 로 커밋한다. 원래 있던 다른 변경은 섞지 말고 사용자에게 알린다.
4. `git push` (처음 올리는 브랜치는 `git push -u origin <브랜치>`). 거절되면 강제 push하지 말고 작업을 보존한 채 알린다.
5. `git status -sb` 로 `ahead` 표시가 없는지 확인해 실제 push 성공을 보고한다.
6. 다음 컴퓨터에서 열 폴더·브랜치와 `git pull` 필요 여부를 짧게 알려준다.

## 문서가 없는 브랜치에 문서만 넣는 방법
기능 코드는 합치지 않고, 공통 문서만 main에서 가져온다. 그 브랜치 폴더에서:
```
git fetch origin
git checkout origin/main -- CLAUDE.md docs/HANDOFF.template.md
cp docs/HANDOFF.template.md docs/HANDOFF.md
```
그다음 HANDOFF.md에 **그 브랜치 자신의** 상태를 채우고(`git show origin/main:docs/BRANCHES.md`의 해당 항목 참고),
세 파일만 커밋·push한다. 다른 브랜치의 HANDOFF 내용을 복사하지 않는다. BRANCHES.md는 가져오지 않는다.
CLAUDE.md를 고칠 때는 main에서 고치고, 다른 브랜치에는 위 `git checkout origin/main -- CLAUDE.md` 로 필요할 때만 반영한다.
