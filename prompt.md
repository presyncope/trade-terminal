# 🚀 Project: Intelligent-Research-Hub (Live Trading Terminal)

NautilusTrader 기반의 TradingView + 실거래 터미널을 구현해 줘. 
이 프로젝트의 궁극적인 목적은 백테스팅, AI 데이터 증강, 실거래 등을 아우르는 'Intelligent-Research-Hub Terminal'을 구축하는 것이며, Top-Down 접근 방식에 따라 가장 핵심이 되는 **'실거래(Live Trading) 기능 및 다중 차트 뷰어'**를 우선적으로 구현하고자 해.

## 🏗️ System Architecture (마이크로서비스 아키텍처)

시스템은 철저한 역할 분리(Decoupling)를 위해 다음과 같은 모듈로 구성할 거야.

### 1. Backend (Python / NautilusTrader)
* **DataStream Node:** 여러 거래소(예: Binance, Bybit 등)로부터 실시간 틱(Tick) 및 캔들(Bar) 데이터를 WebSocket으로 수신하여 Redis MessageBus로 Broadcasting 하는 역할 (API Rate Limit 회피용).
* **Trading Node:** 실제 자동 매매 전략(Strategy)들을 실행함과 동시에, 프론트엔드에서 들어오는 사용자의 수동 주문(Manual Order)을 받아 거래소로 전송하는 핵심 코어. 무거운 연산 없이 오직 매매와 실시간 판단에만 집중함.
* **Data Worker:** 스케줄러나 Web API 요청을 받아 거래소에서 과거(Historical) 데이터를 긁어와 TimescaleDB에 Bulk Insert 하는 수집 전용 백그라운드 워커.

### 2. Database (Storage Layer)
* **TimescaleDB:** 초고속 과거 데이터(캔들, 틱) 영구 저장소. (Continuous Aggregates 기능을 활용해 다양한 Timeframe 제공 예정)
* **Redis:** 거래소 실시간 시세 및 Trading Node의 체결 이벤트(Fills)를 FastAPI로 전달하고, FastAPI의 수동 주문 명령을 Trading Node로 전달하는 초고속 메시지 브로커(Pub/Sub) 겸 캐시.

### 3. Frontend & Middleware (Web UI)
* **FastAPI (Web Node):** 프론트엔드와 통신하는 중계소(BFF). 과거 데이터는 TimescaleDB에서 `REST API`로 제공하고, 실시간 데이터(시세, 체결 내역)는 Redis에서 구독(Subscribe)하여 `WebSocket`으로 전달. 프론트엔드의 주문 요청을 Redis를 통해 Trading Node로 라우팅.
* **React (또는 Vue) + TradingView Lightweight Charts (HTS UI):** * 사용자가 원하는 개수만큼 **동적으로 여러 개의 차트(Multi-chart)**를 띄울 수 있는 유연한 그리드 레이아웃 제공.
  * 각 차트별로 **거래소(Exchange)와 종목(Symbol)**을 독립적으로 선택 가능.
  * 선택된 거래소/종목에 대해 즉각적으로 매수/매도할 수 있는 **수동 실거래(Manual Trading) 패널** 제공.
  * Trading Node에서 체결된 주문 내역(Fills)을 수신하여 **차트 위에 체결 마커(세모 뱃지)**로 즉시 표시하고, 별도의 **주문/체결 내역 테이블(Trade History)**에서 통합 확인 가능.
  * 거래소는 현재 Binance(spot, future)와 hyperliquid(future) 만 고려하면 됨
---

## 🔄 Core Data Flow
* **과거 데이터 (초기 로딩 & 스크롤):** Frontend (REST) ➡️ FastAPI ➡️ TimescaleDB 조회. (데이터 누락 시 Data Worker를 호출하여 DB 보완)
* **실시간 시세 & 체결 마커 표시:** DataStream Node(시세) / Trading Node(체결 이벤트) ➡️ Redis (Publish) ➡️ FastAPI (Subscribe) ➡️ Frontend (WebSocket) ➡️ 차트 및 체결 내역 테이블 업데이트.
* **수동 주문 실행 (Manual Trading):** Frontend (주문 패널 클릭) ➡️ FastAPI (REST/WS) ➡️ Redis (Command Publish) ➡️ Trading Node (Command Subscribe 및 실행) ➡️ 거래소.

---

## 🎯 Task Requirements

위 아키텍처를 바탕으로 다음 단계별 코드를 작성 및 설계해 줘.

1. **Project Directory Structure:** 위 MSA 구조와 Frontend(다중 차트) 요구사항을 모두 반영한 최적의 프로젝트 폴더 구조(Tree)를 제안해 줘. (Docker Compose 환경 고려)
2. **Database Schema:** TimescaleDB에 캔들(Bar) 데이터를 저장하기 위한 최적의 SQL 테이블 스키마 스크립트를 작성해 줘.
3. **Data Worker 스켈레톤:** NautilusTrader의 `DataClient`를 활용하여 Binance에서 과거 1분봉 데이터를 가져와 TimescaleDB에 비동기(asyncpg)로 Bulk Insert 하는 파이썬 스크립트 뼈대를 작성해 줘.
4. **FastAPI 중계소 스켈레톤:** TimescaleDB에서 과거 데이터를 읽어오는 `GET /api/klines` 엔드포인트와, Redis Pub/Sub을 듣고 프론트엔드로 실시간 캔들 및 체결(Fill) 이벤트를 쏴주는 WebSocket 엔드포인트 코드를 작성해 줘.
5. **Frontend UI 컴포넌트 설계:** 여러 차트를 동적으로 띄우고, 각 차트별 거래소/종목 선택, 실거래 주문 패널, 그리고 실시간 체결 내역 마커를 표시하는 React(또는 Vue) 컴포넌트 구조(Hierarchy)와 상태 관리(State Management) 방안을 간략히 설계해 줘.