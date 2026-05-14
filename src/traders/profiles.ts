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
    name: "General-A Momentum",
    summary: "강한 추세와 거래량 확인을 우선으로 보고, 상승 흐름이 약해지면 빠르게 이탈하는 일반 시나리오입니다.",
    strengths: ["추세장 대응", "명확한 진입/이탈 규칙", "12개 후보 중 강한 종목 선택에 적합"],
    risks: ["횡보장에서 반복 손실", "늦은 진입", "급락 갭과 슬리피지"],
  },
  {
    id: "range-grid",
    name: "General-B Range",
    summary: "박스권과 평균 회귀 구간을 찾고, 과매도/과매수 회복을 이용하는 일반 시나리오입니다.",
    strengths: ["횡보장 대응", "반복 변동성 활용", "지지/저항 기반 검증에 적합"],
    risks: ["강한 추세 이탈", "계속 하락하는 종목", "과도한 재진입"],
  },
  {
    id: "arbitrage",
    name: "General-C Relative",
    summary: "초기에는 통계적 상대 가치의 프록시로 운용하고, 이후 페어/괴리/수수료 모델로 확장할 일반 시나리오입니다.",
    strengths: ["방향성 노출 감소 가능", "규칙 기반 비교", "수수료 모델 검증에 적합"],
    risks: ["데이터 요구량", "괴리 장기화", "거래비용 과소평가"],
  },
  {
    id: "anomaly",
    name: "Anomaly Signal",
    summary: "가격과 거래대금의 비정상적 변화를 감지하되, 조작 참여가 아닌 공개 데이터 기반의 방어적 리스크 대응으로 제한합니다.",
    strengths: ["초단기 이상 신호 포착", "일일 12개 후보 감시에 적합", "엄격한 시간 제한"],
    risks: ["높은 거짓 신호", "급락과 슬리피지", "시장 조작 위험"],
  },
];
