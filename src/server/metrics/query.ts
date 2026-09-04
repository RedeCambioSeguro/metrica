/**
 * Camada de consulta das metricas.
 *
 * O relatorio nunca fala com a API do Google ou do Meta: le daqui, do cache
 * em Postgres. E o que faz um relatorio de 12 meses abrir em menos de um
 * segundo em vez de levar 40 e estourar cota.
 *
 * A regra que mais importa aqui: METRICAS DE RAZAO SAO SEMPRE RECALCULADAS.
 * Somar o CTR de 30 dias da um numero sem significado; a media simples tambem,
 * porque trata um dia com 10 impressoes igual a um dia com 100 mil. O jeito
 * certo e somar numerador e denominador do periodo inteiro e dividir no fim -
 * e por isso que os providers gravam os componentes, nao a razao pronta.
 */

import { Prisma } from "@prisma/client";

import { toUtcDate, type IsoDate } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { getProvider } from "@/providers/registry";
import type { MetricDefinition } from "@/providers/types";

export interface MetricValue {
  metric: string;
  label: string;
  value: number;
  format: MetricDefinition["format"];
  higherIsBetter?: boolean;
  /**
   * true quando o numero e uma aproximacao - hoje so acontece com metricas
   * "unique" (usuarios, alcance), em que somar os dias superestima o periodo.
   * A UI marca esses valores para nao passar precisao que nao existe.
   */
  approximate?: boolean;
}

interface RawTotal {
  metric: string;
  total: Prisma.Decimal | null;
}

/** Soma bruta por metrica, apenas linhas sem recorte de dimensao. */
async function rawTotals(
  connectionId: string,
  start: IsoDate,
  end: IsoDate,
): Promise<Map<string, number>> {
  const rows = await prisma.metricDaily.groupBy({
    by: ["metric"],
    where: {
      connectionId,
      dimensionKey: "",
      date: { gte: toUtcDate(start), lte: toUtcDate(end) },
    },
    _sum: { value: true },
  });

  return new Map(
    rows.map((row) => [row.metric, Number(row._sum.value ?? 0)]),
  );
}

/** Aplica ratioOf sobre os totais ja somados. */
function resolveMetric(
  definition: MetricDefinition,
  totals: Map<string, number>,
): number {
  if (definition.aggregation !== "ratio" || !definition.ratioOf) {
    return totals.get(definition.key) ?? 0;
  }

  const numerator = totals.get(definition.ratioOf.numerator) ?? 0;
  const denominator = totals.get(definition.ratioOf.denominator) ?? 0;
  if (denominator === 0) return 0;

  return (numerator / denominator) * (definition.ratioOf.multiplier ?? 1);
}

/**
 * Totais do periodo para uma conexao.
 * `metricKeys` vazio devolve tudo que o provider declara como exibivel.
 */
export async function getTotals(
  connectionId: string,
  providerId: string,
  start: IsoDate,
  end: IsoDate,
  metricKeys?: string[],
): Promise<MetricValue[]> {
  const provider = getProvider(providerId);
  const totals = await rawTotals(connectionId, start, end);

  const wanted = metricKeys?.length
    ? provider.metrics.filter((m) => metricKeys.includes(m.key))
    : provider.metrics;

  return wanted.map((definition) => ({
    metric: definition.key,
    label: definition.label,
    value: resolveMetric(definition, totals),
    format: definition.format,
    higherIsBetter: definition.higherIsBetter,
    approximate: definition.aggregation === "unique" || undefined,
  }));
}

export interface TimeSeriesPoint {
  date: IsoDate;
  values: Record<string, number>;
}

/**
 * Serie temporal diaria.
 *
 * Razoes sao calculadas DIA A DIA aqui (CTR do dia = cliques do dia sobre
 * impressoes do dia), que e o correto para um grafico de linha - diferente do
 * total do periodo, que usa os acumulados.
 */
export async function getTimeSeries(
  connectionId: string,
  providerId: string,
  start: IsoDate,
  end: IsoDate,
  metricKeys: string[],
): Promise<TimeSeriesPoint[]> {
  const provider = getProvider(providerId);
  const definitions = provider.metrics.filter((m) =>
    metricKeys.includes(m.key),
  );

  // Busca tambem os componentes das razoes pedidas.
  const needed = new Set<string>();
  for (const definition of definitions) {
    if (definition.ratioOf) {
      needed.add(definition.ratioOf.numerator);
      needed.add(definition.ratioOf.denominator);
    } else {
      needed.add(definition.key);
    }
  }

  const rows = await prisma.metricDaily.findMany({
    where: {
      connectionId,
      dimensionKey: "",
      metric: { in: [...needed] },
      date: { gte: toUtcDate(start), lte: toUtcDate(end) },
    },
    select: { date: true, metric: true, value: true },
    orderBy: { date: "asc" },
  });

  const byDate = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const iso = row.date.toISOString().slice(0, 10);
    const bucket = byDate.get(iso) ?? new Map<string, number>();
    bucket.set(row.metric, Number(row.value));
    byDate.set(iso, bucket);
  }

  return [...byDate.entries()].map(([date, bucket]) => ({
    date,
    values: Object.fromEntries(
      definitions.map((definition) => [
        definition.key,
        resolveMetric(definition, bucket),
      ]),
    ),
  }));
}

export interface BreakdownRow {
  label: string;
  values: Record<string, number>;
}

interface RawBreakdownRow {
  label: string | null;
  metric: string;
  total: Prisma.Decimal | null;
}

/**
 * Agrupamento por dimensao (campanha, canal, pagina...).
 *
 * Usa SQL cru porque o Prisma nao agrupa por um campo dentro do JSON. O nome
 * da dimensao vem do catalogo do provider, nunca da entrada do usuario, o que
 * mantem a interpolacao segura.
 */
export async function getBreakdown(
  connectionId: string,
  providerId: string,
  start: IsoDate,
  end: IsoDate,
  dimension: string,
  metricKeys: string[],
  limit = 20,
  sortBy?: string,
): Promise<BreakdownRow[]> {
  const provider = getProvider(providerId);

  if (!provider.dimensions.some((d) => d.key === dimension)) {
    throw new Error(
      `Dimensao "${dimension}" nao existe em ${provider.name}. Disponiveis: ${provider.dimensions.map((d) => d.key).join(", ")}`,
    );
  }

  const definitions = provider.metrics.filter((m) => metricKeys.includes(m.key));
  const needed = new Set<string>();
  for (const definition of definitions) {
    if (definition.ratioOf) {
      needed.add(definition.ratioOf.numerator);
      needed.add(definition.ratioOf.denominator);
    } else {
      needed.add(definition.key);
    }
  }

  const rows = await prisma.$queryRaw<RawBreakdownRow[]>`
    SELECT
      "dimensions"->>${dimension} AS label,
      "metric",
      SUM("value") AS total
    FROM "MetricDaily"
    WHERE "connectionId" = ${connectionId}
      AND "date" BETWEEN ${toUtcDate(start)}::date AND ${toUtcDate(end)}::date
      AND "dimensions" ? ${dimension}
      AND "metric" IN (${Prisma.join([...needed])})
    GROUP BY 1, 2
  `;

  const byLabel = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const label = row.label ?? "(nao definido)";
    const bucket = byLabel.get(label) ?? new Map<string, number>();
    bucket.set(row.metric, Number(row.total ?? 0));
    byLabel.set(label, bucket);
  }

  const result: BreakdownRow[] = [...byLabel.entries()].map(
    ([label, bucket]) => ({
      label,
      values: Object.fromEntries(
        definitions.map((definition) => [
          definition.key,
          resolveMetric(definition, bucket),
        ]),
      ),
    }),
  );

  const sortKey = sortBy ?? metricKeys[0];
  result.sort((a, b) => (b.values[sortKey] ?? 0) - (a.values[sortKey] ?? 0));

  return result.slice(0, limit);
}

export interface ComparedMetric extends MetricValue {
  previousValue: number | null;
  /** Variacao percentual. null quando nao ha base de comparacao. */
  changePercent: number | null;
}

/** Totais do periodo com a variacao contra o periodo anterior. */
export async function getTotalsWithComparison(
  connectionId: string,
  providerId: string,
  period: { start: IsoDate; end: IsoDate },
  comparison: { start: IsoDate; end: IsoDate } | null,
  metricKeys?: string[],
): Promise<ComparedMetric[]> {
  const current = await getTotals(
    connectionId,
    providerId,
    period.start,
    period.end,
    metricKeys,
  );

  if (!comparison) {
    return current.map((metric) => ({
      ...metric,
      previousValue: null,
      changePercent: null,
    }));
  }

  const previous = await getTotals(
    connectionId,
    providerId,
    comparison.start,
    comparison.end,
    metricKeys,
  );
  const previousByKey = new Map(previous.map((m) => [m.metric, m.value]));

  return current.map((metric) => {
    const previousValue = previousByKey.get(metric.metric) ?? 0;
    // Sem base anterior nao existe "variacao percentual": crescer de 0 para 10
    // nao e +1000%, e simplesmente incomparavel.
    const changePercent =
      previousValue === 0
        ? null
        : ((metric.value - previousValue) / Math.abs(previousValue)) * 100;

    return { ...metric, previousValue, changePercent };
  });
}
