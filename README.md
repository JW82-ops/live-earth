# 라이브 어스

주소: https://jw82-ops.github.io/live-earth/

실시간으로 낮과 밤이 바뀌는 3D 지구. 나라를 누르면 현지 시각, 기본 정보, 환율, 날씨, 최신 기사, 음악 링크를 보여준다.

## 데이터가 오는 곳

| 항목 | 출처 | 갱신 |
| --- | --- | --- |
| 낮/밤 경계, 현지 시각 | 브라우저에서 직접 계산 | 매초 |
| 환율 | open.er-api.com (브라우저에서 직접 호출) | 페이지를 열 때마다 |
| 날씨 | Open-Meteo (브라우저에서 직접 호출) | 나라를 누를 때마다, 10분 캐시 |
| 최신 기사 | Google 뉴스 RSS → `data/news.json` | GitHub Actions가 매시간 받아서 바로 배포 |
| 지진 | USGS (브라우저에서 직접, 실패 시 `data/quakes.json`) | 5분마다 |
| 국제우주정거장 | Celestrak 궤도 요소 → `data/iss.json`, 위치는 브라우저에서 satellite.js로 계산 | 궤도는 매시간, 위치는 매 순간 |
| 태풍·허리케인 | GDACS → `data/storms.json` (현재 위치, 지나온 길, 예상 진로) | 매시간 |
| 오로라 | NOAA OVATION 예보 + Kp 지수 → `data/aurora.json` | 매시간 |
| 환율 30일 추이 | 유럽중앙은행 기준환율(Frankfurter) → `data/fxhist.json` | 매시간 (영업일 1회 갱신) |
| 미세먼지 | Open-Meteo 대기질 (각국 수도 + 국내 10개 도시) → `data/air.json` | 매시간 |
| 화산 | GDACS 최근 120일 분화 → `data/volcanoes.json` | 매시간 |
| 항공편 | OpenSky (브라우저에서 직접, 보고 있는 지역만) | 켜 두면 45초마다 |
| 달 | 브라우저에서 위치·위상 계산, 일식·월식 일정표 내장 | 매 순간 |
| 매거진 | `scripts/magazines-src.json` 목록 → 주소 확인 + 최신 기사 제목 → `data/magazines.json` | 6시간마다 |
| 위성 구름 | clouds.matteason.co.uk → `data/clouds.png` | GitHub Actions가 매시간 받아서 바로 배포 |

환율·날씨 서버에 닿지 못하면 `snapshot.js`의 환율과 날씨 검색 링크로 대신한다.
기사나 구름을 받지 못하면 이전 데이터를 유지하고, 처음부터 없으면 검색 링크와 연출용 구름을 보여준다.

## 처음 설정

1. Settings → Pages → Source를 **GitHub Actions** 로 선택.
2. Actions 탭 → **Update news and clouds** → **Run workflow** 로 바로 배포.
3. 2~3분 뒤 `https://<사용자명>.github.io/live-earth/` 에서 확인.

기사·구름 데이터는 저장소에 커밋하지 않는다. 매시간 새로 받아 사이트와 함께 배포하므로 저장소 용량이 늘지 않는다.

## 파일

- `index.html` 페이지 전체 (three.js r128, topojson은 cdnjs에서 로드)
- `countries.js` 나라별 이름·수도·좌표·통화·시간대 (world-countries, city-timezones 기반)
- `world.js` 국경 데이터 (world-atlas 50m)
- `earth-*.jpg/png` 지구 텍스처 (three-globe 예제 이미지)
- `scripts/update-data.mjs` 기사·구름·지진·ISS 궤도 수집 스크립트
- `manifest.webmanifest`, `sw.js`, `icon-*.png`, `apple-touch-icon.png` 홈 화면 앱 설정
- `og.jpg` 링크 공유 미리보기 이미지
- `.github/workflows/update-data.yml` 매시간 실행 설정

## 기능 요약

- 나라를 누르면: 현지 시각, 기본 정보, 환율(+30일 그래프), 날씨, 최신 기사, 음악 링크
- **비교** 버튼: 두 나라의 시각·시차·거리·비행시간·환율·날씨·면적을 나란히
- 레이어: 구름, 지진, 국제우주정거장(서울 다음 통과 시각), 태풍, 오로라
- **투어**: 장면 고르기·나라 추가, 배경음악(직접 합성), 세로 9:16/가로 16:9 영상 저장.
  기본 순서: 해 뜨는 곳 → 서울 → 큰 지진 → 태풍 → 오로라 → ISS → 해 지는 곳을 자동으로 도는 시네마틱 모드 (화면을 누르면 종료)
