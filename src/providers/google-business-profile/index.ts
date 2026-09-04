/**
 * Google Meu Negocio / Business Profile (Performance API).
 *
 * Pre-requisito que NAO e codigo: o acesso as APIs do Business Profile nao vem
 * junto com a criacao do projeto no Google Cloud. E preciso preencher o
 * formulario de solicitacao ("Business Profile APIs access request") e aguardar
 * aprovacao manual. Ate la, as chamadas voltam 403 PERMISSION_DENIED.
 *
 * Tres APIs diferentes participam:
 *   - Account Management: lista as contas.
 *   - Business Information: lista as fichas (locations) de cada conta.
 *   - Business Profile Performance: entrega as metricas diarias.
 */

import { getJson } from "../http";
import type {
  ExternalAccount,
  ListAccountsContext,
  MetricPoint,
  MetricProvider,
  SyncContext,
} from "../types";

const ACCOUNT_API = "https://mybusinessaccountmanagement.googleapis.com/v1";
const INFO_API = "https://mybusinessbusinessinformation.googleapis.com/v1";
const PERFORMANCE_API = "https://businessprofileperformance.googleapis.com/v1";

interface AccountsResponse {
  accounts?: Array<{ name?: string; accountName?: string }>;
  nextPageToken?: string;
}

interface LocationsResponse {
  locations?: Array<{
    name?: string; // "locations/123456"
    title?: string;
    storefrontAddress?: { locality?: string; administrativeArea?: string };
  }>;
  nextPageToken?: string;
}

interface DatedValue {
  date?: { year?: number; month?: number; day?: number };
  value?: string;
}

interface MultiDailyMetricsResponse {
  multiDailyMetricTimeSeries?: Array<{
    dailyMetricTimeSeries?: Array<{
      dailyMetric?: string;
      timeSeries?: { datedValues?: DatedValue[] };
    }>;
  }>;
}

/**
 * Metricas da API -> chaves internas.
 * As impressoes vem quebradas em quatro (busca/mapas x desktop/mobile);
 * mantemos as quatro e derivamos o total, porque a divisao entre Busca e Maps
 * e uma das informacoes mais uteis do relatorio local.
 */
const DAILY_METRICS: Record<string, string> = {
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: "impressionsDesktopSearch",
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: "impressionsDesktopMaps",
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH: "impressionsMobileSearch",
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: "impressionsMobileMaps",
  BUSINESS_CONVERSATIONS: "conversations",
  BUSINESS_DIRECTION_REQUESTS: "directionRequests",
  CALL_CLICKS: "callClicks",
  WEBSITE_CLICKS: "websiteClicks",
  BUSINESS_BOOKINGS: "bookings",
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function datedValueToIso(date: DatedValue["date"]): string | null {
  if (!date?.year || !date.month || !date.day) return null;
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

export const googleBusinessProfileProvider: MetricProvider = {
  id: "google_business_profile",
  name: "Google Meu Negocio",
  family: "google",
  brandColor: "#1A73E8",
  availability: "needs_api_approval",
  approvalNote:
    "Exige solicitacao manual de acesso as Business Profile APIs no Google Cloud. A aprovacao costuma levar semanas.",
  scopes: ["https://www.googleapis.com/auth/business.manage"],

  metrics: [
    {
      key: "impressionsDesktopSearch",
      label: "Impressoes - Busca (desktop)",
      format: "integer",
      aggregation: "sum",
      higherIsBetter: true,
    },
    {
      key: "impressionsMobileSearch",
      label: "Impressoes - Busca (celular)",
      format: "integer",
      aggregation: "sum",
      higherIsBetter: true,
    },
    {
      key: "impressionsDesktopMaps",
      label: "Impressoes - Maps (desktop)",
      format: "integer",
      aggregation: "sum",
      higherIsBetter: true,
    },
    {
      key: "impressionsMobileMaps",
      label: "Impressoes - Maps (celular)",
      format: "integer",
      aggregation: "sum",
      higherIsBetter: true,
    },
    {
      key: "impressionsTotal",
      label: "Impressoes totais",
      format: "integer",
      aggregation: "sum",
      higherIsBetter: true,
      description: "Derivada: soma das quatro origens de impressao.",
    },
    {
      key: "callClicks",
      label: "Cliques para ligar",
      format: "integer",
      aggregation: "sum",
      higherIsBetter: true,
    },
    {
      key: "websiteClicks",
      label: "Cliques no site",
      format: "integer",
      aggregation: "sum",
      higherIsBetter: true,
    },
    {
      key: "directionRequests",
      label: "Pedidos de rota",
      format: "integer",
      aggregation: "sum",
      higherIsBetter: true,
    },
    {
      key: "conversations",
      label: "Mensagens",
      format: "integer",
      aggregation: "sum",
      higherIsBetter: true,
    },
    {
      key: "bookings",
      label: "Agendamentos",
      format: "integer",
      aggregation: "sum",
      higherIsBetter: true,
    },
    {
      key: "actionsTotal",
      label: "Interacoes totais",
      format: "integer",
      aggregation: "sum",
      higherIsBetter: true,
      description:
        "Derivada: ligacoes + cliques no site + rotas + mensagens + agendamentos.",
    },
    {
      key: "actionRate",
      label: "Taxa de interacao",
      format: "percent",
      aggregation: "ratio",
      higherIsBetter: true,
      ratioOf: {
        numerator: "actionsTotal",
        denominator: "impressionsTotal",
        multiplier: 100,
      },
    },
  ],

  dimensions: [],

  defaultBlocks: [
    {
      type: "kpi_row",
      title: "Presenca local",
      config: {
        metrics: [
          "impressionsTotal",
          "callClicks",
          "directionRequests",
          "websiteClicks",
        ],
      },
    },
    {
      type: "time_series",
      title: "Impressoes por dia",
      config: { metrics: ["impressionsTotal"] },
    },
    {
      type: "comparison",
      title: "Busca x Maps",
      config: {
        metrics: [
          "impressionsDesktopSearch",
          "impressionsMobileSearch",
          "impressionsDesktopMaps",
          "impressionsMobileMaps",
        ],
      },
    },
  ],

  async listAccounts({ accessToken, log }: ListAccountsContext): Promise<ExternalAccount[]> {
    const accounts = await getJson<AccountsResponse>(
      `${ACCOUNT_API}/accounts?pageSize=100`,
      accessToken,
      "GBP accounts",
    );

    const result: ExternalAccount[] = [];

    for (const account of accounts.accounts ?? []) {
      if (!account.name) continue;

      let pageToken: string | undefined;
      do {
        const url = new URL(`${INFO_API}/${account.name}/locations`);
        url.searchParams.set("readMask", "name,title,storefrontAddress");
        url.searchParams.set("pageSize", "100");
        if (pageToken) url.searchParams.set("pageToken", pageToken);

        try {
          const locations = await getJson<LocationsResponse>(
            url.toString(),
            accessToken,
            "GBP locations",
          );

          for (const location of locations.locations ?? []) {
            const locationId = location.name?.split("/").pop();
            if (!locationId) continue;

            const city = location.storefrontAddress?.locality;
            result.push({
              externalId: locationId,
              name: city
                ? `${location.title ?? locationId} - ${city}`
                : (location.title ?? locationId),
              group: account.accountName ?? undefined,
              selectable: true,
            });
          }

          pageToken = locations.nextPageToken;
        } catch (error) {
          log.warn(`GBP: falha ao listar fichas de ${account.name}`, error);
          pageToken = undefined;
        }
      } while (pageToken);
    }

    return result;
  },

  async sync(ctx: SyncContext): Promise<MetricPoint[]> {
    const { accessToken, connection, rangeStart, rangeEnd, log } = ctx;
    const [startYear, startMonth, startDay] = rangeStart.split("-").map(Number);
    const [endYear, endMonth, endDay] = rangeEnd.split("-").map(Number);

    const url = new URL(
      `${PERFORMANCE_API}/locations/${connection.externalId}:fetchMultiDailyMetricsTimeSeries`,
    );
    for (const apiMetric of Object.keys(DAILY_METRICS)) {
      url.searchParams.append("dailyMetrics", apiMetric);
    }
    url.searchParams.set("dailyRange.start_date.year", String(startYear));
    url.searchParams.set("dailyRange.start_date.month", String(startMonth));
    url.searchParams.set("dailyRange.start_date.day", String(startDay));
    url.searchParams.set("dailyRange.end_date.year", String(endYear));
    url.searchParams.set("dailyRange.end_date.month", String(endMonth));
    url.searchParams.set("dailyRange.end_date.day", String(endDay));

    const data = await getJson<MultiDailyMetricsResponse>(
      url.toString(),
      accessToken,
      "GBP fetchMultiDailyMetricsTimeSeries",
    );

    const points: MetricPoint[] = [];
    const impressionsByDate = new Map<string, number>();
    const actionsByDate = new Map<string, number>();

    const IMPRESSION_KEYS = new Set([
      "impressionsDesktopSearch",
      "impressionsDesktopMaps",
      "impressionsMobileSearch",
      "impressionsMobileMaps",
    ]);
    const ACTION_KEYS = new Set([
      "callClicks",
      "websiteClicks",
      "directionRequests",
      "conversations",
      "bookings",
    ]);

    for (const group of data.multiDailyMetricTimeSeries ?? []) {
      for (const series of group.dailyMetricTimeSeries ?? []) {
        const metric = DAILY_METRICS[series.dailyMetric ?? ""];
        if (!metric) continue;

        for (const dated of series.timeSeries?.datedValues ?? []) {
          const date = datedValueToIso(dated.date);
          if (!date) continue;

          // A API omite `value` quando o dia teve zero.
          const value = Number(dated.value ?? 0);
          points.push({ date, metric, value });

          if (IMPRESSION_KEYS.has(metric)) {
            impressionsByDate.set(
              date,
              (impressionsByDate.get(date) ?? 0) + value,
            );
          }
          if (ACTION_KEYS.has(metric)) {
            actionsByDate.set(date, (actionsByDate.get(date) ?? 0) + value);
          }
        }
      }
    }

    for (const [date, value] of impressionsByDate) {
      points.push({ date, metric: "impressionsTotal", value });
    }
    for (const [date, value] of actionsByDate) {
      points.push({ date, metric: "actionsTotal", value });
    }

    log.info(`Meu Negocio: ${points.length} pontos coletados`, {
      locationId: connection.externalId,
    });
    return points;
  },
};
