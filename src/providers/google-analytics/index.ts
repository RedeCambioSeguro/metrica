/**
 * Google Analytics 4 (Data API v1beta + Admin API v1beta).
 *
 * Este e o provider de referencia: e o mais rapido de liberar no Google e serve
 * de modelo para os demais. Leia-o antes de escrever um provider novo.
 *
 * Decisao importante sobre metricas de razao
 * ------------------------------------------
 * Taxa de rejeicao e tempo medio nao podem ser somados nem tirados a media
 * simples entre dias - dariam numeros errados no relatorio mensal. Em vez de
 * gravar a razao pronta, gravamos os COMPONENTES somaveis (sessoes,
 * sessoes engajadas, segundos de engajamento) e a razao e recalculada no
 * periodo. Ver `ratioOf` nas definicoes abaixo.
 */

import { getJson, postJson } from "../http";
import type {
  ExternalAccount,
  ListAccountsContext,
  MetricPoint,
  MetricProvider,
  SyncContext,
} from "../types";

const ADMIN_API = "https://analyticsadmin.googleapis.com/v1beta";
const DATA_API = "https://analyticsdata.googleapis.com/v1beta";

// --------------------------------------------------------------------------
// Tipos da resposta da API
// --------------------------------------------------------------------------

interface AccountSummariesResponse {
  accountSummaries?: Array<{
    account?: string;
    displayName?: string;
    propertySummaries?: Array<{
      property?: string; // "properties/123456789"
      displayName?: string;
      propertyType?: string;
    }>;
  }>;
  nextPageToken?: string;
}

interface RunReportResponse {
  dimensionHeaders?: Array<{ name: string }>;
  metricHeaders?: Array<{ name: string; type?: string }>;
  rows?: Array<{
    dimensionValues?: Array<{ value?: string }>;
    metricValues?: Array<{ value?: string }>;
  }>;
  rowCount?: number;
}

// --------------------------------------------------------------------------
// Chamada base
// --------------------------------------------------------------------------

interface ReportRequest {
  propertyId: string;
  accessToken: string;
  startDate: string;
  endDate: string;
  dimensions: string[];
  metrics: string[];
  limit?: number;
}

/**
 * Roda um runReport paginando ate o fim. A API devolve no maximo `limit` linhas
 * por chamada, e um recorte por dia + dimensao passa de 10 mil linhas com
 * facilidade em conta grande.
 */
async function runReport(req: ReportRequest): Promise<RunReportResponse> {
  const pageSize = req.limit ?? 10_000;
  const merged: RunReportResponse = { rows: [] };
  let offset = 0;

  for (;;) {
    const page = await postJson<RunReportResponse>(
      `${DATA_API}/properties/${encodeURIComponent(req.propertyId)}:runReport`,
      req.accessToken,
      {
        dateRanges: [{ startDate: req.startDate, endDate: req.endDate }],
        dimensions: req.dimensions.map((name) => ({ name })),
        metrics: req.metrics.map((name) => ({ name })),
        limit: pageSize,
        offset,
        keepEmptyRows: false,
      },
      `GA4 runReport (${req.dimensions.join("+")})`,
    );

    merged.dimensionHeaders ??= page.dimensionHeaders;
    merged.metricHeaders ??= page.metricHeaders;
    merged.rows!.push(...(page.rows ?? []));

    const total = page.rowCount ?? merged.rows!.length;
    offset += pageSize;
    if (merged.rows!.length >= total || !page.rows?.length) break;
  }

  return merged;
}

/** GA4 devolve a dimensao `date` como "20240131". */
function parseGaDate(raw: string): string {
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  return raw;
}

function toNumber(raw: string | undefined): number {
  const n = Number(raw ?? "0");
  return Number.isFinite(n) ? n : 0;
}

/**
 * Converte as linhas do runReport em MetricPoint.
 * Assume que a PRIMEIRA dimensao e sempre `date`.
 */
function rowsToPoints(
  response: RunReportResponse,
  metricNames: string[],
  extraDimensionKeys: string[],
  rename: Record<string, string> = {},
): MetricPoint[] {
  const points: MetricPoint[] = [];

  for (const row of response.rows ?? []) {
    const dimValues = row.dimensionValues ?? [];
    const date = parseGaDate(dimValues[0]?.value ?? "");
    if (!date) continue;

    let dimensions: Record<string, string> | undefined;
    if (extraDimensionKeys.length) {
      dimensions = {};
      extraDimensionKeys.forEach((key, i) => {
        dimensions![key] = dimValues[i + 1]?.value ?? "(nao definido)";
      });
    }

    metricNames.forEach((apiName, i) => {
      points.push({
        date,
        metric: rename[apiName] ?? apiName,
        value: toNumber(row.metricValues?.[i]?.value),
        dimensions,
      });
    });
  }

  return points;
}

/**
 * Corta dimensoes de alta cardinalidade no top-N de cada dia.
 * Sem isso, uma conta com 40 mil URLs geraria 40 mil linhas por dia no banco.
 */
function topNPerDay(
  points: MetricPoint[],
  rankMetric: string,
  n: number,
): MetricPoint[] {
  const byDate = new Map<string, MetricPoint[]>();
  for (const p of points) {
    if (p.metric !== rankMetric) continue;
    const list = byDate.get(p.date) ?? [];
    list.push(p);
    byDate.set(p.date, list);
  }

  const kept: MetricPoint[] = [];
  for (const list of byDate.values()) {
    list.sort((a, b) => b.value - a.value);
    kept.push(...list.slice(0, n));
  }
  return kept;
}

// --------------------------------------------------------------------------
// Provider
// --------------------------------------------------------------------------

export const googleAnalyticsProvider: MetricProvider = {
  id: "google_analytics",
  name: "Google Analytics 4",
  family: "google",
  brandColor: "#E8710A",
  availability: "ready",
  scopes: ["https://www.googleapis.com/auth/analytics.readonly"],

  metrics: [
    {
      key: "sessions",
      label: "Sessoes",
      format: "integer",
      aggregation: "sum",
      higherIsBetter: true,
    },
    {
      key: "totalUsers",
      label: "Usuarios",
      format: "integer",
      aggregation: "unique",
      higherIsBetter: true,
      description:
        "Usuarios unicos. Somar os dias superestima o total do periodo.",
    },
    {
      key: "newUsers",
      label: "Novos usuarios",
      format: "integer",
      aggregation: "sum",
      higherIsBetter: true,
    },
    {
      key: "screenPageViews",
      label: "Visualizacoes de pagina",
      format: "integer",
      aggregation: "sum",
      higherIsBetter: true,
    },
    {
      key: "engagedSessions",
      label: "Sessoes engajadas",
      format: "integer",
      aggregation: "sum",
      higherIsBetter: true,
    },
    {
      key: "bouncedSessions",
      label: "Sessoes com rejeicao",
      format: "integer",
      aggregation: "sum",
      higherIsBetter: false,
      description: "Derivada: sessoes - sessoes engajadas.",
    },
    {
      key: "userEngagementDuration",
      label: "Tempo de engajamento (total)",
      format: "duration",
      aggregation: "sum",
      higherIsBetter: true,
    },
    {
      key: "eventCount",
      label: "Eventos",
      format: "integer",
      aggregation: "sum",
      higherIsBetter: true,
    },
    {
      key: "keyEvents",
      label: "Principais eventos (conversoes)",
      format: "integer",
      aggregation: "sum",
      higherIsBetter: true,
    },
    // --- Metricas de razao: calculadas, nunca gravadas ---
    {
      key: "engagementRate",
      label: "Taxa de engajamento",
      format: "percent",
      aggregation: "ratio",
      higherIsBetter: true,
      ratioOf: {
        numerator: "engagedSessions",
        denominator: "sessions",
        multiplier: 100,
      },
    },
    {
      key: "bounceRate",
      label: "Taxa de rejeicao",
      format: "percent",
      aggregation: "ratio",
      higherIsBetter: false,
      ratioOf: {
        numerator: "bouncedSessions",
        denominator: "sessions",
        multiplier: 100,
      },
    },
    {
      key: "averageEngagementTime",
      label: "Tempo medio de engajamento",
      format: "duration",
      aggregation: "ratio",
      higherIsBetter: true,
      ratioOf: {
        numerator: "userEngagementDuration",
        denominator: "sessions",
      },
    },
    {
      key: "pagesPerSession",
      label: "Paginas por sessao",
      format: "decimal",
      aggregation: "ratio",
      higherIsBetter: true,
      ratioOf: {
        numerator: "screenPageViews",
        denominator: "sessions",
      },
    },
  ],

  dimensions: [
    { key: "channel", label: "Canal" },
    { key: "device", label: "Dispositivo" },
    { key: "sourceMedium", label: "Origem / midia", topNPerDay: 25 },
    { key: "pagePath", label: "Pagina", topNPerDay: 25 },
  ],

  defaultBlocks: [
    {
      type: "kpi_row",
      title: "Visao geral",
      config: {
        metrics: [
          "sessions",
          "totalUsers",
          "engagementRate",
          "keyEvents",
        ],
      },
    },
    {
      type: "time_series",
      title: "Sessoes por dia",
      config: { metrics: ["sessions", "totalUsers"] },
    },
    {
      type: "donut",
      title: "Sessoes por canal",
      config: { metric: "sessions", dimension: "channel", limit: 8 },
    },
    {
      type: "table",
      title: "Paginas mais acessadas",
      config: {
        dimension: "pagePath",
        metrics: ["screenPageViews", "sessions"],
        limit: 15,
        sortBy: "screenPageViews",
      },
    },
  ],

  async listAccounts({ accessToken }: ListAccountsContext): Promise<ExternalAccount[]> {
    const accounts: ExternalAccount[] = [];
    let pageToken: string | undefined;

    do {
      const url = new URL(`${ADMIN_API}/accountSummaries`);
      url.searchParams.set("pageSize", "200");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const data = await getJson<AccountSummariesResponse>(
        url.toString(),
        accessToken,
        "GA4 accountSummaries",
      );

      for (const summary of data.accountSummaries ?? []) {
        for (const property of summary.propertySummaries ?? []) {
          // property vem como "properties/123456789"
          const externalId = property.property?.split("/").pop();
          if (!externalId) continue;

          accounts.push({
            externalId,
            name: property.displayName ?? `Propriedade ${externalId}`,
            group: summary.displayName ?? undefined,
            selectable: true,
          });
        }
      }

      pageToken = data.nextPageToken;
    } while (pageToken);

    return accounts;
  },

  async sync(ctx: SyncContext): Promise<MetricPoint[]> {
    const { accessToken, connection, rangeStart, rangeEnd, log } = ctx;
    const propertyId = connection.externalId;
    const points: MetricPoint[] = [];

    // 1) Metricas gerais por dia (todas somaveis).
    const coreMetrics = [
      "sessions",
      "totalUsers",
      "newUsers",
      "screenPageViews",
      "engagedSessions",
      "userEngagementDuration",
      "eventCount",
    ];

    const core = await runReport({
      propertyId,
      accessToken,
      startDate: rangeStart,
      endDate: rangeEnd,
      dimensions: ["date"],
      metrics: coreMetrics,
    });

    const corePoints = rowsToPoints(core, coreMetrics, []);
    points.push(...corePoints);

    // Deriva bouncedSessions = sessions - engagedSessions, para que a taxa de
    // rejeicao do periodo saia exata em vez de media de medias.
    const sessionsByDate = new Map<string, number>();
    const engagedByDate = new Map<string, number>();
    for (const p of corePoints) {
      if (p.dimensions) continue;
      if (p.metric === "sessions") sessionsByDate.set(p.date, p.value);
      if (p.metric === "engagedSessions") engagedByDate.set(p.date, p.value);
    }
    for (const [date, sessions] of sessionsByDate) {
      points.push({
        date,
        metric: "bouncedSessions",
        value: Math.max(0, sessions - (engagedByDate.get(date) ?? 0)),
      });
    }

    // 2) keyEvents em chamada separada: propriedades antigas ainda usam
    //    `conversions`, e um nome invalido derruba o relatorio inteiro.
    try {
      const keyEvents = await runReport({
        propertyId,
        accessToken,
        startDate: rangeStart,
        endDate: rangeEnd,
        dimensions: ["date"],
        metrics: ["keyEvents"],
      });
      points.push(...rowsToPoints(keyEvents, ["keyEvents"], []));
    } catch (error) {
      log.warn("GA4: keyEvents indisponivel, tentando `conversions`", error);
      try {
        const legacy = await runReport({
          propertyId,
          accessToken,
          startDate: rangeStart,
          endDate: rangeEnd,
          dimensions: ["date"],
          metrics: ["conversions"],
        });
        points.push(
          ...rowsToPoints(legacy, ["conversions"], [], {
            conversions: "keyEvents",
          }),
        );
      } catch (fallbackError) {
        log.warn("GA4: propriedade sem metrica de conversao", fallbackError);
      }
    }

    // 3) Sessoes por canal (baixa cardinalidade, grava tudo).
    const byChannel = await runReport({
      propertyId,
      accessToken,
      startDate: rangeStart,
      endDate: rangeEnd,
      dimensions: ["date", "sessionDefaultChannelGroup"],
      metrics: ["sessions", "engagedSessions", "newUsers"],
    });
    points.push(
      ...rowsToPoints(
        byChannel,
        ["sessions", "engagedSessions", "newUsers"],
        ["channel"],
      ),
    );

    // 4) Sessoes por dispositivo.
    const byDevice = await runReport({
      propertyId,
      accessToken,
      startDate: rangeStart,
      endDate: rangeEnd,
      dimensions: ["date", "deviceCategory"],
      metrics: ["sessions"],
    });
    points.push(...rowsToPoints(byDevice, ["sessions"], ["device"]));

    // 5) Paginas: alta cardinalidade, so o top 25 de cada dia.
    const byPage = await runReport({
      propertyId,
      accessToken,
      startDate: rangeStart,
      endDate: rangeEnd,
      dimensions: ["date", "pagePath"],
      metrics: ["screenPageViews"],
    });
    points.push(
      ...topNPerDay(
        rowsToPoints(byPage, ["screenPageViews"], ["pagePath"]),
        "screenPageViews",
        25,
      ),
    );

    // 6) Origem / midia: idem.
    const bySource = await runReport({
      propertyId,
      accessToken,
      startDate: rangeStart,
      endDate: rangeEnd,
      dimensions: ["date", "sessionSourceMedium"],
      metrics: ["sessions"],
    });
    points.push(
      ...topNPerDay(
        rowsToPoints(bySource, ["sessions"], ["sourceMedium"]),
        "sessions",
        25,
      ),
    );

    log.info(`GA4: ${points.length} pontos coletados`, {
      propertyId,
      rangeStart,
      rangeEnd,
    });

    return points;
  },
};
