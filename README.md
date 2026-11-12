# 라이브 어스

실시간으로 낮과 밤이 바뀌는 3D 지구. 나라를 누르면 현지 시각, 기본 정보, 환율, 날씨, 최신 기사, 음악 링크를 보여준다.

## 데이터가 오는 곳

| 항목 | 출처 | 갱신 |
| --- | --- | --- |
| 낮/밤 경계, 현지 시각 | 브라우저에서 직접 계산 | 매초 |
| 환율 | open.er-api.com (브라우저에서 직접 호출) | 페이지를 열 때마다 |
| 날씨 | Open-Meteo (브라우저에서 직접 호출) | 나라를 누를 때마다, 10분 캐시 |
| 최신 기사 | Google 뉴스 RSS → `data/news.json` | GitHub Actions가 매시간 |
| 위성 구름 | clouds.matteason.co.uk → `data/clouds.*` | GitHub Actions가 매시간 |

환율·날씨 서버에 닿지 못하면 `snapshot.js`의 환율과 날씨 검색 링크로 대신한다.
기사나 구름을 받지 못하면 이전 데이터를 유지하고, 처음부터 없으면 검색 링크와 연출용 구름을 보여준다.

## 처음 설정

1. Settings → Pages → Source를 **Deploy from a branch**, Branch를 **main / (root)** 로 저장.
2. Actions 탭 → **Update news and clouds** → **Run workflow** 로 첫 기사 수집을 바로 실행.
3. 1~2분 뒤 `https://<사용자명>.github.io/live-earth/` 에서 확인.

## 파일

- `index.html` 페이지 전체 (three.js r128, topojson은 cdnjs에서 로드)
- `countries.js` 나라별 이름·수도·좌표·통화·시간대 (world-countries, city-timezones 기반)
- `world.js` 국경 데이터 (world-atlas 50m)
- `earth-*.jpg/png` 지구 텍스처 (three-globe 예제 이미지)
- `scripts/update-data.mjs` 기사·구름 수집 스크립트
- `.github/workflows/update-data.yml` 매시간 실행 설정
