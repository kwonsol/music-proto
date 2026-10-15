# HANDOFF — main

- 최종 갱신: 2026-10-15
- 기준: 브랜치 `main`, 코드 기준 커밋 `4dbd427` (그 뒤로는 이 인수인계 문서 커밋만 있음)
- 다른 브랜치의 상태는 `docs/BRANCHES.md` 참고.

## 이 브랜치는
장르별 이미지 왜곡 앱 (React + TypeScript + Canvas 2D). 페이지: `index.html` 하나.
- 흰 캔버스 위에 장르당 독립 박스 1개. 면적 A = 비율 × 예산, width = √(A·r), height = √(A/r).
- 박스가 특징점 주변에서 탐지 → 추적 → 재탐지를 반복한다.
- 사진 효과: Pop 픽셀레이트, Hip-hop 블록·사선 슬라이스, Electronic 스트레치, Rock 가시, R&B 물결.
- 패널: 장르 선택, 비율, 강도, 옵션, 전환 빈도, 재생/일시정지, 테두리 표시, 초기화.

## 현재 진행 / 마지막 완료
- 마지막 기능 커밋: `4dbd427` 칸 분할(grid partition)을 독립 추적 박스로 교체, Pop을 픽셀레이트로 변경.
- 2026-10-15: 노트북·데스크톱 전환용 인수인계 체계(CLAUDE.md, docs/) 추가. 코드는 바꾸지 않음.
- 진행 중인 코드 작업: 없음.

## 바로 이어서 할 일 (우선순위 순)
1. main과 `experiment/silhouette-patterns` 를 나란히 비교 후 어느 쪽을 이어갈지 결정 (사용자 결정 필요).
2. 실제 사진 2~3장 업로드로 특징점·박스 위치 확인 (지금까지 합성 이미지로만 시험).
3. Rock 가시의 뚜렷함, Electronic 스트레치 빈도, 강도 슬라이더 의미 정리.
4. 다른 브랜치 통합 여부·순서 결정 (사용자 결정 필요, 임의 병합 금지).

## 알려진 문제
- 사진 모드 Hip-hop이 파란 배경을 끌어와 사과에 파란 구멍처럼 보임. 중심 쪽 이웃 우선으로 줄였지만 남아 있음.
- 프레임률은 측정하지 못함(미리보기 패널이 느렸음).

## 중요한 결정과 이유
- 박스 면적 고정, 종횡비만 변경: w·h = A가 항상 성립. 보간하지 않아 면적이 깨지지 않음.
- 박스를 쪼개거나 분할하지 않음: 사용자 요구. 겹치면 가장 최근에 갱신한 박스가 맨 위.
- 구획 밖 누수 방지: clip만 쓰면 경계 밖 1px에 알파가 번져서, 작업 캔버스에 그린 뒤 영역만 1:1 복사(drawRegion).
- 폐기한 접근: 장르 비율대로 화면을 칸으로 나누는 grid partition (`3b1cad5`) → `4dbd427`에서 삭제.

## 관련 파일
- `src/layout/boxes.ts`(박스 추적), `src/layout/features.ts`(특징점), `src/render/renderer.ts`, `src/effects/*.ts`
- `src/components/Stage.tsx`, `src/components/ControlPanel.tsx`, `src/App.tsx`
- 기본 이미지: `src/assets/default-apple.webp` (Git에 포함됨)

## 검증 방법
- `npm test` (2026-10-15 기준 8개 통과), `npm run typecheck` (통과)
- 화면 확인: `npm run dev` 후 브라우저에서 장르 박스가 움직이는지 본다.

## 전환 전 확인
- 2026-10-15 기준: 커밋 안 한 변경 없음, main은 origin/main과 같음(이 문서 커밋 push 후).
- 이 컴퓨터에만 있는 것: worktree 폴더 5개와 `../music-proto-critique/`(Git 밖). 자세한 건 `docs/BRANCHES.md`.
