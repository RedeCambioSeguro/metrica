/**
 * Google Ads (REST, searchStream).
 *
 * Pre-requisitos que NAO sao codigo:
 *   1. Developer token em https://ads.google.com -> Ferramentas -> API Center.
 *      Ele nasce com "Test Account access": funciona apenas em contas de teste.
 *      Para ler contas reais e preciso solicitar "Basic Access" e aguardar
 *      aprovacao do Google (costuma levar dias).
 *   2. O token vai no header `developer-token` de TODA requisicao.
 *   3. Contas sob um MCC exigem o header `login-customer-id` com o id do MCC,
 *      guardado em Connection.config.loginCustomerId.
 *
 * A versao da API sai de GOOGLE_ADS_API_VERSION porque o Google descontinua
 * versoes a cada ~4 meses; trocar uma variavel de ambiente e mais barato que
 * fazer deploy.
 */

import { apiFetch, getJson } from "../http";
import type {
  ExternalAccount,
  ListAccountsContext,
  MetricPoint,
  MetricProvider,
  SyncContext,
} from "../types";

const API_VERSION = process.env.GOOGLE_ADS_API_VERSION ?? "v18";
const API = `https://googleads.googleapis.com/${API_VERSION}`;

const MICROS = 1_000_000;

interface SearchStreamChunk {
  results?: Array<Record<string, any>>;
}

interface ListAccessibleCustomersResponse {
  resourceNames?: string[];
}

function developerToken(): string {
  const token = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!token) {
    throw new Error(
      "GOOGLE_ADS_DEVELOPER_TOKEN ausente. Solicite em ads.google.com > Ferramentas > API Center.",
    );
  }
  return token;
}

function adsHeaders(
  accessToken: string,
  loginCustomerId?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": developerToken(),
    "Content-Type": "application/json",
  };
  if (loginCustomerId) {
    headers["login-customer-id"] = stripDashes(loginCustomerId);
  }
  return headers;
}

function stripDashes(id: string): string {
  return id.replace(/-/g, "");
}

/**
 * searchStream devolve um ARRAY de chunks, nao um objeto unico.
 * Cada chunk traz um lote de `results`.
 */
async function searchStream(
  accessToken: string,
  customerId: string,
  query: string,
  label: string,
  loginCustomerId?: string,
): Promise<Array<Record<string, any>>> {
  const chunks = await apiFetch<SearchStreamChunk[]>(
    `${API}/customers/${stripDashes(customerId)}/googleAds:searchStream`,
    {
      label,
      method: "POST",
      headers: adsHeaders(accessToken, loginCustomerId),
      body: JSON.stringify({ query }),
    },
  );

  const results: Array<Record<string, any>> = [];
  for (const chunk of chunks ?? []) {
    results.push(...(chunk.results ?? []));
  }
  return results;
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Extrai as metricas comuns de uma linha do Google Ads. */
function metricsFromRow(
  row: Record<string, any>,
  date: string,
  dimensions?: Record<string, string>,
): MetricPoint[] {
  const m = row.metrics ?? {};
  const point = (metric: string, value: number): MetricPoint => ({
    date,
    metric,
    value,
    dimensions,
  });

  return [
    point("impressions", num(m.impressions)),
    point("clicks", num(m.clicks)),
    point("cost", num(m.costMicros) / MICROS),
    point("conversions", num(m.conversions)),
    point("conversionsValue", num(m.conversionsValue)),
    point("interactions", num(m.interactions)),
    point("videoViews", num(m.videoViews)),
  ];
}

export const googleAdsProvider: MetricProvider = {
  id: "google_ads",
  name: "Google Ads",
  family: "google",
  brandColor: "#34A853",
  availability: "needs_api_approval",
  approvalNote:
    "Exige developer token com Basic Access aprovado pelo Google. Ate la, so contas de teste retornam dados.",
  scopes: ["https://www.googleapis.com/auth/adwords"],

  metrics: [
    {
      key: "impressions",
      label: "Impressoes",
      format: "integer",
      aggregation: "sum",
      higherIsBetter: true,
    },
    {
      key: "clicks",
      label: "Cliques",
      format: "integer",
      aggregation: "sum",
      higherIsBetter: true,
    },
    {
      key: "cost",
      label: "Investimento",
      format: "currency",
      aggregation: "sum",
      higherIsBetter: false,
    },
    {
      key: "conversions",
      label: "Conversoes",
      format: "decimal",
      aggregation: "sum",
      higherIsBetter: true,
    },
    {
      key: "conversionsValue",
      label: "Valor de conversao",
      format: "currency",
      aggregation: "sum",
      higherIsBetter: true,
    },
    {
      key: "interactions",
      label: "Interacoes",
      format: "integer",
      aggregation: "sum",
      higherIsBetter: true,
    },
    {
      key: "videoViews",
      label: "Visualizacoes de video",
      format: "integer",
      aggregation: "sum",
      higherIsBetter: true,
    },
    // --- Razoes: recalculadas sobre os totais do periodo ---
    {
      key: "ctr",
      label: "CTR",
      format: "percent",
      aggregation: "ratio",
      higherIsBetter: true,
      ratioOf: {
        numerator: "clicks",
        denominator: "impressions",
        multiplier: 100,
      },
    },
    {
      key: "cpc",
      label: "CPC medio",
      format: "currency",
      aggregation: "ratio",
      higherIsBetter: false,
      ratioOf: { numerator: "cost", denominator: "clicks" },
    },
    {
      key: "cpm",
      label: "CPM",
      format: "currency",
      aggregation: "ratio",
      higherIsBetter: false,
      ratioOf: {
        numerator: "cost",
        denominator: "impressions",
        multiplier: 1000,
      },
    },
    {
      key: "cpa",
      label: "Custo por conversao",
      format: "currency",
      aggregation: "ratio",
      higherIsBetter: false,
      ratioOf: { numerator: "cost", denominator: "conversions" },
    },
    {
      key: "conversionRate",
      label: "Taxa de conversao",
      format: "percent",
      aggregation: "ratio",
      higherIsBetter: true,
      ratioOf: {
        numerator: "conversions",
        denominator: "clicks",
        multiplier: 100,
      },
    },
    {
      key: "roas",
      label: "ROAS",
      format: "decimal",
      aggregation: "ratio",
      higherIsBetter: true,
      ratioOf: { numerator: "conversionsValue", denominator: "cost" },
    },
  ],

  dimensions: [
    { key: "campaign", label: "Campanha", topNPerDay: 50 },
    { key: "network", label: "Rede" },
    { key: "device", label: "Dispositivo" },
  ],

  defaultBlocks: [
    {
      type: "kpi_row",
      title: "Resumo da midia paga",
      config: {
        metrics: ["cost", "clicks", "conversions", "cpa", "roas"],
      },
    },
    {
      type: "time_series",
      title: "Investimento e conversoes",
      config: { metrics: ["cost", "conversions"] },
    },
    {
      type: "table",
      title: "Desempenho por campanha",
      config: {
        dimension: "campaign",
        metrics: ["cost", "impressions", "clicks", "ctr", "conversions", "cpa"],
        limit: 20,
        sortBy: "cost",
      },
    },
    {
      type: "donut",
      title: "Investimento por dispositivo",
      config: { metric: "cost", dimension: "device", limit: 5 },
    },
  ],

  async listAccounts({ accessToken, log }: ListAccountsContext): Promise<ExternalAccount[]> {
    const accessible = await getJson<ListAccessibleCustomersResponse>(
      `${API}/customers:listAccessibleCustomers`,
      accessToken,
      "Google Ads listAccessibleCustomers",
      { "developer-token": developerToken() },
    );

    const rootIds = (accessible.resourceNames ?? [])
      .map((name) => name.split("/").pop())
      .filter((id): id is string => Boolean(id));

    const accounts: ExternalAccount[] = [];
    const seen = new Set<string>();

    // Cada id acessivel pode ser uma conta comum ou um MCC. Consultamos
    // customer_client para descobrir a arvore inteira sob cada um.
    for (const rootId of rootIds) {
      try {
        const rows = await searchStream(
          accessToken,
          rootId,
          `SELECT
             customer_client.id,
             customer_client.descriptive_name,
             customer_client.manager,
             customer_client.currency_code,
             customer_client.time_zone,
             customer_client.status
           FROM customer_client
           WHERE customer_client.status = 'ENABLED'`,
          "Google Ads customer_client",
          rootId,
        );

        for (const row of rows) {
          const client = row.customerClient ?? {};
          const id = String(client.id ?? "");
          if (!id || seen.has(id)) continue;
          seen.add(id);

          const isManager = Boolean(client.manager);
          accounts.push({
            externalId: id,
            name:
              client.descriptiveName ??
              `Conta ${id}${isManager ? " (administradora)" : ""}`,
            // MCC nao tem metricas proprias: aparece na lista mas nao e vinculavel.
            selectable: !isManager,
            group: isManager ? undefined : `MCC ${rootId}`,
            config: {
              loginCustomerId: rootId === id ? undefined : rootId,
              currency: client.currencyCode,
              timezone: client.timeZone,
              isManager,
            },
          });
        }
      } catch (error) {
        // Um MCC sem permissao nao deve derrubar a listagem inteira.
        log.warn(`Google Ads: falha ao listar clientes de ${rootId}`, error);
      }
    }

    return accounts;
  },

  async sync(ctx: SyncContext): Promise<MetricPoint[]> {
    const { accessToken, connection, rangeStart, rangeEnd, log } = ctx;
    const customerId = connection.externalId;
    const loginCustomerId = connection.config.loginCustomerId as
      | string
      | undefined;
    const where = `segments.date BETWEEN '${rangeStart}' AND '${rangeEnd}'`;
    const points: MetricPoint[] = [];

    const METRIC_FIELDS = `
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value,
      metrics.interactions,
      metrics.video_views`;

    // 1) Totais da conta por dia.
    const daily = await searchStream(
      accessToken,
      customerId,
      `SELECT segments.date, ${METRIC_FIELDS} FROM customer WHERE ${where}`,
      "Google Ads totais",
      loginCustomerId,
    );
    for (const row of daily) {
      const date = row.segments?.date;
      if (date) points.push(...metricsFromRow(row, date));
    }

    // 2) Por campanha.
    const byCampaign = await searchStream(
      accessToken,
      customerId,
      `SELECT segments.date, campaign.name, ${METRIC_FIELDS}
       FROM campaign
       WHERE ${where}`,
      "Google Ads por campanha",
      loginCustomerId,
    );
    for (const row of byCampaign) {
      const date = row.segments?.date;
      const campaign = row.campaign?.name;
      if (date && campaign) {
        points.push(...metricsFromRow(row, date, { campaign }));
      }
    }

    // 3) Por dispositivo.
    const byDevice = await searchStream(
      accessToken,
      customerId,
      `SELECT segments.date, segments.device, ${METRIC_FIELDS}
       FROM customer
       WHERE ${where}`,
      "Google Ads por dispositivo",
      loginCustomerId,
    );
    for (const row of byDevice) {
      const date = row.segments?.date;
      const device = row.segments?.device;
      if (date && device) {
        points.push(...metricsFromRow(row, date, { device }));
      }
    }

    log.info(`Google Ads: ${points.length} pontos coletados`, { customerId });
    return points;
  },
};
