# Strategy Change Log

## 2026-05-28 — minProfitPct 0.5% 적용 (B, C 전략)

### 배경

7일 1분봉 백테스트 결과 B (rangeGrid), C (arbitrage) 전략에서 거래 횟수가 과도하게 많음.
거래 축소 및 수수료 절감 효과를 위해 매도 시 최소 수익률 기준(minProfitPct)을 도입·조정.

### 백테스트 비교 (7일, ignored guide, 1m 분봉)

| 전략        | 기준    | 수익률    | 거래수 | 승률   | MaxDD |
|------------|--------|---------|------|------|-------|
| B 현재      | (없음)  | 37.54%  | 264  | 81.0% | 3.3%  |
| B 0.5% 적용 | 0.5%   | 32.41%  | 195  | 78.8% | 3.3%  |
| B 1.0% 적용 | 1.0%   | 22.77%  | 165  | 64.5% | 3.6%  |
| C 현재      | 0.3%~0.8% | 109.69% | 710 | 83.8% | 2.9%  |
| C 0.5% 적용 | 0.5%   | 94.96%  | 544  | 84.0% | 3.1%  |
| C 1.0% 적용 | 1.0%   | 17.38%  | 250  | 65.0% | 3.1%  |
| D 현재      | 2.5%   | 17.13%  | 49   | 74.8% | 6.9%  |

**채택 기준: 0.5%**
- 1.0%는 수익률 손실이 너무 크고 C 전략 특성(소폭 차익 반복)과 맞지 않음.
- 0.5%는 거래수 약 25% 감소, 수익률 손실 최소화 (B: -14%, C: -13%).

### 변경 내용

#### `src/strategies/rangeGrid.ts` (General-B)

- `rangeGridScenario.params`에 `minProfitPct: 0.005` 추가
  - tight / deep 시나리오는 default spread를 통해 동일하게 상속됨
- `decide()` 함수: 평균 회귀 매도 신호 발생 시, 수익률이 `minProfitPct` 미만이면 홀드
  - **시간 기반 청산 (`holdCandles >= maxHoldCandles`)은 항상 실행** (손실 누적 방지)

```typescript
// 변경 전
if (current.close >= band.middle || position.holdCandles >= scenario.params.maxHoldCandles) {
  return { action: "sell", ... };
}

// 변경 후
const isTimeExit = position.holdCandles >= scenario.params.maxHoldCandles;
const isMeanReversionExit = current.close >= band.middle;
if (isTimeExit || isMeanReversionExit) {
  const minProfitPct = scenario.params.minProfitPct ?? 0;
  const returnPct = (current.close - position.averagePrice) / position.averagePrice;
  if (!isTimeExit && minProfitPct > 0 && returnPct < minProfitPct) {
    return hold("min-profit-wait");
  }
  return { action: "sell", ... };
}
```

#### `src/strategies/arbitrage.ts` (General-C)

- `relative-value-fast` 시나리오 `minProfitPct`: `0.003` → `0.005`
  - default (0.005), deep (0.008)은 이미 0.5% 이상이므로 변경 없음

### D 전략 (General-D)

`profitTargetPct: 0.025` (2.5%)가 이미 적용되어 있어 별도 변경 없음.
