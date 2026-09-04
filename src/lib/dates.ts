/**
 * Utilitarios de data em formato ISO curto (YYYY-MM-DD).
 *
 * Todo o sistema fala esse formato: e o que as APIs de anuncio aceitam, e o
 * que a coluna @db.Date guarda e o que evita a classe inteira de bugs de
 * fuso horario que aparece quando se usa Date do JavaScript no meio do caminho.
 */

export type IsoDate = string;

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): value is IsoDate {
  return ISO_RE.test(value);
}

/** Data de "hoje" no fuso do projeto, nao no fuso do servidor. */
export function todayIn(timeZone: string): IsoDate {
  // en-CA formata como YYYY-MM-DD, que e exatamente o que precisamos.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Soma dias tratando a data como UTC puro, sem horario de verao no meio. */
export function addDays(date: IsoDate, days: number): IsoDate {
  const [year, month, day] = date.split("-").map(Number);
  const utc = Date.UTC(year, month - 1, day + days);
  return new Date(utc).toISOString().slice(0, 10);
}

export function daysBetween(start: IsoDate, end: IsoDate): number {
  const [ys, ms, ds] = start.split("-").map(Number);
  const [ye, me, de] = end.split("-").map(Number);
  const diff = Date.UTC(ye, me - 1, de) - Date.UTC(ys, ms - 1, ds);
  return Math.round(diff / 86_400_000);
}

/** Converte para Date em meia-noite UTC, que e como o Prisma grava @db.Date. */
export function toUtcDate(date: IsoDate): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function fromUtcDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

/**
 * Quebra um intervalo em pedacos de no maximo `maxDays`.
 *
 * O backfill de 12 meses nao cabe em uma requisicao: a funcao serverless
 * estoura o tempo limite e as APIs reclamam do volume. Cada pedaco vira um
 * SyncJob independente, processado aos poucos.
 */
export function chunkRange(
  start: IsoDate,
  end: IsoDate,
  maxDays = 31,
): Array<{ start: IsoDate; end: IsoDate }> {
  const chunks: Array<{ start: IsoDate; end: IsoDate }> = [];
  let cursor = start;

  while (daysBetween(cursor, end) >= 0) {
    const candidateEnd = addDays(cursor, maxDays - 1);
    const chunkEnd = daysBetween(candidateEnd, end) > 0 ? end : candidateEnd;
    chunks.push({ start: cursor, end: chunkEnd });
    cursor = addDays(chunkEnd, 1);
  }

  return chunks;
}

export type CompareMode = "previous_period" | "previous_year" | "none";

/**
 * Periodo de comparacao do relatorio.
 *
 * "previous_period" desloca o intervalo inteiro para tras pela sua propria
 * duracao - um mes de 30 dias compara com os 30 dias anteriores, e nao com
 * "o mes passado do calendario". E o comportamento que o mercado espera.
 */
export function comparisonRange(
  start: IsoDate,
  end: IsoDate,
  mode: CompareMode,
): { start: IsoDate; end: IsoDate } | null {
  if (mode === "none") return null;

  if (mode === "previous_year") {
    const shift = (date: IsoDate): IsoDate => {
      const [year, month, day] = date.split("-").map(Number);
      return `${year - 1}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    };
    return { start: shift(start), end: shift(end) };
  }

  const length = daysBetween(start, end) + 1;
  return {
    start: addDays(start, -length),
    end: addDays(end, -length),
  };
}

/** Primeiro e ultimo dia do mes de `date`. Base dos relatorios mensais. */
export function monthRange(date: IsoDate): { start: IsoDate; end: IsoDate } {
  const [year, month] = date.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, "0");
  return {
    start: `${year}-${mm}-01`,
    end: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
  };
}
