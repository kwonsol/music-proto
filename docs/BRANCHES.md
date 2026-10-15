# BRANCHES — 전체 브랜치 지도

- 최종 확인: 2026-10-15 (`git fetch --prune` 후 확인)
- 이 파일은 **main에만** 둔다. 다른 브랜치에서는 `git show origin/main:docs/BRANCHES.md` 로 읽는다.
- 모든 브랜치가 GitHub(origin)에 올라가 있고, 로컬과 원격 커밋이 같으며, 커밋 안 한 변경은 없다(2026-10-15 기준).
- 실험 브랜치끼리는 **병합하지 않은 상태**다. 서로 다른 버전을 임의로 합치지 않는다.

## 한눈에 보기
| 브랜치 | 주제 | 열 페이지 | 확인 커밋 | 갈라진 지점 | main 병합 |
|---|---|---|---|---|---|
| `main` | 장르 이미지 왜곡 v2 (독립 추적 박스) | `index.html` | `4dbd427` | — | — |
| `experiment/silhouette-patterns` | 장르 왜곡 v3 (사과 실루엣 + 패턴) | `index.html` | `80b9451` | main `4dbd427` | 안 함 |
| `experiment/lyric-typo` | 가사 타이포 (3D 가사 링) | `index.html`, `genre.html` | `93b2cfd` | `b22500b` (초기 커밋) | 안 함 |
| `experiment/album-dj` | 앨범 커버 DJ | `dj.html` | `11bfae5` | main `3b1cad5` | 안 함 |
| `feature/drawing-score-pre-modes` | 드로잉 악보 (모드 분리 전) | `score.html` | `3ccc8b7` | `11bfae5` (album-dj 위) | 안 함 |
| `feature/drawing-score` | 드로잉 악보 (칸딘스키/몽환/힙합) | `score.html` | `e02bfe1` | `11bfae5` (album-dj 위) | 안 함 |

관계: `b22500b` → `3b1cad5`(장르 앱 v1) → `4dbd427`(main) → silhouette-patterns.
`3b1cad5` → album-dj → drawing-score-pre-modes / drawing-score (두 갈래, 서로 병합 안 함).
lyric-typo는 장르 앱 커밋 전 스냅샷에서 시작해 main과 많이 다르다.

## 각 브랜치

### `main`
- 목적·내용: 장르별 박스가 특징점을 추적하며 사진을 왜곡. 자세한 건 main의 `docs/HANDOFF.md`.
- 상태: 동작함. 실제 사진 테스트, Rock/Electronic/강도 슬라이더 다듬기 남음.

### `experiment/silhouette-patterns`
- 목적: main 위에 사과 실루엣을 중앙에 고정하고 박스를 마스크로만 쓰는 버전.
- 구현: 패턴 모드(기본, 고채도 색면·줄무늬·체크)와 사진 모드 전환, 박스는 기준점 주변 3~6%만 이동하고 종횡비 변화 중심.
  주요 파일 `src/subject/`, `src/pattern/`, `src/layout/boxes.ts`, `src/render/renderer.ts`. 테스트 10개 통과(당시 기록).
- 남은 일: 실제 사진 업로드 시험, 패턴 모드 강도 슬라이더 의미, 박스 움직임을 부드럽게 vs 컷(사용자 확인 필요), Rock 가시 뚜렷함.
- 통합 시 충돌 예상: `boxes.ts`, `renderer.ts`, `Stage.tsx`, `App.tsx` (main 최신을 이미 포함하므로 현재는 빨리감기 가능).

### `experiment/lyric-typo`
- 목적: 가사 속 [대괄호] 핵심 단어에 왜곡 효과를 거는 타이포 실험.
- 구현: 효과 9종(`src/lyric/effects/`), 보기 모드 4개(링 편집 기본·크게 보기·반복 배열·가사 데모),
  12개 기울어진 3D 링 렌더러(`src/lyric/render/ring.ts`), 줄 단위 편집. 저장 키 `lyric-typo.rings.v2`. vitest 26개.
- 남은 일: 실제 FPS 측정, Safari/Firefox 확인, 개발용 전역(`__lyricSeek` 등) 정리 여부, 화면 크기별 링 크기 조정.
- 주의: `genre.html`의 장르 앱은 main보다 오래된 스냅샷. main과 합치면 `src/App.tsx` 등에서 충돌.
- 폰트: `@fontsource/anton` npm 패키지(`npm install`로 설치됨).

### `experiment/album-dj`
- 목적: 앨범 커버 위 칸딘스키풍 도형을 눌러 킥·퍼크·하이햇·스터터·라이저·에코를 연주.
- 구현: `src/dj/` (스펙트럴 플럭스 비트 분석, 최소제곱 템포 맞춤 130.02 BPM), 음원 `public/dj/song.mp3`, `public/dj/cover.webp`.
- 상태: 완료된 실험. drawing-score 두 브랜치의 바탕.

### `feature/drawing-score-pre-modes`
- 목적: 모드 분리 전 드로잉 악보를 보존한 버전(Claude 파일 기록에서 복원).
- 구현: 커버 드래그 이미지 늘이기, 키 1~5 브러시, 4마디 루프 녹음(16분음표 스냅), 그린 요소 다시 재생.
- 상태: 보존용. 더 개발할 계획은 확인 필요.

### `feature/drawing-score`
- 목적: 드로잉 악보를 칸딘스키 / 몽환(Dreamy) / 힙합 세 모드로 분리. 왼쪽 24% 음악 패널, 오른쪽 76% 캔버스.
- 구현: 모드별 엔진·곡·루프. 칸딘스키는 새 곡 `public/score/kandinsky.mp3`(5.3MB, Git에 포함), 힙합은 원곡 + 스크래치·스프레이.
- 남은 일: 전체 청취 테스트(한 번도 안 함), 몽환 모드 디자인·사운드("준비 중"만 표시),
  칸딘스키 곡 구간별 비트맵(130초 이후 박자 어긋남), 안 쓰는 옛 브러시 코드 정리 여부.
- 주의: 공용 파일 `src/dj/audio/engine.ts`, `analysis.ts`를 수정함 → album-dj 쪽을 고치면 충돌 가능.
  페이지를 연 뒤 곡 분석에 10~15초 걸림.

## 이 컴퓨터에만 있는 것 (GitHub로 전달되지 않음)
- worktree 폴더(저장소 폴더 옆): `music-proto-silhouette`, `music-proto-lyric-typo`, `music-proto-album-dj`,
  `music-proto-drawing-score-premodes`, `music-proto-drawing-score`. 브랜치 내용은 GitHub에 있으니 다른 컴퓨터에서 다시 만들면 된다.
- `music-proto-critique/` (Git 밖): 크리틱용 시작 페이지(포트 5300)와 `start.sh`/`stop.sh`, `servers.conf`(포트 5301~5306).
  다른 컴퓨터에서 쓰려면 폴더를 직접 복사해야 한다(USB·클라우드 드라이브 등). 필요한지는 확인 필요.
- 각 폴더의 `node_modules/`, `dist/` — 컴퓨터마다 `npm install`로 새로 만든다.

## 다른 컴퓨터에서 브랜치를 여는 법
한 폴더에서 바꿔 가며 쓰기: `git fetch origin` 후 `git switch <브랜치>` (커밋 안 한 변경이 없을 때만).
나란히 열기(worktree): 저장소 폴더에서 `git worktree add ../music-proto-lyric-typo experiment/lyric-typo` 후 그 폴더에서 `npm install`.
