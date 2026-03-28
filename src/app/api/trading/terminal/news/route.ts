import { NextResponse, NextRequest } from "next/server";

export const dynamic = "force-dynamic";

interface NewsItem {
  id: string;
  headline: string;
  summary: string;
  source: string;
  timestamp: string;
  symbols: string[];
  sentiment: "positive" | "negative" | "neutral";
}

const MOCK_NEWS: NewsItem[] = [
  {
    id: "1",
    headline: "Fed Holds Rates Steady, Signals Patience on Cuts",
    summary:
      "The Federal Reserve kept interest rates unchanged and signaled it is in no rush to cut, citing persistent inflation above its 2% target. Chair Powell noted the economy remains resilient.",
    source: "Reuters",
    timestamp: new Date(Date.now() - 1800000).toISOString(),
    symbols: ["SPY", "QQQ", "TLT"],
    sentiment: "neutral",
  },
  {
    id: "2",
    headline: "NVIDIA Beats Earnings, Data Center Revenue Surges 120%",
    summary:
      "NVIDIA reported Q4 earnings well above estimates with data center revenue hitting $18.4B. CEO Jensen Huang highlighted accelerating demand for AI inference chips.",
    source: "Bloomberg",
    timestamp: new Date(Date.now() - 3600000).toISOString(),
    symbols: ["NVDA", "QQQ", "SPY"],
    sentiment: "positive",
  },
  {
    id: "3",
    headline: "Bitcoin Surges Past $90K on ETF Inflows",
    summary:
      "Bitcoin climbed above $90,000 for the first time as spot ETF inflows topped $1.2B in a single day. BlackRock's IBIT led with $680M in net purchases.",
    source: "CoinDesk",
    timestamp: new Date(Date.now() - 5400000).toISOString(),
    symbols: ["BTC", "ETH"],
    sentiment: "positive",
  },
  {
    id: "4",
    headline: "Tesla Deliveries Miss Estimates, Stock Drops 5%",
    summary:
      "Tesla delivered 387,000 vehicles in Q1, below analyst expectations of 410,000. Competition from Chinese EV makers and weakening European demand weighed on results.",
    source: "CNBC",
    timestamp: new Date(Date.now() - 7200000).toISOString(),
    symbols: ["TSLA", "SPY"],
    sentiment: "negative",
  },
  {
    id: "5",
    headline: "Apple Announces $100B Buyback, Largest in History",
    summary:
      "Apple authorized a record $100 billion share repurchase program and raised its dividend by 4%. Services revenue grew 14% YoY to $23.9B.",
    source: "WSJ",
    timestamp: new Date(Date.now() - 9000000).toISOString(),
    symbols: ["AAPL", "QQQ", "SPY"],
    sentiment: "positive",
  },
  {
    id: "6",
    headline: "Gold Hits All-Time High on Geopolitical Tensions",
    summary:
      "Gold futures surged to $2,450/oz as escalating tensions in the Middle East drove safe-haven demand. Central bank buying remained elevated for a third consecutive quarter.",
    source: "Financial Times",
    timestamp: new Date(Date.now() - 10800000).toISOString(),
    symbols: ["GLD"],
    sentiment: "positive",
  },
  {
    id: "7",
    headline: "Microsoft Cloud Revenue Tops $35B, AI Integration Accelerates",
    summary:
      "Microsoft reported Azure revenue growth of 31%, driven by AI workloads. CEO Nadella said Copilot adoption is exceeding internal projections across enterprise customers.",
    source: "Reuters",
    timestamp: new Date(Date.now() - 14400000).toISOString(),
    symbols: ["MSFT", "QQQ"],
    sentiment: "positive",
  },
  {
    id: "8",
    headline: "Ethereum Shanghai Upgrade Boosts Staking Activity",
    summary:
      "Ethereum staking deposits surged following the successful Shanghai upgrade, with over 500,000 ETH staked in the past week. Network validators now exceed 800,000.",
    source: "The Block",
    timestamp: new Date(Date.now() - 18000000).toISOString(),
    symbols: ["ETH", "SOL"],
    sentiment: "positive",
  },
  {
    id: "9",
    headline: "Small Caps Rally as IWM Breaks Above 200-Day MA",
    summary:
      "The Russell 2000 index broke above its 200-day moving average for the first time in months, signaling improved breadth. Regional banks led the advance.",
    source: "MarketWatch",
    timestamp: new Date(Date.now() - 21600000).toISOString(),
    symbols: ["IWM", "SPY"],
    sentiment: "positive",
  },
  {
    id: "10",
    headline: "VIX Drops Below 14 as Market Complacency Grows",
    summary:
      "The CBOE Volatility Index fell to its lowest level since January 2020, raising concerns about market complacency. Options strategists note put skew remains historically low.",
    source: "Barron's",
    timestamp: new Date(Date.now() - 25200000).toISOString(),
    symbols: ["VIX", "SPY"],
    sentiment: "neutral",
  },
  {
    id: "11",
    headline: "Solana TVL Hits $12B as DeFi Activity Surges",
    summary:
      "Solana's total value locked reached a new all-time high of $12B, driven by memecoin trading and Jupiter DEX volumes exceeding Uniswap for the second consecutive week.",
    source: "DeFi Llama",
    timestamp: new Date(Date.now() - 28800000).toISOString(),
    symbols: ["SOL", "ETH"],
    sentiment: "positive",
  },
  {
    id: "12",
    headline: "Treasury Yields Fall as Bond Market Signals Recession Risk",
    summary:
      "The 10-year Treasury yield dropped 12bps to 4.15% as weak manufacturing data reignited recession fears. The 2s10s curve remains inverted at -25bps.",
    source: "Bloomberg",
    timestamp: new Date(Date.now() - 32400000).toISOString(),
    symbols: ["TLT", "SPY"],
    sentiment: "negative",
  },
];

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol");

  let news = MOCK_NEWS;
  if (symbol) {
    news = MOCK_NEWS.filter((n) => n.symbols.includes(symbol));
  }

  return NextResponse.json(news);
}
