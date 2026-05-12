# Eye Subway

눈동자(시선)로 좌/우 차선을 바꾸는 Subway Surfers 스타일 웹 게임.

## 실행

이 프로젝트는 정적 파일만으로 구성되어 있습니다. 웹캠 권한이 필요하므로
`http://localhost`처럼 보안 컨텍스트에서 서빙해 주세요.

```bash
# 가장 간단한 방법
python3 -m http.server 5173
# 그 후 브라우저에서 http://localhost:5173 접속
```

## 조작

- 시선을 좌/우로 옮기면 차선이 변경됩니다.
- 키보드 ← → / A · D 키도 함께 사용 가능합니다.
- 처음 실행 시 **보정(Calibrate)** 을 한 번 진행하면 정확도가 좋아집니다.

## 사용 기술

- 시선 추적: [MediaPipe Tasks Vision](https://developers.google.com/mediapipe)
  의 FaceLandmarker (홍채 좌표 사용).
- 게임 그래픽: HTML5 Canvas 2D.
- 의존성 없음 (ES module을 CDN에서 직접 import).