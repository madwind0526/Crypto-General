import type { TraderId } from "../types/trading";

export interface TraderProfile {
  id: TraderId;
  name: string;
  summary: string;
  strengths: string[];
  risks: string[];
}

export const traderProfiles: TraderProfile[] = [
  {
    id: "momentum",
    name: "Momentum Trader",
    summary: "추세가 강한 종목 하나를 골라 따라붙고 약해지면 이탈합니다.",
    strengths: ["강한 상승장", "거래량이 붙는 변동성 장세", "명확한 손절/추적손절"],
    risks: ["횡보장 손실 반복", "늦은 진입", "뉴스 급락"],
  },
  {
    id: "range-grid",
    name: "Range Grid Trader",
    summary: "박스권에서 과매도 구간을 사고 평균으로 돌아오면 팝니다.",
    strengths: ["횡보장", "반복 변동성", "짧은 평균 회귀"],
    risks: ["강한 추세 이탈", "계속 하락하는 코인", "그리드 과밀"],
  },
  {
    id: "arbitrage",
    name: "Statistical Arbitrage Trader",
    summary: "초기에는 현물 상대가치 프록시로 시작하고, 나중에 페어/펀딩비 전략으로 확장합니다.",
    strengths: ["방향성 노출 감소 가능", "규칙 기반 비교", "수수료 모델 검증에 적합"],
    risks: ["데이터 요구량", "슬리피지", "거래소 제약"],
  },
  {
    id: "anomaly",
    name: "Anomaly Signal Trader",
    summary: "급격한 가격/거래량 이상 신호를 감지하되 조작 참여가 아닌 짧은 리스크 대응으로 제한합니다.",
    strengths: ["초단기 급등 포착", "후보 12개 일일 선정에 적합", "엄격한 시간 제한"],
    risks: ["매우 높은 거짓 신호", "급락/슬리피지", "시장 조작 위험"],
  },
];

