import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { aggregateCandles, normalizeChartInterval, type ChartInterval } from "../data/candleAggregation";
import {
  loadDashboardMarketData,
  loadDashboardResults,
  loadSampleMarketData,
  type DashboardMarketData,
  type DashboardResults,
} from "../data/marketData";
import { defaultBacktestConfig } from "../simulation/backtest";
import {
  compareStrategies,
  compareStrategiesByGuideMode,
  type StrategyComparison,
  type StrategyGuideModeComparison,
} from "../simulation/optimizer";
import { buildTraderOptimizationPlans, type TraderOptimizationPlan } from "../simulation/traderOptimization";
import { strategies } from "../strategies";
import { traderProfiles, type TraderProfile } from "../traders/profiles";
import type { Candle, GuideRuleMode, Trade, TraderId } from "../types/trading";
import { MarketChart } from "../ui/MarketChart";

type DashboardView = "summary" | TraderId;
type ThemeMode = "light" | "dark";

interface StrategyRefreshStatus {
  completedAt: string;
  error: string;
  logs: string[];
  progress: number;
  running: boolean;
  stepIndex: number;
  stepLabel: string;
  totalSteps: number;
}

const formatPct = (value: number) => `${(value * 100).toFixed(2)}%`;
const formatKrw = (value: number) =>
  new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(value);

const chartIntervalPresets: Array<{ interval: ChartInterval; label: string; value: string; windowLabel: string }> = [
  { interval: { value: 1, unit: "minute" }, label: "1 minute", value: "1m", windowLabel: "6 hours" },
  { interval: { value: 5, unit: "minute" }, label: "5 minutes", value: "5m", windowLabel: "1 day" },
  { interval: { value: 30, unit: "minute" }, label: "30 minutes", value: "30m", windowLabel: "1 week" },
  { interval: { value: 1, unit: "hour" }, label: "1 hour", value: "1h", windowLabel: "1 month" },
];

export function App() {
  const [selectedView, setSelectedView] = useState<DashboardView>("summary");
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const [chartInterval, setChartInterval] = useState<ChartInterval>({ value: 5, unit: "minute" });
  const [modalInterval, setModalInterval] = useState<ChartInterval>({ value: 5, unit: "minute" });
  const [guideRuleMode, setGuideRuleMode] = useState<GuideRuleMode>("strict");
  const [selectedMarket, setSelectedMarket] = useState<string | null>(null);
  const [selectedMarketTrades, setSelectedMarketTrades] = useState<Trade[]>([]);
  const [marketData, setMarketData] = useState<DashboardMarketData>(() => loadSampleMarketData());
  const [dashboardResults, setDashboardResults] = useState<DashboardResults | null>(null);
  const [refreshStatus, setRefreshStatus] = useState<StrategyRefreshStatus | null>(null);
  const lastRefreshCompletedAtRef = useRef("");

  useEffect(() => {
    let active = true;
    loadDashboardState().then(([nextMarketData, nextResults]) => {
      if (!active) return;
      setMarketData(nextMarketData);
      setDashboardResults(nextResults);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function poll() {
      const status = await loadRefreshStatus();
      if (!active || !status) return;
      setRefreshStatus(status);

      if (
        status.completedAt &&
        status.completedAt !== lastRefreshCompletedAtRef.current &&
        !status.running &&
        !status.error
      ) {
        lastRefreshCompletedAtRef.current = status.completedAt;
        const [nextMarketData, nextResults] = await loadDashboardState();
        if (!active) return;
        setMarketData(nextMarketData);
        setDashboardResults(nextResults);
      }
    }

    poll();
    const timer = window.setInterval(poll, 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const backtestConfig = useMemo(
    () => ({
      ...defaultBacktestConfig,
      guideRuleMode,
    }),
    [guideRuleMode],
  );
  const comparisons = useMemo(
    () =>
      selectedView === "summary"
        ? dashboardResults?.comparisons ?? compareStrategies(strategies, marketData.candlesByMarket, backtestConfig)
        : dashboardResults?.comparisonsByGuideMode?.[guideRuleMode] ??
          dashboardResults?.comparisons ??
          compareStrategies(strategies, marketData.candlesByMarket, backtestConfig),
    [backtestConfig, dashboardResults, guideRuleMode, marketData, selectedView],
  );
  const optimizationPlans = useMemo(
    () =>
      selectedView === "summary"
        ? dashboardResults?.optimizationPlans ??
          buildTraderOptimizationPlans(strategies, marketData.candlesByMarket, {
            candidateMarketCount: 30,
            monitoringMarketCount: 12,
            guideRuleMode,
            config: backtestConfig,
          })
        : dashboardResults?.optimizationPlansByGuideMode?.[guideRuleMode] ??
          dashboardResults?.optimizationPlans ??
      buildTraderOptimizationPlans(strategies, marketData.candlesByMarket, {
        candidateMarketCount: 30,
        monitoringMarketCount: 12,
        guideRuleMode,
        config: backtestConfig,
      }),
    [backtestConfig, dashboardResults, guideRuleMode, marketData, selectedView],
  );
  const guideModeComparisons = useMemo(
    () =>
      dashboardResults?.guideModeComparisons ??
      compareStrategiesByGuideMode(strategies, marketData.candlesByMarket, defaultBacktestConfig),
    [dashboardResults, marketData],
  );
  const ranked = comparisons
    .slice()
    .sort((a, b) => b.bestResult.returnRate - a.bestResult.returnRate);
  const selectedTrader = selectedView === "summary" ? ranked[0]?.bestResult.strategyId ?? "momentum" : selectedView;
  const selectedProfile = traderProfiles.find((profile) => profile.id === selectedTrader) ?? traderProfiles[0];
  const selectedComparison = comparisons.find((comparison) => comparison.bestResult.strategyId === selectedTrader);
  const selectedOptimizationPlan = optimizationPlans.find((plan) => plan.strategyId === selectedTrader);
  const selectedMarketCandles = selectedMarket ? marketData.candlesByMarket[selectedMarket] ?? [] : [];
  const visibleCharts = useMemo(() => {
    if (selectedView === "summary") {
      return optimizationPlans
        .map((plan) => {
          const selected = plan.selectedMarkets[0];
          return {
          label: plan.strategyName,
            market: selected?.market,
            trades: selected?.bestResult.trades ?? [],
          };
        })
        .filter((item): item is { label: string; market: string; trades: Trade[] } => Boolean(item.market));
    }

    return (
      selectedOptimizationPlan?.selectedMarkets
        .map((item, index) => ({
          label: `Pick ${index + 1}`,
          market: item.market,
          trades: item.bestResult.trades,
        }))
        .filter((item) => Boolean(marketData.candlesByMarket[item.market])) ?? []
    );
  }, [marketData.candlesByMarket, optimizationPlans, selectedOptimizationPlan, selectedView]);
  const visibleMarketEntries = visibleCharts
    .map((item) => ({ ...item, candles: marketData.candlesByMarket[item.market] }))
    .filter((item) => item.candles?.length > 0);

  function openMarketModal(market: string, trades: Trade[] = []) {
    setSelectedMarket(market);
    setSelectedMarketTrades(trades);
    setModalInterval(chartInterval);
  }

  async function handleStrategyRefresh() {
    const response = await fetch("/api/strategy-refresh", { method: "POST" });
    const status = (await response.json()) as StrategyRefreshStatus;
    setRefreshStatus(status);
  }

  return (
    <main className="shell" data-theme={themeMode}>
      <header className="topbar">
        <div>
          <p className="eyebrow">Upbit KRW Simulation Lab</p>
          <h1>Crypto-Currency Trading</h1>
        </div>
        <div className="top-actions">
          <button
            className="theme-toggle"
            onClick={() => setThemeMode((current) => (current === "light" ? "dark" : "light"))}
            type="button"
          >
            {themeMode === "light" ? "Dark" : "Light"}
          </button>
          <button
            className="strategy-refresh-button"
            disabled={refreshStatus?.running}
            onClick={handleStrategyRefresh}
            type="button"
          >
            전략 재실행
          </button>
          <div className="status">
            <span>Mode</span>
            <strong>{marketData.isRealUpbitData ? "Upbit Cached" : "Sample Only"}</strong>
          </div>
        </div>
      </header>

      <section className="selector-panel" aria-label="Dashboard controls">
        <div className="control-field">
          <label htmlFor="dashboard-view">View</label>
          <select
            id="dashboard-view"
            value={selectedView}
            onChange={(event) => setSelectedView(event.target.value as DashboardView)}
          >
            <option value="summary">Summary</option>
            {traderProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </div>
        {selectedView === "summary" ? null : <GuideRuleControls mode={guideRuleMode} onChange={setGuideRuleMode} />}
      </section>

      {selectedView === "summary" ? (
        <SummaryView
          guideModeComparisons={guideModeComparisons}
          marketData={marketData}
          optimizationPlans={optimizationPlans}
          ranked={ranked}
        />
      ) : (
        <TraderView
          selectedComparison={selectedComparison}
          selectedOptimizationPlan={selectedOptimizationPlan}
          selectedProfile={selectedProfile}
        />
      )}

      <section className="panel watch-panel">
        <div className="section-head">
          <div>
            <div className="inline-title">
              <h2>{selectedView === "summary" ? "Trader Representative Charts" : "Selected Monitoring Charts"}</h2>
              <IntervalControls interval={chartInterval} onChange={setChartInterval} label="Chart period" compact />
            </div>
            <p>
              {selectedView === "summary"
                ? "One selected market per trader."
                : "The 12 monitoring markets selected for this trader."}
            </p>
          </div>
          <strong>{visibleMarketEntries.length} Charts</strong>
        </div>
        <div className="watch-grid" aria-label="Candidate symbols">
        {visibleMarketEntries.map(({ candles, label, market, trades }, index) => {
          const first = candles[0];
          const last = candles[candles.length - 1];
          const change = first && last ? (last.close - first.close) / first.close : 0;
          const aggregated = aggregateCandles(candles, chartInterval);
          return (
            <article
              className="symbol-card"
              key={`${label}-${market}-${index}`}
              onClick={() => openMarketModal(market, trades)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") openMarketModal(market, trades);
              }}
              role="button"
              tabIndex={0}
            >
              <div>
                <strong>{market}</strong>
                <span>{formatPct(change)}</span>
              </div>
              <small>{label}</small>
              <MarketChart
                candles={aggregated}
                interval={chartInterval}
                themeMode={themeMode}
                trades={trades}
                variant="mini"
              />
            </article>
          );
        })}
        </div>
      </section>

      {selectedMarket ? (
        <MarketChartModal
          candles={selectedMarketCandles}
          interval={modalInterval}
          market={selectedMarket}
          onClose={() => setSelectedMarket(null)}
          onIntervalChange={setModalInterval}
          themeMode={themeMode}
          trades={selectedMarketTrades}
        />
      ) : null}
      {refreshStatus?.running ? <RefreshOverlay status={refreshStatus} /> : null}
    </main>
  );
}

async function loadDashboardState(): Promise<[DashboardMarketData, DashboardResults | null]> {
  return Promise.all([loadDashboardMarketData(), loadDashboardResults()]);
}

async function loadRefreshStatus(): Promise<StrategyRefreshStatus | null> {
  try {
    const response = await fetch("/api/strategy-refresh/status", { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as StrategyRefreshStatus;
  } catch {
    return null;
  }
}

function RefreshOverlay({ status }: { status: StrategyRefreshStatus }) {
  return (
    <div className="refresh-overlay" role="status" aria-live="polite">
      <div className="refresh-dialog">
        <div className="section-head">
          <div>
            <p className="eyebrow">Strategy Refresh</p>
            <h2>전략 재실행 중</h2>
            <p>
              {status.stepIndex}/{status.totalSteps} - {status.stepLabel}
            </p>
          </div>
          <strong>{status.progress}%</strong>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${status.progress}%` }} />
        </div>
        <div className="refresh-log">
          {status.logs.slice(-8).map((line, index) => (
            <span key={`${line}-${index}`}>{line}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function SummaryView({
  guideModeComparisons,
  marketData,
  optimizationPlans,
  ranked,
}: {
  guideModeComparisons: StrategyGuideModeComparison[];
  marketData: DashboardMarketData;
  optimizationPlans: TraderOptimizationPlan[];
  ranked: StrategyComparison[];
}) {
  return (
    <>
      <section className="panel">
        <div className="section-head">
          <div>
            <h2>Strategy Summary</h2>
            <p>
              {marketData.isRealUpbitData
                ? `Upbit public ${marketData.source} candles. Generated: ${formatGeneratedAt(marketData.generatedAt)}`
                : "Sample data is active. Fetch Upbit public candles to run the same backtest engine on real KRW markets."}
            </p>
          </div>
          <strong>{ranked[0]?.strategyName ?? "TBD"}</strong>
        </div>
        <div className="table">
          <div className="row header">
            <span>Rank</span>
            <span>Strategy</span>
            <span>Scenario</span>
            <span>Best Market</span>
            <span>Return</span>
            <span>Max DD</span>
            <span>Trades</span>
          </div>
          {ranked.map((comparison, index) => (
            <div className="row" key={comparison.strategyName}>
              <span>{index + 1}</span>
              <span>{comparison.strategyName}</span>
              <span>{comparison.bestResult.scenarioName ?? comparison.bestResult.scenarioId}</span>
              <span>{comparison.bestResult.market}</span>
              <span className={comparison.bestResult.returnRate >= 0 ? "gain" : "loss"}>
                {formatPct(comparison.bestResult.returnRate)}
              </span>
              <span>{formatPct(comparison.bestResult.maxDrawdown)}</span>
              <span>{comparison.bestResult.tradeCount}</span>
            </div>
          ))}
        </div>
      </section>
      <GuideModeComparisonView guideModeComparisons={guideModeComparisons} />
      <OptimizationSummary optimizationPlans={optimizationPlans} />
    </>
  );
}

function TraderView({
  selectedComparison,
  selectedOptimizationPlan,
  selectedProfile,
}: {
  selectedComparison: StrategyComparison | undefined;
  selectedOptimizationPlan: TraderOptimizationPlan | undefined;
  selectedProfile: TraderProfile;
}) {
  const recentTrades = selectedComparison?.bestResult.trades.slice().reverse() ?? [];
  const [isOverviewOpen, setIsOverviewOpen] = useState(false);
  const [isSelectionOpen, setIsSelectionOpen] = useState(false);

  return (
    <>
      <CollapsiblePanel
        isOpen={isOverviewOpen}
        onToggle={() => setIsOverviewOpen((current) => !current)}
        title={`${selectedProfile.name} / Selected Trader Result`}
      >
        <section className="layout layout--inside">
          <article className="trader-panel">
            <h2>{selectedProfile.name}</h2>
            <p>{selectedProfile.summary}</p>
            <div className="split">
              <div>
                <h3>Strengths</h3>
                <ul>
                  {selectedProfile.strengths.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>Risks</h3>
                <ul>
                  {selectedProfile.risks.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </article>

          <article className="result-panel">
            <h2>Selected Trader Result</h2>
            {selectedComparison ? (
              <div className="metric-grid">
                <Metric label="Best market" value={selectedComparison.bestResult.market} />
                <Metric label="Scenario" value={selectedComparison.bestResult.scenarioName ?? selectedComparison.bestResult.scenarioId} />
                <Metric label="Final value" value={formatKrw(selectedComparison.bestResult.finalValue)} />
                <Metric label="Return" value={formatPct(selectedComparison.bestResult.returnRate)} />
                <Metric label="Max DD" value={formatPct(selectedComparison.bestResult.maxDrawdown)} />
                <Metric label="Win rate" value={formatPct(selectedComparison.bestResult.winRate)} />
                <Metric label="Trades" value={String(selectedComparison.bestResult.tradeCount)} />
                <Metric label="Profit factor" value={formatProfitFactor(selectedComparison.bestResult.profitFactor)} />
              </div>
            ) : null}
          </article>
        </section>
      </CollapsiblePanel>

      {selectedOptimizationPlan ? (
        <CollapsiblePanel
          isOpen={isSelectionOpen}
          onToggle={() => setIsSelectionOpen((current) => !current)}
          title="Trader Monitoring Selection"
        >
          <OptimizationPlanView plan={selectedOptimizationPlan} embedded />
        </CollapsiblePanel>
      ) : null}

      <section className="panel">
        <div className="section-head">
          <div>
            <h2>Recent Simulated Trades</h2>
            <p>Trades from the selected trader's best scenario and best market.</p>
          </div>
          <strong>{selectedComparison?.bestResult.market ?? "TBD"}</strong>
        </div>
        <div className="trade-list">
          <div className="trade-row header">
            <span>Time</span>
            <span>Side</span>
            <span>Price</span>
            <span>Quantity</span>
            <span>Reason</span>
          </div>
          {recentTrades.length > 0 ? (
            recentTrades.map((trade) => (
              <div className="trade-row" key={`${trade.timestamp}-${trade.side}-${trade.price}`}>
                <span>{formatTradeTime(trade.timestamp)}</span>
                <span className={trade.side === "buy" ? "gain" : "loss"}>{trade.side.toUpperCase()}</span>
                <span>{formatKrw(trade.price)}</span>
                <span>{trade.quantity.toFixed(6)}</span>
                <span>{trade.reasonCodes.join(", ")}</span>
              </div>
            ))
          ) : (
            <div className="empty-state">No simulated trades for this trader/scenario yet.</div>
          )}
        </div>
      </section>
    </>
  );
}

function OptimizationSummary({ optimizationPlans }: { optimizationPlans: TraderOptimizationPlan[] }) {
  return (
    <section className="panel">
      <div className="section-head">
        <div>
          <h2>Monitoring Selection Summary</h2>
          <p>Each trader optimizes scenarios per candidate market, then selects up to 12 monitoring markets.</p>
        </div>
        <strong>Top 30 -&gt; 12</strong>
      </div>
      <div className="optimization-grid">
        {optimizationPlans.map((plan) => (
          <article className="optimization-card" key={plan.strategyId}>
            <div>
              <strong>{plan.strategyName}</strong>
              <span>{plan.guideRuleMode}</span>
            </div>
            <p>
              Candidates {plan.candidateMarkets.length}/{plan.candidateMarketCount} - Selected{" "}
              {plan.selectedMarkets.length}/{plan.monitoringMarketCount}
            </p>
            <small>{plan.selectedMarkets.map((item) => item.market).join(", ") || "No selected markets"}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function CollapsiblePanel({
  children,
  isOpen,
  onToggle,
  title,
}: {
  children: ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  title: string;
}) {
  return (
    <section className="panel collapsible-panel">
      <button className="collapsible-trigger" onClick={onToggle} type="button">
        <span>{title}</span>
        <strong>{isOpen ? "접기" : "펼치기"}</strong>
      </button>
      {isOpen ? <div className="collapsible-content">{children}</div> : null}
    </section>
  );
}

function OptimizationPlanView({ embedded = false, plan }: { embedded?: boolean; plan: TraderOptimizationPlan }) {
  return (
    <section className={embedded ? "embedded-panel" : "panel"}>
      <div className="section-head">
        <div>
          <h2>Trader Monitoring Selection</h2>
          <p>
            Candidate markets are ranked by recent trade value, then each market is optimized against this trader's
            scenarios.
          </p>
        </div>
        <strong>
          {plan.guideRuleMode} - {plan.selectedMarkets.length}/{plan.monitoringMarketCount}
        </strong>
      </div>
      <div className="optimization-table">
        <div className="optimization-row header">
          <span>Pick</span>
          <span>Market</span>
          <span>Candidate</span>
          <span>Scenario</span>
          <span>Return</span>
          <span>Max DD</span>
          <span>Rejected</span>
        </div>
        {plan.selectedMarkets.map((item, index) => (
          <div className="optimization-row" key={item.market}>
            <span>{index + 1}</span>
            <span>{item.market}</span>
            <span>#{item.candidateRank}</span>
            <span>{item.bestResult.scenarioName ?? item.bestResult.scenarioId}</span>
            <span className={item.bestResult.returnRate >= 0 ? "gain" : "loss"}>
              {formatPct(item.bestResult.returnRate)}
            </span>
            <span>{formatPct(item.bestResult.maxDrawdown)}</span>
            <span>{item.bestResult.guideRejectedSignals}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function GuideModeComparisonView({
  guideModeComparisons,
}: {
  guideModeComparisons: StrategyGuideModeComparison[];
}) {
  return (
    <section className="panel">
      <div className="section-head">
        <div>
          <h2>Guide Rule Split</h2>
          <p>Each trader is backtested in strict and ignored modes, so the rule filter impact is visible.</p>
        </div>
        <strong>Strict / Ignored</strong>
      </div>
      <div className="guide-table">
        <div className="guide-row header">
          <span>Strategy</span>
          <span>Best mode</span>
          <span>Strict return</span>
          <span>Strict rejected</span>
          <span>Ignored return</span>
          <span>Delta</span>
          <span>Trades</span>
        </div>
        {guideModeComparisons.map((comparison) => {
          const strict = comparison.strict.bestResult;
          const ignored = comparison.ignored.bestResult;
          const delta = strict.returnRate - ignored.returnRate;

          return (
            <div className="guide-row" key={comparison.strategyName}>
              <span>{comparison.strategyName}</span>
              <span>{comparison.bestMode}</span>
              <span className={strict.returnRate >= 0 ? "gain" : "loss"}>{formatPct(strict.returnRate)}</span>
              <span>{strict.guideRejectedSignals}</span>
              <span className={ignored.returnRate >= 0 ? "gain" : "loss"}>{formatPct(ignored.returnRate)}</span>
              <span className={delta >= 0 ? "gain" : "loss"}>{formatPct(delta)}</span>
              <span>
                {strict.tradeCount} / {ignored.tradeCount}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MarketChartModal({
  candles,
  interval,
  market,
  onClose,
  onIntervalChange,
  themeMode,
  trades,
}: {
  candles: Candle[];
  interval: ChartInterval;
  market: string;
  onClose: () => void;
  onIntervalChange: (interval: ChartInterval) => void;
  themeMode: ThemeMode;
  trades: Trade[];
}) {
  const aggregated = useMemo(() => aggregateCandles(candles, interval), [candles, interval]);
  const first = candles[0];
  const last = candles[candles.length - 1];
  const change = first && last ? (last.close - first.close) / first.close : 0;

  return (
    <div className="chart-modal-backdrop" onClick={onClose} role="presentation">
      <section className="chart-modal" onClick={(event) => event.stopPropagation()}>
        <div className="chart-modal-head">
          <div>
            <p className="eyebrow">Market Detail</p>
            <h2>{market}</h2>
          </div>
          <div className="chart-modal-actions">
            <IntervalControls interval={interval} onChange={onIntervalChange} label="Large chart" />
            <div className="status compact">
              <span>Change</span>
              <strong className={change >= 0 ? "gain" : "loss"}>{formatPct(change)}</strong>
            </div>
            <button className="icon-button" onClick={onClose} type="button" aria-label="Close chart">
              X
            </button>
          </div>
        </div>
        <MarketChart candles={aggregated} interval={interval} themeMode={themeMode} trades={trades} variant="large" />
      </section>
    </div>
  );
}

function IntervalControls({
  compact = false,
  interval,
  label,
  onChange,
}: {
  compact?: boolean;
  interval: ChartInterval;
  label: string;
  onChange: (interval: ChartInterval) => void;
}) {
  const normalized = normalizeChartInterval(interval);
  const selectedPreset = chartIntervalPresets.find((preset) => isSameInterval(preset.interval, normalized));

  return (
    <div className={compact ? "interval-controls interval-controls--compact" : "interval-controls"}>
      <label>{label}</label>
      <select
        aria-label={`${label} interval preset`}
        onChange={(event) => {
          const preset = chartIntervalPresets.find((item) => item.value === event.target.value);
          if (preset) onChange(preset.interval);
        }}
        value={selectedPreset?.value ?? "5m"}
      >
        {chartIntervalPresets.map((preset) => (
          <option key={preset.value} value={preset.value}>
            {preset.label} / {preset.windowLabel}
          </option>
        ))}
      </select>
    </div>
  );
}

function isSameInterval(a: ChartInterval, b: ChartInterval) {
  return a.value === b.value && a.unit === b.unit;
}

function GuideRuleControls({
  mode,
  onChange,
}: {
  mode: GuideRuleMode;
  onChange: (mode: GuideRuleMode) => void;
}) {
  return (
    <div className="control-field">
      <label htmlFor="guide-rule-mode">Guide rules</label>
      <select id="guide-rule-mode" onChange={(event) => onChange(event.target.value as GuideRuleMode)} value={mode}>
        <option value="strict">strict</option>
        <option value="ignored">ignored</option>
      </select>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatGeneratedAt(value: string) {
  if (!value) return "N/A";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(value));
}

function formatTradeTime(timestamp: number) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatProfitFactor(value: number) {
  if (!Number.isFinite(value)) return "Infinite";
  return value.toFixed(2);
}
