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
    risks: ["박스권 반복 손실", "늦은 진입", "급락 갭과 슬리피지"],
  },
  {
    id: "range-grid",
    name: "General-B Range",
    summary: "박스권과 평균 회귀 구간을 찾고, 과매도 이후 반등을 이용하는 일반 시나리오입니다.",
    strengths: ["횡보장 대응", "반복 변동성 활용", "지지/저항 기반 검증에 적합"],
    risks: ["강한 추세 이탈", "계속 하락하는 종목", "과도한 물타기"],
  },
  {
    id: "arbitrage",
    name: "General-C Relative",
    summary: "통계적 상대 가치의 프록시로 시작하고, 이후 페어/괴리/수수료 모델로 확장할 일반 시나리오입니다.",
    strengths: ["방향성 노출 감소 가능", "규칙 기반 비교", "수수료 모델 검증에 적합"],
    risks: ["데이터 요구량", "괴리 장기화", "거래비용 과소평가"],
  },
  {
    id: "general-d",
    name: "General-D Re-entry",
    summary:
      "General-B의 박스권 매매를 기반으로, +2.5% 수익 구간 이후 매도하고 직전 매도가 대비 충분히 눌렸을 때만 재진입하는 시나리오입니다.",
    strengths: ["박스권 재진입", "수익 목표 기반 매도", "상승 추세에서는 트레일링으로 일부 추세 추종"],
    risks: ["강한 상승에서 재진입 실패", "하락 추세에서 긴 보유", "거래 횟수 감소"],
  },
];
